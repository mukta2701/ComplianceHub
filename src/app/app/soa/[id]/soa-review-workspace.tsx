"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, type FormEvent } from "react";
import { StatusLabel, type StatusTone } from "@/components/status-label";
import {
  deriveSoaReviewState,
  filterSoaQueue,
  summariseSoaQueue,
  type SoaDomain,
  type SoaQueueFilters,
  type SoaQueueItem,
  type SoaReviewState,
} from "@/features/soa/application/review-queue";
import { SOA_STATUS_LABEL, type SoaStatus } from "@/features/soa/domain/soa";

type MemberOption = { id: string; name: string };
type SaveAction = (formData: FormData) => Promise<void>;
type DetailTab = "decision" | "evidence" | "work" | "history";
type BlockerFilter = "missing_rationale" | "evidence_gaps" | "unassigned" | "undecided";

type Draft = Pick<SoaQueueItem, "applicable" | "status" | "justification" | "evidenceText" | "ownerId">;

export type SoaReviewWorkspaceProps = {
  items: SoaQueueItem[];
  members: MemberOption[];
  currentUserId: string;
  saveAction: SaveAction;
};

const DOMAINS: SoaDomain[] = ["organisational", "people", "physical", "technological"];
const STATUSES: SoaStatus[] = ["pending", "absent", "in_progress", "established", "operational", "advanced"];

const REVIEW_STATE_LABEL: Record<SoaReviewState, string> = {
  missing_decision: "Undecided",
  missing_rationale: "Missing rationale",
  missing_owner: "Unassigned",
  missing_evidence: "Evidence gap",
  stale_evidence: "Stale evidence",
  reviewed: "Reviewed",
};

const DOMAIN_WHY: Record<SoaDomain, string> = {
  organisational: "This organisational control clarifies how security responsibilities and decisions are governed.",
  people: "This people control helps staff understand and carry out their security responsibilities.",
  physical: "This physical control helps protect people, facilities, and information from unauthorised access or harm.",
  technological: "This technological control helps systems and information remain protected during day-to-day operation.",
};

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
}

function toDraft(item: SoaQueueItem): Draft {
  return {
    applicable: item.applicable,
    status: item.status,
    justification: item.justification,
    evidenceText: item.evidenceText,
    ownerId: item.ownerId,
  };
}

function reviewTone(reviewState: SoaReviewState): StatusTone {
  if (reviewState === "reviewed") return "confirmed";
  if (reviewState === "missing_evidence" || reviewState === "stale_evidence") return "risk";
  return "attention";
}

function evidenceHealth(item: Pick<SoaQueueItem, "evidenceTotal" | "evidenceExpiring" | "evidenceExpired">) {
  if (item.evidenceTotal === 0) return "No linked evidence";
  if (item.evidenceExpired > 0) return `${item.evidenceTotal} linked, ${item.evidenceExpired} expired`;
  if (item.evidenceExpiring > 0) return `${item.evidenceTotal} linked, ${item.evidenceExpiring} expiring`;
  return `${item.evidenceTotal} linked and current`;
}

function applyBlockerFilter(items: SoaQueueItem[], blocker: BlockerFilter | null) {
  if (blocker === "missing_rationale") return items.filter((item) => !item.justification.trim());
  if (blocker === "evidence_gaps") {
    return items.filter((item) => item.applicable && (item.evidenceTotal === 0 || item.evidenceExpired > 0));
  }
  if (blocker === "unassigned") return items.filter((item) => !item.ownerId);
  if (blocker === "undecided") return items.filter((item) => item.status === "pending");
  return items;
}

export function SoaReviewWorkspace({ items, members, currentUserId, saveAction }: SoaReviewWorkspaceProps) {
  const router = useRouter();
  const initialItems = useMemo(() => [...items].sort((left, right) => left.position - right.position), [items]);
  const [queueItems, setQueueItems] = useState(initialItems);
  const [search, setSearch] = useState("");
  const [domain, setDomain] = useState<SoaDomain | "">("");
  const [reviewState, setReviewState] = useState<SoaReviewState | "needs_attention" | "">("needs_attention");
  const [owner, setOwner] = useState("");
  const [applicability, setApplicability] = useState<"" | "true" | "false">("");
  const [onlyMine, setOnlyMine] = useState(false);
  const [blockerFilter, setBlockerFilter] = useState<BlockerFilter | null>(null);
  const firstAttention = initialItems.find((item) => item.reviewState !== "reviewed") ?? initialItems[0] ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(firstAttention?.id ?? null);
  const [draft, setDraft] = useState<Draft | null>(firstAttention ? toDraft(firstAttention) : null);
  const [activeTab, setActiveTab] = useState<DetailTab>("decision");
  const [saveMessage, setSaveMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const summary = useMemo(() => summariseSoaQueue(queueItems), [queueItems]);
  const filters = useMemo<SoaQueueFilters>(() => ({
    search: search || undefined,
    domain: domain || undefined,
    reviewState: reviewState || undefined,
    ownerId: onlyMine ? currentUserId : owner === "unassigned" ? null : owner || undefined,
    applicable: applicability === "" ? undefined : applicability === "true",
  }), [applicability, currentUserId, domain, onlyMine, owner, reviewState, search]);

  const filterItems = useCallback(
    (source: SoaQueueItem[]) => applyBlockerFilter(filterSoaQueue(source, filters), blockerFilter),
    [blockerFilter, filters],
  );
  const visibleItems = useMemo(() => filterItems(queueItems), [filterItems, queueItems]);
  const selectedItem = queueItems.find((item) => item.id === selectedId) ?? null;

  function selectItem(item: SoaQueueItem) {
    setSelectedId(item.id);
    setDraft(toDraft(item));
    setActiveTab("decision");
    setSaveMessage("");
  }

  function selectSummary(next: "needs_attention" | "reviewed" | BlockerFilter) {
    if (next === "needs_attention" || next === "reviewed") {
      setReviewState(next);
      setBlockerFilter(null);
    } else {
      setReviewState("");
      setBlockerFilter(next);
    }
  }

  function clearFilters() {
    setSearch("");
    setDomain("");
    setReviewState("");
    setOwner("");
    setApplicability("");
    setOnlyMine(false);
    setBlockerFilter(null);
  }

  function updateApplicability(applicable: boolean) {
    setDraft((current) => current ? {
      ...current,
      applicable,
      status: applicable ? (current.status === "not_applicable" ? "pending" : current.status) : "not_applicable",
    } : current);
  }

  async function save(advance: boolean) {
    if (!selectedItem || !draft || saving) return;
    setSaving(true);
    setSaveMessage("Saving");
    const formData = new FormData();
    formData.set("itemId", selectedItem.id);
    formData.set("status", draft.status);
    formData.set("applicable", String(draft.applicable));
    formData.set("ownerId", draft.ownerId ?? "");
    formData.set("justification", draft.justification);
    formData.set("evidence", draft.evidenceText);

    try {
      await saveAction(formData);
      const updated: SoaQueueItem = {
        ...selectedItem,
        ...draft,
        ownerName: members.find((member) => member.id === draft.ownerId)?.name ?? null,
        reviewState: deriveSoaReviewState({
          ...selectedItem,
          ...draft,
        }),
      };
      const nextQueue = queueItems.map((item) => item.id === updated.id ? updated : item);
      setQueueItems(nextQueue);
      setSaveMessage("Saved");
      router.refresh();

      if (advance) {
        const unresolved = filterItems(nextQueue).filter((item) => item.id !== updated.id && item.reviewState !== "reviewed");
        const next = unresolved.find((item) => item.position > updated.position) ?? unresolved[0];
        if (next) selectItem(next);
        setSaveMessage("Saved");
      }
    } catch (error) {
      setSaveMessage(`Error: ${error instanceof Error ? error.message : "Could not save review"}`);
    } finally {
      setSaving(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    void save(submitter?.value === "next");
  }

  const hasActiveFilters = Boolean(
    search || domain || reviewState || owner || applicability || onlyMine || blockerFilter,
  );
  const activeSummary = blockerFilter ?? (reviewState === "needs_attention" || reviewState === "reviewed" ? reviewState : null);

  return (
    <section className="soa-review-workspace" id="soa-review-blockers">
      <div className="soa-review-summary" aria-label="Review summary">
        <button type="button" aria-pressed={activeSummary === "needs_attention"} onClick={() => selectSummary("needs_attention")}>Needs attention <strong>{summary.needsAttention}</strong></button>
        <button type="button" aria-pressed={activeSummary === "reviewed"} onClick={() => selectSummary("reviewed")}>Reviewed <strong>{summary.reviewed}</strong></button>
        <button type="button" aria-pressed={activeSummary === "missing_rationale"} onClick={() => selectSummary("missing_rationale")}>Missing rationale <strong>{summary.missingRationale}</strong></button>
        <button type="button" aria-pressed={activeSummary === "evidence_gaps"} onClick={() => selectSummary("evidence_gaps")}>Evidence gaps <strong>{summary.evidenceGaps}</strong></button>
        <button type="button" aria-pressed={activeSummary === "unassigned"} onClick={() => selectSummary("unassigned")}>Unassigned <strong>{summary.unassigned}</strong></button>
        <button type="button" aria-pressed={activeSummary === "undecided"} onClick={() => selectSummary("undecided")}>Undecided <strong>{summary.undecided}</strong></button>
      </div>

      <div className="soa-review-toolbar" aria-label="Queue filters">
        <label className="soa-filter-search">Search controls<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label>Domain<select value={domain} onChange={(event) => setDomain(event.target.value as SoaDomain | "")}><option value="">All domains</option>{DOMAINS.map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}</select></label>
        <label>Review state<select value={reviewState} onChange={(event) => { setReviewState(event.target.value as SoaReviewState | "needs_attention" | ""); setBlockerFilter(null); }}><option value="">All states</option><option value="needs_attention">Needs attention</option>{Object.entries(REVIEW_STATE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Owner<select value={owner} onChange={(event) => { setOwner(event.target.value); if (event.target.value) setOnlyMine(false); }}><option value="">All owners</option><option value="unassigned">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
        <label>Applicability<select value={applicability} onChange={(event) => setApplicability(event.target.value as "" | "true" | "false")}><option value="">All decisions</option><option value="true">Applicable</option><option value="false">Not applicable</option></select></label>
        <label className="soa-only-mine"><input type="checkbox" checked={onlyMine} onChange={(event) => { setOnlyMine(event.target.checked); if (event.target.checked) setOwner(""); }} />Only my controls</label>
        {hasActiveFilters ? <button type="button" className="clear-filter" onClick={clearFilters}>Clear filters</button> : null}
      </div>

      <div className="soa-review-layout">
        <section className="soa-queue" aria-label="SoA review queue">
          <header><h2>Review queue</h2><span>{visibleItems.length} of {summary.total}</span></header>
          {visibleItems.length ? (
            <ol>
              {visibleItems.map((item) => (
                <li key={item.id} data-selected={item.id === selectedId}>
                  <div className="soa-queue-control"><code>{item.code}</code><strong>{item.title}</strong><small>{titleCase(item.domain)}</small></div>
                  <StatusLabel tone={reviewTone(item.reviewState)}>{REVIEW_STATE_LABEL[item.reviewState]}</StatusLabel>
                  <span className="soa-queue-owner">{item.ownerName ?? "Unassigned"}</span>
                  <span className="soa-queue-evidence">{evidenceHealth(item)}</span>
                  <button type="button" className="button secondary" aria-current={item.id === selectedId ? "true" : undefined} onClick={() => selectItem(item)}>Review <span className="sr-only">{item.code} {item.title}</span></button>
                </li>
              ))}
            </ol>
          ) : <p className="soa-queue-empty">No controls match these filters.</p>}
        </section>

        {selectedItem && draft ? (
          <form className="soa-review-detail" aria-label={`Review ${selectedItem.code}`} onSubmit={submit}>
            <header className="soa-detail-heading">
              <div><small>{titleCase(selectedItem.domain)} control</small><h2>{selectedItem.code} {selectedItem.title}</h2></div>
              <StatusLabel tone={reviewTone(selectedItem.reviewState)}>{REVIEW_STATE_LABEL[selectedItem.reviewState]}</StatusLabel>
            </header>

            <div className="soa-decision-context">
              <div><strong>Why this matters</strong><p>{DOMAIN_WHY[selectedItem.domain]} For {selectedItem.title.toLowerCase()}, record the decision your team can support with its own working evidence.</p></div>
              <div><strong>What you decide here</strong><p>Confirm whether this control applies, how far it is implemented, who owns it, and the rationale and references supporting that decision.</p></div>
            </div>

            <div className="soa-detail-tabs" role="tablist" aria-label="Control review sections">
              {([
                ["decision", "Decision"],
                ["evidence", "Evidence"],
                ["work", "Linked work"],
                ["history", "History"],
              ] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={activeTab === value} aria-controls={`soa-panel-${value}`} id={`soa-tab-${value}`} onClick={() => setActiveTab(value)}>{label}</button>)}
            </div>

            <div className="soa-detail-panel" role="tabpanel" id={`soa-panel-${activeTab}`} aria-labelledby={`soa-tab-${activeTab}`}>
              {activeTab === "decision" ? <div className="soa-decision-fields">
                <label>Applicability decision<select value={String(draft.applicable)} onChange={(event) => updateApplicability(event.target.value === "true")}><option value="true">Applicable</option><option value="false">Not applicable</option></select></label>
                <label>Implementation status<select value={draft.status} disabled={!draft.applicable} onChange={(event) => setDraft({ ...draft, status: event.target.value as SoaStatus })}>{draft.applicable ? STATUSES.map((status) => <option key={status} value={status}>{SOA_STATUS_LABEL[status]}</option>) : <option value="not_applicable">{SOA_STATUS_LABEL.not_applicable}</option>}</select></label>
                <label>Owner assignment<select value={draft.ownerId ?? ""} onChange={(event) => setDraft({ ...draft, ownerId: event.target.value || null })}><option value="">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
                <label className="soa-rationale">Rationale<textarea required value={draft.justification} onChange={(event) => setDraft({ ...draft, justification: event.target.value })} /></label>
              </div> : null}

              {activeTab === "evidence" ? <div className="soa-evidence-panel">
                <div><strong>Evidence health</strong><p>{evidenceHealth(selectedItem)}</p>{selectedItem.evidenceExpiring > 0 ? <small>{selectedItem.evidenceExpiring} item{selectedItem.evidenceExpiring === 1 ? " is" : "s are"} nearing expiry.</small> : null}{selectedItem.evidenceExpired > 0 ? <small>{selectedItem.evidenceExpired} item{selectedItem.evidenceExpired === 1 ? " has" : "s have"} expired.</small> : null}</div>
                <label>Evidence references<textarea value={draft.evidenceText} onChange={(event) => setDraft({ ...draft, evidenceText: event.target.value })} /></label>
                <Link href="/app/evidence">Open evidence library</Link>
              </div> : null}

              {activeTab === "work" ? <div className="soa-work-panel">
                {selectedItem.openTaskCount > 0 ? <><strong>{selectedItem.openTaskCount} linked open {selectedItem.openTaskCount === 1 ? "task" : "tasks"}</strong><p>Open work mapped to this control is available in the task queue.</p><Link href="/app/tasks?filter=open">View open tasks</Link></> : <><strong>No linked open work</strong><p>There are no open or in-progress tasks currently mapped to this control.</p><Link href="/app/tasks">Open task queue</Link></>}
              </div> : null}

              {activeTab === "history" ? <div className="soa-history-panel"><strong>Organisation audit trail</strong><p>Item-level changes are recorded in the organisation audit trail. This workspace does not invent a separate review timeline.</p><Link href="/app/activity">View audit trail</Link></div> : null}
            </div>

            <footer className="soa-detail-actions">
              <p role="status" aria-live="polite">{saveMessage}</p>
              <button type="submit" name="saveIntent" value="draft" className="button secondary" disabled={saving}>{saving ? "Saving" : "Save draft"}</button>
              <button type="submit" name="saveIntent" value="next" className="button primary" disabled={saving}>{saving ? "Saving" : "Save and next"}</button>
            </footer>
          </form>
        ) : <section className="soa-review-detail soa-review-empty"><h2>No control selected</h2><p>Choose a control from the review queue.</p></section>}
      </div>
    </section>
  );
}
