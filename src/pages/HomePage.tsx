import SetupForm from "../components/setup/SetupForm";
import RunProgress from "../components/progress/RunProgress";
import AssessmentReport from "../components/report/AssessmentReport";
import ShareButton from "../components/report/ShareButton";
import DeleteShareControl from "../components/report/DeleteShareControl";
import { useRun } from "../lib/useRun";
import { selectablePlatforms } from "../lib/platforms";

function sourceList(): string {
  const labels = selectablePlatforms().map((p) => p.label);
  return labels.length > 1 ? `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}` : (labels[0] ?? "");
}

export default function HomePage() {
  const { store, estimate, startFetch, confirmRun, abort } = useRun();
  const { stage, error, errorHint, result } = store;

  return (
    <main>
      {stage === "setup" || stage === "error" ? (
        <>
          <section className="rise" style={{ marginBottom: 40, maxWidth: "70ch" }}>
            <h1 style={{ fontSize: "clamp(28px, 4.5vw, 40px)", margin: "0 0 12px" }}>
              What does the public record say about <em style={{ color: "var(--accent)" }}>you</em>?
            </h1>
            <p style={{ color: "var(--text-1)", fontSize: 17, margin: 0 }}>
              Point your own LLM API key at any public {sourceList()} account. The full
              history is fetched and analyzed <strong>entirely in your browser</strong> — a multi-stage pipeline of
              readers, analysts and a synthesizer produces an affectionate, evidence-cited case file.
            </p>
          </section>

          {stage === "error" && (
            <div className="error-box rise" style={{ marginBottom: 24 }}>
              <strong>Something went wrong:</strong> {error}
              {errorHint && <div style={{ color: "var(--text-1)", marginTop: 4 }}>{errorHint}</div>}
            </div>
          )}

          <div className="panel rise">
            <SetupForm onStart={startFetch} disabled={false} />
          </div>
        </>
      ) : null}

      {(stage === "fetching" || stage === "running") && <RunProgress onAbort={abort} />}

      {stage === "estimate" && estimate && (
        <div className="panel rise" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="kicker kicker--accent">cost estimate — confirm before any tokens are spent</div>
          <div style={{ display: "flex", gap: 32, flexWrap: "wrap", fontFamily: "var(--font-mono)" }}>
            <Stat label="items fetched" value={String(store.fetchedCount)} />
            <Stat label="LLM calls" value={String(estimate.llmCalls)} />
            <Stat label="est. tokens" value={`${Math.round(estimate.inputTokens / 1000)}k in / ${Math.round(estimate.outputTokens / 1000)}k out`} />
            <Stat
              label="est. cost"
              value={
                estimate.unknownPricing
                  ? "unknown (model not in pricing list)"
                  : `$${estimate.lowUsd!.toFixed(2)} – $${estimate.highUsd!.toFixed(2)}`
              }
              accent
            />
          </div>
          {store.chosenModels && (
            <div className="kicker">
              models — reader: {store.chosenModels.reader}
              {store.depth === "deep" && <> · analyst: {store.chosenModels.analyst}</>}
              {" · "}synthesis: {store.chosenModels.synthesis}
            </div>
          )}
          <div style={{ display: "flex", gap: 12 }}>
            <button className="btn btn--primary" onClick={confirmRun}>
              run analysis
            </button>
            <button className="btn btn--ghost" onClick={abort}>
              cancel
            </button>
          </div>
        </div>
      )}

      {stage === "done" && result && (
        <AssessmentReport
          doc={result}
          actions={
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
              <ShareButton doc={result} />
              <DeleteShareControl />
              <button className="btn btn--ghost" onClick={() => store.reset()}>
                new analysis
              </button>
            </div>
          }
        />
      )}
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="kicker">{label}</div>
      <div style={{ fontSize: 18, color: accent ? "var(--accent)" : "var(--text-0)" }}>{value}</div>
    </div>
  );
}
