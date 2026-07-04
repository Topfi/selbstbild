import { useStore } from "../../state/store";

const PHASE_LABELS: Record<string, string> = {
  chunking: "Preparing evidence",
  reading: "Readers extracting evidence",
  analyzing: "Analysts assessing",
  synthesizing: "Synthesizing the case file",
  done: "Done",
};

export default function RunProgress({ onAbort }: { onAbort: () => void }) {
  const { stage, fetchedCount, progress } = useStore();

  return (
    <div className="panel rise" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="kicker kicker--accent">{stage === "fetching" ? "collecting the record" : "analysis in progress"}</div>
        <button className="btn btn--ghost" onClick={onAbort}>
          abort
        </button>
      </div>

      {stage === "fetching" && (
        <p style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: 14 }}>
          <Spinner /> fetched <strong style={{ color: "var(--accent)" }}>{fetchedCount}</strong> items…
        </p>
      )}

      {stage === "running" && progress && (
        <>
          <p style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: 14 }}>
            <Spinner /> {PHASE_LABELS[progress.phase] ?? progress.phase}
            {progress.chunksTotal ? ` — ${progress.chunksDone ?? 0}/${progress.chunksTotal}` : ""}
          </p>
          {progress.chunksTotal ? (
            <div style={{ height: 8, background: "var(--ink-2)", borderRadius: 4 }}>
              <div
                style={{
                  width: `${((progress.chunksDone ?? 0) / progress.chunksTotal) * 100}%`,
                  height: "100%",
                  background: "var(--data)",
                  borderRadius: 4,
                  transition: "width 300ms ease",
                }}
              />
            </div>
          ) : null}
          <div className="kicker">
            {Math.round(progress.tokensIn / 1000)}k tokens in · {Math.round(progress.tokensOut / 1000)}k out
            {progress.costSoFar !== undefined && ` · ~$${progress.costSoFar.toFixed(2)} so far`}
          </div>
          {progress.fallbackNotes && progress.fallbackNotes.length > 0 && (
            <div style={{ fontSize: 12.5, color: "var(--accent)" }}>
              {progress.fallbackNotes.map((n) => (
                <div key={n}>⚠ {n}</div>
              ))}
            </div>
          )}
          {progress.streamPreview && (
            <pre
              style={{
                margin: 0,
                maxHeight: 120,
                overflow: "hidden",
                fontFamily: "var(--font-mono)",
                fontSize: 11.5,
                color: "var(--muted)",
                whiteSpace: "pre-wrap",
                maskImage: "linear-gradient(to bottom, transparent, black 30%)",
              }}
            >
              {progress.streamPreview}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        marginRight: 8,
        borderRadius: "50%",
        border: "2px solid var(--ink-3)",
        borderTopColor: "var(--accent)",
        animation: "spin 800ms linear infinite",
      }}
    />
  );
}

// keyframes injected once
const style = document.createElement("style");
style.textContent = "@keyframes spin { to { transform: rotate(360deg); } }";
document.head.appendChild(style);
