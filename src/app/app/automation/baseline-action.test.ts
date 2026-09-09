import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ role: 'owner', sources: [] as { id: string; provider: string; config: object; access_token: string }[], error: null as unknown, collect: vi.fn(), persist: vi.fn(), filters: [] as unknown[][] }));
vi.mock('@/lib/app-context', () => ({ requireAppContext: async () => ({ organisation: { id: 'org' }, user: { id: 'user' }, membership: { role: mocks.role } }) }));
vi.mock('@/lib/security/rate-limit', () => ({ enforceRateLimit: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: () => ({ from: () => { const q = { select: () => q, eq: (...args: unknown[]) => { mocks.filters.push(args); return q; }, is: (...args: unknown[]) => { mocks.filters.push(args); return Promise.resolve({ data: mocks.sources, error: mocks.error }); } }; return q; } }) }));
vi.mock('@/features/integrations/application/evidence-registry', () => ({ resolveEvidenceProvider: () => ({ collect: mocks.collect }) }));
vi.mock('@/features/automation/application/collector-persistence', () => ({ automationConnectionId: (config: { automationConnectionId?: string }) => config.automationConnectionId ?? null, persistCollectedAutomation: mocks.persist, recordCollectionHealth: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/security/secrets', () => ({ decryptSecret: () => '' }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(decodeURIComponent(url)); } }));
vi.mock('@/features/automation/domain/retention', () => ({ purgeContentReference: vi.fn() }));
vi.mock('@/features/ai/application/openai-compatible', () => ({ configuredAiProvider: vi.fn() }));
vi.mock('@/features/ai/application/suggestion', () => ({ generateAiSuggestion: vi.fn() }));
vi.mock('@/features/ai/domain/context', () => ({ buildAutomationProposalAiContext: vi.fn() }));
import { generateAutomationBaselineAction } from './actions';
const source = (id: string) => ({ id, provider: 'github', config: { automationConnectionId: id }, access_token: '' });
beforeEach(() => { vi.clearAllMocks(); mocks.role = 'owner'; mocks.sources = []; mocks.error = null; mocks.filters = []; mocks.collect.mockResolvedValue([{ externalRef: 'sample' }]); mocks.persist.mockResolvedValue(false); });
it('reports no configured source without collecting', async () => {
  await expect(generateAutomationBaselineAction()).rejects.toThrow('No automation sources are configured');
  expect(mocks.collect).not.toHaveBeenCalled();
  expect(mocks.filters).toEqual([['organisation_id', 'org'], ['revoked_at', null]]);
});
it('reports partial collection while retaining successful source processing', async () => {
  mocks.sources = [source('bad'), source('good')];
  mocks.collect.mockRejectedValueOnce(new Error('private provider failure'));
  await expect(generateAutomationBaselineAction()).rejects.toThrow('Baseline incomplete: 1 of 2 sources completed; 1 needs attention');
  expect(mocks.persist).toHaveBeenCalledTimes(1);
});
it('reports all failed without exposing provider errors', async () => {
  mocks.sources = [source('bad')]; mocks.collect.mockRejectedValue(new Error('private provider failure'));
  await expect(generateAutomationBaselineAction()).rejects.toThrow('Baseline failed: no sources completed');
});
it('counts repeat collection as completed without claiming new drafts', async () => {
  mocks.sources = [source('good')];
  await expect(generateAutomationBaselineAction()).rejects.toThrow('Baseline collection completed for 1 source');
});
it('denies members before any provider call', async () => {
  mocks.role = 'member'; mocks.sources = [source('good')];
  await expect(generateAutomationBaselineAction()).rejects.toThrow('Only workspace owners');
  expect(mocks.collect).not.toHaveBeenCalled();
});
it('fails explicitly on source query error', async () => {
  mocks.error = { message: 'private database detail' };
  await expect(generateAutomationBaselineAction()).rejects.toThrow('Could not load configured evidence sources');
});
