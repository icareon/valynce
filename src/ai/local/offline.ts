// The offline AI as the rest of Valynce sees it: whether it is installed, the
// one explicit set-up that downloads it, and a ModelProvider that runs on this
// computer. Nothing is downloaded, verified against the network or started
// unless the user asked for that step.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProviderError } from '../provider.ts';
import type { ModelProvider, ModelReply, ModelRequest, OfflineState, OfflineStatus } from '../provider.ts';
import { pinnedManifest } from './assets.ts';
import type { LocalManifest } from './assets.ts';
import { downloadVerified, megabytes, requireSpace, SetupError, verifyFile } from './download.ts';
import { LocalRuntime } from './runtime.ts';
import { extractTarGz } from './untar.ts';

export interface OfflineOptions {
  dir: string;
  manifest?: LocalManifest;
  platformLabel?: string;
  fetchImpl?: typeof fetch;
  /** Free bytes on the disk holding `dir`. Replaced in tests. */
  freeBytes?: (dir: string) => Promise<number>;
}

const MARKER = 'installed.json';

export class OfflineAi {
  readonly #dir: string;
  readonly #manifest: LocalManifest;
  readonly #fetch: typeof fetch;
  readonly #free: OfflineOptions['freeBytes'];
  readonly #platform: string;
  #state: OfflineState;
  #step: OfflineStatus['step'] = null;
  #received = 0;
  #message: string | null = null;
  #abort: AbortController | null = null;
  #work: Promise<void> | null = null;
  #runtime: LocalRuntime | null = null;

  constructor(options: OfflineOptions) {
    this.#dir = options.dir;
    this.#manifest = options.manifest ?? pinnedManifest();
    this.#fetch = options.fetchImpl ?? fetch;
    this.#free = options.freeBytes;
    this.#platform = options.platformLabel ?? `${process.platform} ${process.arch}`;
    this.#state = this.#manifest.runtime.archive === null ? 'unsupported' : this.#installed() ? 'ready' : 'not_installed';
    if (this.#state === 'unsupported') {
      this.#message = `Offline AI is not available on this platform yet (${this.#platform}). It can be set up on macOS and Linux.`;
    }
  }

  get #modelPath(): string {
    return join(this.#dir, this.#manifest.model.file);
  }

  get #runtimeDir(): string {
    return join(this.#dir, `runtime-${this.#manifest.runtime.build}`);
  }

  get #programPath(): string {
    return join(this.#runtimeDir, this.#manifest.runtime.folder, this.#manifest.runtime.program);
  }

  /** A cheap check made without reading the model: the marker written after verification, and the files it names. */
  #installed(): boolean {
    return existsSync(join(this.#dir, MARKER)) && existsSync(this.#modelPath) && existsSync(this.#programPath);
  }

  status(): OfflineStatus {
    const { model, runtime } = this.#manifest;
    return {
      state: this.#state,
      model: { label: model.label, id: model.id, bytes: model.bytes, source: model.source },
      runtime: runtime.archive === null ? null : { name: runtime.name, build: runtime.build, bytes: runtime.archive.bytes, source: runtime.source },
      totalBytes: model.bytes + (runtime.archive?.bytes ?? 0),
      step: this.#state === 'downloading' ? this.#step : null,
      receivedBytes: this.#state === 'downloading' ? this.#received : 0,
      message: this.#message,
      folder: this.#dir,
    };
  }

  /** Starts the download the user asked for. Returns at once; `status()` reports progress. */
  install(): OfflineStatus {
    if (this.#state === 'unsupported' || this.#state === 'downloading' || this.#state === 'ready') return this.status();
    this.#abort = new AbortController();
    this.#state = 'downloading';
    this.#step = 'checking';
    this.#received = 0;
    this.#message = null;
    this.#work = this.#install(this.#abort.signal).then(
      () => {
        this.#state = 'ready';
      },
      (cause: unknown) => {
        if (cause instanceof SetupError && cause.kind === 'cancelled') {
          this.#state = 'not_installed';
          this.#message = null;
        } else {
          this.#state = 'failed';
          this.#message = cause instanceof SetupError ? cause.message : 'Offline AI could not be set up. Nothing was installed; try again.';
        }
      },
    );
    return this.status();
  }

  async #install(signal: AbortSignal): Promise<void> {
    const { model, runtime } = this.#manifest;
    const archive = runtime.archive!;
    await mkdir(this.#dir, { recursive: true });
    await rm(join(this.#dir, MARKER), { force: true });

    // A file left by an earlier, verified or interrupted set-up is reused only if it still matches.
    const haveModel = await verifyFile(this.#modelPath, model, signal).catch(() => false);
    if (signal.aborted) throw new SetupError('cancelled', 'cancelled');
    const haveRuntime = existsSync(this.#programPath);
    await requireSpace(this.#dir, (haveModel ? 0 : model.bytes) + (haveRuntime ? 0 : archive.bytes * 4), this.#free);

    let before = 0;
    if (haveRuntime) {
      before += archive.bytes;
    } else {
      this.#step = 'runtime';
      const packed = join(this.#dir, `runtime-${runtime.build}.tar.gz`);
      await downloadVerified({ pinned: archive, dest: packed, signal, fetchImpl: this.#fetch, onProgress: (n) => (this.#received = n) });
      const unpacked = `${this.#runtimeDir}.tmp`;
      await rm(unpacked, { recursive: true, force: true });
      await rm(this.#runtimeDir, { recursive: true, force: true });
      try {
        await extractTarGz(await readFile(packed), unpacked);
        if (!existsSync(join(unpacked, runtime.folder, runtime.program))) throw new Error('program missing');
      } catch {
        await rm(unpacked, { recursive: true, force: true });
        await rm(packed, { force: true });
        throw new SetupError('corrupt', 'The runtime archive could not be unpacked, so it was discarded. Try again.');
      }
      await rename(unpacked, this.#runtimeDir);
      await rm(packed, { force: true });
      before = archive.bytes;
    }
    this.#received = before;

    if (!haveModel) {
      this.#step = 'model';
      await rm(this.#modelPath, { force: true });
      await downloadVerified({ pinned: model, dest: this.#modelPath, signal, fetchImpl: this.#fetch, onProgress: (n) => (this.#received = before + n) });
    }
    this.#received = before + model.bytes;
    await writeFile(join(this.#dir, MARKER), JSON.stringify({ model: { file: model.file, bytes: model.bytes, sha256: model.sha256 }, runtime: { build: runtime.build, sha256: archive.sha256 }, verifiedAt: new Date().toISOString() }, null, 1));
  }

  /** Stops a download in progress. The partial file is deleted. */
  async cancel(): Promise<OfflineStatus> {
    this.#abort?.abort();
    await this.#work;
    return this.status();
  }

  /** Deletes the downloaded model and runtime. Summaries already stored are kept. */
  async remove(): Promise<OfflineStatus> {
    await this.cancel();
    this.#runtime?.stop();
    this.#runtime = null;
    if (this.#state !== 'unsupported') {
      const { model, runtime } = this.#manifest;
      // Only the files Valynce put there: the folder itself may be one the user chose.
      for (const name of [MARKER, model.file, `${model.file}.part`, `runtime-${runtime.build}.tar.gz`, `runtime-${runtime.build}.tar.gz.part`]) {
        await rm(join(this.#dir, name), { force: true });
      }
      await rm(this.#runtimeDir, { recursive: true, force: true });
      await rm(`${this.#runtimeDir}.tmp`, { recursive: true, force: true });
      this.#state = 'not_installed';
      this.#message = null;
    }
    return this.status();
  }

  /** The offline provider. Asking for it starts nothing; the model loads on the first request. */
  provider(): ModelProvider {
    const { model } = this.#manifest;
    return {
      location: 'offline',
      name: 'This computer',
      model: model.id,
      host: '127.0.0.1',
      complete: (request) => this.#complete(request),
    };
  }

  async #complete(request: ModelRequest): Promise<ModelReply> {
    if (this.#state !== 'ready') {
      throw new ProviderError('not_installed', 'Offline AI is not installed. Choose "Enable offline AI" first.');
    }
    // A model file that was removed or cut short behind Valynce's back is reported, not downloaded again.
    const size = await stat(this.#modelPath).then((s) => s.size, () => -1);
    if (size !== this.#manifest.model.bytes || !existsSync(this.#programPath)) {
      this.#state = 'failed';
      this.#message = 'The offline AI files are missing or damaged. Remove them and enable offline AI again.';
      throw new ProviderError('not_installed', this.#message);
    }
    this.#runtime ??= new LocalRuntime(this.#programPath, this.#modelPath);
    const running = await this.#runtime.ensure(request.signal);

    let response: Response;
    try {
      response = await fetch(`${running.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${running.key}` },
        body: JSON.stringify({
          messages: [{ role: 'system', content: request.system }, ...request.messages],
          // The runtime turns the schema into a grammar, so the reply cannot leave its shape.
          response_format: { type: 'json_schema', json_schema: { name: 'summary', schema: request.schema } },
          // Qwen3's documented switch for non-thinking mode, with its recommended sampling for that mode.
          chat_template_kwargs: { enable_thinking: false },
          temperature: 0.7,
          top_p: 0.8,
          top_k: 20,
          max_tokens: request.maxOutputTokens,
          cache_prompt: false,
        }),
        signal: request.signal,
      });
    } catch {
      if (request.signal.aborted) throw new ProviderError('timeout', 'The local model did not finish in time, or the request was stopped.');
      this.#runtime.stop();
      throw new ProviderError('runtime', 'The local model runtime stopped answering. Try again; if it keeps happening this computer may be short of memory.');
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      if (request.signal.aborted) throw new ProviderError('timeout', 'The local model did not finish in time, or the request was stopped.');
    }
    if (!response.ok) {
      const detail = (body as { error?: { message?: unknown } } | null)?.error?.message;
      const text = typeof detail === 'string' ? detail : '';
      if (/context|too (?:long|large)|exceed/i.test(text)) {
        throw new ProviderError('truncated', 'This selection is too long for the local model. Narrow it with the search, the status filter or one category.');
      }
      throw new ProviderError('runtime', `The local model runtime answered with an error, status ${response.status}.`);
    }
    const reply = body as { choices?: { finish_reason?: unknown; message?: { content?: unknown } }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } } | null;
    const choice = reply?.choices?.[0];
    if (choice?.finish_reason === 'length') throw new ProviderError('truncated', 'The reply was cut off at the output limit, so it was discarded.');
    const content = choice?.message?.content;
    if (typeof content !== 'string') throw new ProviderError('bad_reply', 'The local model sent a reply with no text in it.');
    const tokens = (value: unknown) => (typeof value === 'number' ? value : null);
    return { text: content, inputTokens: tokens(reply?.usage?.prompt_tokens), outputTokens: tokens(reply?.usage?.completion_tokens) };
  }

  /** Stops any download and the model server. Called when Valynce shuts down. */
  shutdown(): void {
    this.#abort?.abort();
    this.#runtime?.stop();
    this.#runtime = null;
  }
}

export { megabytes };
export type { OfflineState, OfflineStatus };
