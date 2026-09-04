import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertLocalTargets, reconcileRecord, acquireLock, fingerprintRows } from '../../scripts/showcase-setup';

describe('showcase safety', () => {
  it('allows only exact local origins, rejecting hosted targets and misleading URLs', () => {
    expect(() => assertLocalTargets('http://127.0.0.1:54321', 'http://localhost:3100')).not.toThrow();
    for (const api of ['https://example.supabase.co', 'http://127.0.0.1:54322', 'http://localhost:54321/path', 'http://user@localhost:54321']) {
      expect(() => assertLocalTargets(api, 'http://localhost:3100')).toThrow();
    }
    expect(() => assertLocalTargets('http://localhost:54321', 'https://localhost:3100')).toThrow();
  });
  it('reuses one matching record but refuses duplicates, changed IDs and drift', () => {
    expect(reconcileRecord([{ id: 'a', title: 'Fixed' }], 'a', { title: 'Fixed' })).toEqual({ id: 'a', title: 'Fixed' });
    expect(reconcileRecord([], undefined, {})).toBeNull();
    expect(() => reconcileRecord([], 'a', {})).toThrow(/missing/);
    expect(() => reconcileRecord([{ id: 'b' }], 'a', {})).toThrow(/ID/);
    expect(() => reconcileRecord([{ id: 'a', title: 'Changed' }], 'a', { title: 'Fixed' })).toThrow(/drift/);
    expect(() => reconcileRecord([{ id: 'a' }, { id: 'b' }], undefined, {})).toThrow(/duplicate/);
  });
  it('detects metadata drift while ignoring row and object key ordering', () => {
    const baseline = [{ id: 'a', title: 'Fixed', owner: 'owner-a' }, { id: 'b', title: 'Other' }];
    expect(fingerprintRows(baseline)).toBe(fingerprintRows([{ title: 'Other', id: 'b' }, { owner: 'owner-a', title: 'Fixed', id: 'a' }]));
    expect(fingerprintRows(baseline)).not.toBe(fingerprintRows([{ ...baseline[0], owner: 'owner-b' }, baseline[1]]));
  });
  it('refuses concurrent setup and releases its own lock', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'showcase-lock-'));
    try {
      const release = await acquireLock(dir);
      await expect(acquireLock(dir)).rejects.toThrow(/locked/);
      await release();
      const again = await acquireLock(dir); await again();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
