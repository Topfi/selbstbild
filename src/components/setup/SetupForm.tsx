import { useEffect, useState } from "react";
import { platforms } from "../../lib/platforms";
import { redditAuthConfigured } from "../../lib/platforms/reddit";
import { clearApiKey, getApiKey, getPersistPreference, setApiKey } from "../../lib/storage";
import { useStore, type ProviderId } from "../../state/store";
import type { Depth } from "../../lib/pipeline/prompts";
import { makeProvider } from "../../lib/useRun";

const PROVIDERS: { id: ProviderId; label: string; placeholder: string; host: string; keyUrl: string }[] = [
  { id: "anthropic", label: "Anthropic", placeholder: "sk-ant-…", host: "api.anthropic.com", keyUrl: "https://console.anthropic.com/settings/keys" },
  { id: "openrouter", label: "OpenRouter", placeholder: "sk-or-…", host: "openrouter.ai", keyUrl: "https://openrouter.ai/settings/keys" },
];

const DEPTHS: { id: Depth; label: string; blurb: string; models: Record<ProviderId, string>; fable?: boolean; ultra?: boolean }[] = [
  {
    id: "quick",
    label: "Quick",
    blurb: "single pass, cheapest (~$0.10–0.50)",
    models: { anthropic: "Haiku 4.5 throughout", openrouter: "Claude Haiku 4.5 (or cheapest capable)" },
  },
  {
    id: "standard",
    label: "Standard",
    blurb: "parallel readers → synthesis",
    models: { anthropic: "Haiku 4.5 readers → Sonnet 5", openrouter: "Haiku 4.5 readers → Sonnet 5" },
  },
  {
    id: "deep",
    label: "Deep",
    blurb: "readers → 3 analysts → synthesis",
    models: { anthropic: "Haiku 4.5 → Sonnet 5 analysts → Opus 4.8", openrouter: "Haiku 4.5 → Sonnet 5 analysts + synthesis" },
  },
  {
    id: "fable",
    label: "Fable 5",
    blurb: "the frontier tier — full pipeline, analysts and synthesis on Anthropic's most capable model",
    models: { anthropic: "Haiku 4.5 readers → Claude Fable 5 ($10/$50 per Mtok)", openrouter: "Fable 5 via OpenRouter if available" },
    fable: true,
  },
  {
    id: "ultra",
    label: "Ultra",
    blurb: "every single call — readers, analysts, synthesis — on Claude Fable 5. No compromises.",
    models: { anthropic: "100% Claude Fable 5, end to end", openrouter: "100% Fable 5 via OpenRouter if available" },
    ultra: true,
  },
];

/* Anthropic / Claude Code brand tokens for the Ultra card */
const ULTRA = { cream: "#faf9f5", clay: "#d97757", ink: "#191919", faded: "#6e6a60" };

export default function SetupForm({ onStart, disabled }: { onStart: () => void; disabled: boolean }) {
  const { providerId, platformId, handleInput, depth, set } = useStore();
  const [key, setKey] = useState("");
  const [persist, setPersist] = useState(false);
  const [keyStatus, setKeyStatus] = useState<"unchecked" | "checking" | "ok" | "bad">("unchecked");
  const [keyError, setKeyError] = useState("");

  useEffect(() => {
    setKey(getApiKey(providerId));
    setPersist(getPersistPreference(providerId));
    setKeyStatus("unchecked");
  }, [providerId]);

  const saveKey = (value: string, persistNow = persist) => {
    setKey(value);
    setKeyStatus("unchecked");
    setApiKey(providerId, value.trim(), persistNow);
  };

  const checkKey = async () => {
    setKeyStatus("checking");
    const res = await makeProvider(providerId).validateKey();
    setKeyStatus(res.ok ? "ok" : "bad");
    setKeyError(res.error ?? "");
  };

  const platform = platforms.find((p) => p.id === platformId)!;
  const redditUnconfigured = platformId === "reddit" && !redditAuthConfigured();
  const ready = key.trim().length > 8 && handleInput.trim().length > 0 && !redditUnconfigured;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      {/* provider + key */}
      <div className="field">
        <label>1 — LLM provider &amp; your API key</label>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div className="seg" role="group">
            {PROVIDERS.map((p) => (
              <button key={p.id} aria-pressed={providerId === p.id} onClick={() => set({ providerId: p.id })}>
                {p.label}
              </button>
            ))}
          </div>
          <input
            type="password"
            style={{ flex: "1 1 260px" }}
            placeholder={PROVIDERS.find((p) => p.id === providerId)!.placeholder}
            value={key}
            onChange={(e) => saveKey(e.target.value)}
            autoComplete="off"
          />
          <button className="btn btn--ghost" onClick={checkKey} disabled={key.trim().length < 8 || keyStatus === "checking"}>
            {keyStatus === "checking" ? "checking…" : keyStatus === "ok" ? "✓ valid" : "test key"}
          </button>
          <a
            href={PROVIDERS.find((p) => p.id === providerId)!.keyUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, alignSelf: "center" }}
          >
            get a key ↗
          </a>
        </div>
        {keyStatus === "bad" && <span style={{ color: "var(--danger)", fontSize: 13 }}>{keyError}</span>}
        <label style={{ display: "flex", gap: 8, alignItems: "center", textTransform: "none", letterSpacing: 0, fontFamily: "var(--font-body)", fontSize: 13, color: "var(--muted)" }}>
          <input
            type="checkbox"
            checked={persist}
            onChange={(e) => {
              setPersist(e.target.checked);
              saveKey(key, e.target.checked);
            }}
          />
          Remember key on this device (localStorage). Otherwise it lives in memory and dies with this tab. Either way it
          is sent only to {PROVIDERS.find((p) => p.id === providerId)!.host} — never to this app's server.
        </label>
        {key.trim().length > 0 && (
          <div>
            <button
              className="btn btn--ghost"
              style={{ padding: "4px 10px", fontSize: 11.5 }}
              onClick={() => {
                clearApiKey(providerId);
                setKey("");
                setPersist(false);
                setKeyStatus("unchecked");
              }}
            >
              forget this key
            </button>
            <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 8 }}>
              wipes it from memory and this device's storage
            </span>
          </div>
        )}
      </div>

      {/* platform + handle */}
      <div className="field">
        <label>2 — Who are we assessing?</label>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div className="seg" role="group">
            {platforms.map((p) => (
              <button key={p.id} aria-pressed={platformId === p.id} onClick={() => set({ platformId: p.id })}>
                {p.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            style={{ flex: "1 1 260px" }}
            placeholder={platform.placeholder}
            value={handleInput}
            onChange={(e) => set({ handleInput: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && ready && onStart()}
          />
        </div>
        {platformId === "reddit" && (
          <span style={{ fontSize: 13, color: "var(--muted)" }}>
            {redditUnconfigured
              ? "Reddit is not configured on this deployment (the operator must register a Reddit app — see README)."
              : "Reddit requires a one-click read-only authorization; you'll be redirected to reddit.com and back."}
          </span>
        )}
        {platformId === "mastodon" && (
          <span style={{ fontSize: 13, color: "var(--muted)" }}>
            Use the account's home instance for full history; some instances block anonymous reads.
          </span>
        )}
      </div>

      {/* depth */}
      <div className="field">
        <label>3 — Analysis depth</label>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {DEPTHS.map((d) => {
            const selected = depth === d.id;
            return (
              <button
                key={d.id}
                onClick={() => set({ depth: d.id })}
                className="panel"
                style={{
                  flex: "1 1 200px",
                  textAlign: "left",
                  padding: "12px 16px",
                  cursor: "pointer",
                  position: "relative",
                  border: d.ultra
                    ? `2px solid ${ULTRA.clay}`
                    : d.fable
                      ? `2px solid ${selected ? "var(--accent)" : "color-mix(in oklab, var(--accent) 60%, var(--ink-3))"}`
                      : `2px solid ${selected ? "var(--accent)" : "var(--ink-3)"}`,
                  background: d.ultra
                    ? ULTRA.cream
                    : d.fable
                      ? `linear-gradient(140deg, color-mix(in oklab, var(--accent) ${selected ? 14 : 7}%, var(--ink-1)), var(--ink-1) 60%)`
                      : selected
                        ? "color-mix(in oklab, var(--accent) 8%, var(--ink-1))"
                        : "var(--ink-1)",
                  boxShadow: d.ultra
                    ? `5px 5px 0 ${selected ? "rgba(217,119,87,0.55)" : "rgba(217,119,87,0.3)"}`
                    : d.fable && selected
                      ? "0 0 24px color-mix(in oklab, var(--accent) 25%, transparent)"
                      : undefined,
                }}
              >
                {d.ultra && (
                  <span
                    style={{
                      position: "absolute",
                      top: -9,
                      right: 10,
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      background: ULTRA.clay,
                      color: ULTRA.cream,
                      padding: "2px 8px",
                      borderRadius: 4,
                      fontWeight: 600,
                    }}
                  >
                    ✳ 100% fable 5
                  </span>
                )}
                {d.fable && (
                  <span
                    style={{
                      position: "absolute",
                      top: -9,
                      right: 10,
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      background: "var(--accent)",
                      color: "var(--on-accent)",
                      padding: "2px 8px",
                      borderRadius: 4,
                      fontWeight: 600,
                    }}
                  >
                    ★ frontier
                  </span>
                )}
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 13,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: d.ultra ? ULTRA.clay : selected || d.fable ? "var(--accent)" : "var(--text-0)",
                    fontWeight: d.ultra ? 600 : undefined,
                  }}
                >
                  {d.ultra ? "✳ " : d.fable ? "★ " : ""}{d.label}
                </div>
                <div style={{ fontSize: 12.5, color: d.ultra ? ULTRA.faded : "var(--muted)", marginTop: 2 }}>{d.blurb}</div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: d.ultra ? ULTRA.ink : d.fable ? "var(--accent)" : "var(--text-1)",
                    marginTop: 6,
                  }}
                >
                  {d.models[providerId]}
                </div>
              </button>
            );
          })}
        </div>
        {depth === "ultra" && (
          <span style={{ fontSize: 13, color: "var(--muted)" }}>
            ✳ Ultra runs the entire pipeline — every reader chunk included — on Claude Fable 5. Expect roughly 5–10×
            the cost of Deep for the same history (the exact estimate is shown before you confirm). Refused calls fall
            back to Opus 4.8 server-side; requires an org with standard (30-day) data retention.
          </span>
        )}
        {depth === "fable" && (
          <span style={{ fontSize: 13, color: "var(--muted)" }}>
            Fable 5 is Anthropic's highest-end model (Mythos-class tier above Opus). Roughly 2× Opus pricing; if its
            safety classifiers decline a call, the app automatically falls back to Opus 4.8 server-side. Requires an
            org with standard (30-day) data retention.
          </span>
        )}
      </div>

      <div>
        <button className="btn btn--primary" style={{ fontSize: 15, padding: "13px 26px" }} disabled={!ready || disabled} onClick={onStart}>
          Open case file →
        </button>
      </div>
    </div>
  );
}
