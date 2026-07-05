import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import AssessmentReport from "../components/report/AssessmentReport";
import ManualDeleteControl from "../components/report/ManualDeleteControl";
import { getShare, deleteShare } from "../lib/share/client";
import { getDeletionToken } from "../lib/storage";
import type { AssessmentDoc } from "../lib/schema/assessment";
import { assessmentDocSchema } from "../lib/schema/assessment";

export default function ShareViewPage() {
  const { slug = "" } = useParams();
  const [doc, setDoc] = useState<AssessmentDoc | null>(null);
  const [error, setError] = useState("");
  const [deleted, setDeleted] = useState(false);
  const ownToken = getDeletionToken(slug);

  useEffect(() => {
    getShare(slug)
      .then((d) => setDoc(assessmentDocSchema.parse(d)))
      .catch((e) => setError(e?.message ?? "Failed to load."));
  }, [slug]);

  if (deleted) return <main><p>This share has been deleted.</p></main>;
  if (error) return <main><div className="error-box"><strong>Could not load this report:</strong> {error}</div></main>;
  if (!doc) return <main><p className="kicker">loading case file…</p></main>;

  return (
    <main>
      <AssessmentReport
        doc={doc}
        actions={
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <span className="kicker">shared report — generated in the sharer's own browser</span>
            {ownToken ? (
              <button
                className="btn btn--ghost"
                onClick={async () => {
                  await deleteShare(slug, ownToken);
                  setDeleted(true);
                }}
              >
                delete this share
              </button>
            ) : (
              <ManualDeleteControl slug={slug} onDeleted={() => setDeleted(true)} />
            )}
          </div>
        }
      />
    </main>
  );
}
