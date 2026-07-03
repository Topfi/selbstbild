import { describe, expect, it } from "vitest";
import { createShare, deleteShare, getShare } from "../worker/share";
import golden from "../src/fixtures/golden-assessment.json";

function fakeEnv() {
  const kv = new Map<string, string>();
  return {
    SHARES: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
    } as any,
    ASSETS: {} as any,
    MAX_SHARE_BYTES: "262144",
    SHARE_TTL_SECONDS: "1000",
    _kv: kv,
  };
}

describe("share worker logic", () => {
  it("create → get → delete round-trip", async () => {
    const env = fakeEnv();
    const created = await createShare(env, JSON.stringify(golden));
    expect(created.status).toBe(201);
    const { slug, deletionToken } = (await created.json()) as any;
    expect(slug).toMatch(/^[1-9A-HJ-NP-Za-km-z]{11}$/);

    const got = await getShare(env, slug);
    expect(got.status).toBe(200);
    expect(((await got.json()) as any).metadata.username).toBe("Topfi");

    const wrongDelete = await deleteShare(env, slug, "Bearer wrong-token");
    expect(wrongDelete.status).toBe(403);

    const del = await deleteShare(env, slug, `Bearer ${deletionToken}`);
    expect(del.status).toBe(200);
    expect((await getShare(env, slug)).status).toBe(404);
  });

  it("rejects invalid documents", async () => {
    const env = fakeEnv();
    expect((await createShare(env, JSON.stringify({ nope: 1 }))).status).toBe(400);
    expect((await createShare(env, "not json")).status).toBe(400);
  });

  it("rejects oversized payloads", async () => {
    const env = fakeEnv();
    const doc = structuredClone(golden) as any;
    doc.essay.sections[0]!.markdown = "x".repeat(300_000);
    expect((await createShare(env, JSON.stringify(doc))).status).toBe(413);
  });

  it("does not store the raw deletion token", async () => {
    const env = fakeEnv();
    const res = await createShare(env, JSON.stringify(golden));
    const { deletionToken } = (await res.json()) as any;
    const stored = [...env._kv.values()].join("");
    expect(stored).not.toContain(deletionToken);
  });

  it("404s on malformed slugs without hitting KV", async () => {
    const env = fakeEnv();
    expect((await getShare(env, "../etc/passwd")).status).toBe(404);
  });
});
