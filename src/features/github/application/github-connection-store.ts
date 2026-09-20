import "server-only";

import { z } from "zod";

import type { SafeSlackDeliveryPayload } from "@/features/monitoring/application/slack-alert-queue";
import { GITHUB_CONNECTION_DIAGNOSTICS, GITHUB_CONNECTION_HEALTHS } from "../domain/connection-health";

export type ConnectionStoreClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => Promise<{ data: unknown; error: unknown }> & {
        single: () => Promise<{ data: unknown; error: unknown }>;
      };
      single: () => Promise<{ data: unknown; error: unknown }>;
    };
  };
};

export type StoredReconciliationRun = {
  runId: string;
  organisationId: string;
  installationUuid: string;
};

export type StoredInstallationContext = {
  installationUuid: string;
  providerInstallationId: number;
  organisationId: string;
  previousHealth: (typeof GITHUB_CONNECTION_HEALTHS)[number];
  consecutiveFailures: number;
  expectedAccount: { id: number; login: string; type: "Organization" | "User" };
};

export type StoredRepositoryIdentity = {
  providerId: number;
  fullName: string;
};

function unavailable(): never {
  throw new Error("GitHub reconciliation store is unavailable");
}

const uuidSchema = z.uuid();
const positiveIdSchema = z.number().int().positive().safe();

const runRowSchema = z.object({
  id: uuidSchema,
  organisation_id: uuidSchema,
  installation_id: uuidSchema,
}).passthrough();

const installationContextRowSchema = z.object({
  provider_installation_id: positiveIdSchema,
  organisation_id: uuidSchema,
  health: z.enum(GITHUB_CONNECTION_HEALTHS),
  consecutive_reconciliation_failures: z.number().int().nonnegative(),
  account_id: positiveIdSchema,
  account_login: z.string().min(1).max(100),
  account_type: z.enum(["Organization", "User"]),
}).passthrough();

const repositoryRowSchema = z.object({
  provider_repository_id: positiveIdSchema,
  full_name: z.string().min(3).max(201),
}).passthrough();

const incidentSignalSchema = z.enum(["opened", "remained_open", "recovered", "none"]);

const snapshotRowSchema = z.object({
  id: positiveIdSchema,
  owner: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  fullName: z.string().min(3).max(201),
  htmlUrl: z.string().url().max(500),
  visibility: z.enum(["public", "private", "internal"]),
  archived: z.boolean(),
  defaultBranch: z.string().min(1).max(255),
}).passthrough();

export async function claimDueReconciliations(
  client: ConnectionStoreClient,
  input: { workerId: string; limit: number; nowIso: string },
): Promise<StoredReconciliationRun[]> {
  if (!uuidSchema.safeParse(input.workerId).success) unavailable();
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) unavailable();
  if (!Number.isFinite(new Date(input.nowIso).getTime())) unavailable();
  const { data, error } = await client.rpc("claim_due_github_connection_reconciliations_server", {
    target_worker_id: input.workerId,
    target_limit: input.limit,
    target_now: input.nowIso,
  });
  if (error) unavailable();
  const parsed = z.array(runRowSchema).safeParse(data);
  if (!parsed.success) unavailable();
  return parsed.data.map((row) => ({
    runId: row.id,
    organisationId: row.organisation_id,
    installationUuid: row.installation_id,
  }));
}

export async function loadInstallationContext(
  client: ConnectionStoreClient,
  installationUuid: string,
): Promise<StoredInstallationContext> {
  if (!uuidSchema.safeParse(installationUuid).success) unavailable();
  const { data, error } = await client
    .from("github_installations")
    .select("provider_installation_id,organisation_id,health,consecutive_reconciliation_failures,account_id,account_login,account_type")
    .eq("id", installationUuid)
    .single();
  if (error) unavailable();
  const parsed = installationContextRowSchema.safeParse(data);
  if (!parsed.success) unavailable();
  return {
    installationUuid,
    providerInstallationId: parsed.data.provider_installation_id,
    organisationId: parsed.data.organisation_id,
    previousHealth: parsed.data.health,
    consecutiveFailures: parsed.data.consecutive_reconciliation_failures,
    expectedAccount: {
      id: parsed.data.account_id,
      login: parsed.data.account_login,
      type: parsed.data.account_type,
    },
  };
}

export async function listStoredRepositories(
  client: ConnectionStoreClient,
  installationUuid: string,
): Promise<StoredRepositoryIdentity[]> {
  if (!uuidSchema.safeParse(installationUuid).success) unavailable();
  const { data, error } = await client
    .from("github_repositories")
    .select("provider_repository_id,full_name")
    .eq("installation_id", installationUuid);
  if (error) unavailable();
  const parsed = z.array(repositoryRowSchema).safeParse(data);
  if (!parsed.success) unavailable();
  return parsed.data.map((row) => ({ providerId: row.provider_repository_id, fullName: row.full_name }));
}

export async function finalizeReconciliationRun(
  client: ConnectionStoreClient,
  input: {
    runId: string;
    workerId: string;
    outcome: "success" | "partial" | "temporary_failure" | "action_required" | "disconnected";
    diagnostic: (typeof GITHUB_CONNECTION_DIAGNOSTICS)[number] | null;
    nextAttemptAt: string | null;
    snapshot: unknown;
  },
): Promise<string> {
  if (!uuidSchema.safeParse(input.runId).success || !uuidSchema.safeParse(input.workerId).success) unavailable();
  if (!Array.isArray(input.snapshot)) unavailable();
  const rows = input.snapshot as unknown[];
  if (!rows.every((row) => snapshotRowSchema.safeParse(row).success)) unavailable();
  const { data, error } = await client.rpc("finalize_github_connection_reconciliation_server", {
    target_run_id: input.runId,
    target_worker_id: input.workerId,
    target_outcome: input.outcome,
    target_diagnostic_code: input.diagnostic,
    target_next_attempt_at: input.nextAttemptAt,
    target_repository_snapshot: input.snapshot,
  });
  if (error) unavailable();
  const parsed = incidentSignalSchema.safeParse(data);
  if (!parsed.success) unavailable();
  return parsed.data;
}

const selectableRepositoryRowSchema = z.object({
  provider_repository_id: positiveIdSchema,
  selected: z.boolean(),
  available: z.boolean(),
}).passthrough();

export async function scheduleConnectionReconciliation(
  client: ConnectionStoreClient,
  providerInstallationId: number,
): Promise<boolean> {
  if (!positiveIdSchema.safeParse(providerInstallationId).success) unavailable();
  const { data, error } = await client.rpc("schedule_github_connection_reconciliation_server", {
    target_provider_installation_id: providerInstallationId,
  });
  if (error || typeof data !== "boolean") unavailable();
  return data;
}

export async function listSelectedRepositoryIds(
  client: ConnectionStoreClient,
  installationUuid: string,
): Promise<number[]> {
  if (!uuidSchema.safeParse(installationUuid).success) unavailable();
  const { data, error } = await client
    .from("github_repositories")
    .select("provider_repository_id,selected,available")
    .eq("installation_id", installationUuid);
  if (error) unavailable();
  const parsed = z.array(selectableRepositoryRowSchema).safeParse(data);
  if (!parsed.success) unavailable();
  return parsed.data
    .filter((row) => row.selected && row.available)
    .map((row) => row.provider_repository_id)
    .sort((left, right) => left - right)
    .slice(0, 100);
}

const recordNoticeRowSchema = z.object({
  incident_id: uuidSchema.nullable(),
  is_new: z.boolean(),
  notified_user_ids: z.array(uuidSchema),
}).passthrough();

export async function recordConnectionNotice(
  client: ConnectionStoreClient,
  input: {
    organisationId: string;
    installationId: string;
    kind: "incident" | "recovery";
    diagnostic: (typeof GITHUB_CONNECTION_DIAGNOSTICS)[number] | null;
    accountLogin: string;
  },
): Promise<{ incidentId: string | null; isNew: boolean; notifiedUserIds: string[] }> {
  if (!uuidSchema.safeParse(input.organisationId).success
    || !uuidSchema.safeParse(input.installationId).success
    || (input.kind !== "incident" && input.kind !== "recovery")
    || input.accountLogin.trim().length < 1) unavailable();
  const { data, error } = await client.rpc("record_github_connection_notice_server", {
    target_organisation_id: input.organisationId,
    target_installation_id: input.installationId,
    target_kind: input.kind,
    target_diagnostic_code: input.diagnostic,
    target_account_login: input.accountLogin,
  });
  if (error) unavailable();
  const parsed = recordNoticeRowSchema.safeParse(data);
  if (!parsed.success) unavailable();
  return {
    incidentId: parsed.data.incident_id,
    isNew: parsed.data.is_new,
    notifiedUserIds: parsed.data.notified_user_ids,
  };
}

export async function resolveConnectionSlackChannel(
  client: ConnectionStoreClient,
  organisationId: string,
): Promise<string | null> {
  if (!uuidSchema.safeParse(organisationId).success) unavailable();
  const { data, error } = await client
    .from("alert_channels")
    .select("id,type,enabled,revoked_at")
    .eq("organisation_id", organisationId);
  if (error) unavailable();
  const parsed = z.array(z.object({
    id: uuidSchema,
    type: z.string(),
    enabled: z.boolean(),
    revoked_at: z.string().nullable(),
  }).passthrough()).safeParse(data);
  if (!parsed.success) unavailable();
  const channel = parsed.data.find((row) => row.type === "slack" && row.enabled && row.revoked_at === null);
  return channel ? channel.id : null;
}

export async function enqueueConnectionSlackAlert(
  client: ConnectionStoreClient,
  input: {
    organisationId: string;
    channelId: string;
    installationId: string;
    kind: "incident" | "recovery";
    diagnostic: (typeof GITHUB_CONNECTION_DIAGNOSTICS)[number] | null;
    payload: SafeSlackDeliveryPayload;
  },
): Promise<boolean> {
  if (!uuidSchema.safeParse(input.organisationId).success
    || !uuidSchema.safeParse(input.channelId).success
    || !uuidSchema.safeParse(input.installationId).success
    || input.payload.type !== "connection_health") unavailable();
  const { data, error } = await client.rpc("queue_github_connection_alert_delivery", {
    target_organisation_id: input.organisationId,
    target_channel_id: input.channelId,
    target_installation_id: input.installationId,
    target_kind: input.kind,
    target_diagnostic_code: input.diagnostic,
    safe_payload: input.payload,
  });
  if (error || typeof data !== "boolean") {
    throw new Error("Connection alert delivery queue failed");
  }
  return data;
}
