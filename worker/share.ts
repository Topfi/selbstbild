import { assessmentDocSchema, type AssessmentDoc } from "../src/lib/schema/assessment";

/** Minimal structural KV/asset types so this module also typechecks inside
 *  the DOM-typed app project (the unit tests import it). */
export interface KVStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Env {
  SHARES: KVStore;
  ASSETS: { fetch(request: Request): Promise<Response> };
  MAX_SHARE_BYTES: string;
  SHARE_TTL_SECONDS: string;
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function randomSlug(length = 11): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const b of bytes) out += BASE58[b % BASE58.length];
  return out;
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison of two equal-length hex digests (XOR-accumulate).
 *  Both inputs are SHA-256 hex strings, so length is not secret. Kept portable
 *  (no crypto.subtle.timingSafeEqual) so the unit tests run under Node. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface StoredShare {
  doc: AssessmentDoc;
  tokenHash: string;
  createdAt: string;
}

export async function createShare(env: Env, body: string): Promise<Response> {
  const maxBytes = Number(env.MAX_SHARE_BYTES) || 262_144;
  if (new TextEncoder().encode(body).length > maxBytes) {
    return json({ error: "payload too large" }, 413);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  const result = assessmentDocSchema.safeParse(parsed);
  if (!result.success) {
    return json({ error: "invalid assessment document", detail: result.error.issues[0]?.message }, 400);
  }
  const slug = randomSlug();
  const deletionToken = randomToken();
  const stored: StoredShare = {
    doc: result.data,
    tokenHash: await sha256Hex(deletionToken),
    createdAt: new Date().toISOString(),
  };
  await env.SHARES.put(`share:${slug}`, JSON.stringify(stored), {
    expirationTtl: Number(env.SHARE_TTL_SECONDS) || 15_552_000,
  });
  return json({ slug, deletionToken }, 201);
}

export async function getStoredShare(env: Env, slug: string): Promise<StoredShare | null> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{8,16}$/.test(slug)) return null;
  const raw = await env.SHARES.get(`share:${slug}`);
  return raw ? (JSON.parse(raw) as StoredShare) : null;
}

export async function getShare(env: Env, slug: string): Promise<Response> {
  const stored = await getStoredShare(env, slug);
  if (!stored) return json({ error: "not found" }, 404);
  // no-store: deletion must take effect immediately; the delete path can't
  // purge browser or shared HTTP caches holding this JSON.
  return json(stored.doc, 200, { "Cache-Control": "no-store" });
}

export async function deleteShare(env: Env, slug: string, authHeader: string | null): Promise<Response> {
  const token = authHeader?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token) return json({ error: "missing deletion token" }, 401);
  const stored = await getStoredShare(env, slug);
  if (!stored) return json({ error: "not found" }, 404);
  if (!timingSafeEqualHex(await sha256Hex(token), stored.tokenHash)) {
    return json({ error: "wrong deletion token" }, 403);
  }
  await env.SHARES.delete(`share:${slug}`);
  return json({ deleted: true });
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
