import type { ModelInfo } from "../providers/types";
import { costUsd } from "../providers/pricing";
import type { Chunk } from "./chunker";
import type { Depth } from "./prompts";

export interface CostEstimate {
  totalUsd?: number | undefined;
  lowUsd?: number | undefined;
  highUsd?: number | undefined;
  inputTokens: number;
  outputTokens: number;
  llmCalls: number;
  unknownPricing: boolean;
}

const READER_OUTPUT = 2_500;
const ANALYST_OUTPUT = 1_800;
const SYNTHESIS_OUTPUT = 9_000;

/** Rough per-phase token accounting; shown to the user as a ±30% range. */
export function estimateCost(
  chunks: Chunk[],
  depth: Depth,
  models: { reader?: ModelInfo; analyst?: ModelInfo; synthesis?: ModelInfo },
): CostEstimate {
  const corpusTokens = chunks.reduce((s, c) => s + c.estTokens, 0);
  let input = 0;
  let output = 0;
  let calls = 0;
  let usd = 0;
  let unknown = false;

  const add = (model: ModelInfo | undefined, inTok: number, outTok: number, n: number) => {
    input += inTok * n;
    output += outTok * n;
    calls += n;
    const c = costUsd(model, inTok * n, outTok * n);
    if (c === undefined) unknown = true;
    else usd += c;
  };

  if (depth === "quick") {
    // Single synthesis pass over (possibly truncated) corpus.
    add(models.synthesis, Math.min(corpusTokens, 150_000) + 2_000, SYNTHESIS_OUTPUT, 1);
  } else {
    const withAnalysts = depth === "deep" || depth === "fable" || depth === "ultra";
    add(models.reader, corpusTokens / Math.max(1, chunks.length) + 1_200, READER_OUTPUT, chunks.length);
    const dossierTokens = chunks.length * READER_OUTPUT;
    if (withAnalysts) add(models.analyst, dossierTokens + 1_000, ANALYST_OUTPUT, 3);
    const synthesisInput = dossierTokens + (withAnalysts ? 3 * ANALYST_OUTPUT : 0) + 2_500;
    add(models.synthesis, synthesisInput, SYNTHESIS_OUTPUT, 1);
  }

  return {
    totalUsd: unknown ? undefined : usd,
    lowUsd: unknown ? undefined : usd * 0.7,
    highUsd: unknown ? undefined : usd * 1.3,
    inputTokens: Math.round(input),
    outputTokens: Math.round(output),
    llmCalls: calls,
    unknownPricing: unknown,
  };
}
