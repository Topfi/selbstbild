import type { PlatformId } from "../schema/assessment";

export interface RawItem {
  id: string;
  kind: "comment" | "post";
  text: string;
  /** epoch milliseconds */
  createdAt: number;
  url?: string | undefined;
  /** parent story title / subreddit / thread hint */
  context?: string | undefined;
  score?: number | undefined;
}

export interface FetchOptions {
  signal: AbortSignal;
  maxItems: number;
  onProgress: (fetched: number, done: boolean) => void;
}

export type HandleParse = { handle: string } | { error: string };

export interface PlatformAdapter {
  id: PlatformId;
  label: string;
  placeholder: string;
  requiresAuth: boolean;
  parseHandle(input: string): HandleParse;
  /** Redirect to OAuth authorize URL (Reddit only). */
  beginAuth?(handle: string): void;
  /** True when a usable auth token is present. */
  hasAuth?(): boolean;
  fetchHistory(handle: string, opts: FetchOptions): Promise<RawItem[]>;
}

export class PlatformError extends Error {
  constructor(
    message: string,
    public readonly hint?: string | undefined,
  ) {
    super(message);
    this.name = "PlatformError";
  }
}

export async function fetchJson(url: string, init: RequestInit, friendly: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if (init.signal?.aborted) throw e;
    throw new PlatformError(
      `${friendly}: network or CORS error.`,
      "The service may be blocking browser requests, or your connection failed. Check the username and try again.",
    );
  }
  if (!res.ok) {
    throw new PlatformError(`${friendly}: HTTP ${res.status}.`, httpHint(res.status));
  }
  return res.json();
}

function httpHint(status: number): string | undefined {
  if (status === 404) return "User not found — check the spelling.";
  if (status === 401 || status === 403)
    return "This account or instance requires authentication and cannot be read anonymously.";
  if (status === 429) return "Rate limited — wait a minute and retry.";
  return undefined;
}
