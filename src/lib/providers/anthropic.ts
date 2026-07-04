import Anthropic from "@anthropic-ai/sdk";
import type { CompletionRequest, CompletionResult, LLMProvider, ModelInfo } from "./types";
import { ProviderError } from "./types";
import { ANTHROPIC_MODELS } from "./pricing";
import { repairJson } from "../pipeline/jsonRepair";

/**
 * Direct-from-browser Anthropic access. This is the officially sanctioned
 * BYOK pattern: the `dangerouslyAllowBrowser` flag sets the
 * `anthropic-dangerous-direct-browser-access: true` header. The key is held
 * in memory (or localStorage if the user opts in) and sent only to
 * api.anthropic.com.
 */
export function anthropicProvider(apiKey: () => string): LLMProvider {
  const client = () =>
    new Anthropic({ apiKey: apiKey(), dangerouslyAllowBrowser: true, maxRetries: 0 });

  return {
    id: "anthropic",
    label: "Anthropic",
    keyPlaceholder: "sk-ant-...",
    keyHost: "api.anthropic.com",

    async listModels(): Promise<ModelInfo[]> {
      return ANTHROPIC_MODELS;
    },

    async validateKey() {
      try {
        await client().models.list();
        return { ok: true };
      } catch (e: any) /** Consider unknown for this, maybe helpers */ {
        if (e?.status === 401) return { ok: false, error: "Invalid API key." };
        return { ok: false, error: e?.message ?? "Could not reach api.anthropic.com." };
      }
    },

    async complete(model: string, req: CompletionRequest): Promise<CompletionResult> {
      try {
        const isFable = model.startsWith("claude-fable");
        const params = {
          model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: [{ role: "user" as const, content: req.user }],
          ...(req.jsonSchema
            ? { output_config: { format: { type: "json_schema" as const, schema: req.jsonSchema.schema } } }
            : {}),
        };
        // Fable 5's safety classifiers can decline benign-adjacent requests;
        // opt into the server-side fallback so Opus 4.8 transparently rescues
        // the call instead of failing the run.
        const stream = isFable
          ? client().beta.messages.stream(
              {
                ...params,
                betas: ["server-side-fallback-2026-06-01"],
                fallbacks: [{ model: "claude-opus-4-8" }],
              } as any, /** No any, SDK most certainly exposes types to use here. Define as narrowly as we can. */
              { signal: req.signal },
            )
          : client().messages.stream(params, { signal: req.signal });
        if (req.onDelta) stream.on("text", (delta) => req.onDelta!(delta));
        const message = await stream.finalMessage();
        if (message.stop_reason === "refusal") {
          throw new ProviderError(
            "The model declined this request (safety classifier). Try the Deep tier, which uses Opus 4.8.",
          );
        }
        // content is Message | BetaMessage depending on the stream path.
        const blocks = message.content as Array<{ type: string; text?: string }>; /** Type guard this! */
        const text = blocks
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("");
        return {
          text,
          json: req.jsonSchema ? repairJson(text) : undefined,
          usage: {
            inputTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens,
          },
          // The response names whoever actually served it — on a Fable 5
          // safety fallback this is the rescue model, not the requested one.
          servedBy: message.model,
        };
      } catch (e: any) /** Here too, unknown / helpers */ {
        if (req.signal.aborted || e instanceof ProviderError) throw e;
        const retryAfter = Number(e?.headers?.get?.("retry-after"));
        throw new ProviderError(
          e?.message ?? "Anthropic request failed.",
          e?.status,
          Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined,
        );
      }
    },
  };
}
