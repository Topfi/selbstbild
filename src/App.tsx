import { useEffect, useState } from "react";
import { Link, Outlet } from "react-router-dom";

/** Light/dark toggle; "auto" follows the system via prefers-color-scheme. */
function ModeToggle() {
  const [mode, setMode] = useState(() => localStorage.getItem("pl.mode") ?? "auto");

  useEffect(() => {
    if (mode === "auto") delete document.documentElement.dataset["mode"];
    else document.documentElement.dataset["mode"] = mode;
    localStorage.setItem("pl.mode", mode);
  }, [mode]);

  const next = mode === "auto" ? "dark" : mode === "dark" ? "light" : "auto";
  const icon = mode === "auto" ? "◐ auto" : mode === "dark" ? "● dark" : "○ light";
  return (
    <button
      onClick={() => setMode(next)}
      title={`Color mode: ${mode} (click for ${next})`}
      style={{
        background: "none",
        border: "none",
        color: "var(--muted)",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        padding: 0,
      }}
    >
      {icon}
    </button>
  );
}

export default function App() {
  return (
    <div className="shell">
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          padding: "28px 0 18px",
          borderBottom: "1px solid var(--ink-3)",
          marginBottom: 36,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <Link to="/" style={{ textDecoration: "none", color: "inherit", display: "flex", gap: 12, alignItems: "baseline" }}>
          <span style={{ fontFamily: "var(--font-display)", fontSize: 26 }}>
            Selbst<span style={{ color: "var(--accent)" }}>bild</span>
          </span>
          <span className="kicker">your public self-image, assessed</span>
        </Link>
        <nav style={{ display: "flex", gap: 20, alignItems: "baseline" }} className="kicker">
          <Link to="/demo">demo report</Link>
          <a href="https://github.com/Topfi/selbstbild" target="_blank" rel="noreferrer">
            source
          </a>
          <ModeToggle />
        </nav>
      </header>

      <Outlet />

      <footer
        style={{ marginTop: 72, paddingTop: 20, borderTop: "1px solid var(--ink-3)", color: "var(--muted)", fontSize: 13 }}
      >
        <p style={{ margin: "0 0 6px" }}>
          <strong style={{ color: "var(--text-1)" }}>Privacy:</strong> your API key and the fetched history never leave
          your browser — analysis runs client-side against your chosen provider. Sharing is opt-in and uploads only the
          finished report (deletable, expires after 180 days).
        </p>
        <p style={{ margin: 0 }}>
          Open source under MIT · shared reports can be reported via the repository's issue tracker.
        </p>
      </footer>
    </div>
  );
}
