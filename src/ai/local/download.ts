// Fetches one pinned file: to a temporary name first, checked for size and
// SHA-256, and only then moved into place. A file that is cut short, altered or
// cancelled never ends up under its final name.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, statfs } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { PinnedFile } from './assets.ts';

export type SetupFailure = 'cancelled' | 'network' | 'corrupt' | 'disk_full' | 'unsupported' | 'failed';

/** A failed set-up step, with a message that can be shown as it is. */
export class SetupError extends Error {
  readonly kind: SetupFailure;

  constructor(kind: SetupFailure, message: string) {
    super(message);
    this.name = 'SetupError';
    this.kind = kind;
  }
}

/** Kept free beyond the download itself, so the disk is not filled to the last byte. */
export const DISK_MARGIN_BYTES = 200 * 1024 * 1024;

export const megabytes = (bytes: number): string => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`);

/** Refuses before downloading when the disk cannot hold the files. */
export async function requireSpace(dir: string, bytes: number, free?: (dir: string) => Promise<number>): Promise<void> {
  let available: number;
  try {
    available = free ? await free(dir) : await statfs(dir).then((s) => Number(s.bavail) * Number(s.bsize));
  } catch {
    return; // The file system does not say; the write itself will fail if there is no room.
  }
  if (available < bytes + DISK_MARGIN_BYTES) {
    throw new SetupError('disk_full', `Not enough free disk space: ${megabytes(bytes + DISK_MARGIN_BYTES)} is needed and ${megabytes(available)} is free. Free some space and try again.`);
  }
}

/** True when the file has exactly the pinned size and hash. */
export async function verifyFile(path: string, pinned: PinnedFile, signal?: AbortSignal): Promise<boolean> {
  try {
    if ((await stat(path)).size !== pinned.bytes) return false;
  } catch {
    return false;
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk as Buffer);
  return hash.digest('hex') === pinned.sha256;
}

export interface DownloadOptions {
  pinned: PinnedFile;
  dest: string;
  signal: AbortSignal;
  onProgress: (received: number) => void;
  fetchImpl?: typeof fetch;
}

export async function downloadVerified({ pinned, dest, signal, onProgress, fetchImpl = fetch }: DownloadOptions): Promise<void> {
  const host = new URL(pinned.url).host;
  const temp = `${dest}.part`;
  await mkdir(dirname(dest), { recursive: true });
  await rm(temp, { force: true });
  const cancelled = () => new SetupError('cancelled', 'The download was cancelled. Nothing was installed.');

  let response: Response;
  try {
    response = await fetchImpl(pinned.url, { signal, redirect: 'follow' });
  } catch {
    if (signal.aborted) throw cancelled();
    throw new SetupError('network', `Could not reach ${host}. Check the internet connection and try again.`);
  }
  if (!response.ok || response.body === null) {
    throw new SetupError('network', `${host} answered with status ${response.status}, so the file was not downloaded.`);
  }

  const hash = createHash('sha256');
  const out = createWriteStream(temp);
  let received = 0;
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk);
      received += chunk.byteLength;
      if (received > pinned.bytes) break;
      if (!out.write(chunk)) await new Promise<void>((done, fail) => (out.once('drain', done), out.once('error', fail)));
      onProgress(received);
    }
    await new Promise<void>((done, fail) => out.end((error?: Error | null) => (error ? fail(error) : done())));
  } catch (cause) {
    // Wait until the file is really closed: removing it while it is still being opened would leave it behind.
    await new Promise<void>((done) => (out.closed ? done() : (out.once('close', () => done()), out.destroy())));
    await rm(temp, { force: true });
    if (signal.aborted) throw cancelled();
    if ((cause as { code?: string } | null)?.code === 'ENOSPC') {
      throw new SetupError('disk_full', 'The disk filled up during the download. Free some space and try again.');
    }
    throw new SetupError('network', `The download from ${host} was interrupted. Nothing was installed; try again.`);
  }

  if (received !== pinned.bytes || hash.digest('hex') !== pinned.sha256) {
    await rm(temp, { force: true });
    throw new SetupError('corrupt', `The file from ${host} does not match its expected size and checksum, so it was discarded. Try again.`);
  }
  await rename(temp, dest);
}
