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

export interface ModelProvider {
  /** Who receives the data, as shown to the user before anything is sent. */
  name: string;
  model: string;
  /** The host the request goes to. */
  host: string;
  complete(request: ModelRequest): Promise<ModelReply>;
}

export type ProviderFailure =
  | 'auth'
  | 'rate_limited'
  | 'timeout'
  | 'unreachable'
  | 'refused'
  | 'truncated'
  | 'provider_error'
  | 'bad_reply';

/** A failed request, with a message that is safe to show: it never contains the key or the records. */
export class ProviderError extends Error {
  readonly kind: ProviderFailure;

  constructor(kind: ProviderFailure, message: string) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
  }
}
