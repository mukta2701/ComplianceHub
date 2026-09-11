import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { AUDIT_STATUS_LABEL, AUDIT_STATUS_TONE, CHECKLIST_RESULT_LABEL, CHECKLIST_RESULT_TONE, FINDING_SEVERITY_LABEL, FINDING_SEVERITY_TONE, FINDING_STATUS_LABEL, checklistCompletion, recentAuditorViews, summariseFindings, type AuditStatus, type ChecklistResult, type FindingSeverity, type FindingStatus } from "@/features/audits/domain/audits";
import { Card, PageIntro, Pill, Progress } from "@/components/ui";
import { Icon } from "@/components/icons";
import { one } from "@/lib/supabase/one";
import { updateAuditStatusAction, addChecklistItemAction, populateAuditChecklistAction, updateChecklistItemAction, updateFindingStatusAction, linkChecklistEvidenceAction } from "../actions";
import { mintAuditorTokenAction, revokeAuditorTokenAction } from "./share-actions";
import { AiSuggestionPanel } from "@/components/ai-suggestion-panel";
import { ProofRecord, type ProofRecordData } from "@/features/evidence/components/proof-record";
import type { EvidenceKind, EvidenceStatus } from "@/features/evidence/domain/evidence";
import { AuditFindingForm } from "./audit-finding-form";
import { EVIDENCE_PROVIDER_LABELS } from "@/features/integrations/domain/evidence-provider";
import { AuditorLinkFlash } from "./auditor-link-flash";
import styles from "../audit-workspace.module.css";

const RESULTS:ChecklistResult[] = ["not_tested","compliant","non_compliant","not_applicable"];

type EvidenceRow = { id:string;title:string;kind:string;status:string;collected_on:string|null;valid_until:string|null;source_id:string|null;evidence_sources:{provider:string}|{provider:string}[]|null };
type ChecklistEvidenceLink = { id:string;evidence_id:string;audit_checklist_item_id:string;evidence:EvidenceRow|EvidenceRow[]|null };

function displayDate(value:string|null) {
  return value ? new Intl.DateTimeFormat("en-GB", { dateStyle:"medium", timeZone:"UTC" }).format(new Date(value)) : "Not scheduled";
}

function toProofRecord(item:EvidenceRow):ProofRecordData {
  const source = one(item.evidence_sources);
  return { id:item.id,title:item.title,kind:item.kind as EvidenceKind,status:item.status as EvidenceStatus,collectedOn:item.collected_on,validUntil:item.valid_until,sourceLabel:item.source_id ? EVIDENCE_PROVIDER_LABELS[source?.provider as keyof typeof EVIDENCE_PROVIDER_LABELS] ?? "Automated source" : "Added in ComplianceHub" };
}

function AuditJourney() {
  return <nav className={styles.journey} aria-label="Proof to audit journey"><Link href="/app/evidence"><strong>1</strong>Evidence collected</Link><Link href="/app/monitoring"><strong>2</strong>Systems watched</Link><Link href="/app/audits" aria-current="page"><strong>3</strong>Controls audited</Link></nav>;
}

function Summary({ icon,label,value,detail,tone }: { icon:string;label:string;value:number|string;detail:string;tone?:string }) {
  return <Card className={styles.summaryCard}><span className={styles.summaryIcon} data-tone={tone}><Icon name={icon} /></span><span><small className={styles.summaryLabel}>{label}</small><strong className={styles.summaryValue}>{value}</strong><small className={styles.summaryDetail}>{detail}</small></span></Card>;
}

export default async function AuditDetailPage({ params,searchParams }: { params:Promise<{id:string}>;searchParams?:Promise<{proofQuery?:string;proofPage?:string}> }) {
  const { id } = await params;
  const proofSearch = await searchParams;
  const proofQuery = String(proofSearch?.proofQuery ?? "").trim().slice(0,80);
  const parsedProofPage = Number.parseInt(String(proofSearch?.proofPage ?? "1"),10);
  const proofPage = Number.isFinite(parsedProofPage) ? Math.max(1,Math.min(1000,parsedProofPage)) : 1;
  const proofPageSize = 25;

  const { supabase, organisation, membership } = await requireAppContext();
  const isMember = membership.role === "member";
  const { data:audit, error:auditError } = await supabase.from("audits").select("id,reference,title,scope,status,framework,planned_start,planned_end").eq("id", id).eq("organisation_id", organisation.id).maybeSingle();
  if (auditError) throw new Error("Could not load the audit");
  if (!audit) notFound();

  const evidenceChoices = isMember ? Promise.resolve({ rows:[] as EvidenceRow[],count:0,page:1 }) : (async () => {
    const fetchPage = async (page:number) => {
      let query = supabase.from("evidence").select("id,title,kind,status,collected_on,valid_until,source_id,evidence_sources(provider)", { count:"exact" }).eq("organisation_id", organisation.id).in("status", ["current","expiring","expired"]);
      if (proofQuery) query = query.ilike("title", `%${proofQuery}%`);
      const from = (page - 1) * proofPageSize;
      const { data,error,count } = await query.order("title", { ascending:true }).range(from,from + proofPageSize - 1);
      if (error) throw new Error("Could not load audit evidence");
      return { rows:(data ?? []) as EvidenceRow[],count:count ?? 0,page };
    };
    const requestedPage = await fetchPage(proofPage);
    const pageCount = Math.max(1,Math.ceil(requestedPage.count / proofPageSize));
    return proofPage > pageCount ? fetchPage(pageCount) : requestedPage;
  })();
  const [{ data:items,error:itemsError },{ data:findings,error:findingsError },{ data:members,error:membersError },{ data:tokens,error:tokensError },{ data:aiSettings,error:aiError },evidencePage,{ data:evidenceLinks,error:evidenceLinksError }] = await Promise.all([
    supabase.from("audit_checklist_items").select("id,area,clause_reference,checklist_item,compliant,evidence_note,findings").eq("audit_id", id).eq("organisation_id", organisation.id).order("position"),
    supabase.from("audit_findings").select("id,summary,severity,status,corrective_action,task_id,checklist_item_id").eq("audit_id", id).eq("organisation_id", organisation.id).order("created_at"),
    supabase.from("memberships").select("user_id,profiles(display_name)").eq("organisation_id", organisation.id),
    supabase.from("auditor_access_tokens").select("id,label,expires_at,revoked_at,audit_id").eq("organisation_id", organisation.id).or(`audit_id.eq.${id},audit_id.is.null`).order("created_at", { ascending:false }),
    supabase.from("ai_workspace_settings").select("enabled").eq("organisation_id", organisation.id).maybeSingle(),
    evidenceChoices,
    supabase.from("evidence_links").select("id,evidence_id,audit_checklist_item_id,evidence(id,title,kind,status,collected_on,valid_until,source_id,evidence_sources(provider)),audit_checklist_items!inner(audit_id)").eq("organisation_id", organisation.id).eq("audit_checklist_items.audit_id", id),
  ]);
  if (itemsError || findingsError || evidenceLinksError) throw new Error("Could not load audit evidence");
  if (membersError || tokensError || aiError) throw new Error("Could not load audit controls");

  const rows = items ?? [];
  const availableEvidence = evidencePage.rows;
  const evidencePageCount = Math.max(1,Math.ceil(evidencePage.count / proofPageSize));
  const effectiveProofPage = evidencePage.page;
  const linkedEvidence = (evidenceLinks ?? []) as ChecklistEvidenceLink[];
  const { data:accessRows,error:accessRowsError } = await supabase.from("auditor_access_log").select("viewed_at,auditor_access_tokens!inner(label)").eq("organisation_id", organisation.id).eq("auditor_access_tokens.audit_id", id).order("viewed_at", { ascending:false }).limit(10);
  if (accessRowsError) throw new Error("Could not load recent auditor views");
  const recentViews = recentAuditorViews(accessRows ?? []);
  const completion = checklistCompletion(rows.map((item) => ({ compliant:item.compliant as ChecklistResult })));
  const findingSummary = summariseFindings((findings ?? []).map((finding) => ({ severity:finding.severity as FindingSeverity,status:finding.status as FindingStatus })));
  const status = audit.status as AuditStatus;
  const today = new Date().toISOString().slice(0,10);
  const linkedEvidenceCount = new Set(linkedEvidence.map((item) => item.evidence_id)).size;
  const memberOptions = (members ?? []).map((member) => ({ id:member.user_id,label:one(member.profiles)?.display_name ?? member.user_id }));
  const checklistOptions = rows.map((item) => ({ id:item.id,label:`${item.clause_reference ? `${item.clause_reference} — ` : ""}${item.checklist_item}` }));
  const checklistById = new Map(rows.map((item) => [item.id,item.checklist_item]));
  const nonConformityLabel = findingSummary.openNonConformities === 1 ? "non-conformity" : "non-conformities";

  return <div className={styles.page}>
    <Link href="/app/audits" className={styles.pageBack}><span aria-hidden="true">←</span>Back to audit register</Link>
    <div className={styles.detailHero}><PageIntro eyebrow={`AUDIT ${audit.reference}`} title={audit.title} body={audit.scope || "No scope recorded yet."} />{isMember ? <p className={styles.memberStatus}>Audit status <Pill tone={AUDIT_STATUS_TONE[status]}>{AUDIT_STATUS_LABEL[status]}</Pill></p> : <form action={updateAuditStatusAction} className={styles.statusForm}><input type="hidden" name="id" value={id} /><label>Audit status<select name="status" defaultValue={status}>{(["planned","in_progress","reporting","closed"] as AuditStatus[]).map((next) => <option key={next} value={next}>{AUDIT_STATUS_LABEL[next]}</option>)}</select></label><button className="button secondary">Update status</button></form>}</div>
    <AuditJourney />
    <div className={styles.auditMeta}><span className={styles.metaPill}>Framework <strong>{audit.framework}</strong></span><span className={styles.metaPill}>Starts <strong>{displayDate(audit.planned_start)}</strong></span><span className={styles.metaPill}>Ends <strong>{displayDate(audit.planned_end)}</strong></span></div>
    <div className={styles.summaryGrid} aria-label="Audit workspace summary">
      <Card className={`${styles.summaryCard} ${styles.progressCard}`}><div className={styles.progressBody}><div className={styles.progressTop}><span>Checklist completion</span><strong>{completion.percent}%</strong></div><Progress value={completion.percent} /><small className={styles.summaryDetail}>{completion.tested} of {completion.total} items tested</small></div></Card>
      <Summary icon="alert" label="Open findings" value={findingSummary.open} detail={`${findingSummary.openNonConformities} ${nonConformityLabel}`} tone="attention" />
      <Summary icon="file" label="Linked proof" value={linkedEvidenceCount} detail="distinct evidence records" tone="success" />
    </div>
    {aiSettings?.enabled && <AiSuggestionPanel target={{ targetType:"audit",targetId:audit.id }} />}

    <div className={styles.detailGrid}>
      <section className={styles.mainColumn} aria-label="Audit checklist and evidence">
        <div className={styles.exportActions}><a className="button secondary" href={`/api/app/audits/${id}/pack?format=xlsx`}><Icon name="download" />Evidence pack (XLSX)</a><a className="button secondary" href={`/api/app/audits/${id}/pack?format=csv`}><Icon name="download" />Evidence pack (CSV)</a></div>
        <Card className={styles.checklistCard}>
          <div className={styles.sectionHeader}><div><h2>Control checklist</h2><p>Results are human audit decisions. Linked proof keeps the supporting record traceable.</p></div><span className={styles.registerCount}>{completion.tested} / {completion.total} tested</span></div>
          <div className={`${styles.checklistTable} data-table-wrap`} role="region" aria-label="Audit checklist" tabIndex={0}><table><thead><tr><th>Area / clause</th><th>Checklist item</th><th>Result</th><th>Review and proof</th></tr></thead><tbody>
            {rows.map((item) => { const links = linkedEvidence.filter((candidate) => candidate.audit_checklist_item_id === item.id); return <tr key={item.id}>
              <td className={styles.clauseCell} data-label="Area / clause"><strong>{item.area || "Unspecified"}</strong><small>{item.clause_reference || "No clause"}</small></td>
              <td className={styles.questionCell} data-label="Checklist item">{item.checklist_item}</td>
              <td data-label="Result"><Pill tone={CHECKLIST_RESULT_TONE[item.compliant as ChecklistResult]}>{CHECKLIST_RESULT_LABEL[item.compliant as ChecklistResult]}</Pill></td>
              <td className={styles.reviewCell} data-label="Review and proof">
                {isMember ? <div><p className={styles.emptyLine}><strong>Evidence note:</strong> {item.evidence_note || "None recorded"}</p>{item.findings && <p className={styles.emptyLine}><strong>Checklist observation:</strong> {item.findings}</p>}</div> : <form action={updateChecklistItemAction} className={styles.reviewForm}><input type="hidden" name="id" value={item.id} /><input type="hidden" name="auditId" value={id} /><label><span>Result</span><select name="compliant" defaultValue={item.compliant} aria-label={`Result for ${item.checklist_item}`}>{RESULTS.map((result) => <option key={result} value={result}>{CHECKLIST_RESULT_LABEL[result]}</option>)}</select></label><label><span>Evidence note</span><textarea name="evidenceNote" rows={2} defaultValue={item.evidence_note} placeholder="What supports this decision?" aria-label={`Evidence note for ${item.checklist_item}`} /></label><label><span>Checklist observation</span><textarea name="findings" rows={2} defaultValue={item.findings} placeholder="Optional observation" aria-label={`Checklist observation for ${item.checklist_item}`} /></label><button className="button secondary">Save review</button></form>}
                <div className={styles.proofList} role="group" aria-label={`Evidence linked to ${item.checklist_item}`}>{links.map((candidate) => { const proof = one(candidate.evidence); return proof ? <ProofRecord key={candidate.id} record={toProofRecord(proof)} today={today} /> : <span key={candidate.id} className={styles.emptyProof}>Linked evidence unavailable ({candidate.evidence_id})</span>; })}</div>
                {!links.length && <small className={styles.emptyProof}>No linked evidence.</small>}
              </td>
            </tr>; })}
            {!rows.length && <tr><td colSpan={4}>No checklist items yet. Add one or populate the control library below.</td></tr>}
          </tbody></table></div>
        </Card>
        {!isMember && <Card className={styles.proofPicker} id="link-audit-proof"><div className={styles.sectionHeader}><div><h2>Link proof to a checklist item</h2><p>Search the evidence vault, choose one record, then choose the exact audit question it supports.</p></div><span className={styles.registerCount}>{evidencePage.count} available</span></div><div className={styles.proofPickerBody}><form method="get" className={styles.proofSearch}><label>Search available evidence<input name="proofQuery" defaultValue={proofQuery} maxLength={80} placeholder="Search by evidence title" /></label><button className="button secondary">Search</button></form>{rows.length && availableEvidence.length ? <form action={linkChecklistEvidenceAction} className={styles.proofLinkForm}><input type="hidden" name="auditId" value={id} /><label>Checklist item<select name="checklistItemId" required defaultValue=""><option value="" disabled>Select checklist item</option>{checklistOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>Evidence record<select name="evidenceId" required defaultValue=""><option value="" disabled>Select evidence</option>{availableEvidence.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}</select></label><button className="button primary">Link evidence</button></form> : <p className={styles.emptyLine}>{rows.length ? "No evidence matches this search." : "Add a checklist item before linking proof."}</p>}{evidencePageCount > 1 && <nav className={styles.proofPagination} aria-label="Evidence search pages"><span>Page {effectiveProofPage} of {evidencePageCount}</span><span>{effectiveProofPage > 1 && <Link href={`?proofQuery=${encodeURIComponent(proofQuery)}&proofPage=${effectiveProofPage - 1}#link-audit-proof`}>Previous</Link>}{effectiveProofPage < evidencePageCount && <Link href={`?proofQuery=${encodeURIComponent(proofQuery)}&proofPage=${effectiveProofPage + 1}#link-audit-proof`}>Next</Link>}</span></nav>}</div></Card>}
        {!isMember && <details className={styles.management}><summary>Add or populate checklist items</summary><div className={styles.managementBody}>
          <section className={styles.managementSection}><h2>Populate from control library</h2><p>Adds every Annex A control that is not already listed. Running it again only fills missing controls.</p><form action={populateAuditChecklistAction}><input type="hidden" name="auditId" value={id} /><button className="button secondary"><Icon name="clipboard" />Populate from control library</button></form></section>
          <section className={styles.managementSection}><h2>Add a checklist item</h2><p>Add a specific process, clause or audit question outside the standard control library.</p><form action={addChecklistItemAction} className="app-form"><input type="hidden" name="auditId" value={id} /><div className="form-grid"><label>Area / process<input name="area" maxLength={200} placeholder="e.g. Access control" /></label><label>Clause reference<input name="clauseReference" maxLength={40} placeholder="e.g. A.8.1 or 6.1.2" /></label></div><label>Checklist item<input name="checklistItem" required maxLength={2000} placeholder="The question the auditor asks." /></label><button className="button secondary">Add item</button></form></section>
        </div></details>}
      </section>

      <aside className={styles.sideColumn}>
        <Card className={styles.panel}><h2>Findings</h2><p className={styles.panelIntro}>Formal findings stay separate from checklist notes and move through their own status.</p><ul className={styles.findingList}>{(findings ?? []).map((finding) => <li key={finding.id} className={styles.finding}><div className={styles.findingHeader}><span className={styles.findingTitle}>{finding.summary}</span><Pill tone={FINDING_SEVERITY_TONE[finding.severity as FindingSeverity]}>{FINDING_SEVERITY_LABEL[finding.severity as FindingSeverity]}</Pill></div>{finding.checklist_item_id && checklistById.has(finding.checklist_item_id) && <p className={styles.findingContext}>Checklist: {checklistById.get(finding.checklist_item_id)}</p>}{finding.corrective_action && <p>{finding.corrective_action}</p>}{finding.task_id && <Link href={`/app/tasks/${finding.task_id}`}>Open corrective-action task</Link>}{isMember ? <p>Finding status: {FINDING_STATUS_LABEL[finding.status as FindingStatus]}</p> : <form action={updateFindingStatusAction} className={styles.compactForm}><input type="hidden" name="id" value={finding.id} /><input type="hidden" name="auditId" value={id} /><select name="status" defaultValue={finding.status} aria-label={`Status of finding: ${finding.summary}`}>{(["open","in_progress","closed"] as FindingStatus[]).map((next) => <option key={next} value={next}>{FINDING_STATUS_LABEL[next]}</option>)}</select><button className="button secondary">Save finding status</button></form>}</li>)}{!findings?.length && <li className={styles.emptyLine}>No findings raised yet.</li>}</ul>{!isMember && <details className={styles.addFinding}><summary>Raise a finding</summary><AuditFindingForm auditId={id} members={memberOptions} checklistItems={checklistOptions} /></details>}</Card>

        {!isMember && <Card className={styles.panel}><h2>External auditor access</h2><p className={styles.panelIntro}>Create a time-boxed, read-only link. Copy a new link immediately; it is shown only once.</p><AuditorLinkFlash auditId={id} /><form action={mintAuditorTokenAction} className={styles.shareForm}><input type="hidden" name="auditId" value={id} /><label>Label<input name="label" defaultValue="External auditor" maxLength={160} /></label><label>Scope<select name="scope" defaultValue="audit"><option value="audit">This audit</option><option value="org">Whole readiness view</option></select></label><label>Expires in days<input name="expiresInDays" type="number" min={1} max={90} defaultValue={14} /></label><button className="button primary">Create link</button></form><ul className={styles.tokenList}>{(tokens ?? []).map((token) => { const state = token.revoked_at ? "Revoked" : new Date(token.expires_at) < new Date() ? "Expired" : "Active"; const scopeLabel = token.audit_id ? "This audit" : "Whole readiness view"; return <li key={token.id}><span>{token.label} · {scopeLabel} · <Pill tone={state === "Active" ? "green" : "neutral"}>{state}</Pill><small> expires {displayDate(token.expires_at)}</small></span>{!token.revoked_at && <form action={revokeAuditorTokenAction}><input type="hidden" name="id" value={token.id} /><input type="hidden" name="auditId" value={id} /><button className={styles.textAction}>Revoke</button></form>}</li>; })}{!tokens?.length && <li className={styles.emptyLine}>No auditor links yet.</li>}</ul><h3 className={styles.subheading}>Recent auditor views</h3><ul className={styles.viewList}>{recentViews.map((view,index) => <li key={`${view.viewedAt}-${index}`}><span>{view.label}</span><time dateTime={view.viewedAt}>{new Intl.DateTimeFormat("en-GB", { dateStyle:"medium",timeStyle:"short",timeZone:"UTC" }).format(new Date(view.viewedAt))} UTC</time></li>)}{!recentViews.length && <li className={styles.emptyLine}>No auditor views recorded yet.</li>}</ul></Card>}
      </aside>
    </div>
  </div>;
}
