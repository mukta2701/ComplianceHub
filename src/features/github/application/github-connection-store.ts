import "server-only";

import { z } from "zod";

import type {
  GitHubConnectionDiagnostic,
  GitHubConnectionHealth,
} from "../domain/connection-health";
import { hasExactReadPermissions, READ_PERMISSIONS } from "./github-app-auth";
import type { UserInstallationRepository } from "./github-user-oauth";

type QueryResult = { data: unknown; error: unknown };
type CancellableQueryResult = PromiseLike<QueryResult> & {
  abortSignal(signal: AbortSignal): CancellableQueryResult;
};
type QueryBuilder = CancellableQueryResult & {
  eq(column: string, value: unknown): QueryBuilder;
  order(column: string, options: { ascending: boolean }): QueryBuilder;
  limit(count: number): QueryBuilder;
};
type SupabaseServiceClient = {
  from(table: string): { select(columns: string): QueryBuilder };
  rpc(name: string, args: Record<string, unknown>): CancellableQueryResult;
};

export type GitHubConnectionReconciliationOutcome =
  | "success"
  | "partial"
  | "temporary_failure"
  | "action_required"
  | "disconnected";

export type GitHubConnectionFinalization = {
  outcome: GitHubConnectionReconciliationOutcome;
  diagnostic: GitHubConnectionDiagnostic | null;
  nextAttemptAt: string | null;
  repositorySnapshot: UserInstallationRepository[];
};

export type ClaimedGitHubConnectionReconciliation = {
  runId: string;
  workerId: string;
  organisationId: string;
  installationId: string;
  providerInstallationId: number;
  account: { id: number; login: string; type: "Organization" | "User" };
  repositorySelection: "selected";
  permissions: typeof READ_PERMISSIONS;
  selectedRepositoryIds: number[];
  previousHealth: GitHubConnectionHealth;
  consecutiveFailures: number;
  attemptedAt: string;
};

export type GitHubConnectionIncidentTransition = "none" | "opened" | "remained_open" | "recovered";
export type GitHubConnectionFinalizationResult = {
  incidentTransition: GitHubConnectionIncidentTransition;
  effectiveHealth: GitHubConnectionHealth;
};

const uuid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const positiveId = z.number().int().positive().safe();
const login = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?$/);
const repositoryName = z.string().min(1).max(100)
  .regex(/^[A-Za-z0-9_.-]+$/)
  .refine((value) => value !== "." && value !== "..");
const branchName = z.string().min(1).max(255)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));
const healthSchema = z.enum([
  "healthy",
  "retrying",
  "partially_unavailable",
  "owner_action_required",
  "disconnected",
]);
const diagnosticSchema = z.enum([
  "provider_rate_limited",
  "provider_temporary_failure",
  "installation_suspended",
  "installation_revoked",
  "permission_mismatch",
  "account_mismatch",
  "repository_unavailable",
  "invalid_provider_response",
  "internal_failure",
]);

const runRowSchema = z.object({
  id: uuid,
  organisation_id: uuid,
  installation_id: uuid,
  reconciliation_version: positiveId,
  trigger: z.enum(["initial", "scheduled", "webhook"]),
  request_key: z.string().min(1).max(200),
  status: z.literal("running"),
  diagnostic_code: z.null(),
  incident_transition: z.null(),
  effective_health: z.null(),
  started_at: timestamp,
  last_attempted_at: timestamp,
  completed_at: z.null(),
  attempt_count: z.number().int().positive(),
  repository_count: z.number().int().nonnegative(),
  available_repository_count: z.number().int().nonnegative(),
  unavailable_repository_count: z.number().int().nonnegative(),
}).strict();

const installationRowSchema = z.object({
  id: uuid,
  organisation_id: uuid,
  provider_installation_id: positiveId,
  account_id: positiveId,
  account_login: login,
  account_type: z.enum(["Organization", "User"]),
  repository_selection: z.literal("selected"),
  status: z.enum(["active", "suspended", "revoked", "needs_attention"]),
  permissions: z.record(z.string().min(1).max(100), z.string().min(1).max(20)),
  permissions_ok: z.boolean(),
  health: healthSchema,
  consecutive_reconciliation_failures: z.number().int().nonnegative(),
  reconciliation_version: positiveId,
}).strict().refine((value) => hasExactReadPermissions(value.permissions));

const selectedRepositoryRowSchema = z.object({
  id: uuid,
  organisation_id: uuid,
  installation_id: uuid,
  provider_repository_id: positiveId,
  owner_login: login,
  name: repositoryName,
  full_name: z.string().min(3).max(201),
  selected: z.literal(true),
}).strict();

const canonicalRepositorySchema = z.object({
  id: positiveId,
  owner: login,
  name: repositoryName,
  fullName: z.string().min(3).max(201),
  htmlUrl: z.string().url().max(500),
  visibility: z.enum(["public", "private", "internal"]),
  archived: z.boolean(),
  defaultBranch: branchName,
}).strict();

const finalizationSchema = z.object({
  outcome: z.enum(["success", "partial", "temporary_failure", "action_required", "disconnected"]),
  diagnostic: diagnosticSchema.nullable(),
  nextAttemptAt: timestamp.nullable(),
  repositorySnapshot: z.array(canonicalRepositorySchema).max(10_000),
}).strict().superRefine((value, context) => {
  const diagnosticByOutcome = {
    success: [null],
    partial: ["repository_unavailable"],
    temporary_failure: ["provider_rate_limited", "provider_temporary_failure", "invalid_provider_response", "internal_failure"],
    action_required: ["installation_suspended", "permission_mismatch", "account_mismatch"],
    disconnected: ["installation_revoked"],
  } as const;
  if (!(diagnosticByOutcome[value.outcome] as readonly unknown[]).includes(value.diagnostic)) {
    context.addIssue({ code: "custom", message: "diagnostic does not match outcome" });
  }
  const needsNextAttempt = value.outcome === "success"
    || value.outcome === "partial"
    || value.outcome === "temporary_failure";
  if (needsNextAttempt !== (value.nextAttemptAt !== null)) {
    context.addIssue({ code: "custom", message: "next attempt does not match outcome" });
  }
  if (value.outcome !== "success" && value.outcome !== "partial" && value.repositorySnapshot.length !== 0) {
    context.addIssue({ code: "custom", message: "unverified outcomes cannot persist provider repositories" });
  }
});

const claimInputSchema = z.object({
  workerId: uuid,
  limit: z.number().int().min(1).max(100),
  now: timestamp,
  signal: z.instanceof(AbortSignal).optional(),
}).strict();
const incidentTransitionSchema = z.enum(["none", "opened", "remained_open", "recovered"]);
const finalizationResultSchema = z.object({
  incidentTransition: incidentTransitionSchema,
  effectiveHealth: healthSchema,
}).strict();

function failure(): Error {
  return new Error("GitHub connection persistence failed");
}

function oneRow(value: unknown): unknown {
  return Array.isArray(value) && value.length === 1 ? value[0] : undefined;
}

function withSignal<T extends CancellableQueryResult>(query: T, signal?: AbortSignal): T {
  return (signal ? query.abortSignal(signal) : query) as T;
}

function validateCanonicalSnapshot(
  finalization: z.infer<typeof finalizationSchema>,
  accountLogin: string,
): void {
  const ids = new Set<number>();
  const names = new Set<string>();
  for (const repository of finalization.repositorySnapshot) {
    const expectedFullName = `${repository.owner}/${repository.name}`;
    if (
      repository.owner.toLowerCase() !== accountLogin.toLowerCase()
      || repository.fullName !== expectedFullName
      || repository.htmlUrl !== `https://github.com/${expectedFullName}`
      || ids.has(repository.id)
      || names.has(expectedFullName.toLowerCase())
    ) throw failure();
    ids.add(repository.id);
    names.add(expectedFullName.toLowerCase());
  }
}

export function buildGitHubConnectionStore(serviceInput: unknown): {
  claimDue(input: {
    workerId: string;
    limit: number;
    now: string;
    signal?: AbortSignal;
  }): Promise<ClaimedGitHubConnectionReconciliation[]>;
  finalize(
    claim: ClaimedGitHubConnectionReconciliation,
    finalization: GitHubConnectionFinalization,
    signal?: AbortSignal,
  ): Promise<GitHubConnectionFinalizationResult>;
} {
  const service = serviceInput as SupabaseServiceClient;
  return {
    async claimDue(input) {
      try {
        const parsedInput = claimInputSchema.parse(input);
        const { data, error } = await withSignal(service.rpc("claim_due_github_connection_reconciliations_server", {
          target_worker_id: parsedInput.workerId,
          target_limit: parsedInput.limit,
          target_now: parsedInput.now,
        }), parsedInput.signal);
        if (error || !Array.isArray(data)) throw failure();
        const runs = data.map((value) => runRowSchema.parse(value));
        const claims: ClaimedGitHubConnectionReconciliation[] = [];
        for (const run of runs) {
          const installationResponse = await withSignal(service
            .from("github_installations")
            .select("id,organisation_id,provider_installation_id,account_id,account_login,account_type,repository_selection,status,permissions,permissions_ok,health,consecutive_reconciliation_failures,reconciliation_version")
            .eq("id", run.installation_id)
            .eq("organisation_id", run.organisation_id)
            .limit(2), parsedInput.signal);
          if (installationResponse.error) throw failure();
          const installation = installationRowSchema.parse(oneRow(installationResponse.data));
          if (installation.id !== run.installation_id || installation.organisation_id !== run.organisation_id) throw failure();
          if (run.reconciliation_version > installation.reconciliation_version) throw failure();

          const repositoryResponse = await withSignal(service
            .from("github_repositories")
            .select("id,organisation_id,installation_id,provider_repository_id,owner_login,name,full_name,selected")
            .eq("organisation_id", run.organisation_id)
            .eq("installation_id", run.installation_id)
            .eq("selected", true)
            .order("provider_repository_id", { ascending: true })
            .limit(10_001), parsedInput.signal);
          if (repositoryResponse.error || !Array.isArray(repositoryResponse.data)) throw failure();
          const repositories = repositoryResponse.data.map((value) => selectedRepositoryRowSchema.parse(value));
          if (repositories.length > 10_000) throw failure();
          const selectedIds = new Set<number>();
          const selectedNames = new Set<string>();
          for (const repository of repositories) {
            const fullName = `${repository.owner_login}/${repository.name}`;
            if (
              repository.organisation_id !== run.organisation_id
              || repository.installation_id !== run.installation_id
              || repository.owner_login.toLowerCase() !== installation.account_login.toLowerCase()
              || repository.full_name !== fullName
              || selectedIds.has(repository.provider_repository_id)
              || selectedNames.has(fullName.toLowerCase())
            ) throw failure();
            selectedIds.add(repository.provider_repository_id);
            selectedNames.add(fullName.toLowerCase());
          }
          claims.push({
            runId: run.id,
            workerId: parsedInput.workerId,
            organisationId: run.organisation_id,
            installationId: run.installation_id,
            providerInstallationId: installation.provider_installation_id,
            account: {
              id: installation.account_id,
              login: installation.account_login,
              type: installation.account_type,
            },
            repositorySelection: "selected",
            permissions: READ_PERMISSIONS,
            selectedRepositoryIds: [...selectedIds].sort((left, right) => left - right),
            previousHealth: installation.health,
            consecutiveFailures: installation.consecutive_reconciliation_failures,
            attemptedAt: run.last_attempted_at,
          });
        }
        return claims;
      } catch {
        throw failure();
      }
    },
    async finalize(claim, finalization, signal) {
      try {
        const parsedClaim = z.object({
          runId: uuid,
          workerId: uuid,
          organisationId: uuid,
          installationId: uuid,
          account: z.object({ login }).passthrough(),
        }).passthrough().parse(claim);
        const parsedFinalization = finalizationSchema.parse(finalization);
        validateCanonicalSnapshot(parsedFinalization, parsedClaim.account.login);
        const { data, error } = await withSignal(service.rpc("finalize_github_connection_reconciliation_server", {
          target_run_id: parsedClaim.runId,
          target_worker_id: parsedClaim.workerId,
          target_outcome: parsedFinalization.outcome,
          target_diagnostic_code: parsedFinalization.diagnostic,
          target_next_attempt_at: parsedFinalization.nextAttemptAt,
          target_repository_snapshot: parsedFinalization.repositorySnapshot,
        }), signal);
        if (error) throw failure();
        return finalizationResultSchema.parse(data);
      } catch {
        throw failure();
      }
    },
  };
}
