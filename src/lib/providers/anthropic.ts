import Anthropic from "@anthropic-ai/sdk";
import type { CompletionRequest, CompletionResult, LLMProvider, ModelInfo } from "./types";
import { ProviderError, errorMessage, retryAfterMs } from "./types";
import { ANTHROPIC_MODELS } from "./pricing";
import { repairJson } from "../pipeline/jsonRepair";
import type { TextBlock } from "@anthropic-ai/sdk/resources/messages";
import type { BetaTextBlock } from "@anthropic-ai/sdk/resources/beta/messages";

const isTextBlock = (b: { type: string }): b is TextBlock | BetaTextBlock => b.type === "text";

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
      } catch (e: unknown) {
        if (e instanceof Anthropic.AuthenticationError) return { ok: false, error: "Invalid API key." };
        return { ok: false, error: errorMessage(e) ?? "Could not reach api.anthropic.com." };
      }
    },

    async complete(model: string, req: CompletionRequest): Promise<CompletionResult> {
      try {
        const isFable = model.startsWith("claude-fable");
        const base = {
          model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: [{ role: "user" as const, content: req.user }],
        };
        const format = req.jsonSchema
          ? { type: "json_schema" as const, schema: req.jsonSchema.schema }
          : undefined;
        // The beta and non-beta stream types don't unify (their param and
        // event types differ), so each branch attaches the delta listener and
        // resolves its own final message; both settle on Message | BetaMessage.
        const onText = (delta: string) => req.onDelta?.(delta);
        // Fable 5's safety classifiers can decline benign-adjacent requests;
        // opt into the server-side fallback so Opus 4.8 transparently rescues
        // the call instead of failing the run.
        const message = isFable
          ? await client().beta.messages
              .stream(
                {
                  ...base,
                  ...(format ? { output_config: { format } } : {}),
                  betas: ["server-side-fallback-2026-06-01"],
                  fallbacks: [{ model: "claude-opus-4-8" }],
                },
                { signal: req.signal },
              )
              .on("text", onText)
              .finalMessage()
          : await client().messages
              .stream(
                { ...base, ...(format ? { output_config: { format } } : {}) },
                { signal: req.signal },
              )
              .on("text", onText)
              .finalMessage();
        if (message.stop_reason === "refusal") {
          throw new ProviderError(
            "The model declined this request (safety classifier). Try the Deep tier, which uses Opus 4.8.",
          );
        }
        // content is Message | BetaMessage depending on the stream path; widen
        // once so .filter works across the union, then narrow via the guard.
        const blocks: ReadonlyArray<{ type: string }> = message.content;
        const text = blocks.filter(isTextBlock).map((b) => b.text).join("");
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
      } catch (e: unknown) {
        if (req.signal.aborted || e instanceof ProviderError) throw e;
        if (e instanceof Anthropic.APIError) {
          throw new ProviderError(e.message, e.status, retryAfterMs(e));
        }
        throw new ProviderError(errorMessage(e) ?? "Anthropic request failed.");
      }
    },
  };
}
