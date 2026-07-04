import type { ReactNode } from "react";
import type { AssessmentDoc } from "../../lib/schema/assessment";
import Markdown from "./Markdown";
import ActivityChart from "./ActivityChart";
import TopicChart from "./TopicChart";
import TraitMeters from "./TraitMeters";
import WordCloud from "./WordCloud";

const PLATFORM_LABELS: Record<string, string> = {
  hn: "Hacker News",
  reddit: "Reddit",
  bluesky: "Bluesky",
  mastodon: "Mastodon",
};

function Section({ kicker, title, children }: { kicker: string; title?: string; children: ReactNode }) {
  return (
    <section className="rise" style={{ marginTop: 44 }}>
      <div className="kicker kicker--accent" style={{ marginBottom: title ? 4 : 16 }}>
        {kicker}
      </div>
      {title && <h2 style={{ margin: "0 0 16px", fontSize: 24 }}>{title}</h2>}
      {children}
    </section>
  );
}

export default function AssessmentReport({ doc, actions }: { doc: AssessmentDoc; actions?: ReactNode }) {
  const m = doc.metadata;
  const platform = PLATFORM_LABELS[m.platform] ?? m.platform;
  const confidenceBadge = { mild: "◦ mild", firm: "● firm", "hill-to-die-on": "▲ hill to die on" } as const;

  return (
    <article>
      {/* Case header */}
      <header className="rise" style={{ borderBottom: "2px solid var(--ink-3)", paddingBottom: 28 }}>
        <div className="kicker" style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", marginBottom: 14 }}>
          <span style={{ color: "var(--accent)" }}>case file</span>
          <span>@{m.username} · {platform}</span>
          <span>{m.dateRange.from} → {m.dateRange.to}</span>
          <span>{m.counts.analyzedItems} items · {m.counts.comments} comments · {m.counts.posts} posts</span>
        </div>
        <h1 style={{ margin: 0, fontSize: "clamp(30px, 5vw, 46px)" }}>{doc.essay.title}</h1>
        <p style={{ fontSize: 18, color: "var(--text-1)", maxWidth: "62ch", marginTop: 16 }}>{doc.essay.tldr}</p>

        {/* Emoji summary strip */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 20 }}>
          {doc.emojiSummary.map((e, i) => (
            <div
              key={i}
              className="panel"
              style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, flex: "1 1 160px" }}
            >
              <span style={{ fontSize: 26 }}>{e.emoji}</span>
              <span style={{ fontSize: 12.5, color: "var(--text-1)", lineHeight: 1.35 }}>{e.caption}</span>
            </div>
          ))}
        </div>
        {actions && <div style={{ marginTop: 20 }}>{actions}</div>}
      </header>

      {/* Essay */}
      {doc.essay.sections.map((s) => (
        <Section key={s.heading} kicker="assessment" title={s.heading}>
          <div style={{ fontSize: 16.5, color: "var(--text-0)" }}>
            <Markdown>{s.markdown}</Markdown>
          </div>
        </Section>
      ))}

      <Section kicker="measurements" title="Trait meters">
        <TraitMeters traits={doc.traits} />
      </Section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 24 }}>
        <Section kicker="record" title="Activity over time">
          <ActivityChart data={doc.activityByMonth} />
        </Section>
        <Section kicker="record" title="What they talk about">
          <TopicChart data={doc.topicDistribution} />
        </Section>
      </div>

      {doc.wordCloud.length > 0 && (
        <Section kicker="record" title="Vocabulary">
          <div className="panel" style={{ padding: "28px 20px" }}>
            <WordCloud terms={doc.wordCloud} />
          </div>
        </Section>
      )}

      <Section kicker="exhibits" title="Top five">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20 }}>
          <div className="panel">
            <div className="kicker" style={{ marginBottom: 12 }}>topics</div>
            <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 10 }}>
              {doc.topFives.topics.map((t) => (
                <li key={t.label}>
                  <strong>{t.label}</strong>
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>{t.note}</div>
                </li>
              ))}
            </ol>
          </div>
          <div className="panel">
            <div className="kicker" style={{ marginBottom: 12 }}>strongest opinions</div>
            <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 10 }}>
              {doc.topFives.strongestOpinions.map((o) => (
                <li key={o.opinion}>
                  <strong>{o.opinion}</strong>
                  <div style={{ fontSize: 12, color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
                    {confidenceBadge[o.confidence]}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>{o.evidence}</div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </Section>

      <Section kicker="exhibits" title="In their own words">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
          {doc.topFives.characteristicQuotes.map((q, i) => (
            <blockquote
              key={i}
              className="panel"
              style={{
                margin: 0,
                borderLeft: "3px solid var(--accent)",
                fontFamily: "var(--font-display)",
                fontSize: 17,
                fontStyle: "italic",
                transform: `rotate(${(i % 3) - 1}deg)`,
              }}
            >
              “{q.text}”
              <footer style={{ fontFamily: "var(--font-mono)", fontStyle: "normal", fontSize: 12, color: "var(--muted)", marginTop: 10 }}>
                {q.date && <span>{q.date} — </span>}
                {q.note}
              </footer>
            </blockquote>
          ))}
        </div>
      </Section>

      <footer className="kicker" style={{ marginTop: 56, display: "flex", flexWrap: "wrap", gap: "6px 18px" }}>
        <span>generated {m.generatedAt.slice(0, 10)}</span>
        <span>depth: {m.analysis.depth}</span>
        <span>provider: {m.analysis.provider}</span>
        <span>
          models: {Object.entries(m.analysis.models).map(([role, id]) => `${role} ${id}`).join(" · ") || "n/a"}
        </span>
        {Object.values(m.analysis.models).some((id) => id.includes("fallback")) && (
          <span style={{ color: "var(--accent)" }}>
            ⚠ some calls were served by a fallback model after a safety decline — see the models line
          </span>
        )}
        <span>
          {Math.round(m.analysis.tokens.input / 1000)}k in / {Math.round(m.analysis.tokens.output / 1000)}k out ·
          ~${m.analysis.estimatedCostUsd.toFixed(2)}
        </span>
        {m.counts.skippedChunks > 0 && <span style={{ color: "var(--danger)" }}>{m.counts.skippedChunks} chunks skipped</span>}
      </footer>
    </article>
  );
}
