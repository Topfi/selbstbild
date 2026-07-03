import { describe, expect, it } from "vitest";
import { assessmentDocSchema } from "../src/lib/schema/assessment";
import golden from "../src/fixtures/golden-assessment.json";

describe("assessmentDocSchema", () => {
  it("accepts the golden fixture", () => {
    const result = assessmentDocSchema.safeParse(golden);
    if (!result.success) console.error(result.error.issues.slice(0, 3));
    expect(result.success).toBe(true);
  });

  it("rejects extra properties (strict)", () => {
    const doc = structuredClone(golden) as any;
    doc.injected = "<script>alert(1)</script>";
    expect(assessmentDocSchema.safeParse(doc).success).toBe(false);
  });

  it("rejects wrong emoji count", () => {
    const doc = structuredClone(golden) as any;
    doc.emojiSummary.pop();
    expect(assessmentDocSchema.safeParse(doc).success).toBe(false);
  });

  it("rejects oversized markdown sections", () => {
    const doc = structuredClone(golden) as any;
    doc.essay.sections[0]!.markdown = "x".repeat(25_000);
    expect(assessmentDocSchema.safeParse(doc).success).toBe(false);
  });

  it("rejects out-of-range trait scores", () => {
    const doc = structuredClone(golden) as any;
    doc.traits[0]!.score = 140;
    expect(assessmentDocSchema.safeParse(doc).success).toBe(false);
  });
});
