import { useState } from "react";
import { deleteShare } from "../../lib/share/client";

/** Trash-can button that reveals a token input, so a share can be deleted
 *  from a browser that never saved the deletion token. */
export default function ManualDeleteControl({ slug, onDeleted }: { slug: string; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const onConfirm = async () => {
    setBusy(true);
    setMsg("");
    try {
      await deleteShare(slug, token.trim());
      onDeleted();
    } catch (e: any) {
      setMsg(e?.message ?? "Delete failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <button
        className="btn btn--ghost"
        title="delete this share"
        aria-label="delete this share"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 6h18" />
          <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      </button>
      {open && (
        <form
          style={{ display: "flex", gap: 6, alignItems: "center" }}
          onSubmit={(e) => {
            e.preventDefault();
            void onConfirm();
          }}
        >
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="deletion token"
            aria-label="deletion token"
            autoComplete="off"
            style={{ width: 180, padding: "7px 10px", fontSize: 13 }}
          />
          <button className="btn btn--ghost" type="submit" disabled={busy || !token.trim()}>
            {busy ? "deleting…" : "delete"}
          </button>
        </form>
      )}
      {msg && <span style={{ fontSize: 12.5, color: "var(--danger)" }}>{msg}</span>}
    </div>
  );
}
