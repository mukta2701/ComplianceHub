"use client";

import { useMemo, useState } from "react";
import {
  createAutomationTaskDraftAction,
  generateAutomationExplanationAction,
  recollectAutomationProposalAction,
  reviewAutomationProposalAction,
} from "./actions";

type ProposalOutput = {
  title?: string;
  why?: string;
  recommendedAction?: string;
  confidence?: string;
  mappings?: unknown;
  limitations?: string;
};

export type AutomationInboxProposal = {
  id: string;
  targetType: string;
  assignedTo: string;
  output: ProposalOutput;
  createdAt: string;
  signal?: {
    signalType?: string;
    summary?: string;
    confidence?: string;
    occurredAt?: string;
    provider?: string;
    connectionLabel?: string;
  } | null;
  source?: { title?: string; sourceUrl?: string | null } | null;
  aiDraft?: { explanation?: string; recommendedAction?: string } | null;
};

type Props = {
  proposals: AutomationInboxProposal[];
  currentUserId: string;
  canCreateTaskDraft: boolean;
  aiEnabled: boolean;
  collectorVersion: string;
  collectorMode: string;
};

type Confirmation = { proposalId: string; kind: "evidence" | "task" } | null;

function displayDate(value?: string): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
}

function mappings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").slice(0, 8);
}

export function AutomationInbox({ proposals, currentUserId, canCreateTaskDraft, aiEnabled, collectorVersion, collectorMode }: Props) {
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const filtered = useMemo(() => proposals.filter((proposal) => filter === "all" || proposal.signal?.provider === filter), [filter, proposals]);
  const providers = Array.from(new Set(proposals.map((proposal) => proposal.signal?.provider).filter((provider): provider is string => Boolean(provider))));
  const selected = proposals.find((proposal) => proposal.id === selectedId);

  return <div className="automation-inbox">
    <div className="automation-inbox-toolbar">
      <label htmlFor="automation-filter">Filter automation drafts
        <select id="automation-filter" value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">All connected systems</option>
          {providers.map((provider) => <option key={provider} value={provider}>{provider.replaceAll("_", " ")}</option>)}
        </select>
      </label>
      <span className="automation-inbox-note">Selection is local to this view; opening a draft never changes a record.</span>
    </div>
    {selected && <div className="automation-draft-selection" role="status">{selected.output.title ?? "This proposal"} selected as a draft for review. Nothing was saved.</div>}
    {!filtered.length && <p className="automation-inbox-empty">No drafts match this filter.</p>}
    <div className="automation-inbox-list">
      {filtered.map((proposal) => {
        const output = proposal.output ?? {};
        const signal = proposal.signal ?? {};
        const isMine = proposal.assignedTo === currentUserId;
        const title = output.title ?? signal.summary ?? "Automation review";
        const proposalMappings = mappings(output.mappings);
        const limitations = output.limitations ?? "This observation does not prove that every in-scope resource is covered, that the control is effective over time, or that an owner has approved it.";
        const confirmingEvidence = confirmation?.proposalId === proposal.id && confirmation.kind === "evidence";
        const confirmingTask = confirmation?.proposalId === proposal.id && confirmation.kind === "task";
        return <article className="automation-draft-card" key={proposal.id} aria-label={`Automation draft: ${title}`}>
          <div className="automation-draft-heading">
            <div><span className="eyebrow">{proposal.targetType.toUpperCase()} DRAFT</span><h3>{title}</h3></div>
            <span className={`automation-confidence ${signal.confidence ?? output.confidence ?? "low"}`}>{signal.confidence ?? output.confidence ?? "low"} confidence</span>
          </div>
          <p className="automation-draft-why">{output.why ?? "Review the connected-system observation before using it in ComplianceHub."}</p>
          <p className="automation-draft-only"><b>Draft only.</b> No compliance record changes until an owner confirms an action.</p>
          <dl className="automation-provenance">
            <div><dt>Source</dt><dd>{proposal.source?.title ?? signal.connectionLabel ?? signal.provider ?? "Connected system"}{proposal.source?.sourceUrl && <a href={proposal.source.sourceUrl} target="_blank" rel="noreferrer">Open source</a>}</dd></div>
            <div><dt>Observed</dt><dd>{displayDate(signal.occurredAt ?? proposal.createdAt)}</dd></div>
            <div><dt>Collector</dt><dd>{collectorVersion} · {collectorMode === "live" ? "Live provider" : "Deterministic collection"}</dd></div>
            <div><dt>Signal</dt><dd>{signal.signalType ?? "Unclassified signal"}</dd></div>
          </dl>
          <div className="automation-mappings"><b>Suggested mappings</b><div>{proposalMappings.length > 0 ? proposalMappings.map((mapping) => <span key={mapping}>{mapping}</span>) : <span className="automation-mapping-empty">No mapping suggested</span>}</div></div>
          <details className="automation-limitations"><summary>What this does not prove</summary><p>{limitations}</p></details>
          {proposal.aiDraft && <div className="automation-ai" role="status"><b>AI-assisted explanation · Draft only</b><p>{proposal.aiDraft.explanation}</p>{proposal.aiDraft.recommendedAction && <p><b>Suggested next step:</b> {proposal.aiDraft.recommendedAction}</p>}<small>AI content is advisory and never changes a compliance record.</small></div>}
          {isMine && <div className="automation-draft-actions">
            {aiEnabled && !proposal.aiDraft && <form action={generateAutomationExplanationAction}><input type="hidden" name="id" value={proposal.id} /><button className="button secondary" type="submit">Draft AI explanation</button></form>}
            {proposal.targetType === "evidence" && <form action={reviewAutomationProposalAction}>
              <input type="hidden" name="id" value={proposal.id} /><input type="hidden" name="decision" value="accepted" />
              {confirmingEvidence ? <button className="button primary" type="submit">Confirm acceptance</button> : <button className="button primary" type="button" onClick={() => setConfirmation({ proposalId: proposal.id, kind: "evidence" })}>Accept as evidence</button>}
            </form>}
            {canCreateTaskDraft && <form action={createAutomationTaskDraftAction}>
              <input type="hidden" name="id" value={proposal.id} />
              {confirmingTask ? <button className="button secondary" type="submit">Confirm task draft</button> : <button className="button secondary" type="button" onClick={() => setConfirmation({ proposalId: proposal.id, kind: "task" })}>Create task draft</button>}
            </form>}
            <button className="button ghost" type="button" onClick={() => setSelectedId(proposal.id)}>Use as draft</button>
            <form action={recollectAutomationProposalAction}><input type="hidden" name="id" value={proposal.id} /><button className="button ghost" type="submit">Recollect</button></form>
            <form action={reviewAutomationProposalAction} className="automation-dismiss-form"><input type="hidden" name="id" value={proposal.id} /><input type="hidden" name="decision" value="dismissed" /><input aria-label={`Reason for dismissing ${title}`} name="dismissalReason" maxLength={1000} required placeholder="Why does this not apply?" /><button className="button ghost" type="submit">Dismiss</button></form>
          </div>}
        </article>;
      })}
    </div>
  </div>;
}
