import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  enforceRateLimit: vi.fn(),
  createServiceClient: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: hoisted.enforceRateLimit }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: hoisted.createServiceClient }));
vi.mock("@/lib/observability/logger", () => ({ logError: hoisted.logError }));

const context = {
  organisationId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  resource: "risks" as const,
  format: "csv" as const,
};

describe("export protection and audit", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    hoisted.enforceRateLimit.mockResolvedValue(undefined);
    hoisted.createServiceClient.mockReturnValue({
      from: vi.fn(() => ({ insert: vi.fn().mockResolvedValue({ error: null }) })),
    });
  });

  it("rate limits exports by active workspace and user", async () => {
    const { protectExport } = await import("./export-audit");

    await protectExport(context);

    expect(hoisted.enforceRateLimit).toHaveBeenCalledWith(
      `export:${context.organisationId}:${context.userId}`,
      { limit: 30, windowMs: 60_000 },
    );
  });

  it("records a durable audit event without exposing export contents", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    hoisted.createServiceClient.mockReturnValue({ from: vi.fn(() => ({ insert })) });
    const { recordExportAudit } = await import("./export-audit");

    await recordExportAudit(context);

    expect(insert).toHaveBeenCalledWith({
      organisation_id: context.organisationId,
      actor_id: context.userId,
      action: "export",
      entity_type: "export",
      entity_id: `export:${context.resource}:${context.format}`,
      metadata: { resource: context.resource, format: context.format },
    });
  });

  it("does not turn an audit-store outage into an export failure", async () => {
    hoisted.createServiceClient.mockImplementation(() => { throw new Error("secret store detail"); });
    const { recordExportAudit } = await import("./export-audit");

    await expect(recordExportAudit(context)).resolves.toBeUndefined();
    expect(hoisted.logError).toHaveBeenCalledWith(
      "action",
      "export audit event unavailable",
      expect.any(Error),
      expect.objectContaining({ organisationId: context.organisationId, resource: context.resource }),
    );
  });

  it("normalizes a structured Supabase insert error for observability", async () => {
    hoisted.createServiceClient.mockReturnValue({
      from: vi.fn(() => ({ insert: vi.fn().mockResolvedValue({ error: { message: "permission denied", code: "42501" } }) })),
    });
    const { recordExportAudit } = await import("./export-audit");

    await recordExportAudit(context);

    expect(hoisted.logError).toHaveBeenCalledWith(
      "action",
      "export audit event unavailable",
      expect.objectContaining({ message: "permission denied" }),
      expect.objectContaining({ organisationId: context.organisationId }),
    );
  });
});
