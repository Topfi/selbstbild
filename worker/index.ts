import { Hono } from "hono";
import { createShare, deleteShare, getShare, getStoredShare, json, type Env } from "./share";
import { allowCreate } from "./rateLimit";
import { shareShell } from "./ssrShell";
import { ogImage } from "./ogImage";

const app = new Hono<{ Bindings: Env }>();

const BASE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
];

// The app shell must reach the LLM providers and the public platform APIs.
// `https:` is unavoidable for connect-src because Mastodon instances are
// arbitrary hosts; every other directive stays locked down and no inline
// script can run, so a stray fetch requires full script-src compromise.
const APP_CSP = [...BASE_CSP, "connect-src 'self' https:"].join("; ");

// Share pages never touch API keys or third-party APIs — strict connect-src.
const SHARE_CSP = [...BASE_CSP, "connect-src 'self'"].join("; ");

app.use("*", async (c, next) => {
  await next();
  if (c.res.headers.get("Content-Type")?.includes("text/html")) {
    const isSharePage = new URL(c.req.url).pathname.startsWith("/s/");
    c.res.headers.set("Content-Security-Policy", isSharePage ? SHARE_CSP : APP_CSP);
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.set("Referrer-Policy", "no-referrer");
  }
});

app.post("/api/share", async (c) => {
  if (c.req.header("Content-Type")?.includes("application/json") !== true || c.req.header("X-PL-Client") !== "1") {
    return json({ error: "bad request" }, 400);
  }
  if (!(await allowCreate(c.env, c.req.raw))) {
    return json({ error: "rate limited" }, 429);
  }
  return createShare(c.env, await c.req.text());
});

app.get("/api/share/:slug", (c) => getShare(c.env, c.req.param("slug")));

app.delete("/api/share/:slug", (c) => deleteShare(c.env, c.req.param("slug"), c.req.header("Authorization") ?? null));

app.get("/s/:slug", async (c) => {
  const slug = c.req.param("slug");
  const cacheKey = new Request(c.req.url);
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;
  const stored = await getStoredShare(c.env, slug);
  const res = await shareShell(c.env, c.req.raw, slug, stored?.doc ?? null);
  if (stored) c.executionCtx.waitUntil(caches.default.put(cacheKey, res.clone()));
  return res;
});

app.get("/og/:file", async (c) => {
  const slug = c.req.param("file").replace(/\.png$/, "");
  const cacheKey = new Request(c.req.url);
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;
  const stored = await getStoredShare(c.env, slug);
  if (!stored) return json({ error: "not found" }, 404);
  const res = await ogImage(stored.doc);
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  const final = new Response(res.body, { status: res.status, headers });
  c.executionCtx.waitUntil(caches.default.put(cacheKey, final.clone()));
  return final;
});

// Everything else falls through to static assets (SPA fallback handles routes).
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
