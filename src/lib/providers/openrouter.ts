import type { CompletionRequest, CompletionResult, LLMProvider, ModelInfo } from "./types";
import { ProviderError } from "./types";
import { OPENROUTER_SUGGESTED } from "./pricing";
import { repairJson } from "../pipeline/jsonRepair";

const BASE = "https://openrouter.ai/api/v1";

const ATTRIBUTION = {
  "HTTP-Referer": "https://github.com/Topfi/selbstbild",
  "X-Title": "Selbstbild",
};

let modelCache: ModelInfo[] | null = null;

export function openrouterProvider(apiKey: () => string): LLMProvider {
  return {
    id: "openrouter",
    label: "OpenRouter",
    keyPlaceholder: "sk-or-...",
    keyHost: "openrouter.ai",

    async listModels(): Promise<ModelInfo[]> {
      if (modelCache) return modelCache;
      try {
        const res = await fetch(`${BASE}/models`);
        const data = await res.json();
        const all: ModelInfo[] = (data.data ?? []).map((m: any) => ({
          id: m.id,
          label: m.name ?? m.id,
          ctxWindow: m.context_length ?? 128_000,
          inPerMtok: m.pricing?.prompt ? Number(m.pricing.prompt) * 1_000_000 : undefined,
          outPerMtok: m.pricing?.completion ? Number(m.pricing.completion) * 1_000_000 : undefined,
        }));
        modelCache = all.length > 0 ? all : OPENROUTER_SUGGESTED;
      } catch {
        modelCache = OPENROUTER_SUGGESTED;
      }
      return modelCache;
    },

    async validateKey() {
      try {
        const res = await fetch(`${BASE}/key`, {
          headers: { Authorization: `Bearer ${apiKey()}` },
        });
        if (res.status === 401) return { ok: false, error: "Invalid API key." };
        return { ok: res.ok, error: res.ok ? undefined : `HTTP ${res.status}` };
      } catch (e: any) {
        return { ok: false, error: e?.message ?? "Could not reach openrouter.ai." };
      }
    },

    async complete(model: string, req: CompletionRequest): Promise<CompletionResult> {
      const body: any = {
        model,
        max_tokens: req.maxTokens,
        stream: true,
        usage: { include: true },
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
      };
      if (req.jsonSchema) {
        body.response_format = {
          type: "json_schema",
          json_schema: { name: req.jsonSchema.name, strict: true, schema: req.jsonSchema.schema },
        };
      }
      const res = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey()}`,
          "Content-Type": "application/json",
          ...ATTRIBUTION,
        },
        body: JSON.stringify(body),
        signal: req.signal,
      });
      if (!res.ok) {
        let detail = "";
        try {
          detail = (await res.json())?.error?.message ?? "";
        } catch {
          /* ignore */
        }
        const retryAfter = Number(res.headers.get("retry-after"));
        const hint =
          res.status === 402
            ? " (OpenRouter reserves max_tokens × price up front against the credits THIS KEY can see — if your account balance is fine, check the key's own credit limit under openrouter.ai/settings/keys, or whether the key belongs to a different org.)"
            : "";
        throw new ProviderError(
          `OpenRouter: HTTP ${res.status}${detail ? ` — ${detail}` : ""}${hint}`,
          res.status,
          Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined,
        );
      }

      // Parse the SSE stream.
      let text = "";
      let usage = { inputTokens: 0, outputTokens: 0 };
      let servedBy: string | undefined;
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;
          try {
            const chunk = JSON.parse(payload);
            if (typeof chunk.model === "string" && chunk.model) servedBy = chunk.model;
            const delta: string = chunk.choices?.[0]?.delta?.content ?? "";
            if (delta) {
              text += delta;
              req.onDelta?.(delta);
            }
            if (chunk.usage) {
              usage = {
                inputTokens: chunk.usage.prompt_tokens ?? 0,
                outputTokens: chunk.usage.completion_tokens ?? 0,
              };
            }
          } catch {
            /* partial line; ignore */
          }
        }
      }
      return { text, json: req.jsonSchema ? repairJson(text) : undefined, usage, servedBy };
    },
  };
}
