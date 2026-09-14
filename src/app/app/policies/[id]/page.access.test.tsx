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
    range: vi.fn((from: number, to: number) => promise.then((value) => { const row = value as {data?: unknown[]}; return { ...value, data: Array.isArray(row.data) ? row.data.slice(from, to + 1) : row.data }; })),
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

function contextFor(role: "owner" | "admin" | "member", policyStatus: "draft" | "in_review" | "approved" | "archived" = "approved", hasAccepted = role !== "member") {
  const results = {
    policies: query({
      data: {
        id: POLICY_ID, reference: "POL-001", title: "Security policy", body: "Approved policy text",
        version: 3, edit_revision: 7, status: policyStatus, review_due: null, owner_id: null as string | null,
      },
      error: null,
    }),
    policy_acceptances: query({
      data: hasAccepted ? [{ user_id: USER_ID, accepted_version: 3 }] : [],
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
    evidence: query({ data: [{ id: "evidence-1", title: "SOC 2 report" }, { id: "evidence-2", title: "Access review" }], error: null }),
    policy_feedback_comments: query({ data: [{ id: "comment-1", thread_id: "feedback-1", body: "Does this include contractors?", created_at: "2026-07-14T08:00:00Z", author: { display_name: "Alex Member" } }], error: null }),
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

  it("shows completed personal acceptance without asking the employee to repeat it", async () => {
    contextFor("member", "approved", true);
    render(await PolicyDetailPage({ params: Promise.resolve({ id: POLICY_ID }) }));
    expect(screen.getByText("Accepted version 3")).toBeInTheDocument();
    expect(screen.queryByText("Review the current version and record your own acceptance below.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I accept this policy" })).not.toBeInTheDocument();
  });

  it("shows the current policy owner and an explicit unassigned option in the edit form", async () => {
    const { results } = contextFor("admin");
    results.policies.maybeSingle.mockResolvedValueOnce({ data: {
      id: POLICY_ID, reference: "POL-001", title: "Security policy", body: "Approved policy text",
      version: 3, edit_revision: 7, status: "approved", review_due: null, owner_id: USER_ID,
    }, error: null });

    render(await PolicyDetailPage({ params: Promise.resolve({ id: POLICY_ID }) }));

    expect(screen.getByLabelText("Policy owner")).toHaveValue(USER_ID);
    expect(screen.getByRole("option", { name: "Unassigned", hidden: true })).toHaveValue("");
  });

  it.each(["draft", "in_review", "archived"] as const)("does not offer acceptance before approval when a policy is %s", async (status) => {
    contextFor("admin", status, false);

    render(await PolicyDetailPage({ params: Promise.resolve({ id: POLICY_ID }) }));

    expect(screen.queryByRole("button", { name: "I accept this policy" })).not.toBeInTheDocument();
    expect(screen.queryByText(/outstanding/i)).not.toBeInTheDocument();
    expect(screen.getByText("Personal acceptance is available only while this policy is approved. Previous acceptances remain on record.")).toBeInTheDocument();
  });

  it("preserves historical acceptance without implying that a withdrawn policy is approved", async () => {
    contextFor("admin", "draft");

    render(await PolicyDetailPage({ params: Promise.resolve({ id: POLICY_ID }) }));

    expect(screen.getByText("Accepted version 3")).toBeInTheDocument();
    expect(screen.getByText("Your earlier acceptance is preserved; this policy is not currently approved.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I accept this policy" })).not.toBeInTheDocument();
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

  it("keeps historical feedback management visible but disables collaboration on a non-approved policy", async () => {
    contextFor("admin", "draft");

    render(await PolicyDetailPage({ params: Promise.resolve({ id: POLICY_ID }) }));

    expect(screen.getByRole("heading", { name: "Policy feedback" })).toBeInTheDocument();
    expect(screen.getByText("Does this include contractors?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resolve" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start feedback" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reply" })).not.toBeInTheDocument();
    expect(screen.getByText(/Feedback opens after this policy is approved/i)).toBeInTheDocument();
  });
  it("places readable content before acceptance and binds the accepted version", async () => {
    contextFor("member", "approved", false);
    render(await PolicyDetailPage({ params: Promise.resolve({ id: POLICY_ID }) }));
    const document = screen.getByText("Approved policy text");
    const accept = screen.getByRole("button", { name: "I accept this policy" });
    expect(document.compareDocumentPosition(accept) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(accept.closest("form")?.querySelector('[name="expectedVersion"]')).toHaveValue("3");
    expect(screen.getByText("SOC 2 report")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "SOC 2 report" })).not.toBeInTheDocument();
  });

});
