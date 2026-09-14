/** Fictional, explicitly human-reviewed follow-up. All writes use existing UI forms. */
import type { Page, Locator } from '@playwright/test';
import { fingerprintRows } from './showcase-setup';
type Row = { id: string; [key: string]: unknown };
type Snapshot = Record<string, Row[]>;
type Rule = { table: string; id?: string; expected: Record<string, unknown>; reference?: { field: string; table: string } };
export type HumanReviewJournal = {
  version: 'human-review-v1'; startedAt: string; date: string; completed: string[];
  taskCompletionObservedAt?: string; reviewedAt?: string; publishedReport?: Record<string, unknown>;
  pending?: { step: string; before: Snapshot; rules: Rule[]; startedAt: string };
};
export type HumanManifest = {
  ids: Record<string, string>; counts: Record<string, number>; fingerprints?: Record<string, string>;
  urls: Record<string, string>; humanReview?: HumanReviewJournal;
};
const sameValue = (left: unknown, right: unknown) => fingerprintRows([{ id: 'value', value: left }]) === fingerprintRows([{ id: 'value', value: right }]);
const matches = (row: Row, fields: Record<string, unknown>) => Object.entries(fields).every(([key, value]) => sameValue(row[key], value));
export function validateHumanReviewDelta(before: Snapshot, after: Snapshot, rules: Rule[], startedAt?: string): boolean {
  let changed = 0;
  for (const table of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const oldRows = before[table] ?? [], newRows = after[table] ?? [];
    const permitted = rules.filter((rule) => rule.table === table);
    if (new Set(newRows.map((row) => row.id)).size !== newRows.length) throw new Error('Human review duplicate drift');
    for (const old of oldRows) {
      const current = newRows.find((row) => row.id === old.id);
      if (!current) throw new Error('Human review deletion drift');
      if (fingerprintRows([old]) === fingerprintRows([current])) continue;
      const rule = permitted.find((entry) => entry.id === old.id);
      if (!rule || !matches(current, rule.expected)) throw new Error('Human review update drift');
      for (const key of new Set([...Object.keys(old), ...Object.keys(current)])) {
        if (key in rule.expected || key === 'updated_at') continue;
        if (JSON.stringify(current[key]) !== JSON.stringify(old[key])) throw new Error(`Human review field drift: ${key}`);
      }
      checkTimes(current); changed++;
    }
    const added = newRows.filter((row) => !oldRows.some((old) => old.id === row.id));
    const insertRules = permitted.filter((rule) => !rule.id);
    if (added.length > insertRules.length) throw new Error('Human review insertion drift');
    for (const current of added) {
      const candidates = insertRules.filter((rule) => matches(current, rule.expected));
      if (candidates.length !== 1 || added.filter((row) => matches(row, candidates[0].expected)).length !== 1) throw new Error('Human review insertion drift');
      const rule = candidates[0];
      if (rule.reference) {
        const targets = (after[rule.reference.table] ?? []).filter((row) => !(before[rule.reference!.table] ?? []).some((old) => old.id === row.id));
        if (targets.length !== 1 || current[rule.reference.field] !== targets[0].id) throw new Error('Human review relationship drift');
      }
      for (const [key, value] of Object.entries(current)) {
        if (key in rule.expected || ['id', 'created_at', 'updated_at'].includes(key) || (table === 'leadership_report_snapshots' && key === 'published_at') || key === rule.reference?.field || value === null) continue;
        throw new Error(`Human review unexpected inserted field drift: ${key}`);
      }
      checkTimes(current); changed++;
    }
  }
  if (changed && changed !== rules.length) throw new Error('Human review partial atomic action; refusing recovery');
  return changed > 0;
  function checkTimes(row: Row) {
    if (!startedAt) return;
    for (const key of ['created_at', 'updated_at', 'published_at']) {
      if (!row[key] || (key === 'created_at' && rules.some((rule) => rule.id === row.id))) continue;
      const time = Date.parse(String(row[key]));
      if (!Number.isFinite(time) || time < Date.parse(startedAt) - 5000 || time > Date.now() + 5000) throw new Error('Human review timestamp drift');
    }
  }
}

export async function recoverHumanReview(manifest: HumanManifest, rows: (table: string) => Promise<Row[]>, persist: () => Promise<void>) {
  const journal = manifest.humanReview, pending = journal?.pending;
  if (!pending) return false;
  const after: Snapshot = {};
  for (const table of Object.keys(manifest.counts)) {
    if (!pending.before[table] || fingerprintRows(pending.before[table]) !== manifest.fingerprints?.[table] || pending.before[table].length !== manifest.counts[table]) throw new Error('Human review checkpoint baseline drift');
    after[table] = await rows(table);
  }
  const committed = validateHumanReviewDelta(pending.before, after, pending.rules, pending.startedAt);
  // No delta is an uncertain outcome, not proof that the request never ran.
  // Keep its preimage so a later read can recover a late commit safely.
  if (!committed) return false;
  if (committed) {
    journal.completed.push(pending.step);
    if (pending.step === 'task_done') journal.taskCompletionObservedAt = new Date().toISOString();
    for (const [table, records] of Object.entries(after)) {
      manifest.counts[table] = records.length; manifest.fingerprints![table] = fingerprintRows(records);
    }
  }
  delete journal.pending; await persist(); return true;
}

/** Poll only reads of the pending action. A timeout never discards intent or retries a write. */
export async function waitForHumanReviewCommit(
  manifest: HumanManifest, rows: (table: string) => Promise<Row[]>, persist: () => Promise<void>,
  timeoutMs = 10_000,
) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await recoverHumanReview(manifest, rows, persist)) return;
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, deadline - Date.now())));
  } while (Date.now() <= deadline);
  throw new Error('Human review commit was not visible within the readback deadline; pending journal retained, no action retried');
}

export async function runHumanReview(options: {
  manifest: HumanManifest; page: Page; ownerId: string; organisationId: string; organisationName: string; controlId: string; verifyOnly: boolean;
  loadReport: () => Promise<Record<string, unknown>>;
  rows: (table: string, filters?: Record<string, string>) => Promise<Row[]>;
  persist: () => Promise<void>; submit: (button: Locator) => Promise<void>;
}) {
  const { manifest, page, ownerId, organisationId, controlId, verifyOnly, rows, persist, submit } = options;
  if (!manifest.humanReview) {
    if (verifyOnly) throw new Error('Human review has not been rehearsed');
    manifest.humanReview = { version: 'human-review-v1', startedAt: new Date().toISOString(), date: new Date().toISOString().slice(0, 10), completed: [] }; await persist();
  }
  const journal = manifest.humanReview;
  if (journal.version !== 'human-review-v1') throw new Error('Human review version collision');
  const go = (url: string) => page.goto(url, { waitUntil: 'domcontentloaded' });
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const common = { organisation_id: organisationId, created_by: ownerId };
  const title = 'Northstar fictional independent sign-off follow-up';
  const question = 'Has the fictional follow-up received a fresh human review?';
  const summary = 'FICTIONAL NS-AUD-002: independent sign-off needs a human review';
  const correction = 'FICTIONAL: complete the owned corrective task, record a new human review note, link it to the task, control and NS-AUD-002 checklist, then manually close this audit finding. Task completion alone is not verification. No live provider check is claimed.';
  async function step(name: string, rules: Rule[], action: () => Promise<void>) {
    if (journal.completed.includes(name)) return;
    if (journal.pending) throw new Error(`Human review pending action ${journal.pending.step} has no visible committed outcome; journal retained, refusing a blind retry`);
    if (verifyOnly) throw new Error(`Human review incomplete: ${name}`);
    const before: Snapshot = {};
    for (const table of Object.keys(manifest.counts)) {
      before[table] = await rows(table);
      if (before[table].length !== manifest.counts[table] || fingerprintRows(before[table]) !== manifest.fingerprints?.[table]) throw new Error(`Human review pre-action drift: ${table}`);
    }
    journal.pending = { step: name, before, rules, startedAt: new Date().toISOString() }; await persist();
    await action();
    // The supported Server Action response is followed by readback, including unchanged baseline rows.
    await waitForHumanReviewCommit(manifest, rows, persist);
    if (!journal.completed.includes(name)) throw new Error(`Human review action did not persist: ${name}`);
  }
  async function record(key: string, table: string, filter: Record<string, string>) {
    const found = await rows(table, filter);
    if (found.length !== 1 || (manifest.ids[key] && manifest.ids[key] !== found[0].id)) throw new Error(`Human review identity drift: ${key}`);
    manifest.ids[key] = found[0].id; await persist(); return found[0];
  }
  await step('audit', [{ table: 'audits', expected: { ...common, reference: 'NS-AUD-002', title, scope: correction, lead_auditor_id: ownerId, planned_start: journal.date, planned_end: '2026-12-31', framework: 'ISO 27001:2022', status: 'planned' } }], async () => {
    await go('/app/audits/new'); await page.getByLabel('Reference', { exact: true }).fill('NS-AUD-002'); await page.getByLabel('Title', { exact: true }).fill(title); await page.getByLabel('Lead auditor').selectOption(ownerId); await page.getByLabel('Planned start').fill(journal.date); await page.getByLabel('Planned end').fill('2026-12-31'); await page.getByLabel('Scope', { exact: true }).fill(correction); await submit(button('Plan audit'));
  });
  const audit = await record('human_audit', 'audits', { reference: 'NS-AUD-002' });
  const auditUrl = `/app/audits/${audit.id}`;
  await step('checklist', [{ table: 'audit_checklist_items', expected: { organisation_id: organisationId, audit_id: audit.id, checklist_item: question, area: '', clause_reference: '', compliant: 'not_tested', evidence_note: '', findings: '', position: 0 } }], async () => {
    await go(auditUrl); await page.getByLabel('Checklist item', { exact: true }).fill(question); await submit(button('Add item'));
  });
  const checklist = await record('human_checklist', 'audit_checklist_items', { audit_id: audit.id, checklist_item: question });
  async function review(name: string, compliant: string, note: string, findings: string) {
    await step(name, [{ table: 'audit_checklist_items', id: checklist.id, expected: { compliant, evidence_note: note, findings, reviewed_on: new Date().toISOString().slice(0, 10) } }], async () => {
      await go(auditUrl); const row = page.getByRole('row').filter({ hasText: question }); await row.getByLabel(`Result for ${question}`).selectOption(compliant); await row.getByLabel(`Evidence for ${question}`).fill(note); await row.getByLabel(`Findings for ${question}`).fill(findings); await submit(row.getByRole('button', { name: 'Save', exact: true }));
    });
  }
  await review('initial_review', 'non_compliant', 'FICTIONAL: independent human sign-off is pending.', summary);
  await step('finding_task', [
    { table: 'audit_findings', expected: { ...common, audit_id: audit.id, summary, severity: 'minor_nc', root_cause: '', corrective_action: correction, status: 'in_progress' }, reference: { field: 'task_id', table: 'tasks' } },
    { table: 'tasks', expected: { ...common, title: `Corrective action: ${summary}`, detail: correction, owner_id: ownerId, due_on: '2026-12-31', source: 'audit', status: 'open' } },
  ], async () => {
    await go(auditUrl); await page.getByLabel('Summary', { exact: true }).fill(summary); await page.locator('select[name="severity"]').selectOption('minor_nc'); await page.getByLabel('Owner (for the task)').selectOption(ownerId); await page.getByLabel('Due date', { exact: true }).fill('2026-12-31'); await page.getByLabel('Corrective action', { exact: true }).fill(correction); await page.getByLabel('Raise a corrective-action task from this finding').check(); await submit(button('Raise finding'));
  });
  const finding = await record('human_finding', 'audit_findings', { audit_id: audit.id, summary });
  const task = await record('human_task', 'tasks', { title: `Corrective action: ${summary}` });
  if (finding.task_id !== task.id || task.owner_id !== ownerId || task.due_on !== '2026-12-31' || task.source !== 'audit' || task.recurrence !== null) throw new Error('Human review task relationship drift');
  await step('task_done', [{ table: 'tasks', id: task.id, expected: { status: 'done' } }], async () => {
    if (finding.status !== 'in_progress') throw new Error('Human review finding must remain in progress before completing its task');
    await go(`/app/tasks/${task.id}`); await page.locator('select[name="status"]').selectOption('done'); await submit(button('Save'));
  });
  if (!journal.taskCompletionObservedAt) throw new Error('Missing independent task-completion observation');
  if (!journal.completed.includes('finding_closed')) {
    const current = await rows('audit_findings', { id: finding.id });
    if (current.length !== 1 || current[0].status !== 'in_progress') throw new Error('Task completion unexpectedly closed the audit finding');
  }
  if (!journal.reviewedAt) {
    if (verifyOnly) throw new Error('Missing fictional human review timestamp');
    journal.reviewedAt = new Date().toISOString(); await persist();
  }
  const collectedOn = journal.reviewedAt.slice(0, 10);
  const validUntil = new Date(`${collectedOn}T00:00:00Z`); validUntil.setUTCFullYear(validUntil.getUTCFullYear() + 1);
  const validUntilDate = validUntil.toISOString().slice(0, 10);
  const evidenceTitle = 'Northstar FICTIONAL human review — NS-AUD-002';
  const note = `FICTIONAL HUMAN REVIEW. Recorded after task completion was independently observed at ${journal.taskCompletionObservedAt}. Reviewer: Northstar Showcase Owner. Source: synthetic independent sign-off rehearsal for NS-AUD-002. Task ${task.id}; finding ${finding.id}; checklist ${checklist.id}; control ${controlId}. Fictional human review recorded at ${journal.reviewedAt}: three synthetic access entries were checked against the fictional roster, no synthetic exceptions remained, and independent sign-off was recorded. The fictional reviewer records the corrective action as satisfactory. This is a manually recorded simulation, not live provider verification, certification or audit assurance. Closure is a separate manual operator decision; the application does not enforce this human-review sequence.`;
  await step('review_evidence', [{ table: 'evidence', expected: { ...common, title: evidenceTitle, description: note, kind: 'note', owner_id: ownerId, collected_on: collectedOn, valid_until: validUntilDate, status: 'current' } }], async () => {
    await go('/app/evidence/new'); await page.getByLabel('Title', { exact: true }).fill(evidenceTitle); await page.getByLabel('Kind').selectOption('note'); await page.getByLabel('Description', { exact: true }).fill(note); await page.getByRole('combobox', { name: 'Owner', exact: true }).selectOption(ownerId); await page.getByLabel('Collected on').fill(collectedOn); await page.getByLabel('Valid until').fill(validUntilDate); await submit(button('Save evidence'));
  });
  const evidence = await record('human_evidence', 'evidence', { title: evidenceTitle });
  for (const [kind, target] of [['task', task.id], ['control', controlId], ['audit_checklist_item', checklist.id]]) {
    await step(`link_${kind}`, [{ table: 'evidence_links', expected: { ...common, evidence_id: evidence.id, [`${kind}_id`]: target } }], async () => {
      if (kind === 'audit_checklist_item') {
        await go(auditUrl); const select = page.getByLabel(`Evidence to link to ${question}`, { exact: true }); await select.selectOption(evidence.id); await submit(select.locator('..').locator('..').getByRole('button', { name: 'Link evidence', exact: true }));
      } else {
        await go('/app/evidence'); await page.locator(`#evidence-${evidence.id}`).getByText('Manage links', { exact: true }).click(); const select = page.getByLabel(`Link ${evidenceTitle} to a control`); await select.selectOption(`${kind}:${target}`); await submit(select.locator('..').getByRole('button', { name: 'Link', exact: true }));
      }
    });
    const links = await rows('evidence_links', { evidence_id: evidence.id, [`${kind}_id`]: target }); if (links.length !== 1) throw new Error('Human review evidence relationship drift');
  }
  await review('fresh_review', 'compliant', `FICTIONAL human review recorded in immutable evidence ${evidence.id}. ${note}`, 'FICTIONAL human reviewer accepts the corrective action; finding closure is a separate manual step.');
  await step('finding_closed', [{ table: 'audit_findings', id: finding.id, expected: { status: 'closed' } }], async () => {
    await go(auditUrl); const select = page.getByLabel(`Status of finding: ${summary}`, { exact: true }); await select.selectOption('closed'); await submit(select.locator('..').getByRole('button', { name: 'Save', exact: true }));
  });
  await step('audit_reporting', [{ table: 'audits', id: audit.id, expected: { status: 'reporting' } }], async () => {
    await go(auditUrl); await page.getByLabel('Audit status', { exact: true }).selectOption('reporting'); await submit(button('Update status'));
  });
  if (!manifest.ids.report_snapshot) throw new Error('Original leadership snapshot identity is missing');
  if (!journal.publishedReport) {
    if (verifyOnly) throw new Error('Human review member report has not been published');
    // Use exactly the same read-only loader and schema as the supported publish action.
    journal.publishedReport = await options.loadReport(); await persist();
  }
  const reportFields = { organisation_id: organisationId, organisation_name: options.organisationName, published_by: ownerId, payload: journal.publishedReport };
  await step('member_report', [{ table: 'leadership_report_snapshots', expected: reportFields }], async () => {
    // Refuse a changed live report before sending the publication action.
    if (!sameValue(await options.loadReport(), journal.publishedReport)) throw new Error('Human review report changed before publication');
    await go('/app/reports/readiness'); await submit(button('Publish to members'));
  });
  const snapshots = await rows('leadership_report_snapshots');
  const followupReports = snapshots.filter((row) => row.id !== manifest.ids.report_snapshot);
  if (snapshots.filter((row) => row.id === manifest.ids.report_snapshot).length !== 1 || followupReports.length !== 1 || !matches(followupReports[0], reportFields)) throw new Error('Human review member snapshot drift');
  await record('human_report_snapshot', 'leadership_report_snapshots', { id: followupReports[0].id });
  if ((await rows('audits', { id: audit.id }))[0]?.status !== 'reporting') throw new Error('Human review audit reporting status drift');
  const [finalTask, finalFinding, finalChecklist] = await Promise.all([rows('tasks', { id: task.id }), rows('audit_findings', { id: finding.id }), rows('audit_checklist_items', { id: checklist.id })]);
  if (finalTask[0]?.status !== 'done' || finalFinding[0]?.status !== 'closed' || finalChecklist[0]?.compliant !== 'compliant' || !finalChecklist[0]?.reviewed_on || String(finalChecklist[0].reviewed_on) < collectedOn) throw new Error('Human review final state drift');
  manifest.urls.human_audit = new URL(auditUrl, page.url()).href;
  manifest.urls.human_task = new URL(`/app/tasks/${task.id}`, page.url()).href;
  await persist(); return audit.id;
}
