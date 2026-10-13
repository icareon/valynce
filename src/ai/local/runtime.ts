// Starts and stops the local model server (llama.cpp's llama-server) as a child
// process. It listens on the loopback address only, on a spare port, behind a
// key made up for this run, with its web page and its own downloads turned off.
// It is started when the first offline summary is asked for, never at start-up.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { dirname } from 'node:path';
import { ProviderError } from '../provider.ts';

/** Tokens of context: room for the reports of one analysis and a short reply. */
export const LOCAL_CONTEXT_TOKENS = 8192;
/** The model is dropped from memory after this long without a request and loaded again on the next one. */
export const LOCAL_IDLE_SECONDS = 300;
const START_TIMEOUT_MS = 90_000;

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.on('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => (typeof address === 'object' && address !== null ? done(address.port) : fail(new Error('no port'))));
    });
  });
}

export interface RunningModel {
  baseUrl: string;
  key: string;
}

export class LocalRuntime {
  readonly #program: string;
  readonly #model: string;
  #child: ChildProcess | null = null;
  #starting: Promise<RunningModel> | null = null;
  #log = '';

  constructor(program: string, model: string) {
    this.#program = program;
    this.#model = model;
  }

  get running(): boolean {
    return this.#child !== null;
  }

  /** The running server, started first if need be. Concurrent callers share one start. */
  ensure(signal?: AbortSignal): Promise<RunningModel> {
    this.#starting ??= this.#start(signal).catch((error: unknown) => {
      this.#starting = null;
      throw error;
    });
    return this.#starting;
  }

  async #start(signal?: AbortSignal): Promise<RunningModel> {
    const port = await freePort();
    const key = randomBytes(24).toString('hex');
    const folder = dirname(this.#program);
    this.#log = '';
    let child: ChildProcess;
    try {
      child = spawn(
        this.#program,
        ['-m', this.#model, '--host', '127.0.0.1', '--port', String(port), '-c', String(LOCAL_CONTEXT_TOKENS), '-np', '1', '--no-webui', '--no-slots', '--offline', '--reasoning', 'off', '--sleep-idle-seconds', String(LOCAL_IDLE_SECONDS)],
        {
          cwd: folder,
          // The key goes through the environment so it is not visible in the process list.
          env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', LLAMA_API_KEY: key, LD_LIBRARY_PATH: folder },
          stdio: ['ignore', 'ignore', 'pipe'],
        },
      );
    } catch {
      throw new ProviderError('runtime', 'The local model runtime could not be started on this computer.');
    }
    this.#child = child;
    child.stderr?.on('data', (chunk: Buffer) => (this.#log = (this.#log + chunk.toString('utf8')).slice(-4000)));
    let exited = false;
    let spawnFailed = false;
    child.once('error', () => ((spawnFailed = true), (exited = true)));
    child.once('exit', () => {
      exited = true;
      if (this.#child === child) {
        this.#child = null;
        this.#starting = null;
      }
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + START_TIMEOUT_MS;
    for (;;) {
      if (exited) {
        throw new ProviderError(
          'runtime',
          spawnFailed
            ? 'The local model runtime could not be started on this computer. Remove the offline AI files and enable it again.'
            : `The local model runtime stopped while loading the model. ${this.#reason()}`,
        );
      }
      if (signal?.aborted) {
        this.stop();
        throw new ProviderError('timeout', 'The local model was still loading when the request was stopped.');
      }
      if (Date.now() > deadline) {
        this.stop();
        throw new ProviderError('runtime', 'The local model did not finish loading in time. This computer may not have enough free memory.');
      }
      try {
        const health = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
        if (health.ok) return { baseUrl, key };
      } catch {
        // not listening yet
      }
      await new Promise((done) => setTimeout(done, 150));
    }
  }

  /** The runtime's own last words, reduced to something a person can act on. */
  #reason(): string {
    const log = this.#log.toLowerCase();
    if (/illegal instruction|unsupported cpu|avx/.test(log)) return 'This processor is not supported by the runtime build.';
    if (/out of memory|failed to allocate|insufficient memory|bad_alloc/.test(log)) return 'There was not enough free memory to load it.';
    if (/invalid magic|failed to load model|error loading model|gguf/.test(log)) return 'The model file could not be read. Remove the offline AI files and enable it again.';
    if (/library not loaded|cannot open shared object|image not found|glibc/.test(log)) return 'A system library the runtime needs is missing on this computer.';
    return 'This computer may not be supported, or may be short of memory.';
  }

  /** Stops the server and frees the model's memory. Safe to call when nothing is running. */
  stop(): void {
    const child = this.#child;
    this.#child = null;
    this.#starting = null;
    if (child !== null && child.exitCode === null) child.kill('SIGTERM');
  }
}
