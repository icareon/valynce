// The one thing Valynce asks of a model provider: a single bounded request that
// returns JSON matching a schema. Anything provider-specific stays in its adapter,
// so another provider can be added without touching the server or the rules.

export interface ModelMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ModelRequest {
  system: string;
  messages: ModelMessage[];
  /** JSON Schema the reply must match. */
  schema: Record<string, unknown>;
  /** Hard limit on what the model may write back, thinking included. */
  maxOutputTokens: number;
  /** Aborts the request. The caller sets the time limit. */
  signal: AbortSignal;
}

export interface ModelReply {
  /** The reply text, expected to be one JSON document. */
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** Where a model runs: on this computer, or at an external provider. */
export type AiLocation = 'offline' | 'online';

export interface ModelProvider {
  /** Offline providers run on this computer and send nothing outside it. */
  location: AiLocation;
  /** Who receives the data, as shown to the user before anything is sent. */
  name: string;
  model: string;
  /** The host the request goes to. For an offline provider this is the loopback address. */
  host: string;
  complete(request: ModelRequest): Promise<ModelReply>;
}

export type OfflineState = 'unsupported' | 'not_installed' | 'downloading' | 'ready' | 'failed';

/** What the interface shows about the offline AI. It holds sizes and names, never a path to user data. */
export interface OfflineStatus {
  state: OfflineState;
  model: { label: string; id: string; bytes: number; source: string };
  /** Null when Valynce cannot manage a runtime on this platform. */
  runtime: { name: string; build: string; bytes: number; source: string } | null;
  /** Everything a set-up downloads, in bytes. */
  totalBytes: number;
  /** While downloading: what is being fetched and how far it is. */
  step: 'runtime' | 'model' | 'checking' | null;
  receivedBytes: number;
  /** Why set-up failed or cannot run here, in words that can be shown. */
  message: string | null;
  /** The folder the files are kept in, so the user can find or remove them. */
  folder: string;
}

export type ProviderFailure =
  | 'auth'
  | 'rate_limited'
  | 'timeout'
  | 'unreachable'
  | 'refused'
  | 'truncated'
  | 'provider_error'
  | 'bad_reply'
  /** The offline model or its runtime is not installed. */
  | 'not_installed'
  /** The offline runtime could not start or stopped answering. */
  | 'runtime';

/** A failed request, with a message that is safe to show: it never contains the key or the records. */
export class ProviderError extends Error {
  readonly kind: ProviderFailure;

  constructor(kind: ProviderFailure, message: string) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
  }
}
