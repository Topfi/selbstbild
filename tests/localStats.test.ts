import { describe, expect, it } from "vitest";
import { activityByMonth, countsByKind, dateRange, wordCloud } from "../src/lib/pipeline/localStats";
import type { RawItem } from "../src/lib/platforms/types";

const items: RawItem[] = [
  { id: "1", kind: "comment", text: "fedora silverblue is rock solid, fedora forever", createdAt: Date.UTC(2024, 0, 15) },
  { id: "2", kind: "comment", text: "fedora and wayland keep improving", createdAt: Date.UTC(2024, 0, 20) },
  { id: "3", kind: "post", text: "benchmarking fedora against ubuntu", createdAt: Date.UTC(2024, 2, 5) },
];

describe("activityByMonth", () => {
  it("fills gap months with zero", () => {
    expect(activityByMonth(items)).toEqual([
      { month: "2024-01", count: 2 },
      { month: "2024-02", count: 0 },
      { month: "2024-03", count: 1 },
    ]);
  });

  it("handles empty input", () => {
    expect(activityByMonth([])).toEqual([]);
  });
});

describe("wordCloud", () => {
  it("surfaces recurring terms, drops stopwords, normalizes weights", () => {
    const cloud = wordCloud(items);
    expect(cloud[0]!.term).toBe("fedora");
    expect(cloud[0]!.weight).toBe(1);
    expect(cloud.find((t) => t.term === "and")).toBeUndefined();
    expect(cloud.find((t) => t.term === "is")).toBeUndefined();
  });
});

describe("counts and range", () => {
  it("counts by kind", () => {
    expect(countsByKind(items)).toEqual({ comments: 2, posts: 1 });
  });
  it("computes date range", () => {
    expect(dateRange(items)).toEqual({ from: "2024-01-15", to: "2024-03-05" });
  });
});
