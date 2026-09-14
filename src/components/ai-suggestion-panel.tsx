"use client";

import { useEffect, useRef, useState } from "react";

type Target = { targetType: "assessment_question"; targetId: string; sessionId: string } | { targetType: "soa_item"; targetId: string } | { targetType: "audit"; targetId: string } | { targetType: "readiness_report" } | { targetType: "task"; targetId: string } | { targetType: "evidence"; targetId: string } | { targetType: "risk"; targetId: string };
type Draft = { id: string; status: string; output: { explanation: string; recommendedAction: string; confidence: string }; source_references: { type: string; id: string; label: string }[] };

const AI_ROUTE = ["/api", "app", "ai"].join("/");
const suggestionRoute = (id: string) => [AI_ROUTE, "suggestions", id].join("/");

export function AiSuggestionPanel({ target }: { target: Target }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (draft) resultRef.current?.focus(); }, [draft]);

  async function generate() {
    setLoading(true); setMessage("");
    try {
      const response = await fetch(AI_ROUTE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(target) });
      const body = await response.json();
      if (!response.ok) { setMessage(body.error ?? "Could not generate a draft."); return; }
      setDraft(body);
    } catch {
      setMessage("Could not generate a draft. Use the deterministic guidance instead.");
    } finally {
      setLoading(false);
    }
  }
  async function review(status: "accepted" | "dismissed") {
    if (!draft) return;
    setReviewing(true); setMessage("");
    try {
      const response = await fetch(suggestionRoute(draft.id), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
      if (!response.ok) { setMessage("Could not record your review."); return; }
      setDraft({ ...draft, status });
    } catch {
      setMessage("Could not record your review. Try again.");
    } finally {
      setReviewing(false);
    }
  }

  return <aside aria-label="AI Explain and Act" aria-busy={loading || reviewing} style={{ marginTop: "12px", padding: "12px", border: "1px solid #cfe0fb", borderRadius: "6px", background: "#fbfdff" }}>
    <b style={{ fontSize: "13px" }}>AI Explain &amp; Act <span style={{ color: "#596273", fontWeight: 500 }}>(draft only)</span></b>
    {!draft && <button type="button" className="button secondary" style={{ marginTop: "9px" }} onClick={() => void generate()} disabled={loading}>{loading ? "Drafting..." : "Draft explanation and next step"}</button>}
    {message && <p role="alert" style={{ margin: "8px 0 0", color: "var(--red)", fontSize: "12px" }}>{message}</p>}
    {draft && <div ref={resultRef} tabIndex={-1} role="status" aria-live="polite" style={{ marginTop: "9px", fontSize: "12px", color: "#596273", lineHeight: 1.5 }}>
      <p style={{ margin: 0 }}><b>Explanation:</b> {draft.output.explanation}</p><p style={{ margin: "7px 0" }}><b>Recommended next step:</b> {draft.output.recommendedAction}</p>
      <p style={{ margin: "7px 0" }}><b>Confidence:</b> {draft.output.confidence}. Facts used: {draft.source_references.map((reference) => reference.label).join(", ") || "none"}.</p>
      {draft.status === "draft" && <span style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}><button type="button" className="button secondary" onClick={() => void review("accepted")} disabled={reviewing}>{reviewing ? "Recording..." : "Mark draft reviewed"}</button><button type="button" className="button secondary" onClick={() => void review("dismissed")} disabled={reviewing}>Dismiss draft</button></span>}
      {draft.status !== "draft" && <p role="status" style={{ margin: "7px 0 0" }}>Draft {draft.status}. No compliance record was changed.</p>}
    </div>}
  </aside>;
}
