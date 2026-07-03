// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { hnAdapter } from "../src/lib/platforms/hn";
import { blueskyAdapter } from "../src/lib/platforms/bluesky";
import { mastodonAdapter } from "../src/lib/platforms/mastodon";
import { PlatformError } from "../src/lib/platforms/types";

const opts = () => ({ signal: new AbortController().signal, maxItems: 5000, onProgress: vi.fn() });

function mockFetchSequence(responses: Array<{ url?: RegExp; body: unknown; status?: number }>) {
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const r = responses[Math.min(call++, responses.length - 1)]!;
      if (r.url) expect(String(url)).toMatch(r.url);
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("hnAdapter", () => {
  it("validates handles", () => {
    expect(hnAdapter.parseHandle("@Topfi")).toEqual({ handle: "Topfi" });
    expect("error" in hnAdapter.parseHandle("bad name!")).toBe(true);
  });

  it("fetches comments and stories, strips HTML, sorts chronologically", async () => {
    mockFetchSequence([
      {
        url: /tags=comment%2Cauthor_alice|tags=comment,author_alice/,
        body: {
          hits: [
            { objectID: "2", created_at_i: 200, comment_text: "Second &amp; <p>with para</p>", story_title: "Story B" },
            { objectID: "1", created_at_i: 100, comment_text: "First <i>italic</i>", story_title: "Story A" },
          ],
        },
      },
      { body: { hits: [] } }, // comment pagination ends
      { body: { hits: [{ objectID: "3", created_at_i: 300, title: "My Show HN", points: 42 }] } },
      { body: { hits: [] } }, // story pagination ends
    ]);
    const items = await hnAdapter.fetchHistory("alice", opts());
    expect(items.map((i) => i.id)).toEqual(["1", "2", "3"]);
    expect(items[1]!.text).toContain("Second &");
    expect(items[1]!.text).toContain("with para");
    expect(items[1]!.text).not.toContain("<p>");
    expect(items[0]!.text).toBe("First italic");
    expect(items[2]!.kind).toBe("post");
  });

  it("throws PlatformError for empty user", async () => {
    mockFetchSequence([{ body: { hits: [] } }]);
    await expect(hnAdapter.fetchHistory("ghost", opts())).rejects.toBeInstanceOf(PlatformError);
  });
});

describe("blueskyAdapter", () => {
  it("normalizes bare handles to .bsky.social", () => {
    expect(blueskyAdapter.parseHandle("alice")).toEqual({ handle: "alice.bsky.social" });
    expect(blueskyAdapter.parseHandle("@Jay.bsky.team")).toEqual({ handle: "jay.bsky.team" });
  });

  it("paginates with cursor and skips reposts", async () => {
    mockFetchSequence([
      {
        body: {
          cursor: "next1",
          feed: [
            { post: { uri: "at://x/app.bsky.feed.post/aaa", record: { text: "hello", createdAt: "2024-01-01T00:00:00Z" }, likeCount: 3 } },
            { reason: { $type: "repost" }, post: { uri: "at://x/app.bsky.feed.post/bbb", record: { text: "reposted" } } },
          ],
        },
      },
      {
        body: {
          feed: [
            {
              post: {
                uri: "at://x/app.bsky.feed.post/ccc",
                record: { text: "a reply", createdAt: "2024-01-02T00:00:00Z", reply: { parent: {} } },
              },
            },
          ],
        },
      },
    ]);
    const items = await blueskyAdapter.fetchHistory("alice.bsky.social", opts());
    expect(items).toHaveLength(2);
    expect(items[0]!.kind).toBe("post");
    expect(items[1]!.kind).toBe("comment");
    expect(items[0]!.url).toContain("/post/aaa");
  });
});

describe("mastodonAdapter", () => {
  it("requires user@instance form", () => {
    expect("error" in mastodonAdapter.parseHandle("justauser")).toBe(true);
    expect(mastodonAdapter.parseHandle("@Gargron@mastodon.social")).toEqual({ handle: "Gargron@mastodon.social" });
  });

  it("looks up the account then pages statuses, stripping HTML", async () => {
    mockFetchSequence([
      { url: /accounts\/lookup/, body: { id: "42" } },
      {
        url: /accounts\/42\/statuses/,
        body: [
          { id: "9", content: "<p>Hello <b>world</b></p>", created_at: "2024-03-01T10:00:00Z", url: "https://m.s/9", favourites_count: 1, reblogs_count: 0 },
        ],
      },
      { body: [] },
    ]);
    const items = await mastodonAdapter.fetchHistory("Gargron@mastodon.social", opts());
    expect(items).toHaveLength(1);
    expect(items[0]!.text).toBe("Hello world");
  });

  it("surfaces auth-restricted instances with a hint", async () => {
    mockFetchSequence([{ body: { error: "unauthorized" }, status: 401 }]);
    await expect(mastodonAdapter.fetchHistory("a@closed.example", opts())).rejects.toBeInstanceOf(PlatformError);
  });
});
