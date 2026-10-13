// Unpacks a .tar.gz archive with Node's own zlib, so set-up needs no system tool.
// It handles what the llama.cpp release archives contain: folders, files and
// relative symbolic links. Anything that would land outside the target is refused.
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';

const BLOCK = 512;
const text = (buffer: Buffer, start: number, length: number): string => {
  const slice = buffer.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8');
};

function inside(root: string, name: string): string {
  const target = resolve(root, name);
  if (target !== root && !target.startsWith(root + sep)) throw new Error(`The archive holds a path outside its folder: ${name}`);
  return target;
}

/** Extracts the archive into `dest`, which must not hold anything that matters. Returns the entries written. */
export async function extractTarGz(archive: Buffer, dest: string): Promise<string[]> {
  const data = gunzipSync(archive);
  const root = resolve(dest);
  await mkdir(root, { recursive: true });
  const written: string[] = [];
  let longName: string | null = null;

  for (let offset = 0; offset + BLOCK <= data.length; ) {
    const header = data.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const size = parseInt(text(header, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(header[156]!);
    const prefix = text(header, 345, 155);
    const name: string = longName ?? (prefix ? `${prefix}/${text(header, 0, 100)}` : text(header, 0, 100));
    const body = data.subarray(offset + BLOCK, offset + BLOCK + size);
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
    longName = null;

    if (type === 'L') {
      longName = text(body, 0, body.length); // GNU: the next entry's real name
    } else if (type === 'x' || type === 'g') {
      const path = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString('utf8'));
      if (type === 'x' && path) longName = path[1]!;
    } else if (type === '5') {
      await mkdir(inside(root, name), { recursive: true });
    } else if (type === '0' || type === '\0') {
      const target = inside(root, name);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, body, { mode: parseInt(text(header, 100, 8).trim() || '644', 8) & 0o777 });
      written.push(name);
    } else if (type === '2') {
      const link = text(header, 157, 100);
      const target = inside(root, name);
      // A link may only point at a neighbour inside the archive's own folder.
      if (isAbsolute(link) || normalize(link).startsWith('..')) throw new Error(`The archive holds a link outside its folder: ${name}`);
      inside(root, join(dirname(name), link));
      await mkdir(dirname(target), { recursive: true });
      await symlink(link, target);
      written.push(name);
    }
    // Other entry types (devices, hard links) do not occur in these archives and are skipped.
  }
  return written;
}
