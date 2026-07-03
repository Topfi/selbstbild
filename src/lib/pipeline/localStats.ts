import type { RawItem } from "../platforms/types";

/** Deterministic, locally computed report fields — never produced by an LLM. */

export function activityByMonth(items: RawItem[]): { month: string; count: number }[] {
  const counts = new Map<string, number>();
  let min = "";
  let max = "";
  for (const item of items) {
    const month = new Date(item.createdAt).toISOString().slice(0, 7);
    counts.set(month, (counts.get(month) ?? 0) + 1);
    if (!min || month < min) min = month;
    if (!max || month > max) max = month;
  }
  if (!min) return [];
  // Fill gaps so the chart shows quiet months as zero.
  const out: { month: string; count: number }[] = [];
  let [y = 0, m = 1] = min.split("-").map(Number);
  for (;;) {
    const month = `${y}-${String(m).padStart(2, "0")}`;
    out.push({ month, count: counts.get(month) ?? 0 });
    if (month === max) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

// Compact English stopword list; enough to keep function words out of the cloud.
const STOPWORDS = new Set(
  `a about above after again against all am an and any are as at be because been before being below between both but by can cannot could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just like me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with you your yours yourself yourselves
also im ive dont doesnt didnt cant wont isnt arent wasnt werent youre theyre weve theyve id youd hed shed wed itd thats whats heres theres id ill youll hell shell well theyll
one two three get got make made even much many still though however really actually thing things something anything nothing way say said see seen know known think thought want wanted use used using go going gone come came take took new time people lot bit yes able https http www com org
would could should might must may`.split(/\s+/),
);

/**
 * Top terms by a simple TF-IDF-flavored score: term frequency damped by
 * log, restricted to words appearing in at least 3 items so one rant about
 * a single topic doesn't dominate. Weights normalized to [0, 1].
 */
export function wordCloud(items: RawItem[], limit = 80): { term: string; weight: number }[] {
  const tf = new Map<string, number>();
  const df = new Map<string, number>();
  for (const item of items) {
    const words = item.text
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .match(/[a-zäöüßéèáàôçñ][a-z0-9äöüßéèáàôçñ'-]{2,}/gi);
    if (!words) continue;
    const seen = new Set<string>();
    for (const raw of words) {
      const w = raw.replace(/^'+|'+$/g, "");
      if (w.length < 3 || w.length > 30 || STOPWORDS.has(w)) continue;
      tf.set(w, (tf.get(w) ?? 0) + 1);
      if (!seen.has(w)) {
        seen.add(w);
        df.set(w, (df.get(w) ?? 0) + 1);
      }
    }
  }
  const scored = [...tf.entries()]
    .filter(([w]) => (df.get(w) ?? 0) >= Math.min(3, items.length))
    .map(([term, count]) => ({ term, score: count * Math.log(1 + (df.get(term) ?? 1)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  const max = scored[0]?.score ?? 1;
  return scored.map(({ term, score }) => ({ term, weight: Number((score / max).toFixed(4)) }));
}

export function countsByKind(items: RawItem[]): { comments: number; posts: number } {
  let comments = 0;
  let posts = 0;
  for (const i of items) i.kind === "comment" ? comments++ : posts++;
  return { comments, posts };
}

export function dateRange(items: RawItem[]): { from: string; to: string } {
  if (items.length === 0) return { from: "", to: "" };
  const sorted = [...items].sort((a, b) => a.createdAt - b.createdAt);
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: iso(sorted[0]!.createdAt), to: iso(sorted[sorted.length - 1]!.createdAt) };
}
