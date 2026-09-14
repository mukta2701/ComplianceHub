import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  ctx: null as unknown,
  enforceRateLimit: vi.fn(),
  provider: vi.fn(),
  generate: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: hoisted.enforceRateLimit }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: vi.fn() }));
vi.mock("@/features/integrations/application/evidence-registry", () => ({ resolveEvidenceProvider: vi.fn() }));
vi.mock("@/features/automation/application/collector-persistence", () => ({ automationConnectionId: vi.fn(), persistCollectedAutomation: vi.fn(), recordCollectionHealth: vi.fn() }));
vi.mock("@/features/automation/domain/retention", () => ({ purgeContentReference: vi.fn(), shouldPurgeSourceObject: vi.fn() }));
vi.mock("@/features/ai/application/openai-compatible", () => ({ configuredAiProvider: hoisted.provider }));
vi.mock("@/features/ai/application/suggestion", () => ({ generateAiSuggestion: hoisted.generate }));
vi.mock("@/features/ai/domain/context", () => ({ buildAutomationProposalAiContext: vi.fn() }));
vi.mock("@/lib/security/secrets", () => ({ decryptSecret: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidatePath }));

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  generateAutomationExplanationAction,
  reviewAutomationProposalAction,
  revokeAutomationConnectionAction,
} from "./actions";

const organisation = { id: "00000000-0000-4000-8000-000000000001" };
const user = { id: "00000000-0000-4000-8000-000000000002" };
const proposal = {
  id: "00000000-0000-4000-8000-000000000099",
  status: "accepted",
  assigned_to: user.id,
  target_type: "evidence",
  output: { title: "Reviewed draft", confidence: "high" },
  automation_signals: { id: "signal-1", signal_type: "test", summary: "Reviewed" },
};

function supabaseForProposal(status = proposal.status) {
  const currentProposal = { ...proposal, status };
  return {
    from(table: string) {
      const filters = new Map<string, unknown>();
      const builder: Record<string, unknown> = {
        select() { return builder; },
        eq(column: string, value: unknown) { filters.set(column, value); return builder; },
        limit() { return builder; },
        maybeSingle() {
          if (table === "ai_workspace_settings") return Promise.resolve({ data: { enabled: true }, error: null });
          if (table === "automation_proposals") {
            const matches = filters.get("id") === proposal.id
              && filters.get("organisation_id") === organisation.id
              && filters.get("assigned_to") === currentProposal.assigned_to
              && (!filters.has("status") || filters.get("status") === currentProposal.status);
            return Promise.resolve({ data: matches ? currentProposal : null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return builder;
    },
    rpc: vi.fn().mockResolvedValue({ error: null }),
  };
}

function formData(id = proposal.id) {
  const form = new FormData();
  form.set("id", id);
  return form;
}

describe("generateAutomationExplanationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.ctx = { supabase: supabaseForProposal(), user, organisation };
    hoisted.provider.mockReturnValue({ generate: vi.fn() });
  });

  it("rejects reviewed proposals before generating or saving AI content", async () => {
    await expect(generateAutomationExplanationAction(formData())).rejects.toThrow("Automation draft not found");
    expect(hoisted.generate).not.toHaveBeenCalled();
    expect(hoisted.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not expose malformed provider configuration through the server action", async () => {
    hoisted.provider.mockImplementation(() => { throw new Error("provider URL is invalid"); });
    await expect(generateAutomationExplanationAction(formData())).rejects.toThrow("AI assistance is not configured");
  });
});

describe("reviewAutomationProposalAction workspace boundary", () => {
  it("does not review a proposal from a sibling organisation", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    hoisted.ctx = { supabase: { ...supabaseForProposal(), rpc }, user, organisation };
    const form = formData("00000000-0000-4000-8000-000000000098");
    form.set("decision", "accepted");

    await expect(reviewAutomationProposalAction(form)).rejects.toThrow("Automation draft not found");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not expose internal RPC details when review fails", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: "internal review policy detail" } });
    hoisted.ctx = { supabase: { ...supabaseForProposal("draft"), rpc }, user, organisation };
    const form = formData();
    form.set("decision", "accepted");

    await expect(reviewAutomationProposalAction(form)).rejects.toThrow("Could not review automation draft");
  });

  it("does not replay a proposal that is no longer a draft", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    hoisted.ctx = { supabase: { ...supabaseForProposal(), rpc }, user, organisation };
    const form = formData();
    form.set("decision", "accepted");

    await expect(reviewAutomationProposalAction(form)).rejects.toThrow("Automation draft not found");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("revokeAutomationConnectionAction workspace boundary", () => {
  it("keeps the active organisation predicate on the connector mutation", async () => {
    const connectorUpdateFilters: [string, unknown][] = [];
    const builder = (table: string) => {
      let updating = false;
      const chain: Record<string, unknown> = {
        select() { return chain; },
        update() { updating = true; return chain; },
        eq(column: string, value: unknown) {
          if (table === "connector_connections" && updating) {
            connectorUpdateFilters.push([column, value]);
          }
          return chain;
        },
        contains() { return chain; },
        neq() { return chain; },
        maybeSingle() { return Promise.resolve({ data: { id: "connection-1" }, error: null }); },
        then(onfulfilled: (value: { data: unknown[]; error: null }) => unknown) {
          return Promise.resolve(onfulfilled({ data: [], error: null }));
        },
      };
      return chain;
    };
    const supabase = {
      from(table: string) {
        if (table === "connector_connections") {
          const chain = builder(table);
          const originalEq = chain.eq as (column: string, value: unknown) => unknown;
          chain.eq = (column: string, value: unknown) => {
            return originalEq(column, value);
          };
          return chain;
        }
        return builder(table);
      },
    };
    const service = { from: (table: string) => builder(table) };
    vi.mocked(createSupabaseServiceClient).mockReturnValue(service as never);
    hoisted.ctx = { supabase, user, organisation, membership: { role: "owner" } };

    const form = formData("connection-1");
    await revokeAutomationConnectionAction(form);

    expect(connectorUpdateFilters).toContainEqual(["organisation_id", organisation.id]);
  });
});
