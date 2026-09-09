import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { collectEvidence } from '@/features/integrations/application/collect-run';
import { generateAutomationBaselineAction, recollectAutomationProposalAction } from '@/app/app/automation/actions';

const actionBoundary = vi.hoisted(() => ({ context: {} as unknown, service: {} as unknown }));
vi.mock('@/lib/app-context', () => ({ requireAppContext: async () => actionBoundary.context }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: () => actionBoundary.service }));
vi.mock('@/lib/security/rate-limit', () => ({ enforceRateLimit: async () => {} }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(decodeURIComponent(url)); } }));


const connectionId = '11111111-1111-4111-8111-111111111111';
type Row = Record<string, unknown>;
// Synthetic credential only; providerResponse intercepts every network request.
function database() {
  const tables: Record<string, Row[]> = {
    evidence_sources: [{ id: 'source-1', organisation_id: 'org-1', provider: 'github', config: { owner: 'fictional', repo: 'app', asOf: '2026-08-01', automationConnectionId: connectionId }, access_token: randomUUID(), connected_by: 'owner-1', revoked_at: null }],
    evidence: [],
    connector_connections: [{ id: connectionId, organisation_id: 'org-1', owner_id: 'owner-1', retention_days: 30, provider: 'github', revoked_at: null, status: 'connected', last_collected_at: '2026-07-01T00:00:00Z', last_error_at: null }],
    source_objects: [], automation_signals: [], automation_assignments: [], automation_proposals: [], automation_proposal_sources: [],
  };
  let sequence = 0;
  let failProposals = false;
  let raceEvidence = false;
  const failures = new Set<string>();
  const failAfter = new Map<string, number>();
  let beforeHealth: (() => void) | undefined;
  const client = { from(table: string) {
    const filters: ((row: Row) => boolean)[] = [];
    let mode = 'select'; let payload: Row = {};
    const run = () => {
      if (!tables[table]) throw new Error(`Unknown table: ${table}`);
      if (mode === "update" && table === "connector_connections") beforeHealth?.();
      if (mode === "insert" && (failures.has(table) || tables[table].length >= (failAfter.get(table) ?? Infinity))) return { data: null, error: { message: "fictional storage failure" } };
      const rows = tables[table].filter(row => filters.every(matches => matches(row)));
      if (mode === 'insert') {
        if (table === 'evidence' && raceEvidence) {
          raceEvidence = false;
          tables[table].push({ id: `row-${++sequence}`, ...payload });
          return { data: null, error: { code: '23505', message: 'fictional concurrent observation' } };
        }
        if (table === 'automation_proposals' && failProposals) return { data: null, error: { message: 'fictional storage failure' } };
        const inserted = { id: `row-${++sequence}`, ...payload }; tables[table].push(inserted);
        return { data: [inserted], error: null };
      }
      if (mode === 'update') rows.forEach(row => Object.assign(row, payload));
      return { data: structuredClone(rows), error: null };
    };
    const builder = {
      select() { return builder; }, eq(key: string, value: unknown) { filters.push(row => row[key] === value); return builder; },
      is(key: string, value: unknown) { return builder.eq(key, value); }, contains(key: string, values: Row) { filters.push(row => Object.entries(values).every(([name, value]) => (row[key] as Row)?.[name] === value)); return builder; }, in(key: string, values: unknown[]) { filters.push(row => values.includes(row[key])); return builder; }, order() { return builder; }, limit() { return builder; },
      insert(values: Row) { mode = 'insert'; payload = values; return builder; }, update(values: Row) { mode = 'update'; payload = values; return builder; },
      maybeSingle() { const result = run(); return Promise.resolve({ ...result, data: result.data?.[0] ?? null }); },
      single() { return builder.maybeSingle(); }, then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return builder;
  } };
  return { client: client as never, tables, failProposals() { failProposals = true; }, raceEvidenceOnce() { raceEvidence = true; }, recover() { failProposals = false; failures.clear(); }, fail(table: string) { failures.add(table); }, failAfter(table: string, count: number) { failAfter.set(table, count); }, beforeHealth(callback: () => void) { beforeHealth = callback; } };
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function providerResponse(count = 1, status = 200) {
  vi.stubEnv('EVIDENCE_LIVE', '1');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(Array.from({ length: count }, () => ({ protected: true }))), { status })));
}
it('retains last success and exposes a provider failure on the linked connection', async () => {
  const db = database(); providerResponse(1, 503);
  await expect(collectEvidence(db.client)).resolves.toEqual({ collected: 0, refreshed: 0, failed: 1 });
  expect(db.tables.connector_connections[0]).toMatchObject({ status: 'error', last_collected_at: '2026-07-01T00:00:00Z', last_error_at: expect.any(String) });
});
it('reports failed provenance once, retains evidence and last success, then recovers on retry', async () => {
  const db = database(); providerResponse(1); db.failProposals();
  await expect(collectEvidence(db.client)).resolves.toEqual({ collected: 1, refreshed: 0, failed: 1 });
  expect(db.tables.evidence).toHaveLength(1);
  expect(db.tables.connector_connections[0]).toMatchObject({ status: 'error', last_collected_at: '2026-07-01T00:00:00Z' });
  db.recover();
  await expect(collectEvidence(db.client)).resolves.toEqual({ collected: 0, refreshed: 1, failed: 0 });
  expect(db.tables.evidence).toHaveLength(1);
  expect(db.tables.connector_connections[0]).toMatchObject({ status: 'connected', last_error_at: null });
  expect(db.tables.connector_connections[0].last_collected_at).not.toBe('2026-07-01T00:00:00Z');
});

it('preserves a later dated observation and its separate automation review chain', async () => {
  const db = database();
  providerResponse(1);
  await expect(collectEvidence(db.client)).resolves.toEqual({ collected: 1, refreshed: 0, failed: 0 });

  db.tables.evidence_sources[0].config = {
    ...(db.tables.evidence_sources[0].config as Row),
    asOf: '2026-09-01',
  };
  providerResponse(1);
  await expect(collectEvidence(db.client)).resolves.toEqual({ collected: 1, refreshed: 0, failed: 0 });

  expect(db.tables.evidence).toHaveLength(2);
  expect(db.tables.evidence.map((row) => row.collected_on)).toEqual(['2026-08-01', '2026-09-01']);
  expect(db.tables.source_objects).toHaveLength(2);
  expect(db.tables.automation_signals).toHaveLength(2);
  expect(db.tables.automation_proposals).toHaveLength(2);
  expect(db.tables.automation_proposal_sources).toHaveLength(2);

  providerResponse(1);
  await expect(collectEvidence(db.client)).resolves.toEqual({ collected: 0, refreshed: 1, failed: 0 });
  expect(db.tables.evidence).toHaveLength(2);
  expect(db.tables.source_objects).toHaveLength(2);
  expect(db.tables.automation_signals).toHaveLength(2);
  expect(db.tables.automation_proposals).toHaveLength(2);
  expect(db.tables.automation_proposal_sources).toHaveLength(2);
});

it('preserves changed facts collected on the same day and reuses their exact retry', async () => {
  const db = database();
  providerResponse(1);
  await expect(collectEvidence(db.client)).resolves.toEqual({ collected: 1, refreshed: 0, failed: 0 });

  providerResponse(2);
  await expect(collectEvidence(db.client)).resolves.toEqual({ collected: 1, refreshed: 0, failed: 0 });
  expect(db.tables.evidence).toHaveLength(2);
  expect(db.tables.evidence.map((row) => row.description)).toEqual([
    '1 protected branches reported. Repository contents and branch names were not collected.',
    '2 protected branches reported. Repository contents and branch names were not collected.',
  ]);
  expect(db.tables.source_objects).toHaveLength(2);
  expect(db.tables.automation_signals).toHaveLength(2);
  expect(db.tables.automation_proposals).toHaveLength(2);

  providerResponse(2);
  await expect(collectEvidence(db.client)).resolves.toEqual({ collected: 0, refreshed: 1, failed: 0 });
  expect(db.tables.evidence).toHaveLength(2);
  expect(db.tables.source_objects).toHaveLength(2);
  expect(db.tables.automation_signals).toHaveLength(2);
  expect(db.tables.automation_proposals).toHaveLength(2);
});

it('reuses only the exact observation that wins an evidence insertion race', async () => {
  const db = database();
  db.raceEvidenceOnce();
  providerResponse(1);

  await expect(collectEvidence(db.client)).resolves.toEqual({ collected: 0, refreshed: 1, failed: 0 });
  expect(db.tables.evidence).toHaveLength(1);
  expect(db.tables.source_objects).toHaveLength(1);
  expect(db.tables.automation_signals).toHaveLength(1);
  expect(db.tables.automation_proposals).toHaveLength(1);
});

it('counts a failed evidence write once and continues collecting another source', async () => {
  const db = database(); providerResponse(1);
  db.tables.evidence_sources.unshift({ ...db.tables.evidence_sources[0], id: 'broken', provider: 'aws', config: {} });
  await expect(collectEvidence(db.client)).resolves.toEqual({ collected: 1, refreshed: 0, failed: 1 });
  expect(db.tables.connector_connections[0].status).toBe('connected');
  db.fail('evidence'); db.tables.evidence.length = 0;
  await expect(collectEvidence(db.client)).resolves.toEqual({ collected: 0, refreshed: 0, failed: 2 });
  expect(db.tables.connector_connections[0].status).toBe('error');
});
it.each(['paused', 'revoked', 'setup'])('preserves a %s connection through collection failure and success', async (status) => {
  const db = database(); db.tables.connector_connections[0].status = status;
  providerResponse(1, 503); await collectEvidence(db.client);
  providerResponse(1); await collectEvidence(db.client);
  expect(db.tables.connector_connections[0]).toMatchObject({ status, last_collected_at: '2026-07-01T00:00:00Z', last_error_at: null });
  expect(db.tables.automation_proposals).toHaveLength(0);
});
it.each(['paused', 'revoked'])('preserves a concurrent %s change at the health write', async (status) => {
  const db = database(); providerResponse(1);
  db.beforeHealth(() => { db.tables.connector_connections[0].status = status; });
  await collectEvidence(db.client);
  expect(db.tables.connector_connections[0]).toMatchObject({ status, last_collected_at: '2026-07-01T00:00:00Z', last_error_at: null });
});
it.each([{ organisation_id: 'another-workspace' }, { provider: 'aws' }, { revoked_at: '2026-08-01T00:00:00Z' }])('ignores an invalid linked connection %j', async (patch) => {
  const db = database(); Object.assign(db.tables.connector_connections[0], patch);
  providerResponse(1, 503); await collectEvidence(db.client);
  providerResponse(1); await collectEvidence(db.client);
  expect(db.tables.connector_connections[0]).toMatchObject({ ...patch, status: 'connected', last_collected_at: '2026-07-01T00:00:00Z', last_error_at: null });
  expect(db.tables.automation_proposals).toHaveLength(0);
});

function manualContext(db: ReturnType<typeof database>) {
  actionBoundary.service = db.client;
  actionBoundary.context = { supabase: db.client, organisation: { id: 'org-1' }, user: { id: 'owner-1' }, membership: { role: 'owner' } };
}
it('manual baseline records a source failure and recovers only after required proposal persistence succeeds', async () => {
  const db = database(); manualContext(db); providerResponse(1); db.failProposals();
  await expect(generateAutomationBaselineAction()).rejects.toThrow('Baseline failed: no sources completed');
  expect(db.tables.connector_connections[0]).toMatchObject({ status: 'error', last_collected_at: '2026-07-01T00:00:00Z', last_error_at: expect.any(String) });
  db.recover();
  await expect(generateAutomationBaselineAction()).rejects.toThrow('Baseline collection completed for 1 source');
  expect(db.tables.connector_connections[0]).toMatchObject({ status: 'connected', last_error_at: null });
  expect(db.tables.connector_connections[0].last_collected_at).not.toBe('2026-07-01T00:00:00Z');
  expect(db.tables.automation_proposals).toHaveLength(1);
});

it('manual baseline and proposal recollection share dated observation identity', async () => {
  const db = database(); manualContext(db); providerResponse(1);
  await expect(generateAutomationBaselineAction()).rejects.toThrow('Baseline collection completed for 1 source');
  expect(db.tables.evidence).toHaveLength(0);
  expect(db.tables.source_objects).toHaveLength(1);

  db.tables.evidence_sources[0].config = {
    ...(db.tables.evidence_sources[0].config as Row),
    asOf: '2026-09-01',
  };
  const form = recollectionForm(db); providerResponse(1);
  await expect(recollectAutomationProposalAction(form)).resolves.toBeUndefined();
  expect(db.tables.evidence).toHaveLength(0);
  expect(db.tables.source_objects).toHaveLength(2);
  expect(db.tables.automation_signals).toHaveLength(2);

  providerResponse(1);
  await expect(recollectAutomationProposalAction(form)).resolves.toBeUndefined();
  expect(db.tables.source_objects).toHaveLength(2);
  expect(db.tables.automation_signals).toHaveLength(2);
});

function recollectionForm(db: ReturnType<typeof database>) {
  db.tables.automation_proposals.push({ id: 'review-1', organisation_id: 'org-1', assigned_to: 'owner-1', status: 'draft', automation_signals: { connection_id: connectionId } });
  const form = new FormData(); form.set('id', 'review-1'); return form;
}
it('manual recollection records safe failure health and preserves history before a complete recovery', async () => {
  const db = database(); manualContext(db); const form = recollectionForm(db); providerResponse(1, 503);
  await expect(recollectAutomationProposalAction(form)).rejects.toThrow('Collection failed; existing drafts are preserved. Review connection setup and retry.');
  expect(db.tables.connector_connections[0]).toMatchObject({ status: 'error', last_collected_at: '2026-07-01T00:00:00Z', last_error_at: expect.any(String) });
  expect(db.tables.automation_proposals[0]).toMatchObject({ id: 'review-1', status: 'draft' });
  providerResponse(1);
  await expect(recollectAutomationProposalAction(form)).resolves.toBeUndefined();
  expect(db.tables.connector_connections[0]).toMatchObject({ status: 'connected', last_error_at: null });
  expect(db.tables.connector_connections[0].last_collected_at).not.toBe('2026-07-01T00:00:00Z');
});
it.each(['paused', 'setup', 'revoked'])('manual recollection rejects an unavailable %s connection before contacting its provider', async (status) => {
  const db = database(); manualContext(db); const form = recollectionForm(db); providerResponse();
  db.tables.connector_connections[0].status = status;
  await expect(recollectAutomationProposalAction(form)).rejects.toThrow('Automation connection is not available');
  expect(fetch).not.toHaveBeenCalled();
});

it('does not mark a multi-item source successful when a later proposal fails', async () => {
  const db = database(); vi.stubEnv('EVIDENCE_LIVE', '0'); db.failAfter('automation_proposals', 1);
  await expect(collectEvidence(db.client)).resolves.toEqual({ collected: 2, refreshed: 0, failed: 1 });
  expect(db.tables.automation_proposals).toHaveLength(1);
  expect(db.tables.evidence).toHaveLength(2);
  expect(db.tables.connector_connections[0]).toMatchObject({ status: 'error', last_collected_at: '2026-07-01T00:00:00Z', last_error_at: expect.any(String) });
});

it('counts a source once when recording its failure also fails, and continues other sources', async () => {
  const db = database(); providerResponse(1);
  db.tables.evidence_sources.push({ ...db.tables.evidence_sources[0], id: 'source-2', config: { ...(db.tables.evidence_sources[0].config as Row), repo: 'second-app' } });
  let unavailableWrites = 2;
  db.beforeHealth(() => { if (unavailableWrites-- > 0) throw new Error('fictional health store outage'); });
  await expect(collectEvidence(db.client)).resolves.toEqual({ collected: 2, refreshed: 0, failed: 1 });
  expect(db.tables.evidence).toHaveLength(2);
  expect(db.tables.connector_connections[0]).toMatchObject({ status: 'connected', last_error_at: null });
});
