import { describe, expect, it } from "vitest";
import { chunkItems } from "../src/lib/pipeline/chunker";
import type { RawItem } from "../src/lib/platforms/types";

function item(i: number, text: string): RawItem {
  return { id: String(i), kind: "comment", text, createdAt: Date.UTC(2024, 0, 1) + i * 86_400_000 };
}

describe("chunkItems", () => {
  it("packs items into chunks under the token target", () => {
    const items = Array.from({ length: 50 }, (_, i) => item(i, "hello world ".repeat(40)));
    const chunks = chunkItems(items, 500);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.estTokens).toBeLessThanOrEqual(500);
    expect(chunks.reduce((s, c) => s + c.itemCount, 0)).toBe(50);
  });

  it("keeps chunks chronologically contiguous with date ranges", () => {
    const items = Array.from({ length: 20 }, (_, i) => item(i, "x".repeat(400)));
    const chunks = chunkItems(items, 300);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.dateFrom >= chunks[i - 1]!.dateTo).toBe(true);
    }
    expect(chunks[0]!.dateFrom).toBe("2024-01-01");
  });

  it("truncates a single oversized item into its own chunk", () => {
    const chunks = chunkItems([item(0, "y".repeat(100_000))], 1000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.estTokens).toBeLessThanOrEqual(1000);
  });

  it("handles empty input", () => {
    expect(chunkItems([], 1000)).toEqual([]);
  });
});
