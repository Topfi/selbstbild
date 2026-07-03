import { useCallback, useRef, useState } from "react";
import { getPlatform } from "./platforms";
import { PlatformError, type RawItem } from "./platforms/types";
import { anthropicProvider } from "./providers/anthropic";
import { openrouterProvider } from "./providers/openrouter";
import type { LLMProvider, ModelInfo } from "./providers/types";
import { chunkItems } from "./pipeline/chunker";
import { estimateCost, type CostEstimate } from "./pipeline/costEstimator";
import { runPipeline } from "./pipeline/orchestrator";
import { getApiKey } from "./storage";
import { useStore, type ProviderId } from "../state/store";
import type { Depth } from "./pipeline/prompts";

export function makeProvider(id: ProviderId): LLMProvider {
  return id === "anthropic" ? anthropicProvider(() => getApiKey("anthropic")) : openrouterProvider(() => getApiKey("openrouter"));
}

/** Default model roles per depth. */
export function defaultModels(providerId: ProviderId, depth: Depth, available: ModelInfo[]): { reader: ModelInfo; analyst: ModelInfo; synthesis: ModelInfo } {
  const first = available[0];
  if (!first) throw new Error("The provider returned no models — check your key.");
  const find = (id: string, fallback?: ModelInfo): ModelInfo => available.find((m) => m.id === id) ?? fallback ?? first;
  if (providerId === "anthropic") {
    const haiku = find("claude-haiku-4-5");
    const sonnet = find("claude-sonnet-5", haiku);
    const opus = find("claude-opus-4-8", sonnet);
    const fable = find("claude-fable-5", opus);
    if (depth === "quick") return { reader: haiku, analyst: haiku, synthesis: haiku };
    if (depth === "standard") return { reader: haiku, analyst: sonnet, synthesis: sonnet };
    if (depth === "fable") return { reader: haiku, analyst: fable, synthesis: fable };
    if (depth === "ultra") return { reader: fable, analyst: fable, synthesis: fable };
    return { reader: haiku, analyst: sonnet, synthesis: opus };
  }
  // OpenRouter: resolve by preference patterns; never fall back to an
  // arbitrary catalog entry (list order is meaningless and can be a very
  // expensive frontier model).
  const priced = available.filter((m) => (m.outPerMtok ?? 0) > 0 && m.ctxWindow >= 100_000);
  const cheapestPriced = [...priced].sort((a, b) => (a.outPerMtok ?? 99) - (b.outPerMtok ?? 99))[0];
  const resolve = (patterns: RegExp[], fallback: ModelInfo): ModelInfo => {
    for (const p of patterns) {
      const hit = priced.find((m) => p.test(m.id));
      if (hit) return hit;
    }
    return fallback;
  };
  const cheap = resolve(
    [/^anthropic\/claude-haiku-4\.5$/, /claude.*haiku(?!.*3)/, /gemini.*flash/, /haiku/],
    cheapestPriced ?? first,
  );
  const strong = resolve(
    [/^anthropic\/claude-sonnet-5$/, /claude-sonnet-5/, /claude.*sonnet-4\.6/, /claude.*sonnet/, /gpt-5/],
    cheap,
  );
  if (depth === "quick") return { reader: cheap, analyst: cheap, synthesis: cheap };
  if (depth === "fable" || depth === "ultra") {
    const fable = resolve([/^anthropic\/claude-fable-5$/, /fable/], strong);
    return { reader: depth === "ultra" ? fable : cheap, analyst: fable, synthesis: fable };
  }
  return { reader: cheap, analyst: strong, synthesis: strong };
}

export function useRun() {
  const store = useStore();
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const itemsRef = useRef<RawItem[]>([]);
  const modelsRef = useRef<{ reader: ModelInfo; analyst: ModelInfo; synthesis: ModelInfo } | null>(null);

  const fail = useCallback(
    (e: unknown) => {
      const err = e as any;
      if (err?.name === "AbortError") {
        useStore.getState().set({ stage: "setup", progress: null });
        return;
      }
      useStore.getState().set({
        stage: "error",
        error: err?.message ?? String(e),
        errorHint: e instanceof PlatformError ? (e.hint ?? null) : null,
      });
    },
    [],
  );

  /** Phase 1: fetch history, compute estimate, stop at the confirm gate. */
  const startFetch = useCallback(async () => {
    const s = useStore.getState();
    const adapter = getPlatform(s.platformId);
    const parsed = adapter.parseHandle(s.handleInput);
    if ("error" in parsed) {
      s.set({ stage: "error", error: parsed.error, errorHint: null });
      return;
    }
    if (adapter.requiresAuth && !adapter.hasAuth?.()) {
      try {
        adapter.beginAuth?.(parsed.handle);
      } catch (e) {
        fail(e);
      }
      return;
    }
    const controller = new AbortController();
    s.set({ stage: "fetching", error: null, errorHint: null, fetchedCount: 0, abortController: controller, result: null, shareUrl: null });
    try {
      const items = await adapter.fetchHistory(parsed.handle, {
        signal: controller.signal,
        maxItems: s.maxItems,
        onProgress: (n) => useStore.getState().set({ fetchedCount: n }),
      });
      itemsRef.current = items;

      const provider = makeProvider(s.providerId);
      const available = await provider.listModels();
      const models = defaultModels(s.providerId, s.depth, available);
      for (const role of ["reader", "analyst", "synthesis"] as const) {
        const override = s.modelOverrides[role];
        if (override) models[role] = available.find((m) => m.id === override) ?? { id: override, label: override, ctxWindow: 200_000 };
      }
      modelsRef.current = models;
      useStore.getState().set({
        chosenModels: { reader: models.reader.id, analyst: models.analyst.id, synthesis: models.synthesis.id },
      });

      const chunks = chunkItems(items, Math.min(14_000, Math.floor(models.reader.ctxWindow * 0.35)));
      setEstimate(estimateCost(chunks, s.depth, models));
      useStore.getState().set({ stage: "estimate" });
    } catch (e) {
      fail(e);
    }
  }, [fail]);

  /** Phase 2: user confirmed the estimate — run the LLM pipeline. */
  const confirmRun = useCallback(async () => {
    const s = useStore.getState();
    const controller = new AbortController();
    s.set({ stage: "running", abortController: controller });
    try {
      const provider = makeProvider(s.providerId);
      const parsed = getPlatform(s.platformId).parseHandle(s.handleInput);
      const doc = await runPipeline(itemsRef.current, {
        provider,
        models: modelsRef.current!,
        depth: s.depth,
        platform: s.platformId,
        username: "handle" in parsed ? parsed.handle : s.handleInput,
        signal: controller.signal,
        onProgress: (p) => useStore.getState().set({ progress: p }),
      });
      useStore.getState().set({ stage: "done", result: doc, progress: null });
    } catch (e) {
      fail(e);
    }
  }, [fail]);

  const abort = useCallback(() => {
    useStore.getState().abortController?.abort();
    useStore.getState().set({ stage: "setup", progress: null });
  }, []);

  return { store, estimate, startFetch, confirmRun, abort };
}
