"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { StatusLabel, type StatusTone } from "@/components/status-label";
import type { EvidenceKind, EvidenceStatus } from "@/features/evidence/domain/evidence";
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
import type { TaskStatus } from "@/features/tasks/domain/tasks";

type MemberOption = { id: string; name: string };
type SaveAction = (formData: FormData) => Promise<void>;
type DetailTab = "decision" | "evidence" | "work" | "history";
type BlockerFilter = "missing_rationale" | "evidence_gaps" | "unassigned" | "undecided";
type EvidenceFreshnessFilter = "none" | "current" | "expiring" | "expired";

type LinkedEvidence = {
  id: string;
  title: string;
  status: EvidenceStatus;
  validUntil: string | null;
  kind: EvidenceKind;
};

type LinkedTask = {
  id: string;
  title: string;
  status: TaskStatus;
  dueOn: string | null;
};

type RecentAuditEvent = {
  action: string;
  occurredAt: string;
};

export type SoaReviewWorkspaceItem = SoaQueueItem & {
  linkedEvidence: LinkedEvidence[];
  linkedTasks: LinkedTask[];
  recentAuditEvents: RecentAuditEvent[];
};

type Draft = Pick<SoaQueueItem, "applicable" | "status" | "justification" | "evidenceText" | "ownerId">;
type OptimisticDraft = { draft: Draft; sourceItems: SoaReviewWorkspaceItem[] };

export type SoaReviewWorkspaceProps = {
  items: SoaReviewWorkspaceItem[];
  members: MemberOption[];
  currentUserId: string;
  saveAction: SaveAction;
};

const DOMAINS: SoaDomain[] = ["organisational", "people", "physical", "technological"];
const IMPLEMENTATION_STATUSES: SoaStatus[] = ["pending", "absent", "in_progress", "established", "operational", "advanced"];
const ALL_STATUSES: SoaStatus[] = [...IMPLEMENTATION_STATUSES, "not_applicable"];
const DETAIL_TABS: readonly { value: DetailTab; label: string }[] = [
  { value: "decision", label: "Decision" },
  { value: "evidence", label: "Evidence" },
  { value: "work", label: "Linked work" },
  { value: "history", label: "History" },
];

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

function auditActionLabel(action: string) {
  if (action === "insert") return "Created";
  if (action === "update") return "Updated";
  if (action === "delete") return "Deleted";
  return titleCase(action);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatAuditTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(value));
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

function evidenceTone(status: EvidenceStatus): StatusTone {
  if (status === "current") return "confirmed";
  if (status === "expiring") return "attention";
  if (status === "expired") return "risk";
  return "neutral";
}

function taskTone(status: TaskStatus): StatusTone {
  if (status === "done") return "confirmed";
  if (status === "open" || status === "in_progress") return "attention";
  return "neutral";
}

function evidenceHealth(item: Pick<SoaQueueItem, "evidenceTotal" | "evidenceExpiring" | "evidenceExpired">) {
  if (item.evidenceTotal === 0) return "No linked evidence";
  if (item.evidenceExpired > 0) return `${item.evidenceTotal} linked, ${item.evidenceExpired} expired`;
  if (item.evidenceExpiring > 0) return `${item.evidenceTotal} linked, ${item.evidenceExpiring} expiring`;
  return `${item.evidenceTotal} linked and current`;
}

function applyBlockerFilter<T extends SoaQueueItem>(items: T[], blocker: BlockerFilter | null): T[] {
  if (blocker === "missing_rationale") return items.filter((item) => !item.justification.trim());
  if (blocker === "evidence_gaps") {
    return items.filter((item) => item.applicable && (item.evidenceTotal === 0 || item.evidenceExpired > 0));
  }
  if (blocker === "unassigned") return items.filter((item) => !item.ownerId);
  if (blocker === "undecided") return items.filter((item) => item.status === "pending");
  return items;
}

function applyEvidenceFilter<T extends SoaQueueItem>(items: T[], freshness: EvidenceFreshnessFilter | ""): T[] {
  if (freshness === "none") return items.filter((item) => item.evidenceTotal === 0);
  if (freshness === "current") {
    return items.filter((item) => item.evidenceTotal > 0 && item.evidenceExpiring === 0 && item.evidenceExpired === 0);
  }
  if (freshness === "expiring") return items.filter((item) => item.evidenceExpired === 0 && item.evidenceExpiring > 0);
  if (freshness === "expired") return items.filter((item) => item.evidenceExpired > 0);
  return items;
}

function filterWorkspaceItems(
  source: SoaReviewWorkspaceItem[],
  filters: SoaQueueFilters,
  blocker: BlockerFilter | null,
  freshness: EvidenceFreshnessFilter | "",
) {
  const queueFiltered = filterSoaQueue(source, filters) as SoaReviewWorkspaceItem[];
  return applyEvidenceFilter(applyBlockerFilter(queueFiltered, blocker), freshness);
}

export function SoaReviewWorkspace({ items, members, currentUserId, saveAction }: SoaReviewWorkspaceProps) {
  const router = useRouter();
  const initialItems = useMemo(() => [...items].sort((left, right) => left.position - right.position), [items]);
  const [optimisticDrafts, setOptimisticDrafts] = useState<Record<string, OptimisticDraft>>({});
  const [search, setSearch] = useState("");
  const [domain, setDomain] = useState<SoaDomain | "">("");
  const [reviewState, setReviewState] = useState<SoaReviewState | "needs_attention" | "">("needs_attention");
  const [owner, setOwner] = useState("");
  const [applicability, setApplicability] = useState<"" | "true" | "false">("");
  const [statusFilter, setStatusFilter] = useState<SoaStatus | "">("");
  const [freshness, setFreshness] = useState<EvidenceFreshnessFilter | "">("");
  const [onlyMine, setOnlyMine] = useState(false);
  const [blockerFilter, setBlockerFilter] = useState<BlockerFilter | null>(null);
  const firstAttention = initialItems.find((item) => item.reviewState !== "reviewed") ?? initialItems[0] ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(firstAttention?.id ?? null);
  const [draft, setDraft] = useState<Draft | null>(firstAttention ? toDraft(firstAttention) : null);
  const [dirty, setDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>("decision");
  const [saveMessage, setSaveMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const queueItems = useMemo(() => initialItems.map((item) => {
    const optimisticEntry = optimisticDrafts[item.id];
    const optimistic = optimisticEntry && (
      optimisticEntry.sourceItems === items
      || (dirty && item.id === selectedId)
    ) ? optimisticEntry.draft : null;
    if (!optimistic) return item;
    const projected = {
      ...item,
      ...optimistic,
      ownerName: members.find((member) => member.id === optimistic.ownerId)?.name ?? null,
    };
    return { ...projected, reviewState: deriveSoaReviewState(projected) };
  }), [dirty, initialItems, items, members, optimisticDrafts, selectedId]);

  const summary = useMemo(() => summariseSoaQueue(queueItems), [queueItems]);
  const filters = useMemo<SoaQueueFilters>(() => ({
    search: search || undefined,
    domain: domain || undefined,
    reviewState: reviewState || undefined,
    ownerId: onlyMine ? currentUserId : owner === "unassigned" ? null : owner || undefined,
    applicable: applicability === "" ? undefined : applicability === "true",
    status: statusFilter || undefined,
  }), [applicability, currentUserId, domain, onlyMine, owner, reviewState, search, statusFilter]);

  const filterItems = useCallback(
    (source: SoaReviewWorkspaceItem[]) => filterWorkspaceItems(source, filters, blockerFilter, freshness),
    [blockerFilter, filters, freshness],
  );

  const matchingItems = useMemo(() => filterItems(queueItems), [filterItems, queueItems]);
  const stateSelectedItem = queueItems.find((item) => item.id === selectedId) ?? null;
  const selectedMatchesFilters = matchingItems.some((item) => item.id === selectedId);
  const retainingDirtySelection = dirty && Boolean(stateSelectedItem) && !selectedMatchesFilters;
  const visibleItems = retainingDirtySelection && stateSelectedItem
    ? [...matchingItems, stateSelectedItem].sort((left, right) => left.position - right.position)
    : matchingItems;
  const selectedItem = retainingDirtySelection
    ? stateSelectedItem
    : matchingItems.find((item) => item.id === selectedId) ?? matchingItems[0] ?? null;
  const selectedDraft = selectedItem?.id === selectedId && draft && dirty
    ? draft
    : selectedItem ? toDraft(selectedItem) : null;

  useEffect(() => {
    if (!dirty) return;

    function guardUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    function guardExitSubmission(event: Event) {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const finalising = form.matches("[data-soa-finalise-form]");
      const exiting = form.matches("[data-app-exit-form]");
      if (!finalising && !exiting) return;
      const message = finalising
        ? "Discard unsaved changes and finalise this SoA?"
        : "Discard unsaved changes and sign out?";
      if (window.confirm(message)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    function guardAnchorNavigation(event: MouseEvent) {
      if (
        event.defaultPrevented
        || event.button !== 0
        || event.metaKey
        || event.ctrlKey
        || event.shiftKey
        || event.altKey
      ) return;

      const eventTarget = event.target;
      const element = eventTarget instanceof Element
        ? eventTarget
        : eventTarget instanceof Node ? eventTarget.parentElement : null;
      const anchor = element?.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;

      const destination = new URL(anchor.href, window.location.href);
      const current = new URL(window.location.href);
      if (destination.origin !== current.origin) return;
      if (
        destination.pathname === current.pathname
        && destination.search === current.search
        && destination.hash
      ) return;
      if (window.confirm("Discard unsaved changes and leave this control?")) return;

      event.preventDefault();
      event.stopImmediatePropagation();
    }

    window.addEventListener("beforeunload", guardUnload);
    document.addEventListener("click", guardAnchorNavigation, true);
    document.addEventListener("submit", guardExitSubmission, true);
    return () => {
      window.removeEventListener("beforeunload", guardUnload);
      document.removeEventListener("click", guardAnchorNavigation, true);
      document.removeEventListener("submit", guardExitSubmission, true);
    };
  }, [dirty]);

  function resetDetailForFilter() {
    setActiveTab("decision");
    setSaveMessage("");
  }

  function reconcileSelection(
    nextFilters: SoaQueueFilters,
    nextBlocker: BlockerFilter | null,
    nextFreshness: EvidenceFreshnessFilter | "",
  ) {
    if (dirty) return;
    const nextVisible = filterWorkspaceItems(queueItems, nextFilters, nextBlocker, nextFreshness);
    const nextSelected = nextVisible.find((item) => item.id === selectedId) ?? nextVisible[0] ?? null;
    setSelectedId(nextSelected?.id ?? null);
    setDraft(nextSelected ? toDraft(nextSelected) : null);
  }

  function loadItem(item: SoaReviewWorkspaceItem) {
    setSelectedId(item.id);
    setDraft(toDraft(item));
    setDirty(false);
    setActiveTab("decision");
    setSaveMessage("");
  }

  function selectItem(item: SoaReviewWorkspaceItem) {
    if (dirty && item.id !== selectedItem?.id && !window.confirm("Discard unsaved changes for this control?")) return;
    loadItem(item);
  }

  function updateDraft(next: Draft) {
    if (!selectedItem) return;
    setSelectedId(selectedItem.id);
    setDraft(next);
    setDirty(true);
  }

  function selectSummary(next: "needs_attention" | "reviewed" | BlockerFilter) {
    if (next === "needs_attention" || next === "reviewed") {
      reconcileSelection({ ...filters, reviewState: next }, null, freshness);
      setReviewState(next);
      setBlockerFilter(null);
    } else {
      reconcileSelection({ ...filters, reviewState: undefined }, next, freshness);
      setReviewState("");
      setBlockerFilter(next);
    }
    resetDetailForFilter();
  }

  function clearFilters() {
    reconcileSelection({}, null, "");
    setSearch("");
    setDomain("");
    setReviewState("");
    setOwner("");
    setApplicability("");
    setStatusFilter("");
    setFreshness("");
    setOnlyMine(false);
    setBlockerFilter(null);
    resetDetailForFilter();
  }

  function changeSearch(value: string) {
    reconcileSelection({ ...filters, search: value || undefined }, blockerFilter, freshness);
    setSearch(value);
    resetDetailForFilter();
  }

  function changeDomain(value: SoaDomain | "") {
    reconcileSelection({ ...filters, domain: value || undefined }, blockerFilter, freshness);
    setDomain(value);
    resetDetailForFilter();
  }

  function changeReviewState(value: SoaReviewState | "needs_attention" | "") {
    reconcileSelection({ ...filters, reviewState: value || undefined }, null, freshness);
    setReviewState(value);
    setBlockerFilter(null);
    resetDetailForFilter();
  }

  function changeOwner(value: string) {
    const ownerId = value === "unassigned" ? null : value || undefined;
    reconcileSelection({ ...filters, ownerId }, blockerFilter, freshness);
    setOwner(value);
    if (value) setOnlyMine(false);
    resetDetailForFilter();
  }

  function changeApplicability(value: "" | "true" | "false") {
    reconcileSelection({ ...filters, applicable: value === "" ? undefined : value === "true" }, blockerFilter, freshness);
    setApplicability(value);
    resetDetailForFilter();
  }

  function changeStatusFilter(value: SoaStatus | "") {
    reconcileSelection({ ...filters, status: value || undefined }, blockerFilter, freshness);
    setStatusFilter(value);
    resetDetailForFilter();
  }

  function changeFreshness(value: EvidenceFreshnessFilter | "") {
    reconcileSelection(filters, blockerFilter, value);
    setFreshness(value);
    resetDetailForFilter();
  }

  function changeOnlyMine(checked: boolean) {
    reconcileSelection({ ...filters, ownerId: checked ? currentUserId : undefined }, blockerFilter, freshness);
    setOnlyMine(checked);
    if (checked) setOwner("");
    resetDetailForFilter();
  }

  function updateApplicability(applicable: boolean) {
    if (!selectedDraft) return;
    updateDraft({
      ...selectedDraft,
      applicable,
      status: applicable ? (selectedDraft.status === "not_applicable" ? "pending" : selectedDraft.status) : "not_applicable",
    });
  }

  async function save(advance: boolean) {
    if (!selectedItem || !selectedDraft || saving || !visibleItems.some((item) => item.id === selectedItem.id)) return;
    setSaving(true);
    setSaveMessage("Saving");
    const formData = new FormData();
    formData.set("itemId", selectedItem.id);
    formData.set("status", selectedDraft.status);
    formData.set("applicable", String(selectedDraft.applicable));
    formData.set("ownerId", selectedDraft.ownerId ?? "");
    formData.set("justification", selectedDraft.justification);
    formData.set("evidence", selectedDraft.evidenceText);

    try {
      await saveAction(formData);
      const updated: SoaReviewWorkspaceItem = {
        ...selectedItem,
        ...selectedDraft,
        ownerName: members.find((member) => member.id === selectedDraft.ownerId)?.name ?? null,
        reviewState: deriveSoaReviewState({ ...selectedItem, ...selectedDraft }),
      };
      const nextQueue = queueItems.map((item) => item.id === updated.id ? updated : item);
      setOptimisticDrafts((current) => ({
        ...current,
        [updated.id]: { draft: selectedDraft, sourceItems: items },
      }));
      setSelectedId(updated.id);
      setDraft(toDraft(updated));
      setDirty(false);
      setSaveMessage("Saved");
      router.refresh();

      if (advance) {
        const unresolved = filterItems(nextQueue).filter((item) => item.id !== updated.id && item.reviewState !== "reviewed");
        const next = unresolved.find((item) => item.position > updated.position) ?? unresolved[0];
        if (next) loadItem(next);
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

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, currentTab: DetailTab) {
    const currentIndex = DETAIL_TABS.findIndex((tab) => tab.value === currentTab);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % DETAIL_TABS.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + DETAIL_TABS.length) % DETAIL_TABS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = DETAIL_TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = DETAIL_TABS[nextIndex].value;
    setActiveTab(nextTab);
    const target = event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-tab="${nextTab}"]`);
    target?.focus();
  }

  const hasActiveFilters = Boolean(
    search || domain || reviewState || owner || applicability || statusFilter || freshness || onlyMine || blockerFilter,
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
        <label className="soa-filter-search">Search controls<input type="search" value={search} onChange={(event) => changeSearch(event.target.value)} /></label>
        <label>Domain<select value={domain} onChange={(event) => changeDomain(event.target.value as SoaDomain | "")}><option value="">All domains</option>{DOMAINS.map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}</select></label>
        <label>Review state<select value={reviewState} onChange={(event) => changeReviewState(event.target.value as SoaReviewState | "needs_attention" | "")}><option value="">All states</option><option value="needs_attention">Needs attention</option>{Object.entries(REVIEW_STATE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Owner<select value={owner} onChange={(event) => changeOwner(event.target.value)}><option value="">All owners</option><option value="unassigned">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
        <label>Applicability<select value={applicability} onChange={(event) => changeApplicability(event.target.value as "" | "true" | "false")}><option value="">All decisions</option><option value="true">Applicable</option><option value="false">Not applicable</option></select></label>
        <label>Implementation status filter<select value={statusFilter} onChange={(event) => changeStatusFilter(event.target.value as SoaStatus | "")}><option value="">All statuses</option>{ALL_STATUSES.map((status) => <option key={status} value={status}>{SOA_STATUS_LABEL[status]}</option>)}</select></label>
        <label>Evidence freshness<select value={freshness} onChange={(event) => changeFreshness(event.target.value as EvidenceFreshnessFilter | "")}><option value="">All evidence</option><option value="none">No evidence</option><option value="current">Current</option><option value="expiring">Expiring</option><option value="expired">Expired</option></select></label>
        <label className="soa-only-mine"><input type="checkbox" checked={onlyMine} onChange={(event) => changeOnlyMine(event.target.checked)} />Only my controls</label>
        {hasActiveFilters ? <button type="button" className="clear-filter" onClick={clearFilters}>Clear filters</button> : null}
      </div>

      <div className="soa-review-layout">
        <section className="soa-queue" aria-label="SoA review queue">
          <header><h2>Review queue</h2><span>{visibleItems.length} of {summary.total}</span></header>
          {visibleItems.length ? (
            <ol>
              {visibleItems.map((item) => (
                <li key={item.id} data-selected={item.id === selectedItem?.id}>
                  <div className="soa-queue-control"><code>{item.code}</code><strong>{item.title}</strong><small>{titleCase(item.domain)}</small></div>
                  <StatusLabel tone={reviewTone(item.reviewState)}>{REVIEW_STATE_LABEL[item.reviewState]}</StatusLabel>
                  <span className="soa-queue-owner">{item.ownerName ?? "Unassigned"}</span>
                  <span className="soa-queue-evidence">{evidenceHealth(item)}</span>
                  <button type="button" className="button secondary" aria-current={item.id === selectedItem?.id ? "true" : undefined} onClick={() => selectItem(item)}>Review <span className="sr-only">{item.code} {item.title}</span></button>
                </li>
              ))}
            </ol>
          ) : <p className="soa-queue-empty">No controls match these filters.</p>}
        </section>

        {selectedItem && selectedDraft ? (
          <form className="soa-review-detail" aria-label={`Review ${selectedItem.code}`} onSubmit={submit}>
            <header className="soa-detail-heading">
              <div><small>{titleCase(selectedItem.domain)} control</small><h2>{selectedItem.code} {selectedItem.title}</h2></div>
              <StatusLabel tone={reviewTone(selectedItem.reviewState)}>{REVIEW_STATE_LABEL[selectedItem.reviewState]}</StatusLabel>
            </header>

            {retainingDirtySelection ? <p className="soa-filtered-dirty-notice">This control is shown because it has unsaved changes and does not match the current filters.</p> : null}

            <div className="soa-decision-context">
              <div><strong>Why this matters</strong><p>{DOMAIN_WHY[selectedItem.domain]} For {selectedItem.title.toLowerCase()}, record the decision your team can support with its own working evidence.</p></div>
              <div><strong>What you decide here</strong><p>Confirm whether this control applies, how far it is implemented, who owns it, and the rationale and references supporting that decision.</p></div>
            </div>

            <div className="soa-detail-tabs" role="tablist" aria-label="Control review sections">
              {DETAIL_TABS.map((tab) => <button
                key={tab.value}
                type="button"
                role="tab"
                data-tab={tab.value}
                tabIndex={activeTab === tab.value ? 0 : -1}
                aria-selected={activeTab === tab.value}
                aria-controls={`soa-panel-${tab.value}`}
                id={`soa-tab-${tab.value}`}
                onClick={() => setActiveTab(tab.value)}
                onKeyDown={(event) => handleTabKey(event, tab.value)}
              >{tab.label}</button>)}
            </div>

            <div className="soa-detail-panel" role="tabpanel" id={`soa-panel-${activeTab}`} aria-labelledby={`soa-tab-${activeTab}`}>
              {activeTab === "decision" ? <div className="soa-decision-fields">
                <label>Applicability decision<select value={String(selectedDraft.applicable)} onChange={(event) => updateApplicability(event.target.value === "true")}><option value="true">Applicable</option><option value="false">Not applicable</option></select></label>
                <label>Implementation status<select value={selectedDraft.status} disabled={!selectedDraft.applicable} onChange={(event) => updateDraft({ ...selectedDraft, status: event.target.value as SoaStatus })}>{selectedDraft.applicable ? IMPLEMENTATION_STATUSES.map((status) => <option key={status} value={status}>{SOA_STATUS_LABEL[status]}</option>) : <option value="not_applicable">{SOA_STATUS_LABEL.not_applicable}</option>}</select></label>
                <label>Owner assignment<select value={selectedDraft.ownerId ?? ""} onChange={(event) => updateDraft({ ...selectedDraft, ownerId: event.target.value || null })}><option value="">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
                <label className="soa-rationale">Rationale<textarea required value={selectedDraft.justification} onChange={(event) => updateDraft({ ...selectedDraft, justification: event.target.value })} /></label>
              </div> : null}

              {activeTab === "evidence" ? <div className="soa-evidence-panel">
                <div className="soa-evidence-health"><strong>Evidence health</strong><p>{evidenceHealth(selectedItem)}</p>{selectedItem.evidenceExpiring > 0 ? <small>{selectedItem.evidenceExpiring} item{selectedItem.evidenceExpiring === 1 ? " is" : "s are"} nearing expiry.</small> : null}{selectedItem.evidenceExpired > 0 ? <small>{selectedItem.evidenceExpired} item{selectedItem.evidenceExpired === 1 ? " has" : "s have"} expired.</small> : null}</div>
                {selectedItem.linkedEvidence.length ? <ul className="soa-linked-records">{selectedItem.linkedEvidence.map((evidence) => <li key={evidence.id}><span><strong>{evidence.title}</strong><small>{titleCase(evidence.kind)}{evidence.validUntil ? ` - valid until ${formatDate(evidence.validUntil)}` : " - no expiry date"}</small></span><StatusLabel tone={evidenceTone(evidence.status)}>{titleCase(evidence.status)}</StatusLabel></li>)}</ul> : <p className="soa-record-empty"><strong>No linked evidence</strong><span>No evidence records are currently mapped to this control.</span></p>}
                <label>Evidence references<textarea value={selectedDraft.evidenceText} onChange={(event) => updateDraft({ ...selectedDraft, evidenceText: event.target.value })} /></label>
                <Link href="/app/evidence">Open evidence library</Link>
              </div> : null}

              {activeTab === "work" ? <div className="soa-work-panel">
                {selectedItem.linkedTasks.length ? <ul className="soa-linked-records">{selectedItem.linkedTasks.map((task) => <li key={task.id}><span><Link href={`/app/tasks/${task.id}`}>{task.title}</Link><small>{task.dueOn ? `Due ${formatDate(task.dueOn)}` : "No due date"}</small></span><StatusLabel tone={taskTone(task.status)}>{titleCase(task.status)}</StatusLabel></li>)}</ul> : <p className="soa-record-empty"><strong>No linked open work</strong><span>There are no open or in-progress tasks currently mapped to this control.</span></p>}
                <Link href="/app/tasks">Open task queue</Link>
              </div> : null}

              {activeTab === "history" ? <div className="soa-history-panel">
                {selectedItem.recentAuditEvents.length ? <ul className="soa-history-list">{selectedItem.recentAuditEvents.map((event, index) => <li key={`${event.occurredAt}-${index}`}><strong>{auditActionLabel(event.action)}</strong><time dateTime={event.occurredAt}>{formatAuditTime(event.occurredAt)}</time></li>)}</ul> : <p className="soa-record-empty"><strong>No recent item history</strong><span>No item-level audit events are available for this control yet.</span></p>}
                <Link href="/app/activity">View audit trail</Link>
              </div> : null}
            </div>

            <footer className="soa-detail-actions">
              <p role="status" aria-live="polite">{saveMessage}</p>
              <button type="submit" name="saveIntent" value="draft" className="button secondary" disabled={saving}>{saving ? "Saving" : "Save draft"}</button>
              <button type="submit" name="saveIntent" value="next" className="button primary" disabled={saving}>{saving ? "Saving" : "Save and next"}</button>
            </footer>
          </form>
        ) : <section className="soa-review-detail soa-review-empty"><h2>No control selected</h2><p>Adjust the filters or choose a control from the review queue.</p></section>}
      </div>
    </section>
  );
}
