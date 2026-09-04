import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { IntegrationProvider } from "../domain/provider";

export type AuthorizationOperator = {
  organisationId: string;
  userId: string;
  role: "owner" | "admin" | "member";
};

export type AuthorizationStateDatabase = {
  from(table: "integration_authorization_states"): {
    insert(row: Record<string, unknown>): PromiseLike<{ error: unknown }>;
  };
  rpc(
    name: "consume_integration_authorization_state" | "prune_integration_authorization_states",
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
};

type ResolveOperator = () => Promise<AuthorizationOperator>;
type Continuation = Record<string, unknown>;

type IssueAuthorizationStateInput = {
  database: AuthorizationStateDatabase;
  resolveOperator: ResolveOperator;
  provider: IntegrationProvider;
  purpose: string;
  continuation?: Continuation;
  now?: () => Date;
};

type ConsumeAuthorizationStateInput = {
  database: AuthorizationStateDatabase;
  resolveOperator: ResolveOperator;
  provider: IntegrationProvider;
  purpose: string;
  state: string;
};

export type IssuedAuthorizationState = {
  state: string;
  expiresAt: string;
};

export type ConsumedAuthorizationState = {
  provider: IntegrationProvider;
  purpose: string;
  continuation: Continuation;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const purposePattern = /^[a-z][a-z0-9_]{0,63}$/;
const rawStatePattern = /^[A-Za-z0-9_-]{43}$/;
const stateLifetimeMs = 10 * 60 * 1_000;
const invalidStateMessage = "Authorization state is invalid or expired";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProvider(value: unknown): value is IntegrationProvider {
  return value === "github" || value === "jira";
}

function validContinuation(value: unknown): value is Continuation {
  if (!isRecord(value)) return false;
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= 4_096;
  } catch {
    return false;
  }
}

function validPurpose(value: unknown): value is string {
  return typeof value === "string" && purposePattern.test(value);
}

function purposeMatchesProvider(provider: IntegrationProvider, purpose: string): boolean {
  return (provider === "github" && purpose === "github_install")
    || (provider === "jira" && purpose === "jira_oauth");
}

function validOperator(value: unknown): value is AuthorizationOperator {
  if (!isRecord(value)) return false;
  return typeof value.organisationId === "string"
    && uuidPattern.test(value.organisationId)
    && typeof value.userId === "string"
    && uuidPattern.test(value.userId)
    && (value.role === "owner" || value.role === "admin");
}

async function currentOperator(resolveOperator: ResolveOperator, message: string): Promise<AuthorizationOperator> {
  try {
    const operator = await resolveOperator();
    if (!validOperator(operator)) throw new Error(message);
    return operator;
  } catch {
    throw new Error(message);
  }
}

function hashState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

export async function issueAuthorizationState(
  input: IssueAuthorizationStateInput,
): Promise<IssuedAuthorizationState> {
  const unavailable = "Provider authorization is unavailable";
  if (
    !isProvider(input.provider)
    || !validPurpose(input.purpose)
    || !purposeMatchesProvider(input.provider, input.purpose)
  ) throw new Error(unavailable);
  const continuation = input.continuation ?? {};
  if (!validContinuation(continuation)) throw new Error(unavailable);
  const operator = await currentOperator(input.resolveOperator, unavailable);

  try {
    const cleanup = await input.database.rpc("prune_integration_authorization_states", {});
    if (cleanup.error) throw new Error("cleanup failed");
  } catch {
    throw new Error("Could not start provider authorization");
  }

  const state = randomBytes(32).toString("base64url");
  const now = (input.now ?? (() => new Date()))();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error(unavailable);
  const expiresAt = new Date(now.getTime() + stateLifetimeMs).toISOString();
  let error: unknown;
  try {
    ({ error } = await input.database.from("integration_authorization_states").insert({
      organisation_id: operator.organisationId,
      user_id: operator.userId,
      provider: input.provider,
      state_hash: hashState(state),
      purpose: input.purpose,
      continuation,
      expires_at: expiresAt,
    }));
  } catch {
    throw new Error("Could not start provider authorization");
  }
  if (error) throw new Error("Could not start provider authorization");

  return { state, expiresAt };
}

function parseConsumedRow(value: unknown): {
  organisationId: string;
  userId: string;
  provider: IntegrationProvider;
  purpose: string;
  continuation: Continuation;
} | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.organisation_id !== "string"
    || !uuidPattern.test(value.organisation_id)
    || typeof value.user_id !== "string"
    || !uuidPattern.test(value.user_id)
    || !isProvider(value.provider)
    || !validPurpose(value.purpose)
    || !validContinuation(value.continuation)
    || typeof value.consumed_at !== "string"
    || !Number.isFinite(Date.parse(value.consumed_at))
    || typeof value.expires_at !== "string"
    || !Number.isFinite(Date.parse(value.expires_at))
  ) return null;
  return {
    organisationId: value.organisation_id,
    userId: value.user_id,
    provider: value.provider,
    purpose: value.purpose,
    continuation: value.continuation,
  };
}

export async function consumeAuthorizationState(
  input: ConsumeAuthorizationStateInput,
): Promise<ConsumedAuthorizationState> {
  if (
    !isProvider(input.provider)
    || !validPurpose(input.purpose)
    || !purposeMatchesProvider(input.provider, input.purpose)
    || !rawStatePattern.test(input.state)
  ) throw new Error(invalidStateMessage);

  const before = await currentOperator(input.resolveOperator, invalidStateMessage);
  let response: { data: unknown; error: unknown };
  try {
    response = await input.database.rpc("consume_integration_authorization_state", {
      candidate_state_hash: hashState(input.state),
      expected_organisation_id: before.organisationId,
      expected_user_id: before.userId,
      expected_provider: input.provider,
      expected_purpose: input.purpose,
    });
  } catch {
    throw new Error(invalidStateMessage);
  }
  if (response.error || !Array.isArray(response.data) || response.data.length !== 1) {
    throw new Error(invalidStateMessage);
  }

  const row = parseConsumedRow(response.data[0]);
  if (
    !row
    || row.organisationId !== before.organisationId
    || row.userId !== before.userId
    || row.provider !== input.provider
    || row.purpose !== input.purpose
  ) throw new Error(invalidStateMessage);

  // Re-resolve after the atomic consume so an offboarded/demoted session or a
  // workspace switch cannot continue using the consumed authorization.
  const after = await currentOperator(input.resolveOperator, invalidStateMessage);
  if (
    after.organisationId !== before.organisationId
    || after.userId !== before.userId
    || after.role !== before.role
  ) throw new Error(invalidStateMessage);

  return { provider: row.provider, purpose: row.purpose, continuation: row.continuation };
}
