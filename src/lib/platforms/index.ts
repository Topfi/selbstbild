import type { PlatformAdapter } from "./types";
import { hnAdapter } from "./hn";
import { redditAdapter } from "./reddit";
import { blueskyAdapter } from "./bluesky";
import { mastodonAdapter } from "./mastodon";

export const platforms: PlatformAdapter[] = [hnAdapter, redditAdapter, blueskyAdapter, mastodonAdapter];

/**
 * Platforms offered in the setup picker. On the public deployment only
 * Hacker News is selectable; the other adapters stay registered (hidden,
 * not removed) so localhost dev and existing shared reports keep working.
 */
export function selectablePlatforms(): PlatformAdapter[] {
  const host = typeof location !== "undefined" ? location.hostname : "";
  const isLocal = host === "localhost" || host === "127.0.0.1";
  return isLocal ? platforms : platforms.filter((p) => p.id === "hn");
}

export function getPlatform(id: string): PlatformAdapter {
  const p = platforms.find((a) => a.id === id);
  if (!p) throw new Error(`Unknown platform: ${id}`);
  return p;
}
