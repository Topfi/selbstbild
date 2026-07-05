import { afterEach, describe, expect, it, vi } from "vitest";
import { openrouterProvider } from "../src/lib/providers/openrouter";
import { ProviderError } from "../src/lib/providers/types";

function sseResponse(chunks: object[]): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n`).join("") + "data: [DONE]\n";
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const delta = (model: string, content: string) => ({ model, choices: [{ delta: { content } }] });
const finish = (model: string, finish_reason: string, usage = { prompt_tokens: 10, completion_tokens: 5 }) => ({
  model,
  choices: [{ delta: {}, finish_reason }],
  usage,
});

function completeWith(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  return openrouterProvider(() => "sk-or-test").complete("anthropic/claude-fable-5", {
    system: "s",
    user: "u",
    maxTokens: 100,
    signal: new AbortController().signal,
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("openrouterProvider.complete", () => {
  it("returns text and usage from a normal stream", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([delta("anthropic/claude-fable-5", "hello"), finish("anthropic/claude-fable-5", "stop")]),
    );
    const res = await completeWith(fetchMock);
    expect(res.text).toBe("hello");
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(res.servedBy).toBe("anthropic/claude-fable-5");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws a ProviderError on an in-band mid-stream error", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([{ error: { code: 502, message: "provider disconnected" }, choices: [{ finish_reason: "error" }] }]),
    );
    const err = await completeWith(fetchMock).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toContain("provider disconnected");
    expect(err.status).toBe(502);
    expect(err.retryable).toBe(true);
  });

  it("rescues a refused Fable call on Opus 4.8 and sums usage", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const model = JSON.parse(init.body as string).model;
      return model === "anthropic/claude-fable-5"
        ? sseResponse([finish("anthropic/claude-fable-5", "refusal", { prompt_tokens: 10, completion_tokens: 0 })])
        : sseResponse([
            delta("anthropic/claude-opus-4.8", "rescued"),
            finish("anthropic/claude-opus-4.8", "stop", { prompt_tokens: 10, completion_tokens: 5 }),
          ]);
    });
    const res = await completeWith(fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string).model).toBe("anthropic/claude-opus-4.8");
    expect(res.text).toBe("rescued");
    expect(res.servedBy).toBe("anthropic/claude-opus-4.8");
    expect(res.usage).toEqual({ inputTokens: 20, outputTokens: 5 });
  });

  it("throws a clear error when the rescue is also refused", async () => {
    const fetchMock = vi.fn(async () => sseResponse([finish("any", "content_filter")]));
    const err = await completeWith(fetchMock).catch((e) => e);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toContain("declined");
  });
});
