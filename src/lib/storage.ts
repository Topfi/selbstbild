/**
 * API-key handling. Default is memory-only: the key lives in a module
 * variable and dies with the tab. The user can opt into localStorage
 * persistence ("remember on this device"). The key is only ever sent to the
 * selected LLM provider's own API host — never to this app's server.
 */

const KEY_PREFIX = "pl.key.";
const PERSIST_PREFIX = "pl.persist.";
const DELETION_TOKENS = "pl.shareDeletionTokens";

const memoryKeys = new Map<string, string>();

export function getApiKey(providerId: string): string {
  return memoryKeys.get(providerId) ?? localStorage.getItem(KEY_PREFIX + providerId) ?? "";
}

export function setApiKey(providerId: string, key: string, persist: boolean): void {
  memoryKeys.set(providerId, key);
  localStorage.setItem(PERSIST_PREFIX + providerId, persist ? "1" : "0");
  if (persist && key) localStorage.setItem(KEY_PREFIX + providerId, key);
  else localStorage.removeItem(KEY_PREFIX + providerId);
}

export function getPersistPreference(providerId: string): boolean {
  return localStorage.getItem(PERSIST_PREFIX + providerId) === "1";
}

export function clearApiKey(providerId: string): void {
  memoryKeys.delete(providerId);
  localStorage.removeItem(KEY_PREFIX + providerId);
  localStorage.removeItem(PERSIST_PREFIX + providerId);
}

/** Deletion tokens for shares this browser created, so the user can delete later. */
export function rememberDeletionToken(slug: string, token: string): void {
  const all = JSON.parse(localStorage.getItem(DELETION_TOKENS) ?? "{}");
  all[slug] = token;
  localStorage.setItem(DELETION_TOKENS, JSON.stringify(all));
}

export function getDeletionToken(slug: string): string | undefined {
  return JSON.parse(localStorage.getItem(DELETION_TOKENS) ?? "{}")[slug];
}

export function forgetDeletionToken(slug: string): void {
  const all = JSON.parse(localStorage.getItem(DELETION_TOKENS) ?? "{}");
  delete all[slug];
  localStorage.setItem(DELETION_TOKENS, JSON.stringify(all));
}
