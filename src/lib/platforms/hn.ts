import type { FetchOptions, PlatformAdapter, RawItem } from "./types";
import { fetchJson, PlatformError } from "./types";

const API = "https://hn.algolia.com/api/v1/search_by_date";

function decodeEntities(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.documentElement.textContent ?? "";
}

function stripHtml(html: string): string {
  const withBreaks = html.replace(/<p>/gi, "\n\n").replace(/<br\s*\/?>/gi, "\n");
  return decodeEntities(withBreaks.replace(/<[^>]+>/g, "")).trim();
}

interface AlgoliaHit {
  objectID: string;
  created_at_i: number;
  comment_text?: string;
  story_title?: string;
  title?: string;
  url?: string;
  story_id?: number;
  points?: number | null;
}

/**
 * Algolia caps pagination at 1000 hits per query, so for prolific users we
 * time-slice: repeat the query with created_at_i < oldest-seen until empty.
 */
async function fetchTagged(
  handle: string,
  tag: "comment" | "story",
  opts: FetchOptions,
  runningTotal: () => number,
): Promise<RawItem[]> {
  const items: RawItem[] = [];
  let before: number | undefined;
  for (;;) {
    const params = new URLSearchParams({
      tags: `${tag},author_${handle}`,
      hitsPerPage: "1000",
    });
    if (before !== undefined) params.set("numericFilters", `created_at_i<${before}`);
    const data = await fetchJson(`${API}?${params}`, { signal: opts.signal }, "Hacker News (Algolia)");
    const hits: AlgoliaHit[] = data.hits ?? [];
    if (hits.length === 0) break;
    for (const h of hits) {
      items.push(
        tag === "comment"
          ? {
              id: h.objectID,
              kind: "comment",
              text: stripHtml(h.comment_text ?? ""),
              createdAt: h.created_at_i * 1000,
              url: `https://news.ycombinator.com/item?id=${h.objectID}`,
              context: h.story_title ?? undefined,
              score: h.points ?? undefined,
            }
          : {
              id: h.objectID,
              kind: "post",
              text: h.title ?? "",
              createdAt: h.created_at_i * 1000,
              url: `https://news.ycombinator.com/item?id=${h.objectID}`,
              context: h.url ?? undefined,
              score: h.points ?? undefined,
            },
      );
    }
    opts.onProgress(runningTotal() + items.length, false);
    before = hits[hits.length - 1]!.created_at_i;
    if (items.length >= opts.maxItems) break;
    // Be polite to Algolia (~3 req/s is plenty).
    await new Promise((r) => setTimeout(r, 350));
  }
  return items;
}

export const hnAdapter: PlatformAdapter = {
  id: "hn",
  label: "Hacker News",
  placeholder: "username (e.g. tptacek)",
  requiresAuth: false,

  parseHandle(input) {
    const handle = input.trim().replace(/^@/, "");
    if (!/^[A-Za-z0-9_-]{2,64}$/.test(handle)) return { error: "That doesn't look like a valid HN username." };
    return { handle };
  },

  async fetchHistory(handle, opts) {
    const comments = await fetchTagged(handle, "comment", opts, () => 0);
    const posts = await fetchTagged(handle, "story", opts, () => comments.length);
    const all = [...comments, ...posts].filter((i) => i.text.length > 0);
    if (all.length === 0) {
      throw new PlatformError(`No public comments or submissions found for "${handle}".`, "Check the username on news.ycombinator.com.");
    }
    all.sort((a, b) => a.createdAt - b.createdAt);
    const sliced = all.slice(-opts.maxItems);
    opts.onProgress(sliced.length, true);
    return sliced;
  },
};
