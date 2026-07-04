export interface ModelInfo {
  id: string;
  label: string;
  ctxWindow: number;
  /** USD per million input tokens; undefined = unknown */
  inPerMtok?: number | undefined;
  outPerMtok?: number | undefined;
}

export interface CompletionRequest {
  system: string;
  user: string;
  /** When set, the model must return JSON matching this schema. */
  jsonSchema?: { name: string; schema: Record<string, unknown> } | undefined;
  maxTokens: number;
  onDelta?: ((text: string) => void) | undefined;
  signal: AbortSignal;
}

export interface CompletionResult {
  text: string;
  json?: unknown | undefined;
  usage: { inputTokens: number; outputTokens: number };
  /** Model that actually produced the response (may differ from the
   *  requested one when a server-side safety fallback kicked in). */
  servedBy?: string | undefined;
}

export interface LLMProvider {
  id: "anthropic" | "openrouter";
  label: string;
  keyPlaceholder: string;
  keyHost: string;
  listModels(): Promise<ModelInfo[]>;
  complete(model: string, req: CompletionRequest): Promise<CompletionResult>;
  validateKey(): Promise<{ ok: boolean; error?: string | undefined }>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number | undefined,
    public readonly retryAfterMs?: number | undefined,
  ) {
    super(message);
    this.name = "ProviderError";
  }
  get retryable(): boolean {
    return this.status === 429 || this.status === 529 || (this.status !== undefined && this.status >= 500);
  }
}
