import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "member", connectionRows: [] as unknown[], sourceRows: [] as unknown[], errors: {} as Record<string, Error> }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/app-context", () => ({ requireAppContext: async () => ({
  membership: { role: state.role }, user: { id: "reviewer" }, organisation: { id: "workspace" },
  supabase: { from: (table: string) => {
    const data = table === "connector_connections" ? state.connectionRows : table === "evidence_sources" ? state.sourceRows : table === "automation_proposals" ? [{
      id: "proposal", target_type: "evidence", assigned_to: "reviewer", status: "draft",
      output: { title: "Review access evidence", why: "A source prepared this evidence" },
      created_at: "2026-09-04T00:00:00Z", source_references: [],
      automation_proposal_sources: [{ source_objects: { title: "Access review source", source_url: "https://example.test/access", external_ref: "workspace/access-review", observation_key: "observation-1", collected_on: "2026-09-04" } }],
    }] : [];
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "limit", "is", "contains"]) chain[method] = () => chain;
    chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: state.errors[table] ?? null }).then(resolve);
    return chain;
  } },
}) }));
import AutomationPage from "./page";

beforeEach(() => { state.role = "member"; state.connectionRows = []; state.sourceRows = []; state.errors = {}; });
describe("automation baseline permissions", () => {
  it.each(["member", "admin"])("hides owner-only baseline generation for %s without hiding assigned reviews", async (role) => {
    state.role = role;
    render(await AutomationPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByRole("button", { name: "Generate baseline" })).not.toBeInTheDocument();
    expect(screen.getByText("Review access evidence")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept as evidence" })).toBeInTheDocument();
  });
  it("preserves baseline generation for an Owner", async () => {
    state.role = "owner";
    state.sourceRows = [{ config: { automationConnectionId: "00000000-0000-4000-8000-000000000001" }, revoked_at: null }];
    render(await AutomationPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("button", { name: "Generate baseline" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept as evidence" })).toBeInTheDocument();
  });

  it("reports connection read failures instead of showing a fake empty state", async () => {
    state.errors.connector_connections = new Error("connection read failed");
    render(await AutomationPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("alert")).toHaveTextContent(/could not load automation status/i);
    expect(screen.queryByText("No automation systems are configured yet.")).not.toBeInTheDocument();
  });

  it("shows lifecycle state and collection timestamp, and labels the runtime mode", async () => {
    state.connectionRows = [
      { id: "revoked", provider: "github", label: "Revoked GitHub", status: "revoked", last_collected_at: null, last_error_at: null },
      { id: "pending", provider: "jira", label: "Pending Jira", status: "setup", last_collected_at: null, last_error_at: null },
      { id: "error", provider: "aws", label: "AWS", status: "error", last_collected_at: "2026-09-04T00:00:00Z", last_error_at: "2026-09-05T00:00:00Z" },
    ];
    render(await AutomationPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(/Fictional sandbox collection.*does not contact providers/i)).toBeInTheDocument();
    expect(screen.getByText("Revoked GitHub")).toBeInTheDocument();
    expect(screen.getByText(/Connection revoked; reconnect/i)).toBeInTheDocument();
    expect(screen.getByText("Pending Jira")).toBeInTheDocument();
    expect(screen.getByText(/Pending setup; collection is not ready/i)).toBeInTheDocument();
    expect(screen.getByText("AWS")).toBeInTheDocument();
    expect(screen.getByText(/Collection error; needs attention/i)).toBeInTheDocument();
    expect(screen.getByText(/Last collected 04 Sep 2026/i)).toBeInTheDocument();
  });

  it("shows the keyed collection date and resource reference for an automation draft", async () => {
    render(await AutomationPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Collected 04 Sep 2026")).toBeInTheDocument();
    expect(screen.getByText("Resource: workspace/access-review")).toBeInTheDocument();
  });

  it("does not offer baseline generation when no runnable source is configured", async () => {
    state.role = "owner";
    render(await AutomationPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByRole("button", { name: "Generate baseline" })).not.toBeInTheDocument();
    expect(screen.getByText(/Configure an automation source before running a baseline/i)).toBeInTheDocument();
  });
});


describe("automation task draft permissions", () => {
  it("keeps assigned Member evidence review but hides direct task creation", async () => {
    render(await AutomationPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("button", { name: "Accept as evidence" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create task draft" })).not.toBeInTheDocument();
  });
  it.each(["owner", "admin"])("preserves assigned task drafting for %s", async (role) => {
    state.role = role;
    render(await AutomationPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("button", { name: "Create task draft" })).toBeInTheDocument();
  });
});
