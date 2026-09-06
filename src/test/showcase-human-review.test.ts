import { describe, expect, it } from 'vitest';
import { validateHumanReviewDelta } from '../../scripts/showcase-human-review';

describe('human review checkpoint recovery', () => {
  const before = { tasks: [{ id: 'baseline', status: 'open' }, { id: 'followup', status: 'open', title: 'Fixed' }], evidence: [] };
  const rules = [{ table: 'tasks', id: 'followup', expected: { status: 'done' } }];
  it('accepts either no committed action or the exact intended transition', () => {
    expect(validateHumanReviewDelta(before, before, rules)).toBe(false);
    expect(validateHumanReviewDelta(before, { ...before, tasks: [before.tasks[0], { ...before.tasks[1], status: 'done' }] }, rules)).toBe(true);
  });
  it('refuses baseline changes, unrelated table inserts, deletion and extra target edits', () => {
    for (const after of [
      { ...before, tasks: [{ id: 'baseline', status: 'done' }, before.tasks[1]] },
      { ...before, evidence: [{ id: 'rogue' }] },
      { ...before, tasks: [before.tasks[1]] },
      { ...before, tasks: [before.tasks[0], { ...before.tasks[1], status: 'done', title: 'Changed' }] },
    ]) expect(() => validateHumanReviewDelta(before, after, rules)).toThrow(/drift/);
  });
  it('validates nested snapshot payloads canonically while preserving the original snapshot', () => {
    const original = { id: 'old', payload: { evidence: { total: 2 }, tasksOpen: 1 } };
    const before = { leadership_report_snapshots: [original] };
    const expected = { payload: { tasksOpen: 1, evidence: { total: 3 } }, published_by: 'owner' };
    const rules = [{ table: 'leadership_report_snapshots', expected }];
    const published = { id: 'new', published_by: 'owner', payload: { evidence: { total: 3 }, tasksOpen: 1 } };
    expect(validateHumanReviewDelta(before, { leadership_report_snapshots: [original, published] }, rules)).toBe(true);
    expect(() => validateHumanReviewDelta(before, { leadership_report_snapshots: [original, { ...published, payload: { evidence: { total: 2 }, tasksOpen: 1 } }] }, rules)).toThrow(/drift/);
    expect(() => validateHumanReviewDelta(before, { leadership_report_snapshots: [{ ...original, payload: expected.payload }, published] }, rules)).toThrow(/drift/);
  });
  it('rejects duplicate inserts and a half-committed atomic finding/task action', () => {
    const insertion = [{ table: 'evidence', expected: { title: 'FICTIONAL' } }];
    expect(validateHumanReviewDelta(before, { ...before, evidence: [{ id: 'new', title: 'FICTIONAL' }] }, insertion)).toBe(true);
    expect(() => validateHumanReviewDelta(before, { ...before, evidence: [{ id: 'new', title: 'FICTIONAL' }, { id: 'dup', title: 'FICTIONAL' }] }, insertion)).toThrow();
    expect(() => validateHumanReviewDelta(before, { ...before, evidence: [{ id: 'new', title: 'FICTIONAL' }] }, [...insertion, ...rules])).toThrow(/partial/);
  });
});

import { recoverHumanReview, waitForHumanReviewCommit, runHumanReview, type HumanManifest } from '../../scripts/showcase-human-review';
import { fingerprintRows } from '../../scripts/showcase-setup';
import type { Page } from '@playwright/test';

describe('human review journal', () => {
  it('recovers a committed action once, preserving the original baseline and checking every table', async () => {
    const before = { tasks: [{ id: 'baseline', status: 'open' }, { id: 'followup', status: 'open' }], evidence: [] };
    const after = { ...before, tasks: [before.tasks[0], { ...before.tasks[1], status: 'done' }] };
    const manifest: HumanManifest = { ids: {}, urls: {}, counts: { tasks: 2, evidence: 0 }, fingerprints: { tasks: fingerprintRows(before.tasks), evidence: fingerprintRows([]) }, humanReview: { version: 'human-review-v1', startedAt: new Date().toISOString(), date: '2026-09-06', completed: [], pending: { step: 'task_done', before, startedAt: new Date().toISOString(), rules: [{ table: 'tasks', id: 'followup', expected: { status: 'done' } }] } } };
    const read = async (table: string) => after[table as keyof typeof after];
    let writes = 0;
    await recoverHumanReview(manifest, read, async () => { writes++; });
    expect(manifest.humanReview?.completed).toEqual(['task_done']);
    expect(manifest.humanReview?.taskCompletionObservedAt).toBeTruthy();
    expect(manifest.fingerprints?.tasks).toBe(fingerprintRows(after.tasks));
    expect(after.tasks[0]).toEqual(before.tasks[0]);
    await recoverHumanReview(manifest, read, async () => { writes++; });
    expect(writes).toBe(1);
  });
  it('polls exact readback until a delayed commit becomes visible without replaying a mutation', async () => {
    const before = { tasks: [{ id: 'followup', status: 'open' }] };
    const manifest: HumanManifest = { ids: {}, urls: {}, counts: { tasks: 1 }, fingerprints: { tasks: fingerprintRows(before.tasks) }, humanReview: { version: 'human-review-v1', startedAt: new Date().toISOString(), date: '2026-09-06', completed: [], pending: { step: 'task_done', before, startedAt: new Date().toISOString(), rules: [{ table: 'tasks', id: 'followup', expected: { status: 'done' } }] } } };
    let reads = 0, writes = 0;
    await waitForHumanReviewCommit(manifest, async () => ++reads === 1 ? before.tasks : [{ id: 'followup', status: 'done' }], async () => { writes++; });
    expect(reads).toBe(2);
    expect(writes).toBe(1);
    expect(manifest.humanReview?.completed).toEqual(['task_done']);
  });
  it('bounds unchanged readback and retains the exact pending intent on timeout', async () => {
    const before = { tasks: [{ id: 'followup', status: 'open' }] };
    const manifest: HumanManifest = { ids: {}, urls: {}, counts: { tasks: 1 }, fingerprints: { tasks: fingerprintRows(before.tasks) }, humanReview: { version: 'human-review-v1', startedAt: new Date().toISOString(), date: '2026-09-06', completed: [], pending: { step: 'task_done', before, startedAt: new Date().toISOString(), rules: [{ table: 'tasks', id: 'followup', expected: { status: 'done' } }] } } };
    const pending = JSON.stringify(manifest.humanReview?.pending);
    let writes = 0;
    await expect(waitForHumanReviewCommit(manifest, async () => before.tasks, async () => { writes++; }, 5)).rejects.toThrow(/deadline/);
    expect(JSON.stringify(manifest.humanReview?.pending)).toBe(pending);
    expect(manifest.humanReview?.completed).toEqual([]);
    expect(writes).toBe(0);
  });
  it('retains an unchanged pending action until its committed outcome becomes visible', async () => {
    const before = { tasks: [{ id: 'followup', status: 'open' }] };
    const manifest: HumanManifest = { ids: {}, urls: {}, counts: { tasks: 1 }, fingerprints: { tasks: fingerprintRows(before.tasks) }, humanReview: { version: 'human-review-v1', startedAt: new Date().toISOString(), date: '2026-09-06', completed: [], pending: { step: 'task_done', before, startedAt: new Date().toISOString(), rules: [{ table: 'tasks', id: 'followup', expected: { status: 'done' } }] } } };
    let writes = 0;
    await recoverHumanReview(manifest, async () => before.tasks, async () => { writes++; });
    expect(manifest.humanReview?.pending?.step).toBe('task_done');
    expect(manifest.humanReview?.completed).toEqual([]);
    expect(writes).toBe(0);
    await recoverHumanReview(manifest, async () => [{ id: 'followup', status: 'done' }], async () => { writes++; });
    expect(manifest.humanReview?.completed).toEqual(['task_done']);
    expect(manifest.humanReview?.pending).toBeUndefined();
    expect(writes).toBe(1);
  });
  it('does not adopt drift during recovery or clear the pending journal on failure', async () => {
    const before = { tasks: [{ id: 'baseline', status: 'open' }] };
    const manifest: HumanManifest = { ids: {}, urls: {}, counts: { tasks: 1 }, fingerprints: { tasks: fingerprintRows(before.tasks) }, humanReview: { version: 'human-review-v1', startedAt: new Date().toISOString(), date: '2026-09-06', completed: [], pending: { step: 'insert', before, startedAt: new Date().toISOString(), rules: [{ table: 'tasks', expected: { title: 'FICTIONAL' } }] } } };
    let writes = 0;
    await expect(recoverHumanReview(manifest, async () => [{ id: 'baseline', status: 'done' }], async () => { writes++; })).rejects.toThrow(/drift/);
    expect(manifest.humanReview?.pending).toBeDefined();
    expect(manifest.fingerprints?.tasks).toBe(fingerprintRows(before.tasks));
    expect(writes).toBe(0);
  });
  it('verifies a completed rehearsal without repeating any UI action', async () => {
    const summary = 'FICTIONAL NS-AUD-002: independent sign-off needs a human review';
    const data: Record<string, { id: string; [key: string]: unknown }[]> = {
      audits: [{ id: 'audit', reference: 'NS-AUD-002', status: 'reporting' }],
      audit_checklist_items: [{ id: 'checklist', audit_id: 'audit', checklist_item: 'Has the fictional follow-up received a fresh human review?', compliant: 'compliant', reviewed_on: '2026-09-06' }],
      audit_findings: [{ id: 'finding', audit_id: 'audit', summary, task_id: 'task', status: 'closed' }],
      tasks: [{ id: 'task', title: `Corrective action: ${summary}`, owner_id: 'owner', due_on: '2026-12-31', source: 'audit', recurrence: null, status: 'done' }],
      evidence: [{ id: 'evidence', title: 'Northstar FICTIONAL human review — NS-AUD-002' }],
      leadership_report_snapshots: [{ id: 'original', payload: { evidence: { total: 2 } } }, { id: 'followup', organisation_id: 'org', organisation_name: 'Northstar', published_by: 'owner', payload: { evidence: { total: 3 } } }],
      evidence_links: ['task', 'control', 'audit_checklist_item'].map((kind) => ({ id: kind, evidence_id: 'evidence', [`${kind}_id`]: kind === 'audit_checklist_item' ? 'checklist' : kind })),
    };
    const manifest: HumanManifest = { ids: { report_snapshot: 'original' }, urls: {}, counts: {}, humanReview: { version: 'human-review-v1', startedAt: '2026-09-06T00:00:00Z', date: '2026-09-06', taskCompletionObservedAt: '2026-09-06T00:01:00Z', reviewedAt: '2026-09-06T00:02:00Z', publishedReport: { evidence: { total: 3 } }, completed: ['audit', 'checklist', 'initial_review', 'finding_task', 'task_done', 'review_evidence', 'link_task', 'link_control', 'link_audit_checklist_item', 'fresh_review', 'finding_closed', 'audit_reporting', 'member_report'] } };
    const result = await runHumanReview({ manifest, page: { url: () => 'http://localhost:3100/app', goto: () => { throw new Error('UI action repeated'); } } as unknown as Page, ownerId: 'owner', organisationId: 'org', organisationName: 'Northstar', loadReport: async () => { throw new Error('Completed snapshot should not be regenerated'); }, controlId: 'control', verifyOnly: true, rows: async (table, filters = {}) => data[table].filter((row) => Object.entries(filters).every(([key, value]) => row[key] === value)), persist: async () => {}, submit: async () => { throw new Error('UI submission repeated'); } });
    expect(result).toBe('audit');
    expect(manifest.ids.report_snapshot).toBe('original');
    expect(manifest.ids.human_report_snapshot).toBe('followup');
    expect(manifest.urls.human_task).toBe('http://localhost:3100/app/tasks/task');
  });
});
