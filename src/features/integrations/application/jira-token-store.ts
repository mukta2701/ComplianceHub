import "server-only";
import { decryptSecret, encryptSecret } from "@/lib/security/secrets";
import {
  JiraProviderError,
  type JiraAccessCredential,
  type JiraConnectionStore,
  type JiraOAuthGateway,
  type JiraOAuthTokens,
  type JiraRefreshFailure,
  type JiraRefreshLease,
} from "./jira-oauth";

export type JiraPersistenceDatabase = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

type SecretCipher = {
  seal(value: string): string | null;
  open(value: string): string | null;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encryptedPattern = /^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/;
const minimumTokenTtlMs = 60_000;

const defaultCipher: SecretCipher = {
  seal: encryptSecret,
  open: decryptSecret,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validEncrypted(value: unknown): value is string {
  return typeof value === "string" && value.length <= 8_192 && encryptedPattern.test(value);
}

function validIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validGeneration(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2_147_483_646;
}

function seal(cipher: SecretCipher, value: string): string {
  const encrypted = cipher.seal(value);
  if (typeof encrypted !== "string" || encrypted.length === 0 || encrypted.length > 8_192) {
    throw new Error("Jira credential encryption failed");
  }
  // Production encryption is shape-checked. Tests may inject an explicit
  // deterministic cipher to verify that plaintext is never sent to storage.
  if (cipher === defaultCipher && !validEncrypted(encrypted)) {
    throw new Error("Jira credential encryption failed");
  }
  return encrypted;
}

function open(cipher: SecretCipher, value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 8_192) {
    throw new Error("Jira credential could not be read");
  }
  if (cipher === defaultCipher && !validEncrypted(value)) {
    throw new Error("Jira credential could not be read");
  }
  const plaintext = cipher.open(value);
  if (typeof plaintext !== "string" || plaintext.length === 0 || plaintext.length > 8_192 || /[\r\n]/.test(plaintext)) {
    throw new Error("Jira credential could not be read");
  }
  return plaintext;
}

function parseAccessRow(value: unknown, cipher: SecretCipher): JiraAccessCredential {
  if (
    !isRecord(value)
    || !validIso(value.token_expires_at)
    || !validGeneration(value.refresh_generation)
  ) throw new Error("Jira credential could not be read");
  return {
    accessToken: open(cipher, value.encrypted_access_token),
    expiresAt: value.token_expires_at,
    generation: value.refresh_generation,
  };
}

function parseLeaseRow(value: unknown, cipher: SecretCipher): JiraRefreshLease {
  const access = parseAccessRow(value, cipher);
  if (!isRecord(value) || typeof value.lease_id !== "string" || !uuidPattern.test(value.lease_id)) {
    throw new Error("Jira refresh lease could not be read");
  }
  return {
    ...access,
    leaseId: value.lease_id,
    refreshToken: open(cipher, value.encrypted_refresh_token),
  };
}

function requireUuid(value: string, message: string): void {
  if (!uuidPattern.test(value)) throw new Error(message);
}

export function createSupabaseJiraConnectionStore(
  database: JiraPersistenceDatabase,
  cipher: SecretCipher = defaultCipher,
): JiraConnectionStore {
  return {
    async saveAuthorization(input) {
      const { data, error } = await database.rpc("connect_jira_oauth", {
        target_organisation_id: input.organisationId,
        target_user_id: input.userId,
        target_cloud_id: input.site.cloudId,
        target_site_name: input.site.name,
        encrypted_access_token: seal(cipher, input.tokens.accessToken),
        encrypted_refresh_token: seal(cipher, input.tokens.refreshToken),
        target_token_expires_at: input.tokens.expiresAt,
      });
      if (error || typeof data !== "string" || !uuidPattern.test(data)) {
        throw new Error("Jira persistence failed");
      }
      return data;
    },

    async savePendingAuthorization(input) {
      const { data, error } = await database.rpc("save_pending_jira_authorization", {
        target_organisation_id: input.organisationId,
        target_user_id: input.userId,
        encrypted_access_token: seal(cipher, input.tokens.accessToken),
        encrypted_refresh_token: seal(cipher, input.tokens.refreshToken),
        target_token_expires_at: input.tokens.expiresAt,
        accessible_sites: input.sites.map((site) => ({
          cloudId: site.cloudId,
          name: site.name,
          url: site.url,
          scopes: site.scopes,
        })),
      });
      if (error || typeof data !== "string" || !uuidPattern.test(data)) {
        throw new Error("Pending Jira authorization persistence failed");
      }
      return data;
    },

    async finalizePendingAuthorization(input) {
      const { data, error } = await database.rpc("finalize_pending_jira_authorization", {
        target_organisation_id: input.organisationId,
        target_user_id: input.userId,
        target_setup_id: input.setupId,
        selected_cloud_id: input.cloudId,
      });
      if (error || typeof data !== "string" || !uuidPattern.test(data)) {
        throw new Error("Pending Jira authorization could not be completed");
      }
      return data;
    },

    async readAccessCredential(connectionId) {
      requireUuid(connectionId, "Jira connection is invalid");
      const { data, error } = await database.rpc("read_jira_access_credential", {
        target_connection_id: connectionId,
      });
      if (error || !Array.isArray(data) || data.length !== 1) {
        throw new Error("Jira credential could not be read");
      }
      return parseAccessRow(data[0], cipher);
    },

    async claimRefreshLease(connectionId) {
      requireUuid(connectionId, "Jira connection is invalid");
      const { data, error } = await database.rpc("claim_jira_refresh_lease", {
        target_connection_id: connectionId,
      });
      if (error || !Array.isArray(data) || data.length > 1) {
        throw new Error("Jira refresh lease could not be acquired");
      }
      return data.length === 0 ? null : parseLeaseRow(data[0], cipher);
    },

    async completeRefreshLease(input) {
      const { data, error } = await database.rpc("complete_jira_refresh_lease", {
        target_connection_id: input.connectionId,
        claimed_lease_id: input.leaseId,
        new_encrypted_access_token: seal(cipher, input.tokens.accessToken),
        new_encrypted_refresh_token: seal(cipher, input.tokens.refreshToken),
        new_token_expires_at: input.tokens.expiresAt,
      });
      if (error || typeof data !== "boolean") throw new Error("Jira refresh could not be committed");
      return data;
    },

    async releaseRefreshLease(input) {
      const { data, error } = await database.rpc("release_jira_refresh_lease", {
        target_connection_id: input.connectionId,
        claimed_lease_id: input.leaseId,
        safe_failure: input.failure,
      });
      if (error || typeof data !== "boolean") throw new Error("Jira refresh lease could not be released");
      return data;
    },

    async disconnect(input) {
      const { data, error } = await database.rpc("disconnect_jira_oauth", {
        target_organisation_id: input.organisationId,
        target_user_id: input.userId,
        target_connection_id: input.connectionId,
      });
      if (
        error
        || (data !== null && (typeof data !== "string" || !/^[1-9][0-9]{0,15}$/.test(data)))
      ) throw new Error("Jira disconnect failed");
    },
  };
}

type JiraRefreshCredentialStore = Pick<
  JiraConnectionStore,
  "readAccessCredential" | "claimRefreshLease" | "completeRefreshLease" | "releaseRefreshLease"
>;

export function createSupabaseJiraCleanupConnectionStore(
  database: JiraPersistenceDatabase,
  context: { cleanupId: string; cleanupLockToken: string },
  cipher: SecretCipher = defaultCipher,
): JiraRefreshCredentialStore {
  requireUuid(context.cleanupId, "Jira cleanup identity is invalid");
  requireUuid(context.cleanupLockToken, "Jira cleanup identity is invalid");
  const cleanupArgs = {
    target_cleanup_id: context.cleanupId,
    cleanup_lock_token: context.cleanupLockToken,
  };
  return {
    async readAccessCredential(connectionId) {
      requireUuid(connectionId, "Jira connection is invalid");
      const { data, error } = await database.rpc("read_jira_cleanup_access_credential", {
        target_connection_id: connectionId,
        ...cleanupArgs,
      });
      if (error || !Array.isArray(data) || data.length !== 1) throw new Error("Jira credential could not be read");
      return parseAccessRow(data[0], cipher);
    },
    async claimRefreshLease(connectionId) {
      requireUuid(connectionId, "Jira connection is invalid");
      const { data, error } = await database.rpc("claim_jira_cleanup_refresh_lease", {
        target_connection_id: connectionId,
        ...cleanupArgs,
      });
      if (error || !Array.isArray(data) || data.length > 1) throw new Error("Jira refresh lease could not be acquired");
      return data.length === 0 ? null : parseLeaseRow(data[0], cipher);
    },
    async completeRefreshLease(input) {
      const { data, error } = await database.rpc("complete_jira_cleanup_refresh_lease", {
        target_connection_id: input.connectionId,
        ...cleanupArgs,
        claimed_lease_id: input.leaseId,
        new_encrypted_access_token: seal(cipher, input.tokens.accessToken),
        new_encrypted_refresh_token: seal(cipher, input.tokens.refreshToken),
        new_token_expires_at: input.tokens.expiresAt,
      });
      if (error || typeof data !== "boolean") throw new Error("Jira refresh could not be committed");
      return data;
    },
    async releaseRefreshLease(input) {
      const { data, error } = await database.rpc("release_jira_cleanup_refresh_lease", {
        target_connection_id: input.connectionId,
        ...cleanupArgs,
        claimed_lease_id: input.leaseId,
        safe_failure: input.failure,
      });
      if (error || typeof data !== "boolean") throw new Error("Jira refresh lease could not be released");
      return data;
    },
  };
}

function tokenIsFresh(credential: JiraAccessCredential, now: Date): boolean {
  const expiresAt = Date.parse(credential.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt - now.getTime() > minimumTokenTtlMs;
}

function providerFailure(error: unknown): { failure: JiraRefreshFailure; message: string } {
  if (error instanceof JiraProviderError) return { failure: error.code, message: error.message };
  return { failure: "unexpected_error", message: "Jira could not refresh the connection. Try again." };
}

async function winnerCredential(input: {
  store: JiraRefreshCredentialStore;
  connectionId: string;
  previousGeneration: number;
  now: Date;
}): Promise<string | null> {
  try {
    const latest = await input.store.readAccessCredential(input.connectionId);
    if (latest.generation > input.previousGeneration && tokenIsFresh(latest, input.now)) {
      return latest.accessToken;
    }
  } catch {
    // The fixed refresh-in-progress result below is safer than reflecting a
    // storage or decryption detail from a concurrent worker.
  }
  return null;
}

export async function getFreshJiraAccessToken(input: {
  connectionId: string;
  gateway: JiraOAuthGateway;
  store: JiraRefreshCredentialStore;
  now?: () => Date;
}): Promise<string> {
  requireUuid(input.connectionId, "Jira connection is invalid");
  const now = (input.now ?? (() => new Date()))();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Jira connection is invalid");

  let current: JiraAccessCredential;
  try {
    current = await input.store.readAccessCredential(input.connectionId);
  } catch {
    throw new Error("Jira credential could not be read");
  }
  if (tokenIsFresh(current, now)) return current.accessToken;

  let lease: JiraRefreshLease | null;
  try {
    lease = await input.store.claimRefreshLease(input.connectionId);
  } catch {
    throw new Error("Jira refresh could not be started");
  }
  if (!lease) {
    const winner = await winnerCredential({
      store: input.store,
      connectionId: input.connectionId,
      previousGeneration: current.generation,
      now,
    });
    if (winner) return winner;
    throw new Error("Jira refresh is already in progress. Try again shortly.");
  }

  let tokens: JiraOAuthTokens;
  try {
    tokens = await input.gateway.refreshAuthorization(lease.refreshToken);
  } catch (error) {
    const safe = providerFailure(error);
    try {
      await input.store.releaseRefreshLease({
        connectionId: input.connectionId,
        leaseId: lease.leaseId,
        failure: safe.failure,
      });
    } catch {
      // The provider failure remains the only user-visible error.
    }
    throw new Error(safe.message);
  }

  let committed: boolean;
  try {
    committed = await input.store.completeRefreshLease({
      connectionId: input.connectionId,
      leaseId: lease.leaseId,
      tokens,
    });
  } catch {
    throw new Error("Jira refresh could not be committed");
  }
  if (committed) return tokens.accessToken;

  const winner = await winnerCredential({
    store: input.store,
    connectionId: input.connectionId,
    previousGeneration: lease.generation,
    now,
  });
  if (winner) return winner;
  throw new Error("Jira refresh could not be committed");
}
