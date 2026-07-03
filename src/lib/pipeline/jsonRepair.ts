/**
 * Best-effort recovery of JSON from LLM output. Models occasionally wrap JSON
 * in code fences, prepend prose, or leave trailing commas — especially
 * arbitrary OpenRouter models without json_schema support.
 * Returns the parsed value, or null if nothing parseable was found.
 */
export function repairJson(raw: string): unknown | null {
  const attempts: string[] = [raw.trim()];

  // Strip code fences: ```json ... ```
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1] !== undefined) attempts.push(fence[1].trim());

  // Extract the outermost {...} or [...] span.
  const first = raw.search(/[{[]/);
  if (first !== -1) {
    const open = raw[first];
    const close = open === "{" ? "}" : "]";
    const last = raw.lastIndexOf(close);
    if (last > first) attempts.push(raw.slice(first, last + 1));
  }

  for (const candidate of attempts) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Remove trailing commas before } or ] and retry.
      try {
        return JSON.parse(candidate.replace(/,\s*([}\]])/g, "$1"));
      } catch {
        /* next attempt */
      }
    }
  }
  return null;
}
