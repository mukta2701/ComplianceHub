import { describe, expect, it } from "vitest";
import { persistCollectedAutomation } from "./collector-persistence";

type State = {
  proposalPresent: boolean;
  failFirstProposalInsert: boolean;
  failFirstLinkInsert: boolean;
  linkPresent: boolean;
  proposalInserts: number;
  linkInserts: number;
  signalInserts: number;
};

function makeSupabase(state: State) {
  const responses = {
    connector_connections: { id: "connection-1", owner_id: "owner-1", retention_days: 30, status: "connected" },
    source_objects: { id: "source-1" },
    automation_signals: { id: "signal-1" },
    automation_assignments: { owner_id: null },
  } as const;

  function resolve(table: string, mode: "select" | "insert" | "update", terminal: "single" | "maybeSingle" | "await") {
    if (table === "connector_connections" && mode === "select" && terminal === "maybeSingle") return Promise.resolve({ data: responses.connector_connections, error: null });
    if (table === "source_objects" && mode === "select" && terminal === "maybeSingle") return Promise.resolve({ data: responses.source_objects, error: null });
    if (table === "automation_signals" && mode === "select" && terminal === "maybeSingle") return Promise.resolve({ data: responses.automation_signals, error: null });
    if (table === "automation_assignments" && mode === "select" && terminal === "maybeSingle") return Promise.resolve({ data: responses.automation_assignments, error: null });
    if (table === "automation_proposals" && mode === "select" && terminal === "maybeSingle") return Promise.resolve({ data: state.proposalPresent ? { id: "proposal-1" } : null, error: null });
    if (table === "automation_proposal_sources" && mode === "select" && terminal === "maybeSingle") return Promise.resolve({ data: state.linkPresent ? { proposal_id: "proposal-1" } : null, error: null });
    if (table === "automation_proposals" && mode === "insert" && terminal === "single") {
      state.proposalInserts += 1;
      if (state.failFirstProposalInsert) {
        state.failFirstProposalInsert = false;
        return Promise.resolve({ data: null, error: new Error("simulated proposal write failure") });
      }
      state.proposalPresent = true;
      return Promise.resolve({ data: { id: "proposal-1" }, error: null });
    }
    if (table === "automation_proposal_sources" && mode === "insert" && terminal === "await") {
      state.linkInserts += 1;
      if (state.failFirstLinkInsert) {
        state.failFirstLinkInsert = false;
        state.linkPresent = true;
        return Promise.resolve({ error: { code: "23505", message: "simulated concurrent link write" } });
      }
      state.linkPresent = true;
      return Promise.resolve({ error: null });
    }
    if (table === "automation_signals" && mode === "insert" && terminal === "single") {
      state.signalInserts += 1;
      return Promise.resolve({ data: { id: "signal-1" }, error: null });
    }
    if (table === "connector_connections" && mode === "update" && terminal === "await") return Promise.resolve({ error: null });
    throw new Error(`unexpected ${table} ${mode} ${terminal}`);
  }

  return {
    from(table: string) {
      let mode: "select" | "insert" | "update" = "select";
      const builder: Record<string, unknown> = {
        select() { return builder; },
        eq() { return builder; },
        limit() { return builder; },
        insert() { mode = "insert"; return builder; },
        update() { mode = "update"; return builder; },
        maybeSingle() { return resolve(table, mode, "maybeSingle"); },
        single() { return resolve(table, mode, "single"); },
        then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          return resolve(table, mode, "await").then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
  } as never;
}

describe("automation collector persistence recovery", () => {
  it("retries a missing proposal and source link after a partial proposal write", async () => {
    const state: State = { proposalPresent: false, failFirstProposalInsert: true, failFirstLinkInsert: false, linkPresent: false, proposalInserts: 0, linkInserts: 0, signalInserts: 0 };
    const supabase = makeSupabase(state);
    const input = {
      supabase,
      organisationId: "org-1",
      provider: "github" as const,
      config: { automationConnectionId: "11111111-1111-4111-8111-111111111111" },
      collected: {
        externalRef: "repo:acme/app:branches",
        title: "Branch protection settings",
        kind: "link" as const,
        url: "https://github.example/acme/app/settings/branches",
        collectedOn: "2026-07-10",
        validUntil: "2026-08-09",
      },
    };

    await expect(persistCollectedAutomation(input)).rejects.toThrow("simulated proposal write failure");
    await expect(persistCollectedAutomation(input)).resolves.toBe(true);
    expect(state.signalInserts).toBe(0);
    expect(state.proposalInserts).toBe(2);
    expect(state.linkInserts).toBe(1);
    expect(state.linkPresent).toBe(true);
  });

  it("does not report a change when a concurrent worker creates the missing source link", async () => {
    const state: State = { proposalPresent: true, failFirstProposalInsert: false, failFirstLinkInsert: true, linkPresent: false, proposalInserts: 0, linkInserts: 0, signalInserts: 0 };
    const supabase = makeSupabase(state);
    const input = {
      supabase,
      organisationId: "org-1",
      provider: "github" as const,
      config: { automationConnectionId: "11111111-1111-4111-8111-111111111111" },
      collected: {
        externalRef: "repo:acme/app:branches",
        title: "Branch protection settings",
        kind: "link" as const,
        url: "https://github.example/acme/app/settings/branches",
        collectedOn: "2026-07-10",
        validUntil: "2026-08-09",
      },
    };

    await expect(persistCollectedAutomation(input)).resolves.toBe(false);
    expect(state.linkInserts).toBe(1);
    expect(state.linkPresent).toBe(true);
  });
});
