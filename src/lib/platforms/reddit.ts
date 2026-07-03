import type { PlatformAdapter, RawItem } from "./types";
import { fetchJson, PlatformError } from "./types";

/**
 * Reddit "installed app" OAuth. Anonymous www.reddit.com/*.json fetches are
 * CORS-unreliable and datacenter proxies are blocked, so we send the user
 * through Reddit's authorize page and call oauth.reddit.com (CORS-enabled)
 * from their own browser/IP.
 *
 * Reddit allows exactly one redirect URI per registered app, so localhost dev
 * and production each need their own app (client ids are public for
 * installed apps). Configure them here or via VITE_REDDIT_CLIENT_ID*.
 */
const CLIENT_IDS: Record<string, string> = {
  localhost: import.meta.env["VITE_REDDIT_CLIENT_ID_DEV"] ?? "",
  default: import.meta.env["VITE_REDDIT_CLIENT_ID"] ?? "",
};

const TOKEN_KEY = "pl.reddit.token";
const STATE_KEY = "pl.reddit.state";

function clientId(): string {
  const host = location.hostname;
  return (host === "localhost" || host === "127.0.0.1" ? CLIENT_IDS["localhost"] : CLIENT_IDS["default"]) || "";
}

function redirectUri(): string {
  return `${location.origin}/reddit-callback`;
}

function randomString(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function redditAuthConfigured(): boolean {
  return clientId().length > 0;
}

/** Called by the /reddit-callback route. Returns true on success. */
export async function completeRedditAuth(params: URLSearchParams): Promise<boolean> {
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state || state !== sessionStorage.getItem(STATE_KEY)) return false;
  sessionStorage.removeItem(STATE_KEY);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
  });
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // Installed apps authenticate with an empty secret.
      Authorization: `Basic ${btoa(`${clientId()}:`)}`,
    },
    body,
  });
  if (!res.ok) return false;
  const json = await res.json();
  if (!json.access_token) return false;
  sessionStorage.setItem(TOKEN_KEY, json.access_token);
  return true;
}

async function fetchListing(
  kind: "comments" | "submitted",
  handle: string,
  token: string,
  opts: { signal: AbortSignal; maxItems: number; onProgress: (n: number, done: boolean) => void },
  offset: number,
): Promise<RawItem[]> {
  const items: RawItem[] = [];
  let after: string | undefined;
  for (;;) {
    const params = new URLSearchParams({ limit: "100", raw_json: "1" });
    if (after) params.set("after", after);
    const data = await fetchJson(
      `https://oauth.reddit.com/user/${encodeURIComponent(handle)}/${kind}?${params}`,
      { signal: opts.signal, headers: { Authorization: `Bearer ${token}` } },
      "Reddit",
    );
    const children: any[] = data?.data?.children ?? [];
    if (children.length === 0) break;
    for (const c of children) {
      const d = c.data;
      const isComment = c.kind === "t1";
      const text = isComment ? d.body : [d.title, d.selftext].filter(Boolean).join("\n\n");
      if (!text) continue;
      items.push({
        id: d.name,
        kind: isComment ? "comment" : "post",
        text,
        createdAt: d.created_utc * 1000,
        url: d.permalink ? `https://www.reddit.com${d.permalink}` : undefined,
        context: d.subreddit ? `r/${d.subreddit}` : undefined,
        score: d.score ?? undefined,
      });
    }
    opts.onProgress(offset + items.length, false);
    after = data?.data?.after ?? undefined;
    if (!after || items.length >= opts.maxItems) break;
    await new Promise((r) => setTimeout(r, 650)); // stay under 100 QPM
  }
  return items;
}

export const redditAdapter: PlatformAdapter = {
  id: "reddit",
  label: "Reddit",
  placeholder: "username (e.g. spez)",
  requiresAuth: true,

  parseHandle(input) {
    const handle = input.trim().replace(/^\/?u\//, "").replace(/^@/, "");
    if (!/^[A-Za-z0-9_-]{3,20}$/.test(handle)) return { error: "That doesn't look like a valid Reddit username." };
    return { handle };
  },

  hasAuth() {
    return Boolean(sessionStorage.getItem(TOKEN_KEY));
  },

  beginAuth(handle: string) {
    if (!redditAuthConfigured()) {
      throw new PlatformError(
        "Reddit support is not configured on this deployment.",
        "The site operator must register a Reddit 'installed app' and set VITE_REDDIT_CLIENT_ID. See the README.",
      );
    }
    const state = `${randomString(16)}:${handle}`;
    sessionStorage.setItem(STATE_KEY, state);
    const params = new URLSearchParams({
      client_id: clientId(),
      response_type: "code",
      state,
      redirect_uri: redirectUri(),
      duration: "temporary",
      scope: "history identity",
    });
    location.assign(`https://www.reddit.com/api/v1/authorize?${params}`);
  },

  async fetchHistory(handle, opts) {
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (!token) {
      throw new PlatformError("Reddit requires a one-click authorization first.", "Click 'Connect Reddit' to grant read-only access from your own browser.");
    }
    const comments = await fetchListing("comments", handle, token, opts, 0);
    const posts = await fetchListing("submitted", handle, token, opts, comments.length);
    const all = [...comments, ...posts];
    if (all.length === 0) {
      throw new PlatformError(`No public history found for u/${handle}.`, "Reddit listings are capped at ~1000 recent items per type.");
    }
    all.sort((a, b) => a.createdAt - b.createdAt);
    const sliced = all.slice(-opts.maxItems);
    opts.onProgress(sliced.length, true);
    return sliced;
  },
};
