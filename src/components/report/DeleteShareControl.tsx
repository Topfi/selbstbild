import { useState } from "react";
import { deleteShare } from "../../lib/share/client";
import { getDeletionToken } from "../../lib/storage";
import { useStore } from "../../state/store";
import ManualDeleteControl from "./ManualDeleteControl";

/** Lets the creator delete the share they just published. */
export default function DeleteShareControl() {
  const { shareUrl, shareDeletionToken, set } = useStore();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  if (!shareUrl) return null;
  const slug = shareUrl.split("/s/")[1] ?? "";
  const token = getDeletionToken(slug) ?? shareDeletionToken;

  if (!token) {
    return (
      <ManualDeleteControl
        slug={slug}
        onDeleted={() => set({ shareUrl: null, shareDeletionToken: null })}
      />
    );
  }

  const onDelete = async () => {
    setBusy(true);
    try {
      await deleteShare(slug, token);
      set({ shareUrl: null, shareDeletionToken: null });
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
