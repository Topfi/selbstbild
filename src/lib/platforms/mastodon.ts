import type { PlatformAdapter, RawItem } from "./types";
import { fetchJson, PlatformError } from "./types";

function stripHtml(html: string): string {
  const withBreaks = html.replace(/<\/p>\s*<p>/gi, "\n\n").replace(/<br\s*\/?>/gi, "\n");
  const doc = new DOMParser().parseFromString(withBreaks, "text/html");
  return (doc.body.textContent ?? "").trim();
}

export const mastodonAdapter: PlatformAdapter = {
  id: "mastodon",
  label: "Mastodon",
  placeholder: "user@instance (e.g. Gargron@mastodon.social)",
  requiresAuth: false,

  parseHandle(input) {
    const handle = input.trim().replace(/^@/, "");
    const m = handle.match(/^([A-Za-z0-9_]{1,64})@([a-z0-9.-]+\.[a-z]{2,})$/i);
    if (!m) return { error: "Enter a full Mastodon handle like user@instance.tld." };
    return { handle };
  },

  async fetchHistory(handle, opts) {
    const [user = "", instance = ""] = handle.split("@");
    const base = `https://${instance}/api/v1`;
    let account: any;
    try {
      account = await fetchJson(
        `${base}/accounts/lookup?acct=${encodeURIComponent(user)}`,
        { signal: opts.signal },
        `Mastodon (${instance})`,
      );
    } catch (e) {
      if (e instanceof PlatformError) {
        throw new PlatformError(e.message, e.hint ?? "Some instances disable anonymous API access or lack CORS headers; try the user's home instance.");
      }
      throw e;
    }
    const items: RawItem[] = [];
    let maxId: string | undefined;
    for (;;) {
      const params = new URLSearchParams({ limit: "40", exclude_reblogs: "true" });
      if (maxId) params.set("max_id", maxId);
      const statuses: any[] = await fetchJson(
        `${base}/accounts/${account.id}/statuses?${params}`,
        { signal: opts.signal },
        `Mastodon (${instance})`,
      );
      if (statuses.length === 0) break;
      for (const s of statuses) {
        const text = stripHtml(s.content ?? "");
        if (!text) continue;
        items.push({
          id: String(s.id),
          kind: s.in_reply_to_id ? "comment" : "post",
          text,
          createdAt: Date.parse(s.created_at),
          url: s.url ?? undefined,
          context: s.spoiler_text || undefined,
          score: (s.favourites_count ?? 0) + (s.reblogs_count ?? 0),
        });
      }
      opts.onProgress(items.length, false);
      maxId = statuses[statuses.length - 1].id;
      if (items.length >= opts.maxItems) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (items.length === 0) {
      throw new PlatformError(
        `No public posts found for "${handle}".`,
        "The account may be private, or the instance may restrict anonymous access. Note: only the user's home instance has their full history.",
      );
    }
    items.sort((a, b) => a.createdAt - b.createdAt);
    const sliced = items.slice(-opts.maxItems);
    opts.onProgress(sliced.length, true);
    return sliced;
  },
};
