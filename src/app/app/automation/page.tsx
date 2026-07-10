import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { Card, EmptyState, PageIntro, Pill, Stat } from "@/components/ui";
import { generateAutomationBaselineAction, reviewAutomationProposalAction, revokeAutomationConnectionAction } from "./actions";

type ProposalOutput = { title?: string; why?: string; recommendedAction?: string; state?: string; confidence?: string };

function asOutput(value: unknown): ProposalOutput { return value && typeof value === "object" ? value as ProposalOutput : {}; }

export default async function AutomationPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const { supabase, user, membership } = await requireAppContext();
  const { message } = await searchParams;
  const [{ data: connections }, { data: proposals }] = await Promise.all([
    supabase.from("connector_connections").select("id,provider,label,status,last_collected_at,last_error_at").order("created_at", { ascending: false }),
    supabase.from("automation_proposals").select("id,target_type,assigned_to,status,output,source_references,created_at,automation_signals(signal_type,summary,confidence,occurred_at,connector_connections(label,provider))").order("created_at", { ascending: false }).limit(100),
  ]);
  const drafts = (proposals ?? []).filter((proposal) => proposal.status === "draft");
  const mine = drafts.filter((proposal) => proposal.assigned_to === user.id);
  return <>
    <PageIntro eyebrow="AUTOMATION" title="Review the work your systems prepared" body="Connected systems collect bounded evidence, map it to GRC work, and prepare drafts. Nothing becomes a compliance decision until the assigned owner reviews it." action={<span style={{ display: "flex", gap: "8px" }}><form action={generateAutomationBaselineAction}><button className="button primary">Generate baseline</button></form><Link className="button secondary" href="/app/setup">Edit setup</Link></span>} />
    {message && <Card role="status" style={{ padding: "12px", marginBottom: "16px", background: "#f0f7ff", borderColor: "#cfe0fb" }}>{message}</Card>}
    <div className="stats-grid"><Stat label="CONNECTED SYSTEMS" value={(connections ?? []).filter((connection) => connection.status === "connected").length} detail={`${connections?.length ?? 0} configured`} tone="blue" /><Stat label="YOUR REVIEWS" value={mine.length} detail="drafts waiting for you" tone={mine.length ? "amber" : "green"} /><Stat label="ALL DRAFTS" value={drafts.length} detail="human review required" tone={drafts.length ? "amber" : "green"} /></div>
    <Card style={{ padding: "20px", marginTop: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>Connection health</h2>
      {(connections ?? []).length ? <div style={{ display: "grid", gap: "10px" }}>{connections?.map((connection) => <div key={connection.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", fontSize: "13px" }}><span><b>{connection.label || connection.provider}</b><small style={{ display: "block", color: "#596273", marginTop: "3px" }}>{connection.last_error_at ? "Collection needs attention" : connection.last_collected_at ? `Last collected ${new Date(connection.last_collected_at).toLocaleDateString("en-GB")}` : "Baseline collection is ready to run"}</small></span><span style={{ display: "flex", gap: "10px", alignItems: "center" }}><Pill tone={connection.status === "connected" ? "green" : connection.status === "error" ? "red" : "amber"}>{connection.status}</Pill>{membership.role === "owner" && connection.status !== "revoked" && <form action={revokeAutomationConnectionAction}><input type="hidden" name="id" value={connection.id} /><button type="submit" style={{ color: "var(--red)", fontWeight: 700, border: 0, background: "none" }}>Disconnect</button></form>}</span></div>)}</div> : <p style={{ margin: 0, color: "#596273", fontSize: "13px" }}>No automation systems are configured yet.</p>}
    </Card>
    <section style={{ marginTop: "22px" }} aria-labelledby="automation-inbox"><h2 id="automation-inbox" style={{ fontSize: "16px", margin: "0 0 10px" }}>Automation inbox</h2>
      {!drafts.length && <EmptyState icon="clipboard" title="No automation drafts yet" body="Complete setup, then run a baseline collection. Evidence and remediation drafts will appear here for the people responsible for the work." primary={{ href: "/app/setup", label: "Set up automation" }} />}
      <div style={{ display: "grid", gap: "12px" }}>{drafts.map((proposal) => { const output = asOutput(proposal.output); const signal = Array.isArray(proposal.automation_signals) ? proposal.automation_signals[0] : proposal.automation_signals; const connection = signal && (Array.isArray(signal.connector_connections) ? signal.connector_connections[0] : signal.connector_connections); const isMine = proposal.assigned_to === user.id; const draftTitle = output.title ?? signal?.summary ?? "Automation review"; return <Card key={proposal.id} aria-label={`Automation draft: ${draftTitle}`} style={{ padding: "18px", borderColor: isMine ? "#cfe0fb" : undefined }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "start" }}><div><span className="eyebrow">{proposal.target_type.toUpperCase()} DRAFT</span><h3 style={{ fontSize: "15px", margin: "4px 0" }}>{draftTitle}</h3><p style={{ margin: "0", color: "#596273", fontSize: "13px", lineHeight: 1.5 }}>{output.why ?? "Review the connected-system observation before using it in ComplianceHub."}</p></div><Pill tone={isMine ? "blue" : "neutral"}>{isMine ? "Assigned to you" : "Assigned to another owner"}</Pill></div>
        <p style={{ margin: "10px 0", color: "#596273", fontSize: "12px" }}><b>Source:</b> {connection?.label ?? connection?.provider ?? "Connected system"} · {signal?.confidence ?? output.confidence ?? "low"} confidence · {signal?.signal_type ?? "unclassified signal"}</p>
        <p style={{ margin: "0", color: "#596273", fontSize: "12px" }}><b>Recommended next step:</b> {output.recommendedAction ?? "Review the source and decide whether it belongs in the workspace."}</p>
        {isMine && <div style={{ display: "grid", gap: "8px", marginTop: "14px" }}><form action={reviewAutomationProposalAction} style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}><input type="hidden" name="id" value={proposal.id} /><input type="hidden" name="decision" value="accepted" /><button className="button primary">{proposal.target_type === "task" ? "Create task" : "Accept as evidence"}</button></form><form action={reviewAutomationProposalAction} style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}><input type="hidden" name="id" value={proposal.id} /><input type="hidden" name="decision" value="dismissed" /><input aria-label={`Reason for dismissing ${output.title ?? "automation draft"}`} name="dismissalReason" maxLength={1000} required placeholder="Why does this not apply?" style={{ flex: "1 1 220px" }} /><button className="button secondary">Dismiss</button></form></div>}
      </Card>; })}</div>
    </section>
  </>;
}
