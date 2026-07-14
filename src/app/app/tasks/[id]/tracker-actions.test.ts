import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG_ID = "20000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000002";
const CONNECTION_ID = "20000000-0000-4000-8000-000000000003";
const TASK_ID = "20000000-0000-4000-8000-000000000004";

const hoisted = vi.hoisted(() => ({
  ctx: null as unknown,
  createTicket: vi.fn(),
  enforceRateLimit: vi.fn(),
  revalidatePath: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: hoisted.enforceRateLimit }));
vi.mock("@/lib/security/secrets", () => ({ decryptSecret: (value: string | null) => value }));
vi.mock("@/features/integrations/application/registry", () => ({
  resolveTicketProvider: hoisted.resolve,
}));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidatePath }));

import { pushTaskToTrackerAction } from "./tracker-actions";

function form() {
  const data = new FormData();
  data.set("taskId", TASK_ID);
  data.set("connectionId", CONNECTION_ID);
  return data;
}

function readableRow(row: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
  return chain;
}

describe("pushTaskToTrackerAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.resolve.mockReturnValue({ createTicket: hoisted.createTicket });
    hoisted.createTicket.mockResolvedValue({ externalId: "42", url: "https://example.test/42", status: "To Do" });
  });

  it("rejects Members before reading an operator-only connection", async () => {
    const from = vi.fn();
    hoisted.ctx = {
      supabase: { from }, user: { id: USER_ID }, organisation: { id: ORG_ID }, membership: { role: "member" },
    };

    await expect(pushTaskToTrackerAction(form())).rejects.toThrow("Only workspace operators can push tracker tickets");
    expect(from).not.toHaveBeenCalled();
  });

  it("uses only an enabled active-workspace connection and passes its broker reference", async () => {
    const connectionQuery = readableRow({
      id: CONNECTION_ID, provider: "github", config: { owner: "acme", repo: "isms" }, access_token: null,
      connection_mode: "oauth", broker_connection_id: "nango-1", broker_provider_config_key: "github-prod",
    });
    const taskQuery = readableRow({ id: TASK_ID, title: "Fix drift", detail: "Protect main", source: "monitoring", controls: { code: "A.8.32" } });
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn((table: string) => {
      if (table === "integration_connections") return connectionQuery;
      if (table === "tasks") return taskQuery;
      if (table === "task_tickets") return { insert };
      throw new Error(`Unexpected table ${table}`);
    });
    hoisted.ctx = {
      supabase: { from }, user: { id: USER_ID }, organisation: { id: ORG_ID }, membership: { role: "admin" },
    };

    await pushTaskToTrackerAction(form());

    expect(connectionQuery.select).toHaveBeenCalledWith(
      "id,provider,config,access_token,connection_mode,broker_connection_id,broker_provider_config_key",
    );
    expect(connectionQuery.eq).toHaveBeenCalledWith("organisation_id", ORG_ID);
    expect(connectionQuery.eq).toHaveBeenCalledWith("enabled", true);
    expect(hoisted.resolve).toHaveBeenCalledWith(expect.objectContaining({
      provider: "github", connectionMode: "oauth",
    }));
    expect(hoisted.createTicket).toHaveBeenCalledWith(expect.objectContaining({
      connectionMode: "oauth", brokerConnectionId: "nango-1", brokerProviderConfigKey: "github-prod",
    }), expect.anything());
  });
});
