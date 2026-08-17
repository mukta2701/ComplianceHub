import "server-only";

import { z } from "zod";

import type { GitHubObservation } from "../domain/observation";
import { evaluateGitHubRepository } from "../domain/rules";
import { collectRepositoryFacts } from "./collect-repository-facts";
import { createAppJwt, createInstallationToken } from "./github-app-auth";
import type {
  CollectionDependencies,
  CollectionRequest,
  CollectionTarget,
  RunReservation,
  RunResult,
} from "./run-collection";

type QueryResult = { data: unknown; error: unknown };
type QueryBuilder = PromiseLike<QueryResult> & {
  eq(column: string, value: unknown): QueryBuilder;
  order(column: string, options: { ascending: boolean }): QueryBuilder;
  limit(count: number): QueryBuilder;
  range(from: number, to: number): QueryBuilder;
};
type SourceBuilder = {
  select(columns: string): QueryBuilder;
};
type SupabaseServiceClient = {
  from(table: string): SourceBuilder;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<QueryResult>;
};

type CollectionConfiguration = {
  appId: string;
  privateKey: string;
  approvedSecurityWorkflowIds: readonly number[];
  fetchImpl?: typeof fetch;
};

const uuidSchema = z.string().uuid();
const safeId = z.number().int().positive().safe();
const installationSchema = z.object({
  id: uuidSchema,
  organisation_id: uuidSchema,
  provider_installation_id: safeId,
  status: z.literal("active"),
  permissions_ok: z.literal(true),
}).strict();
const repositorySchema = z.object({
  id: uuidSchema,
  organisation_id: uuidSchema,
  installation_id: uuidSchema,
  provider_repository_id: safeId,
  owner_login: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  selected: z.literal(true),
  available: z.literal(true),
  github_installations: installationSchema,
}).strict();
const reservationSchema = z.object({
  run_id: uuidSchema,
  lease_token: uuidSchema,
  lease_expires_at: z.string().datetime({ offset: true }),
  attempt: z.number().int().positive(),
  acquisition_state: z.enum(["acquired", "reclaimed", "active_duplicate", "completed_duplicate"]),
  status: z.enum(["running", "succeeded", "partial", "failed", "rate_limited"]),
  organisation_id: uuidSchema,
  installation_id: uuidSchema,
  repository_id: uuidSchema,
  provider_repository_id: safeId,
}).strict();
const PAGE_SIZE = 1_000;
const MAX_TARGET_PAGES = 100;

function fail(): Error {
  return new Error("GitHub collection persistence failed");
}

function targetLoadingFailure(): Error {
  return new Error("GitHub collection target loading failed");
}

function singleRpcData(data: unknown): unknown {
  if (Array.isArray(data)) return data.length === 1 ? data[0] : undefined;
  return data;
}

function toReservation(value: unknown): RunReservation {
  const row = reservationSchema.safeParse(singleRpcData(value));
  if (!row.success) throw fail();
  return {
    runId: row.data.run_id,
    leaseToken: row.data.lease_token,
    leaseExpiresAt: row.data.lease_expires_at,
    attempt: row.data.attempt,
    acquisitionState: row.data.acquisition_state,
    status: row.data.status,
    organisationId: row.data.organisation_id,
    installationId: row.data.installation_id,
    repositoryId: row.data.repository_id,
    providerRepositoryId: row.data.provider_repository_id,
  };
}

export function buildCollectionDependencies(
  serviceInput: unknown,
  configuration: CollectionConfiguration,
): CollectionDependencies {
  const service = serviceInput as SupabaseServiceClient;
  const repositoryIdsByInstallation = new Map<string, number[]>();
  const tokenPromises = new Map<string, Promise<string>>();

  async function listTargets(request: CollectionRequest): Promise<CollectionTarget[]> {
    try {
      const baseQuery = () => {
        let query = service
          .from("github_repositories")
          .select("id,organisation_id,installation_id,provider_repository_id,owner_login,name,selected,available,github_installations!inner(id,organisation_id,provider_installation_id,status,permissions_ok)")
          .eq("selected", true)
          .eq("available", true)
          .eq("github_installations.status", "active")
          .eq("github_installations.permissions_ok", true)
          .order("installation_id", { ascending: true })
          .order("id", { ascending: true });
        if (request.installationId) query = query.eq("installation_id", request.installationId);
        if (request.repositoryId) query = query.eq("id", request.repositoryId);
        return query;
      };
      const values: unknown[] = [];
      if (request.repositoryId) {
        const { data, error } = await baseQuery().limit(2);
        if (error || !Array.isArray(data) || data.length !== 1) throw targetLoadingFailure();
        values.push(...data);
      } else if (request.installationId) {
        const { data, error } = await baseQuery().limit(101);
        if (error || !Array.isArray(data) || data.length < 1 || data.length > 100) throw targetLoadingFailure();
        values.push(...data);
      } else {
        for (let page = 0; page < MAX_TARGET_PAGES; page += 1) {
          const from = page * PAGE_SIZE;
          const { data, error } = await baseQuery().range(from, from + PAGE_SIZE - 1);
          if (error || !Array.isArray(data)) throw targetLoadingFailure();
          values.push(...data);
          if (data.length < PAGE_SIZE) break;
          if (page === MAX_TARGET_PAGES - 1) throw targetLoadingFailure();
        }
      }

      const rows = values.map((value) => repositorySchema.parse(value));
      const installationProviders = new Map<string, number>();
      const installationCounts = new Map<string, number>();
      const targets = rows.map((row): CollectionTarget => {
        const installation = row.github_installations;
        if (installation.id !== row.installation_id || installation.organisation_id !== row.organisation_id) throw targetLoadingFailure();
        const existingProvider = installationProviders.get(row.installation_id);
        if (existingProvider !== undefined && existingProvider !== installation.provider_installation_id) throw targetLoadingFailure();
        const count = (installationCounts.get(row.installation_id) ?? 0) + 1;
        if (count > 100) throw targetLoadingFailure();
        installationProviders.set(row.installation_id, installation.provider_installation_id);
        installationCounts.set(row.installation_id, count);
        return {
          organisationId: row.organisation_id,
          installationId: row.installation_id,
          repositoryId: row.id,
          providerInstallationId: installation.provider_installation_id,
          providerRepositoryId: row.provider_repository_id,
          owner: row.owner_login,
          name: row.name,
        };
      });
      repositoryIdsByInstallation.clear();
      tokenPromises.clear();
      for (const target of targets) {
        const ids = repositoryIdsByInstallation.get(target.installationId) ?? [];
        ids.push(target.providerRepositoryId);
        repositoryIdsByInstallation.set(target.installationId, ids);
      }
      return targets;
    } catch {
      throw targetLoadingFailure();
    }
  }

  async function tokenFor(target: CollectionTarget): Promise<string> {
    const existing = tokenPromises.get(target.installationId);
    if (existing) return existing;
    const repositoryIds = repositoryIdsByInstallation.get(target.installationId);
    if (!repositoryIds?.includes(target.providerRepositoryId)) throw targetLoadingFailure();
    const pending = (async () => {
      const appJwt = await createAppJwt({ appId: configuration.appId, privateKey: configuration.privateKey }, new Date());
      const token = await createInstallationToken({ installationId: target.providerInstallationId, repositoryIds, appJwt, fetchImpl: configuration.fetchImpl });
      return token.token;
    })();
    tokenPromises.set(target.installationId, pending);
    return pending;
  }

  return {
    listTargets,
    async reserveRun(target, request) {
      const { data, error } = await service.rpc("reserve_github_collection_run_server", {
        target_organisation_id: target.organisationId,
        target_installation_id: target.installationId,
        target_repository_id: target.repositoryId,
        target_provider_repository_id: target.providerRepositoryId,
        target_trigger_type: request.trigger,
        target_request_key: request.requestKey,
        target_lease_seconds: 180,
      });
      if (error) throw fail();
      const result = toReservation(data);
      if (
        result.organisationId !== target.organisationId
        || result.installationId !== target.installationId
        || result.repositoryId !== target.repositoryId
        || result.providerRepositoryId !== target.providerRepositoryId
      ) throw fail();
      return result;
    },
    async listPersistedObservations(reservation, target) {
      const { data, error } = await service
        .from("github_observations")
        .select("observation_key,result")
        .eq("collection_run_id", reservation.runId)
        .eq("organisation_id", target.organisationId)
        .eq("installation_id", target.installationId)
        .eq("repository_id", target.repositoryId)
        .eq("provider_repository_id", target.providerRepositoryId)
        .order("observation_key", { ascending: true })
        .limit(16);
      if (error || !Array.isArray(data)) throw fail();
      const parsed = z.array(z.object({
        observation_key: z.string().min(1).max(500),
        result: z.enum(["pass", "fail", "unknown", "not_applicable"]),
      }).strict()).safeParse(data);
      if (!parsed.success) throw fail();
      return parsed.data.map((row) => ({ observationKey: row.observation_key, result: row.result }));
    },
    async collectFacts(target, signal) {
      return collectRepositoryFacts({
        installationToken: await tokenFor(target),
        repository: { repositoryId: target.providerRepositoryId, owner: target.owner, name: target.name },
        approvedSecurityWorkflowIds: configuration.approvedSecurityWorkflowIds,
        fetchImpl: configuration.fetchImpl,
        signal,
      });
    },
    evaluate: evaluateGitHubRepository,
    async refreshRepository(reservation, target, facts) {
      const { data, error } = await service.rpc("refresh_github_repository_server", {
        target_run_id: reservation.runId,
        target_organisation_id: target.organisationId,
        target_installation_id: target.installationId,
        target_repository_id: target.repositoryId,
        target_provider_repository_id: target.providerRepositoryId,
        target_lease_token: reservation.leaseToken,
        target_attempt: reservation.attempt,
        target_owner_login: facts.repository.owner,
        target_name: facts.repository.name,
        target_html_url: facts.repository.url,
        target_visibility: facts.repository.visibility,
        target_default_branch: facts.repository.defaultBranch,
        target_archived: facts.repository.archived,
      });
      if (error || data !== true) throw fail();
    },
    async saveObservations(reservation, target, observations) {
      const payload = observations.map((row: GitHubObservation) => ({
        observation_key: row.observationKey,
        check_id: row.checkId,
        rule_version: row.ruleVersion,
        subject_type: row.subjectType,
        subject_id: row.subjectId,
        result: row.result,
        severity: row.severity,
        title: row.title,
        explanation: row.explanation,
        remediation: row.remediation,
        observed_at: row.observedAt,
        fresh_until: row.freshUntil,
        source_url: row.sourceUrl,
        fingerprint: row.fingerprint,
        diagnostic_code: row.diagnosticCode,
      }));
      const { data, error } = await service.rpc("save_github_observations_server", {
        target_run_id: reservation.runId,
        target_organisation_id: target.organisationId,
        target_installation_id: target.installationId,
        target_repository_id: target.repositoryId,
        target_provider_repository_id: target.providerRepositoryId,
        target_lease_token: reservation.leaseToken,
        target_attempt: reservation.attempt,
        target_observations: payload,
      });
      if (error || typeof data !== "number") throw fail();
      return data;
    },
    async finaliseRun(reservation, target, result: RunResult) {
      const { data, error } = await service.rpc("finalise_github_collection_run_server", {
        target_run_id: reservation.runId,
        target_organisation_id: target.organisationId,
        target_installation_id: target.installationId,
        target_repository_id: target.repositoryId,
        target_provider_repository_id: target.providerRepositoryId,
        target_lease_token: reservation.leaseToken,
        target_attempt: reservation.attempt,
        target_status: result.status,
        target_diagnostic_code: result.diagnosticCode ?? null,
      });
      if (error || typeof data !== "boolean") throw fail();
      return data;
    },
    now: () => new Date(),
  };
}
