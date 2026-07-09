import { getSoaControlGuidance } from "@/features/education/domain/soa-guidance";
import { AiSuggestionPanel } from "@/components/ai-suggestion-panel";

export function SoaControlGuidance({ control, aiEnabled = false }: { control: { id: string; code: string; title: string; applicable: boolean }; aiEnabled?: boolean }) {
  const guidance = getSoaControlGuidance(control);

  return <details style={{ marginTop: "14px", border: "1px solid #d8e6f8", borderRadius: "6px", background: "#fbfdff", padding: "10px 12px" }}>
    <summary style={{ cursor: "pointer", color: "var(--blue)", fontSize: "13px", fontWeight: 700 }}>Explain &amp; Act</summary>
    <div style={{ display: "grid", gap: "10px", marginTop: "12px", fontSize: "13px", lineHeight: 1.5 }}>
      <div><b>Why this control matters</b><p style={{ margin: "4px 0 0", color: "#596273" }}>{guidance.why}</p></div>
      <div><b>What you decide</b><p style={{ margin: "4px 0 0", color: "#596273" }}>{guidance.decision}</p></div>
      <div><b>Evidence ideas</b><ul style={{ margin: "4px 0 0", paddingLeft: "18px", color: "#596273" }}>{guidance.evidenceExamples.map((example) => <li key={example}>{example}</li>)}</ul></div>
      <div><b>Rationale draft only</b><p style={{ margin: "4px 0 0", color: "#596273" }}>{guidance.rationaleTemplate}</p></div>
      {aiEnabled && <AiSuggestionPanel target={{ targetType: "soa_item", targetId: control.id }} />}
    </div>
  </details>;
}
