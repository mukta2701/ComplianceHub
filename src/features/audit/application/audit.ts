const sensitiveKeys = new Set(["password", "token", "token_hash", "secret", "evidence", "evidence_note", "authorization"]);

type SafeValue = string | number | boolean | null | SafeValue[] | { [key: string]: SafeValue };

function sanitise(value: unknown): SafeValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(sanitise).filter((item): item is SafeValue => item !== undefined);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !sensitiveKeys.has(key.toLowerCase()))
      .map(([key, child]) => [key, sanitise(child)]).filter((entry) => entry[1] !== undefined)) as { [key: string]: SafeValue };
  }
  return undefined;
}

export type AuditEvent = {
  organisationId: string; actorId: string; action: string; entityType: string; entityId: string;
  metadata?: Record<string, unknown>;
};

export async function recordAuditEvent(event: AuditEvent, adapter: { insert: (event: AuditEvent & { metadata: Record<string, SafeValue> }) => Promise<void> }) {
  const metadata = (sanitise(event.metadata ?? {}) ?? {}) as Record<string, SafeValue>;
  await adapter.insert({ ...event, metadata });
}
