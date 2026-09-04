import { beforeEach, describe, expect, it, vi } from "vitest";

const ORGANISATION_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000002";
const AUDIT_ID = "30000000-0000-4000-8000-000000000003";
const ITEM_ID = "40000000-0000-4000-8000-000000000004";
const FINDING_ID = "50000000-0000-4000-8000-000000000005";

const hoisted = vi.hoisted(() => ({
  ctx: null as unknown,
  enforceRateLimit: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: hoisted.enforceRateLimit }));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidatePath }));

import {
  linkChecklistEvidenceAction,
  raiseFindingAction,
  updateChecklistItemAction,
  updateFindingStatusAction,
} from "./actions";

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

function updateClient() {
  const eqCalls: Array<[string, unknown]> = [];
  const builder = {
    eq: vi.fn((column: string, value: unknown) => {
      eqCalls.push([column, value]);
      return builder;
    }),
    select: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve({ data: { id: FINDING_ID }, error: null })),
    then: (resolve: (value: { data: { id: string }; error: null }) => unknown) => Promise.resolve(resolve({ data: { id: FINDING_ID }, error: null })),
  };
  const update = vi.fn(() => builder);
  const from = vi.fn(() => ({ update }));
  return { from, update, eqCalls };
}

function checklistOwnershipClient() {
  const checklistLookup = {
    select: vi.fn(() => checklistLookup),
    eq: vi.fn(() => checklistLookup),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  const findingInsert = vi.fn();
  const evidenceInsert = vi.fn();
  const rpc = vi.fn().mockResolvedValue({ data: FINDING_ID, error: null });
  findingInsert.mockReturnValue({
    select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { id: FINDING_ID }, error: null }) })),
  });
  evidenceInsert.mockResolvedValue({ error: null });
  const from = vi.fn((table: string) => {
    if (table === "audit_checklist_items") return checklistLookup;
    if (table === "audit_findings") return { insert: findingInsert };
    return { insert: evidenceInsert };
  });
  return { from, rpc, checklistLookup, findingInsert, evidenceInsert };
}

describe("audit mutation object scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.enforceRateLimit.mockResolvedValue(undefined);
    hoisted.ctx = {
      supabase: null,
      user: { id: USER_ID },
      organisation: { id: ORGANISATION_ID },
      membership: { role: "owner" },
    };
  });

  it("scopes checklist-item updates to the selected audit", async () => {
    const client = updateClient();
    (hoisted.ctx as { supabase: unknown }).supabase = client;

    await expect(updateChecklistItemAction(form({
      id: ITEM_ID,
      auditId: AUDIT_ID,
      compliant: "compliant",
      evidenceNote: "Evidence reviewed",
      findings: "",
    }))).resolves.toBeUndefined();

    expect(client.eqCalls).toEqual([
      ["id", ITEM_ID],
      ["organisation_id", ORGANISATION_ID],
      ["audit_id", AUDIT_ID],
    ]);
  });

  it("scopes finding-status updates to the selected audit", async () => {
    const client = updateClient();
    (hoisted.ctx as { supabase: unknown }).supabase = client;

    await expect(updateFindingStatusAction(form({
      id: FINDING_ID,
      auditId: AUDIT_ID,
      status: "closed",
    }))).resolves.toBeUndefined();

    expect(client.eqCalls).toEqual([
      ["id", FINDING_ID],
      ["organisation_id", ORGANISATION_ID],
      ["audit_id", AUDIT_ID],
    ]);
  });

  it("rejects a finding that names a checklist item from another audit", async () => {
    const client = checklistOwnershipClient();
    (hoisted.ctx as { supabase: unknown }).supabase = client;

    await expect(raiseFindingAction(form({
      auditId: AUDIT_ID,
      checklistItemId: ITEM_ID,
      summary: "Wrong-audit finding",
      severity: "observation",
      rootCause: "",
      correctiveAction: "",
      ownerId: "",
      dueOn: "",
      spawnTask: "",
    }))).rejects.toThrow("Could not find that checklist item");

    expect(client.checklistLookup.eq).toHaveBeenCalledWith("audit_id", AUDIT_ID);
    expect(client.checklistLookup.eq).toHaveBeenCalledWith("organisation_id", ORGANISATION_ID);
    expect(client.findingInsert).not.toHaveBeenCalled();
  });

  it("rejects Members before any audit mutation", async () => {
    const client = checklistOwnershipClient();
    (hoisted.ctx as { supabase: unknown; membership: unknown }).supabase = client;
    (hoisted.ctx as { membership: unknown }).membership = { role: "member" };
    await expect(raiseFindingAction(form({ auditId: AUDIT_ID, summary: "Denied", severity: "observation", rootCause: "", correctiveAction: "", ownerId: "", dueOn: "", spawnTask: "" }))).rejects.toThrow("Only workspace operators can modify audits");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("raises a finding and optional corrective task through the atomic RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: FINDING_ID, error: null });
    (hoisted.ctx as { supabase: unknown }).supabase = { rpc };
    await expect(raiseFindingAction(form({ auditId: AUDIT_ID, summary: "Missing evidence", severity: "minor_nc", rootCause: "Process gap", correctiveAction: "Collect evidence", ownerId: USER_ID, dueOn: "2026-10-01", spawnTask: "on" }))).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("raise_finding_with_task", expect.objectContaining({ target_organisation_id: ORGANISATION_ID, finding_input: expect.objectContaining({ audit_id: AUDIT_ID, owner_id: USER_ID, due_on: "2026-10-01", spawn_task: true }) }));
  });

  it("surfaces an atomic RPC failure without attempting partial writes", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: new Error("db failure") });
    (hoisted.ctx as { supabase: unknown }).supabase = { rpc };
    await expect(raiseFindingAction(form({ auditId: AUDIT_ID, summary: "Failure", severity: "observation", rootCause: "", correctiveAction: "", ownerId: "", dueOn: "", spawnTask: "" }))).rejects.toThrow("Could not raise the finding");
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("rejects evidence links to a checklist item from another audit", async () => {
    const client = checklistOwnershipClient();
    (hoisted.ctx as { supabase: unknown }).supabase = client;

    await expect(linkChecklistEvidenceAction(form({
      auditId: AUDIT_ID,
      evidenceId: "60000000-0000-4000-8000-000000000006",
      checklistItemId: ITEM_ID,
    }))).rejects.toThrow("Could not find that checklist item");

    expect(client.checklistLookup.eq).toHaveBeenCalledWith("audit_id", AUDIT_ID);
    expect(client.checklistLookup.eq).toHaveBeenCalledWith("organisation_id", ORGANISATION_ID);
    expect(client.evidenceInsert).not.toHaveBeenCalled();
  });
});
