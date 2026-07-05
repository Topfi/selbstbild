import type { RawItem } from "../platforms/types";
import type { LLMProvider, ModelInfo } from "../providers/types";
import { ProviderError, errorMessage } from "../providers/types";
import type { AssessmentDoc, PlatformId } from "../schema/assessment";
import { assessmentDocSchema, SCHEMA_VERSION } from "../schema/assessment";
import { chunkItems } from "./chunker";
import { activityByMonth, countsByKind, dateRange, wordCloud } from "./localStats";
import {
  ANALYST_LENSES,
  analystPrompt,
  quickSynthesisUser,
  readerPrompt,
  READER_SCHEMA,
  synthesisPrompt,
  SYNTHESIS_SCHEMA,
  type Depth,
} from "./prompts";
import { costUsd } from "../providers/pricing";

export interface PipelineConfig {
  provider: LLMProvider;
  models: { reader: ModelInfo; analyst: ModelInfo; synthesis: ModelInfo };
  depth: Depth;
  platform: PlatformId;
  username: string;
  concurrency?: number | undefined;
  targetChunkTokens?: number | undefined;
  signal: AbortSignal;
  onProgress: (p: PipelineProgress) => void;
}

export interface PipelineProgress {
  phase: "chunking" | "reading" | "analyzing" | "synthesizing" | "done";
  chunksDone?: number | undefined;
  chunksTotal?: number | undefined;
  tokensIn: number;
  tokensOut: number;
  costSoFar?: number | undefined;
  streamPreview?: string | undefined;
  fallbackNotes?: string[] | undefined;
}

const MAX_RETRIES = 4;

async function withRetry<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (signal.aborted) throw e;
      const retryable = e instanceof ProviderError && e.retryable;
      if (!retryable || attempt === MAX_RETRIES) throw e;
      const backoff =
        (e instanceof ProviderError && e.retryAfterMs) || Math.min(30_000, 1500 * 2 ** attempt) * (0.5 + Math.random());
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

/** Simple concurrency pool preserving result order; failed slots become null
 *  and their errors are collected so total failure can name a real cause. */
async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<{ results: (R | null)[]; errors: unknown[] }> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  const errors: unknown[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i]!, i);
      } catch (e) {
        results[i] = null; // skip failed chunk; reported via skippedChunks
        errors.push(e);
      }
    }
  });
  await Promise.all(workers);
  return { results, errors };
}

export async function runPipeline(items: RawItem[], cfg: PipelineConfig): Promise<AssessmentDoc> {
  const { provider, models, depth, signal } = cfg;
  const concurrency = cfg.concurrency ?? 4;
  let tokensIn = 0;
  let tokensOut = 0;
  let cost = 0;

  // Per-role tally of which model actually served each call, so a
  // server-side safety fallback (Fable 5 → Opus 4.8) is reported, not hidden.
  const served: Record<"reader" | "analyst" | "synthesis", Map<string, number>> = {
    reader: new Map(),
    analyst: new Map(),
    synthesis: new Map(),
  };
  const fallbackNotes: string[] = [];

  /** Same model family? Tolerates date-suffixed response ids and provider prefixes. */
  const sameFamily = (requested: string, servedId: string) => {
    const base = (s: string) => s.replace(/^[^/]+\//, "").replace(/-\d{8}$/, "");
    const a = base(requested);
    const b = base(servedId);
    return a.startsWith(b) || b.startsWith(a);
  };

  const track = (
    role: "reader" | "analyst" | "synthesis",
    model: ModelInfo,
    res: { usage: { inputTokens: number; outputTokens: number }; servedBy?: string | undefined },
  ) => {
    tokensIn += res.usage.inputTokens;
    tokensOut += res.usage.outputTokens;
    cost += costUsd(model, res.usage.inputTokens, res.usage.outputTokens) ?? 0;
    const by = res.servedBy ?? model.id;
    served[role].set(by, (served[role].get(by) ?? 0) + 1);
    if (res.servedBy && !sameFamily(model.id, res.servedBy)) {
      const note = `${role}: a call to ${model.id} was served by ${res.servedBy} (safety fallback)`;
      if (!fallbackNotes.includes(note)) fallbackNotes.push(note);
    }
  };

  /** Honest per-role model string: plain id, or "requested → served (fallback)". */
  const modelReport = (role: "reader" | "analyst" | "synthesis", model: ModelInfo): string => {
    const tally = served[role];
    const foreign = [...tally.entries()].filter(([id]) => !sameFamily(model.id, id));
    if (foreign.length === 0) return model.id;
    const total = [...tally.values()].reduce((s, n) => s + n, 0);
    const foreignCount = foreign.reduce((s, [, n]) => s + n, 0);
    const names = foreign.map(([id]) => id).join(", ");
    if (foreignCount === total) return `${model.id} → ${names} (safety fallback)`;
    return `${model.id} (${foreignCount}/${total} calls served by ${names} — safety fallback)`;
  };

  const progress = (p: Omit<PipelineProgress, "tokensIn" | "tokensOut" | "costSoFar" | "fallbackNotes">) =>
    cfg.onProgress({ ...p, tokensIn, tokensOut, costSoFar: cost, fallbackNotes });

  progress({ phase: "chunking" });
  const targetChunk = cfg.targetChunkTokens ?? Math.min(14_000, Math.floor(models.reader.ctxWindow * 0.35));
  const chunks = chunkItems(items, targetChunk);
  let skippedChunks = 0;

  let synthesisUser: string;

  if (depth === "quick") {
    // Single pass over the most recent history that fits.
    const budget = Math.min(150_000, Math.floor(models.synthesis.ctxWindow * 0.6));
    let corpus = "";
    let used = 0;
    for (let i = chunks.length - 1; i >= 0; i--) {
      const chunk = chunks[i]!;
      if (used + chunk.estTokens > budget) break;
      corpus = chunk.text + "\n" + corpus;
      used += chunk.estTokens;
    }
    synthesisUser = quickSynthesisUser(cfg.platform, cfg.username, corpus);
  } else {
    // Readers
    let done = 0;
    progress({ phase: "reading", chunksDone: 0, chunksTotal: chunks.length });
    const { results: readerResults, errors: readerErrors } = await pool(chunks, concurrency, async (chunk) => {
      const p = readerPrompt(cfg.platform, cfg.username, chunk.text, chunk.dateFrom, chunk.dateTo);
      const res = await withRetry(
        () =>
          provider.complete(models.reader.id, {
            system: p.system,
            user: p.user,
            jsonSchema: READER_SCHEMA,
            maxTokens: 6_000,
            signal,
          }),
        signal,
      );
      track("reader", models.reader, res);
      done += 1;
      progress({ phase: "reading", chunksDone: done, chunksTotal: chunks.length });
      if (res.json == null) throw new ProviderError("Reader returned unparseable JSON");
      return { slice: `${chunk.dateFrom}..${chunk.dateTo}`, evidence: res.json };
    });
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const dossierEntries = readerResults.filter(Boolean);
    skippedChunks = chunks.length - dossierEntries.length;
    if (dossierEntries.length === 0) {
      const detail = errorMessage(readerErrors[0]);
      throw new Error(
        detail
          ? `All ${chunks.length} reader calls failed. First error: ${detail}`
          : "All reader calls failed — check your key, model choice and rate limits.",
      );
    }
    const dossier = JSON.stringify(dossierEntries);

    // Analysts (deep, fable, ultra)
    let analyses = "";
    if (depth === "deep" || depth === "fable" || depth === "ultra") {
      progress({ phase: "analyzing", chunksDone: 0, chunksTotal: ANALYST_LENSES.length });
      let analystsDone = 0;
      const { results: analystResults } = await pool([...ANALYST_LENSES], 3, async (lens) => {
        const p = analystPrompt(lens, cfg.platform, cfg.username, dossier);
        const res = await withRetry(
          () => provider.complete(models.analyst.id, { system: p.system, user: p.user, maxTokens: 4_000, signal }),
          signal,
        );
        track("analyst", models.analyst, res);
        analystsDone += 1;
        progress({ phase: "analyzing", chunksDone: analystsDone, chunksTotal: ANALYST_LENSES.length });
        return `## ${lens.title}\n\n${res.text}`;
      });
      analyses = analystResults.filter(Boolean).join("\n\n");
    }

    synthesisUser = [
      analyses ? `ANALYST REPORTS:\n${analyses}` : "",
      `READER EVIDENCE DOSSIER (JSON):\n${dossier}`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  // Synthesis (streaming)
  progress({ phase: "synthesizing" });
  const sp = synthesisPrompt(cfg.platform, cfg.username, synthesisUser);
  let preview = "";
  const synth = await withRetry(
    () =>
      provider.complete(models.synthesis.id, {
        system: sp.system,
        user: sp.user,
        jsonSchema: SYNTHESIS_SCHEMA,
        maxTokens: 20_000,
        signal,
        onDelta: (d) => {
          preview += d;
          if (preview.length % 400 < d.length) progress({ phase: "synthesizing", streamPreview: preview.slice(-600) });
        },
      }),
    signal,
  );
  track("synthesis", models.synthesis, synth);
  if (synth.json == null) throw new Error("Synthesis returned unparseable JSON.");

  // Merge LLM output with deterministic local fields and validate.
  const llm = synth.json as any;
  const counts = countsByKind(items);
  const candidate: AssessmentDoc = {
    schemaVersion: SCHEMA_VERSION,
    metadata: {
      platform: cfg.platform,
      username: cfg.username,
      generatedAt: new Date().toISOString(),
      dateRange: dateRange(items),
      counts: { ...counts, analyzedItems: items.length, skippedChunks },
      analysis: {
        depth,
        provider: provider.id,
        models: {
          reader: modelReport("reader", models.reader),
          analyst: modelReport("analyst", models.analyst),
          synthesis: modelReport("synthesis", models.synthesis),
        },
        tokens: { input: tokensIn, output: tokensOut },
        estimatedCostUsd: Number(cost.toFixed(4)),
      },
    },
    essay: llm.essay,
    emojiSummary: normalizeEmoji(llm.emojiSummary),
    traits: (llm.traits ?? []).slice(0, 12).map((t: any) => ({ ...t, score: clamp(t.score, 0, 100) })),
    topFives: {
      topics: (llm.topFives?.topics ?? []).slice(0, 5),
      characteristicQuotes: (llm.topFives?.characteristicQuotes ?? []).slice(0, 5),
      strongestOpinions: (llm.topFives?.strongestOpinions ?? []).slice(0, 5),
    },
    quotes: (llm.quotes ?? []).slice(0, 40),
    topicDistribution: normalizeDistribution(llm.topicDistribution ?? []),
    activityByMonth: activityByMonth(items),
    wordCloud: wordCloud(items),
  };

  const parsed = assessmentDocSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(`Assessment failed validation: ${parsed.error.issues[0]?.path.join(".")} — ${parsed.error.issues[0]?.message}`);
  }
  progress({ phase: "done" });
  return parsed.data;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Number(n) || 0));
}

function normalizeEmoji(list: any[]): AssessmentDoc["emojiSummary"] {
  const items = (Array.isArray(list) ? list : []).slice(0, 5);
  while (items.length < 5) items.push({ emoji: "❓", caption: "…" });
  return items.map((e) => ({ emoji: String(e.emoji ?? "❓").slice(0, 16), caption: String(e.caption ?? "").slice(0, 120) || "…" }));
}

function normalizeDistribution(list: any[]): AssessmentDoc["topicDistribution"] {
  let entries = (Array.isArray(list) ? list : [])
    .filter((t) => t?.topic && Number(t.weight) > 0)
    .slice(0, 12);
  if (entries.length === 0) entries = [{ topic: "General", weight: 1 }];
  const total = entries.reduce((s, t) => s + Number(t.weight), 0);
  return entries.map((t) => ({ topic: String(t.topic).slice(0, 60), weight: Number((Number(t.weight) / total).toFixed(4)) }));
}
