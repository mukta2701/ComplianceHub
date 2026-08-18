import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { Card, EmptyState, PageIntro, Pill, Stat } from "@/components/ui";
import { generateAutomationBaselineAction, revokeAutomationConnectionAction } from "./actions";
import { AutomationInbox } from "./automation-inbox";

type ProposalOutput = { title?: string; why?: string; explanation?: string; recommendedAction?: string; state?: string; confidence?: string; mappings?: unknown; limitations?: string };

function asOutput(value: unknown): ProposalOutput { return value && typeof value === "object" ? value as ProposalOutput : {}; }

export default async function AutomationPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const { supabase, user, membership, organisation } = await requireAppContext();
  const { message } = await searchParams;
  const [{ data: connections }, { data: proposals }, { data: aiSettings }, { data: aiDrafts }] = await Promise.all([
    supabase.from("connector_connections").select("id,provider,label,status,last_collected_at,last_error_at").eq("organisation_id", organisation.id).order("created_at", { ascending: false }),
    supabase.from("automation_proposals").select("id,target_type,assigned_to,status,output,source_references,created_at,automation_signals(signal_type,summary,confidence,occurred_at,connector_connections(label,provider)),automation_proposal_sources(source_objects(title,source_url))").eq("organisation_id", organisation.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("ai_workspace_settings").select("enabled").eq("organisation_id", organisation.id).maybeSingle(),
    supabase.from("ai_suggestions").select("target_id,output,status,created_at").eq("organisation_id", organisation.id).eq("target_type", "automation_proposal").eq("status", "draft").order("created_at", { ascending: false }),
  ]);
  const drafts = (proposals ?? []).filter((proposal) => proposal.status === "draft");
  const mine = drafts.filter((proposal) => proposal.assigned_to === user.id);
  const acceptedEvidence = (proposals ?? []).find((proposal) => proposal.status === "accepted" && proposal.target_type === "evidence" && proposal.assigned_to === user.id);
  const acceptedEvidenceTitle = acceptedEvidence ? asOutput(acceptedEvidence.output).title ?? "Automation evidence" : null;
  const inboxProposals = drafts.map((proposal) => {
    const signal = Array.isArray(proposal.automation_signals) ? proposal.automation_signals[0] : proposal.automation_signals;
    const connection = signal && (Array.isArray(signal.connector_connections) ? signal.connector_connections[0] : signal.connector_connections);
    const sourceLink = Array.isArray(proposal.automation_proposal_sources) ? proposal.automation_proposal_sources[0] : proposal.automation_proposal_sources;
    const source = sourceLink && (Array.isArray(sourceLink.source_objects) ? sourceLink.source_objects[0] : sourceLink.source_objects);
    const aiDraft = (aiDrafts ?? []).find((draft) => draft.target_id === proposal.id);
    const aiOutput = asOutput(aiDraft?.output);
    return {
      id: proposal.id,
      targetType: proposal.target_type,
      assignedTo: proposal.assigned_to,
      output: asOutput(proposal.output),
      createdAt: proposal.created_at,
      signal: signal ? { signalType: signal.signal_type, summary: signal.summary, confidence: signal.confidence, occurredAt: signal.occurred_at, provider: connection?.provider, connectionLabel: connection?.label } : null,
      source: source ? { title: source.title, sourceUrl: source.source_url } : null,
      aiDraft: aiDraft ? { explanation: aiOutput.explanation, recommendedAction: aiOutput.recommendedAction } : null,
    };
  });
  return <>
    <PageIntro eyebrow="AUTOMATION" title="Review the work your systems prepared" body="Connected systems collect bounded evidence, map it to GRC work, and prepare drafts. Nothing becomes a compliance decision until the assigned owner reviews it." action={<span style={{ display: "flex", gap: "8px" }}><form action={generateAutomationBaselineAction}><button className="button primary">Generate baseline</button></form><Link className="button secondary" href="/app/setup">Edit setup</Link></span>} />
    {message && <Card role="status" style={{ padding: "12px", marginBottom: "16px", background: "#f0f7ff", borderColor: "#cfe0fb" }}>{message}</Card>}
    <div className="stats-grid"><Stat label="CONNECTED SYSTEMS" value={(connections ?? []).filter((connection) => connection.status === "connected").length} detail={`${connections?.length ?? 0} configured`} tone="blue" /><Stat label="YOUR REVIEWS" value={mine.length} detail="drafts waiting for you" tone={mine.length ? "amber" : "green"} /><Stat label="ALL DRAFTS" value={drafts.length} detail="human review required" tone={drafts.length ? "amber" : "green"} /></div>
    <Card style={{ padding: "20px", marginTop: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>Connection health</h2>
      {(connections ?? []).length ? <div style={{ display: "grid", gap: "10px" }}>{connections?.map((connection) => <div key={connection.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", fontSize: "13px" }}><span><b>{connection.label || connection.provider}</b><small style={{ display: "block", color: "#596273", marginTop: "3px" }}>{connection.last_error_at ? "Collection needs attention" : connection.last_collected_at ? `Last collected ${new Date(connection.last_collected_at).toLocaleDateString("en-GB")}` : "Baseline collection is ready to run"}</small></span><span style={{ display: "flex", gap: "10px", alignItems: "center" }}><Pill tone={connection.status === "connected" ? "green" : connection.status === "error" ? "red" : "amber"}>{connection.status}</Pill>{membership.role === "owner" && connection.status !== "revoked" && <form action={revokeAutomationConnectionAction}><input type="hidden" name="id" value={connection.id} /><button type="submit" style={{ color: "var(--red)", fontWeight: 700, border: 0, background: "none" }}>Disconnect</button></form>}</span></div>)}</div> : <p style={{ margin: 0, color: "#596273", fontSize: "13px" }}>No automation systems are configured yet.</p>}
    </Card>
    <section style={{ marginTop: "22px" }} aria-labelledby="automation-inbox"><h2 id="automation-inbox" style={{ fontSize: "16px", margin: "0 0 10px" }}>Automation inbox</h2>
      {acceptedEvidenceTitle && <div role="status" style={{ padding: "12px", marginBottom: "12px", background: "#f2faf5", border: "1px solid #cce8d5", borderRadius: "6px", color: "#245c35", fontSize: "13px" }}><b>Evidence accepted.</b> {acceptedEvidenceTitle} is now available in <Link href="/app/evidence">Evidence</Link>.</div>}
      {!drafts.length && <EmptyState icon="clipboard" title="No automation drafts yet" body="Complete setup, then run a baseline collection. Evidence and remediation drafts will appear here for the people responsible for the work." primary={{ href: "/app/setup", label: "Set up automation" }} />}
      {drafts.length > 0 && <AutomationInbox proposals={inboxProposals} currentUserId={user.id} aiEnabled={Boolean(aiSettings?.enabled)} collectorVersion={process.env.EVIDENCE_LIVE === "1" ? "live-collector-v1" : "sandbox-fake-1"} collectorMode={process.env.EVIDENCE_LIVE === "1" ? "live" : "deterministic sandbox"} />}
    </section>
  </>;
}
