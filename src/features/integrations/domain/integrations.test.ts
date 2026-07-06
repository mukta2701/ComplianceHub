import { describe, expect, it } from "vitest";
import { fakeTicketProvider } from "./provider";
import { buildTicketPayload, isTerminalTicketStatus, isTicketSyncDue, ticketStatusTone } from "./mapping";

const conn = { id: "c1", provider: "jira" as const, config: { projectKey: "ENG" }, accessToken: "t" };

describe("fakeTicketProvider round-trip", () => {
  it("creates a To Do ticket and fetches it as In Progress deterministically", async () => {
    const created = await fakeTicketProvider.createTicket(conn, { title: "Fix access reviews", body: "detail" });
    expect(created.externalId).toMatch(/^FAKE-/);
    expect(created.status).toBe("To Do");
    expect(created.url).toContain(created.externalId);
    const fetched = await fakeTicketProvider.fetchTicket(conn, created.externalId);
    expect(fetched.status).toBe("In Progress");
    expect(fetched.assignee).toBe("auto-bot");
  });
});

describe("buildTicketPayload", () => {
  it("pre-fills the title and a body from the task's fields", () => {
    const payload = buildTicketPayload({ title: "Rotate keys", detail: "Rotate the signing keys.", source: "audit", controlCode: "A.8.24" });
    expect(payload.title).toBe("Rotate keys");
    expect(payload.body).toContain("Rotate the signing keys.");
    expect(payload.body).toContain("A.8.24");
    expect(payload.body).toContain("ComplianceHub");
  });
});

describe("isTicketSyncDue", () => {
  it("is due when never synced or older than the window", () => {
    expect(isTicketSyncDue({ lastSyncedAt: null }, "2026-07-06T12:00:00Z")).toBe(true);
    expect(isTicketSyncDue({ lastSyncedAt: "2026-07-06T11:00:00Z" }, "2026-07-06T12:00:00Z")).toBe(true);
    expect(isTicketSyncDue({ lastSyncedAt: "2026-07-06T11:50:00Z" }, "2026-07-06T12:00:00Z")).toBe(false);
  });
});

describe("isTerminalTicketStatus", () => {
  it("is terminal for done/closed/resolved, case-insensitively", () => {
    expect(isTerminalTicketStatus("Done")).toBe(true);
    expect(isTerminalTicketStatus("Closed")).toBe(true);
    expect(isTerminalTicketStatus("Resolved")).toBe(true);
    expect(isTerminalTicketStatus("DONE")).toBe(true);
    expect(isTerminalTicketStatus("  resolved  ")).toBe(true);
  });
  it("is not terminal for open/in-flight or empty statuses", () => {
    expect(isTerminalTicketStatus("In Progress")).toBe(false);
    expect(isTerminalTicketStatus("To Do")).toBe(false);
    expect(isTerminalTicketStatus("In Review")).toBe(false);
    expect(isTerminalTicketStatus("")).toBe(false);
  });
  it("agrees with the green tone (single source of truth)", () => {
    for (const status of ["Done", "Closed", "Resolved", "In Progress", "To Do", ""]) {
      expect(isTerminalTicketStatus(status)).toBe(ticketStatusTone(status) === "green");
    }
  });
});

describe("ticketStatusTone", () => {
  it("maps common tracker statuses to design tones", () => {
    expect(ticketStatusTone("Done")).toBe("green");
    expect(ticketStatusTone("In Progress")).toBe("amber");
    expect(ticketStatusTone("To Do")).toBe("neutral");
    expect(ticketStatusTone("something else")).toBe("blue");
  });
});
