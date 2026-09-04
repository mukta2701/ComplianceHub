import "server-only";
import { z } from "zod";
import {
  JIRA_WEBHOOK_EVENTS,
  buildJiraWebhookJql,
  type JiraOAuthGateway,
} from "./jira-oauth";
import { generateJiraWebhookToken, hashJiraWebhookToken } from "./webhook-security";

export type JiraWebhookConfiguration = {
  organisationId: string;
  connectionId: string;
  cloudId: string;
  generation: number;
  webhookId: string | null;
  webhookExpiresAt: string | null;
  callbackHash: string | null;
};

export type VerifiedJiraProject = {
  externalId: string;
  displayName: string;
  baseUrl: string;
  cloudId: string;
  projectKey: string;
};

type WebhookSwap = {
  connectionId: string;
  expectedGeneration: number;
  expectedWebhookId: string | null;
  newWebhookId: string;
  newWebhookExpiresAt: string;
  newCallbackHash: string;
  candidateCleanupId: string;
  candidateOwnershipToken: string;
};

export type JiraWebhookCleanupJob = {
  cleanupId: string;
  organisationId: string;
  connectionId: string;
  cloudId: string;
  webhookId: string | null;
  callbackHash: string | null;
  callbackOrigin: string | null;
  lockToken: string;
  attemptCount: number;
  absentObservations: number;
};

export type JiraWebhookLifecycleStore = {
  commitConfiguration(input: WebhookSwap & {
    organisationId: string;
    userId: string;
    verifiedProjects: VerifiedJiraProject[];
  }): Promise<boolean>;
  replaceMetadata(input: WebhookSwap): Promise<boolean>;
  refreshExpiry(input: {
    connectionId: string;
    expectedGeneration: number;
    expectedWebhookId: string;
    newWebhookExpiresAt: string;
  }): Promise<boolean>;
  listDue(limit: number): Promise<JiraWebhookConfiguration[]>;
  readProjectKeys(connectionId: string, expectedGeneration: number): Promise<string[]>;
  disconnect(input: {
    organisationId: string;
    userId: string;
    connectionId: string;
  }): Promise<{ webhookId: string | null }>;
  prepareCandidate(input: {
    organisationId: string;
    connectionId: string;
    cloudId: string;
    callbackHash: string;
    callbackOrigin: string;
    providerExpiresAt: string;
  }): Promise<{ cleanupId: string; ownershipToken: string }>;
  recordCandidate(cleanupId: string, ownershipToken: string, webhookId: string): Promise<boolean>;
  readCandidateState(cleanupId: string, ownershipToken: string): Promise<"prepared" | "promoted" | "completed" | null>;
  acknowledgeCleanup(input: {
    organisationId: string;
    cloudId: string;
    webhookId: string;
  }): Promise<boolean>;
  claimCleanup(workerId: string): Promise<JiraWebhookCleanupJob | null>;
  completeCleanup(cleanupId: string, lockToken: string): Promise<boolean>;
  failCleanup(cleanupId: string, lockToken: string): Promise<boolean>;
  observeCleanupAbsent(cleanupId: string, lockToken: string): Promise<boolean>;
};

export type JiraWebhookLifecycleDatabase = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

const uuidSchema = z.uuid();
const cloudIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const webhookIdSchema = z.string().regex(/^[1-9][0-9]{0,15}$/);
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const generationSchema = z.number().int().min(0).max(2_147_483_646);
const configurationRowSchema = z.object({
  organisation_id: uuidSchema,
  connection_id: uuidSchema,
  cloud_id: cloudIdSchema,
  webhook_generation: generationSchema,
  webhook_id: webhookIdSchema.nullable(),
  webhook_expires_at: z.string().datetime({ offset: true }).nullable(),
  callback_hash: hashSchema.nullable(),
}).strict();
const projectKeysSchema = z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/)).min(1).max(100);
const cleanupRowSchema = z.object({
  cleanup_id: uuidSchema,
  organisation_id: uuidSchema,
  connection_id: uuidSchema,
  cloud_id: cloudIdSchema,
  webhook_id: webhookIdSchema.nullable(),
  callback_hash: hashSchema.nullable(),
  callback_origin: z.string().url().nullable(),
  lock_token: uuidSchema,
  attempt_count: z.number().int().min(1).max(20),
  absent_observations: z.number().int().min(0).max(2),
}).strict();
const workerSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/);

function parseConfiguration(value: unknown): JiraWebhookConfiguration {
  const parsed = configurationRowSchema.parse(value);
  return {
    organisationId: parsed.organisation_id,
    connectionId: parsed.connection_id,
    cloudId: parsed.cloud_id,
    generation: parsed.webhook_generation,
    webhookId: parsed.webhook_id,
    webhookExpiresAt: parsed.webhook_expires_at,
    callbackHash: parsed.callback_hash,
  };
}

export function createSupabaseJiraWebhookLifecycleStore(
  database: JiraWebhookLifecycleDatabase,
): JiraWebhookLifecycleStore {
  async function booleanRpc(name: string, args: Record<string, unknown>): Promise<boolean> {
    const { data, error } = await database.rpc(name, args);
    if (error || typeof data !== "boolean") throw new Error("Jira webhook persistence failed");
    return data;
  }
  return {
    commitConfiguration: (input) => booleanRpc("commit_jira_webhook_configuration", {
      target_organisation_id: input.organisationId,
      target_user_id: input.userId,
      target_connection_id: input.connectionId,
      expected_generation: input.expectedGeneration,
      expected_webhook_id: input.expectedWebhookId,
      candidate_cleanup_id: input.candidateCleanupId,
      candidate_ownership_token: input.candidateOwnershipToken,
      verified_projects: input.verifiedProjects,
      new_webhook_id: input.newWebhookId,
      new_webhook_expires_at: input.newWebhookExpiresAt,
      new_callback_hash: input.newCallbackHash,
    }),
    replaceMetadata: (input) => booleanRpc("replace_jira_webhook_metadata", {
      target_connection_id: input.connectionId,
      expected_generation: input.expectedGeneration,
      expected_webhook_id: input.expectedWebhookId,
      candidate_cleanup_id: input.candidateCleanupId,
      candidate_ownership_token: input.candidateOwnershipToken,
      new_webhook_id: input.newWebhookId,
      new_webhook_expires_at: input.newWebhookExpiresAt,
      new_callback_hash: input.newCallbackHash,
    }),
    refreshExpiry: (input) => booleanRpc("refresh_jira_webhook_expiry", {
      target_connection_id: input.connectionId,
      expected_generation: input.expectedGeneration,
      expected_webhook_id: input.expectedWebhookId,
      new_webhook_expires_at: input.newWebhookExpiresAt,
    }),
    async listDue(limit) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw new Error("Jira webhook reconciliation is invalid");
      const { data, error } = await database.rpc("list_due_jira_webhook_configurations", { result_limit: limit });
      if (error || !Array.isArray(data) || data.length > limit) throw new Error("Jira webhook reconciliation failed");
      return data.map(parseConfiguration);
    },
    async readProjectKeys(connectionId, expectedGeneration) {
      if (!uuidSchema.safeParse(connectionId).success || !generationSchema.safeParse(expectedGeneration).success) {
        throw new Error("Jira webhook reconciliation is invalid");
      }
      const { data, error } = await database.rpc("read_jira_webhook_project_keys", {
        target_connection_id: connectionId,
        expected_generation: expectedGeneration,
      });
      const parsed = projectKeysSchema.safeParse(data);
      if (error || !parsed.success || new Set(parsed.data).size !== parsed.data.length) {
        throw new Error("Jira webhook project selection could not be read");
      }
      return [...parsed.data].sort();
    },
    async disconnect(input) {
      const { data, error } = await database.rpc("disconnect_jira_oauth", {
        target_organisation_id: input.organisationId,
        target_user_id: input.userId,
        target_connection_id: input.connectionId,
      });
      if (error || (data !== null && !webhookIdSchema.safeParse(data).success)) {
        throw new Error("Jira disconnect failed");
      }
      return { webhookId: data as string | null };
    },
    async prepareCandidate(input) {
      const { data, error } = await database.rpc("prepare_jira_webhook_candidate", {
        target_organisation_id: input.organisationId,
        target_connection_id: input.connectionId,
        target_cloud_id: input.cloudId,
        target_callback_hash: input.callbackHash,
        target_callback_origin: input.callbackOrigin,
        target_provider_expires_at: input.providerExpiresAt,
      });
      const row = z.array(z.object({ cleanup_id: uuidSchema, ownership_token: uuidSchema }).strict()).length(1).safeParse(data);
      if (error || !row.success) throw new Error("Jira webhook cleanup could not be prepared");
      return { cleanupId: row.data[0].cleanup_id, ownershipToken: row.data[0].ownership_token };
    },
    recordCandidate: (cleanupId, ownershipToken, webhookId) => booleanRpc("record_jira_webhook_candidate", {
      target_cleanup_id: cleanupId,
      candidate_ownership_token: ownershipToken,
      target_webhook_id: webhookId,
    }),
    async readCandidateState(cleanupId, ownershipToken) {
      const { data, error } = await database.rpc("read_jira_webhook_candidate_state", {
        target_cleanup_id: cleanupId,
        candidate_ownership_token: ownershipToken,
      });
      const parsed = z.enum(["prepared", "promoted", "completed"]).nullable().safeParse(data);
      if (error || !parsed.success) throw new Error("Jira webhook candidate state could not be read");
      return parsed.data;
    },
    acknowledgeCleanup: (input) => booleanRpc("acknowledge_jira_webhook_cleanup", {
      target_organisation_id: input.organisationId,
      target_cloud_id: input.cloudId,
      target_webhook_id: input.webhookId,
    }),
    async claimCleanup(workerId) {
      if (!workerSchema.safeParse(workerId).success) throw new Error("Jira webhook cleanup worker is invalid");
      const { data, error } = await database.rpc("claim_jira_webhook_cleanup", { worker_id: workerId });
      if (error || !Array.isArray(data) || data.length > 1) throw new Error("Jira webhook cleanup claim failed");
      if (data.length === 0) return null;
      const row = cleanupRowSchema.parse(data[0]);
      return {
        cleanupId: row.cleanup_id,
        organisationId: row.organisation_id,
        connectionId: row.connection_id,
        cloudId: row.cloud_id,
        webhookId: row.webhook_id,
        callbackHash: row.callback_hash,
        callbackOrigin: row.callback_origin,
        lockToken: row.lock_token,
        attemptCount: row.attempt_count,
        absentObservations: row.absent_observations,
      };
    },
    completeCleanup: (cleanupId, lockToken) => booleanRpc("complete_jira_webhook_cleanup", {
      target_cleanup_id: cleanupId,
      claimed_lock_token: lockToken,
    }),
    failCleanup: (cleanupId, lockToken) => booleanRpc("fail_jira_webhook_cleanup", {
      target_cleanup_id: cleanupId,
      claimed_lock_token: lockToken,
    }),
    observeCleanupAbsent: (cleanupId, lockToken) => booleanRpc("observe_jira_webhook_cleanup_absent", {
      target_cleanup_id: cleanupId,
      claimed_lock_token: lockToken,
    }),
  };
}

function requireCallbackBaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("Jira webhook configuration is invalid"); }
  const localHttp = url.protocol === "http:" && url.hostname === "localhost" && process.env.NODE_ENV !== "production";
  if (
    (url.protocol !== "https:" && !localHttp)
    || url.username !== ""
    || url.password !== ""
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== ""
  ) throw new Error("Jira webhook configuration is invalid");
  return url.origin;
}

function registrationExpiry(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new Error("Jira webhook configuration is invalid");
  return new Date(now.getTime() + 29 * 24 * 60 * 60 * 1_000).toISOString();
}

function sortedProjectKeys(values: string[]): string[] {
  buildJiraWebhookJql(values);
  return [...values].sort();
}

function requireIncrementableGeneration(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 2_147_483_645) {
    throw new Error("Jira webhook generation is exhausted");
  }
}

async function bestEffortDelete(
  gateway: JiraOAuthGateway,
  accessToken: string,
  cloudId: string,
  webhookId: string,
): Promise<boolean> {
  try {
    await gateway.deleteDynamicWebhook({ accessToken, cloudId, webhookId });
    return true;
  } catch {
    return false;
  }
}

async function acknowledgeDeletedWebhook(input: {
  gateway: JiraOAuthGateway;
  store: JiraWebhookLifecycleStore;
  accessToken: string;
  organisationId: string;
  cloudId: string;
  webhookId: string;
}): Promise<boolean> {
  const deleted = await bestEffortDelete(input.gateway, input.accessToken, input.cloudId, input.webhookId);
  if (!deleted) return false;
  try {
    await input.store.acknowledgeCleanup({
      organisationId: input.organisationId,
      cloudId: input.cloudId,
      webhookId: input.webhookId,
    });
  } catch {
    // The durable cleanup row remains. A later 404 is a successful retry.
  }
  return true;
}

async function cleanupUncommittedCandidate(input: {
  gateway: JiraOAuthGateway;
  store: JiraWebhookLifecycleStore;
  accessToken: string;
  organisationId: string;
  cloudId: string;
  webhookId: string;
}): Promise<void> {
  if (await bestEffortDelete(input.gateway, input.accessToken, input.cloudId, input.webhookId)) {
    try {
      await input.store.acknowledgeCleanup({
      organisationId: input.organisationId,
      cloudId: input.cloudId,
      webhookId: input.webhookId,
      });
    } catch { /* the prepared intent remains safe for the cleanup worker */ }
  }
}

async function registerCandidate(input: {
  gateway: JiraOAuthGateway;
  store: JiraWebhookLifecycleStore;
  accessToken: string;
  organisationId: string;
  connectionId: string;
  cloudId: string;
  projectKeys: string[];
  callbackBaseUrl: string;
  now: () => Date;
  knownWebhooks?: Awaited<ReturnType<JiraOAuthGateway["listDynamicWebhooks"]>>;
}) {
  const existing = input.knownWebhooks ?? await input.gateway.listDynamicWebhooks({
    accessToken: input.accessToken,
    cloudId: input.cloudId,
  });
  if (existing.length >= 5) throw new Error("Jira webhook quota is full");
  const token = generateJiraWebhookToken();
  const callbackHash = hashJiraWebhookToken(token);
  const callbackOrigin = requireCallbackBaseUrl(input.callbackBaseUrl);
  const callbackUrl = `${callbackOrigin}/api/webhooks/jira/${token}`;
  const expiresAt = registrationExpiry(input.now());
  const prepared = await input.store.prepareCandidate({
    organisationId: input.organisationId,
    connectionId: input.connectionId,
    cloudId: input.cloudId,
    callbackHash,
    callbackOrigin,
    providerExpiresAt: expiresAt,
  });
  const registered = await input.gateway.registerDynamicWebhook({
    accessToken: input.accessToken,
    cloudId: input.cloudId,
    callbackUrl,
    projectKeys: sortedProjectKeys(input.projectKeys),
  });
  const webhookId = webhookIdSchema.parse(registered.id);
  if (!await input.store.recordCandidate(prepared.cleanupId, prepared.ownershipToken, webhookId)) {
    throw new Error("Jira webhook cleanup intent could not be recorded");
  }
  return {
    webhookId,
    callbackHash,
    expiresAt,
    cleanupId: prepared.cleanupId,
    ownershipToken: prepared.ownershipToken,
  };
}

async function candidateCommitOutcome(
  store: JiraWebhookLifecycleStore,
  cleanupId: string,
  ownershipToken: string,
): Promise<"promoted" | "not_promoted" | "unknown"> {
  try {
    return await store.readCandidateState(cleanupId, ownershipToken) === "promoted"
      ? "promoted"
      : "not_promoted";
  } catch {
    // The commit response and its readback are both ambiguous. The prepared
    // cleanup intent is the only safe authority: deleting here could remove a
    // candidate that was atomically promoted and is already active.
    return "unknown";
  }
}

export async function configureJiraWebhookProjects(input: {
  gateway: JiraOAuthGateway;
  store: JiraWebhookLifecycleStore;
  accessToken: string;
  configuration: JiraWebhookConfiguration;
  organisationId: string;
  userId: string;
  callbackBaseUrl: string;
  verifiedProjects: VerifiedJiraProject[];
  now?: () => Date;
}): Promise<{ webhookId: string; generation: number }> {
  requireIncrementableGeneration(input.configuration.generation);
  const projectKeys = input.verifiedProjects.map((project) => project.projectKey);
  let candidate: Awaited<ReturnType<typeof registerCandidate>>;
  try {
    candidate = await registerCandidate({
      gateway: input.gateway,
      store: input.store,
      accessToken: input.accessToken,
      organisationId: input.organisationId,
      connectionId: input.configuration.connectionId,
      cloudId: input.configuration.cloudId,
      projectKeys,
      callbackBaseUrl: input.callbackBaseUrl,
      now: input.now ?? (() => new Date()),
    });
  } catch {
    throw new Error("Jira webhook could not be registered");
  }
  let committed = false;
  try {
    committed = await input.store.commitConfiguration({
      organisationId: input.organisationId,
      userId: input.userId,
      connectionId: input.configuration.connectionId,
      expectedGeneration: input.configuration.generation,
      expectedWebhookId: input.configuration.webhookId,
      candidateCleanupId: candidate.cleanupId,
      candidateOwnershipToken: candidate.ownershipToken,
      newWebhookId: candidate.webhookId,
      newWebhookExpiresAt: candidate.expiresAt,
      newCallbackHash: candidate.callbackHash,
      verifiedProjects: input.verifiedProjects,
    });
  } catch {
    const outcome = await candidateCommitOutcome(
      input.store, candidate.cleanupId, candidate.ownershipToken,
    );
    committed = outcome === "promoted";
    if (outcome === "not_promoted") {
      await cleanupUncommittedCandidate({
        gateway: input.gateway, store: input.store, accessToken: input.accessToken,
        organisationId: input.organisationId, cloudId: input.configuration.cloudId,
        webhookId: candidate.webhookId,
      });
      throw new Error("Jira projects could not be saved");
    }
    if (outcome === "unknown") throw new Error("Jira projects could not be saved");
  }
  if (!committed) {
    await cleanupUncommittedCandidate({
      gateway: input.gateway, store: input.store, accessToken: input.accessToken,
      organisationId: input.organisationId, cloudId: input.configuration.cloudId,
      webhookId: candidate.webhookId,
    });
    throw new Error("Jira projects could not be saved");
  }
  if (input.configuration.webhookId && input.configuration.webhookId !== candidate.webhookId) {
    await acknowledgeDeletedWebhook({
      gateway: input.gateway, store: input.store, accessToken: input.accessToken,
      organisationId: input.organisationId, cloudId: input.configuration.cloudId,
      webhookId: input.configuration.webhookId,
    });
  }
  return { webhookId: candidate.webhookId, generation: input.configuration.generation + 1 };
}

function callbackMatches(webhookUrl: string, callbackBaseUrl: string, expectedHash: string): boolean {
  try {
    const url = new URL(webhookUrl);
    const origin = requireCallbackBaseUrl(callbackBaseUrl);
    const match = /^\/api\/webhooks\/jira\/([A-Za-z0-9_-]{43})$/.exec(url.pathname);
    return url.origin === origin
      && url.username === ""
      && url.password === ""
      && url.search === ""
      && url.hash === ""
      && Boolean(match)
      && hashJiraWebhookToken(match![1]) === expectedHash;
  } catch {
    return false;
  }
}

function eventsMatch(events: string[]): boolean {
  return events.length === JIRA_WEBHOOK_EVENTS.length
    && JIRA_WEBHOOK_EVENTS.every((event) => events.includes(event));
}

function providerWebhookMatches(input: {
  webhook: { jqlFilter: string; events: string[]; url: string };
  desiredJql: string;
  callbackBaseUrl: string;
  callbackHash: string;
}): boolean {
  return input.webhook.jqlFilter === input.desiredJql
    && eventsMatch(input.webhook.events)
    && callbackMatches(input.webhook.url, input.callbackBaseUrl, input.callbackHash);
}

export type EnsureJiraWebhookInput = {
  gateway: JiraOAuthGateway;
  store: JiraWebhookLifecycleStore;
  accessToken: string;
  configuration: JiraWebhookConfiguration;
  projectKeys: string[];
  callbackBaseUrl: string;
  now?: () => Date;
};

export async function ensureJiraWebhook(
  input: EnsureJiraWebhookInput,
): Promise<{ status: "refreshed" | "replaced"; generation: number }> {
  const projectKeys = sortedProjectKeys(input.projectKeys);
  const desiredJql = buildJiraWebhookJql(projectKeys);
  const providerWebhooks = await input.gateway.listDynamicWebhooks({
    accessToken: input.accessToken,
    cloudId: input.configuration.cloudId,
  });
  let replacementInventory = providerWebhooks;
  const current = input.configuration.webhookId
    ? providerWebhooks.find((webhook) => webhook.id === input.configuration.webhookId)
    : undefined;
  if (
    current
    && input.configuration.callbackHash
    && providerWebhookMatches({
      webhook: current, desiredJql, callbackBaseUrl: input.callbackBaseUrl,
      callbackHash: input.configuration.callbackHash,
    })
  ) {
    await input.gateway.refreshDynamicWebhook({
      accessToken: input.accessToken,
      cloudId: input.configuration.cloudId,
      webhookId: current.id,
    });
    const verifiedWebhooks = await input.gateway.listDynamicWebhooks({
      accessToken: input.accessToken,
      cloudId: input.configuration.cloudId,
    });
    replacementInventory = verifiedWebhooks;
    const verified = verifiedWebhooks.find((webhook) => webhook.id === current.id);
    if (
      verified
      && providerWebhookMatches({
        webhook: verified, desiredJql, callbackBaseUrl: input.callbackBaseUrl,
        callbackHash: input.configuration.callbackHash,
      })
    ) {
      const committed = await input.store.refreshExpiry({
        connectionId: input.configuration.connectionId,
        expectedGeneration: input.configuration.generation,
        expectedWebhookId: current.id,
        newWebhookExpiresAt: verified.expiresAt,
      });
      if (!committed) throw new Error("Jira webhook changed during reconciliation");
      return { status: "refreshed", generation: input.configuration.generation };
    }
  }

  requireIncrementableGeneration(input.configuration.generation);

  let candidate: Awaited<ReturnType<typeof registerCandidate>>;
  try {
    candidate = await registerCandidate({
      gateway: input.gateway,
      store: input.store,
      accessToken: input.accessToken,
      organisationId: input.configuration.organisationId,
      connectionId: input.configuration.connectionId,
      cloudId: input.configuration.cloudId,
      projectKeys,
      callbackBaseUrl: input.callbackBaseUrl,
      now: input.now ?? (() => new Date()),
      knownWebhooks: replacementInventory,
    });
  } catch {
    throw new Error("Jira webhook could not be replaced");
  }
  let committed = false;
  try {
    committed = await input.store.replaceMetadata({
      connectionId: input.configuration.connectionId,
      expectedGeneration: input.configuration.generation,
      expectedWebhookId: input.configuration.webhookId,
      candidateCleanupId: candidate.cleanupId,
      candidateOwnershipToken: candidate.ownershipToken,
      newWebhookId: candidate.webhookId,
      newWebhookExpiresAt: candidate.expiresAt,
      newCallbackHash: candidate.callbackHash,
    });
  } catch {
    const outcome = await candidateCommitOutcome(
      input.store, candidate.cleanupId, candidate.ownershipToken,
    );
    committed = outcome === "promoted";
    if (outcome === "not_promoted") {
      await cleanupUncommittedCandidate({
        gateway: input.gateway, store: input.store, accessToken: input.accessToken,
        organisationId: input.configuration.organisationId, cloudId: input.configuration.cloudId,
        webhookId: candidate.webhookId,
      });
      throw new Error("Jira webhook could not be replaced");
    }
    if (outcome === "unknown") throw new Error("Jira webhook could not be replaced");
  }
  if (!committed) {
    await cleanupUncommittedCandidate({
      gateway: input.gateway, store: input.store, accessToken: input.accessToken,
      organisationId: input.configuration.organisationId, cloudId: input.configuration.cloudId,
      webhookId: candidate.webhookId,
    });
    throw new Error("Jira webhook changed during reconciliation");
  }
  if (input.configuration.webhookId && input.configuration.webhookId !== candidate.webhookId) {
    await acknowledgeDeletedWebhook({
      gateway: input.gateway, store: input.store, accessToken: input.accessToken,
      organisationId: input.configuration.organisationId, cloudId: input.configuration.cloudId,
      webhookId: input.configuration.webhookId,
    });
  }
  return { status: "replaced", generation: input.configuration.generation + 1 };
}

export async function reconcileDueJiraWebhooks(input: {
  store: JiraWebhookLifecycleStore;
  gateway: JiraOAuthGateway;
  getAccessToken: (connectionId: string) => Promise<string>;
  callbackBaseUrl: string;
  limit?: number;
  ensure?: (input: EnsureJiraWebhookInput) => Promise<{ status: "refreshed" | "replaced"; generation: number }>;
}): Promise<{ checked: number; refreshed: number; replaced: number; failed: number }> {
  const limit = input.limit ?? 20;
  const configurations = await input.store.listDue(limit);
  const summary = { checked: configurations.length, refreshed: 0, replaced: 0, failed: 0 };
  for (const configuration of configurations) {
    try {
      const [accessToken, projectKeys] = await Promise.all([
        input.getAccessToken(configuration.connectionId),
        input.store.readProjectKeys(configuration.connectionId, configuration.generation),
      ]);
      const result = await (input.ensure ?? ensureJiraWebhook)({
        gateway: input.gateway,
        store: input.store,
        accessToken,
        configuration,
        projectKeys,
        callbackBaseUrl: input.callbackBaseUrl,
      });
      summary[result.status] += 1;
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
}

export async function disconnectJiraWebhook(input: {
  gateway: JiraOAuthGateway;
  store: JiraWebhookLifecycleStore;
  accessToken: string | null;
  organisationId: string;
  userId: string;
  configuration: JiraWebhookConfiguration;
}): Promise<void> {
  let disconnected: { webhookId: string | null };
  try {
    disconnected = await input.store.disconnect({
      organisationId: input.organisationId,
      userId: input.userId,
      connectionId: input.configuration.connectionId,
    });
  } catch {
    throw new Error("Jira disconnect failed");
  }
  if (input.accessToken && disconnected.webhookId) {
    await acknowledgeDeletedWebhook({
      gateway: input.gateway, store: input.store, accessToken: input.accessToken,
      organisationId: input.organisationId, cloudId: input.configuration.cloudId,
      webhookId: disconnected.webhookId,
    });
  }
}

export async function drainJiraWebhookCleanup(input: {
  store: JiraWebhookLifecycleStore;
  gateway: JiraOAuthGateway;
  getAccessToken: (job: JiraWebhookCleanupJob) => Promise<string>;
  workerId: string;
  batchSize?: number;
  shouldContinue?: () => boolean;
}): Promise<{ claimed: number; completed: number; failed: number; deferred: number }> {
  const batchSize = input.batchSize ?? 20;
  if (!workerSchema.safeParse(input.workerId).success || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 25) {
    throw new Error("Jira webhook cleanup worker is invalid");
  }
  const summary = { claimed: 0, completed: 0, failed: 0, deferred: 0 };
  for (let index = 0; index < batchSize; index += 1) {
    if (input.shouldContinue && !input.shouldContinue()) break;
    const job = await input.store.claimCleanup(input.workerId);
    if (!job) break;
    summary.claimed += 1;
    try {
      const accessToken = await input.getAccessToken(job);
      let webhookId = job.webhookId;
      if (!webhookId) {
        if (!job.callbackHash || !job.callbackOrigin) throw new Error("Jira webhook cleanup identity is invalid");
        const providerWebhooks = await input.gateway.listDynamicWebhooks({
          accessToken, cloudId: job.cloudId,
        });
        const matches = providerWebhooks.filter((webhook) => (
          callbackMatches(webhook.url, job.callbackOrigin!, job.callbackHash!)
        ));
        if (matches.length === 0) {
          const terminal = await input.store.observeCleanupAbsent(job.cleanupId, job.lockToken);
          if (terminal) summary.completed += 1;
          else summary.deferred += 1;
          continue;
        }
        if (matches.length !== 1) throw new Error("Jira webhook cleanup identity is ambiguous");
        webhookId = matches[0].id;
      }
      await input.gateway.deleteDynamicWebhook({
        accessToken, cloudId: job.cloudId, webhookId,
      });
      if (await input.store.completeCleanup(job.cleanupId, job.lockToken)) summary.completed += 1;
    } catch {
      try {
        if (await input.store.failCleanup(job.cleanupId, job.lockToken)) summary.failed += 1;
      } catch {
        // The lease expires and the durable cleanup is reclaimed later.
      }
    }
  }
  return summary;
}
