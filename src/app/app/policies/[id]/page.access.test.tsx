import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const POLICY_ID = "78000000-0000-4000-8000-000000000001";
const USER_ID = "78000000-0000-4000-8000-000000000002";

const hoisted = vi.hoisted(() => ({ ctx: null as unknown }));

vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("not found"); }) }));

import PolicyDetailPage from "./page";

function query<T>(result: T) {
  const promise = Promise.resolve(result);
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    maybeSingle: vi.fn(() => promise),
    then: promise.then.bind(promise),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  return builder;
}

function contextFor(role: "owner" | "admin" | "member") {
  const results = {
    policies: query({
      data: {
        id: POLICY_ID, reference: "POL-001", title: "Security policy", body: "Approved policy text",
        version: 3, status: "approved", review_due: null, owner_id: null,
      },
      error: null,
    }),
    policy_acceptances: query({
      data: role === "member" ? [] : [{ user_id: USER_ID, accepted_version: 3 }],
      error: null,
    }),
    memberships: query({
      data: [{ user_id: USER_ID, profiles: { display_name: "Alex Member" } }],
      error: null,
    }),
    evidence_links: query({
      data: [{ id: "link-1", evidence: { id: "evidence-1", title: "SOC 2 report" } }],
      error: null,
    }),
    evidence: query({ data: [{ id: "evidence-1", title: "SOC 2 report" }], error: null }),
    policy_feedback_threads: query({
      data: [{
        id: "feedback-1", subject: "Clarify contractors", status: "open", policy_version: 3,
        created_at: "2026-07-14T08:00:00Z", resolved_at: null,
        author: { display_name: "Alex Member" }, resolver: null,
        comments: [{ id: "comment-1", body: "Does this include contractors?", created_at: "2026-07-14T08:00:00Z", author: { display_name: "Alex Member" } }],
      }],
      error: null,
    }),
  };
  const from = vi.fn((table: keyof typeof results) => results[table]);
  hoisted.ctx = {
    supabase: { from }, user: { id: USER_ID }, membership: { role },
    organisation: { id: "78000000-0000-4000-8000-000000000003" },
  };
  return { from, results };
}

describe("policy detail role presentation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows Members only their personal acceptance and read-only policy evidence", async () => {
    const { from, results } = contextFor("member");

    render(await PolicyDetailPage({ params: Promise.resolve({ id: POLICY_ID }) }));

    expect(screen.getByText("Review the current version and record your own acceptance below.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I accept this policy" })).toBeInTheDocument();
    expect(screen.getByText("SOC 2 report")).toBeInTheDocument();
    expect(screen.queryByText(/members have accepted version/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Edit policy")).not.toBeInTheDocument();
    expect(screen.queryByText("Approval")).not.toBeInTheDocument();
    expect(screen.queryByText("Acceptance roster")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove evidence link" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Link" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Policy feedback" })).toBeInTheDocument();
    expect(screen.getByText("Does this include contractors?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start feedback" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reply" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resolve" })).not.toBeInTheDocument();
    expect(from).not.toHaveBeenCalledWith("memberships");
    expect(from).not.toHaveBeenCalledWith("evidence");
    expect(results.policies.eq).toHaveBeenCalledWith("organisation_id", "78000000-0000-4000-8000-000000000003");
    expect(results.policy_acceptances.eq).toHaveBeenCalledWith("organisation_id", "78000000-0000-4000-8000-000000000003");
    expect(results.evidence_links.eq).toHaveBeenCalledWith("organisation_id", "78000000-0000-4000-8000-000000000003");
    expect(results.policy_feedback_threads.eq).toHaveBeenCalledWith("organisation_id", "78000000-0000-4000-8000-000000000003");
  });

  it("shows Admins organisation reporting and policy management controls", async () => {
    contextFor("admin");

    render(await PolicyDetailPage({ params: Promise.resolve({ id: POLICY_ID }) }));

    expect(screen.getByText(/1 of 1 members have accepted version 3/i)).toBeInTheDocument();
    expect(screen.getByText("Edit policy")).toBeInTheDocument();
    expect(screen.getByText("Approval")).toBeInTheDocument();
    expect(screen.getByText("Acceptance roster")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove evidence link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resolve" })).toBeInTheDocument();
  });
});
