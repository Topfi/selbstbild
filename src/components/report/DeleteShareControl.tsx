import { useState } from "react";
import { deleteShare } from "../../lib/share/client";
import { getDeletionToken } from "../../lib/storage";
import { useStore } from "../../state/store";

/** Lets the creator delete the share they just published. */
export default function DeleteShareControl() {
  const { shareUrl, set } = useStore();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  if (!shareUrl) return null;
  const slug = shareUrl.split("/s/")[1] ?? "";

  const onDelete = async () => {
    const token = getDeletionToken(slug) ?? useStore.getState().shareDeletionToken;
    if (!token) {
      setMsg("No deletion token found in this browser.");
      return;
    }
    setBusy(true);
    try {
      await deleteShare(slug, token);
      set({ shareUrl: null, shareDeletionToken: null });
      setMsg("Share deleted.");
    } catch (e: any) {
      setMsg(e?.message ?? "Delete failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <button className="btn btn--ghost" onClick={onDelete} disabled={busy}>
        {busy ? "deleting…" : "delete share"}
      </button>
      <span style={{ fontSize: 11.5, color: "var(--muted)", maxWidth: 200 }}>
        authenticates with the deletion token saved in this browser
      </span>
      {msg && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{msg}</span>}
    </div>
  );
}
