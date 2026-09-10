import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { controlReviewFixture, finaliseControlReviewFixture } from "@/test/control-review-fixture";
const state = vi.hoisted(() => ({ fixture: null as ReturnType<typeof controlReviewFixture> | null, role: "owner" }));
vi.mock("@/lib/app-context", () => ({ requireAppContext: async () => ({ supabase: state.fixture!.client, organisation: { id: "org" }, user: { id: "member" }, membership: { role: state.role } }) }));
vi.mock("../../actions", () => ({ finaliseSoaAction: vi.fn(), reviewSoaItemAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), notFound: () => { throw new Error("not found"); } }));
import SoaReviewPage from "./page";

describe("control review page loading", () => {
  beforeEach(() => { state.fixture = controlReviewFixture(); state.role = "owner"; });
  it("shows the source identity and current recorded revision without treating a draft assessment as complete", async () => {
    render(await SoaReviewPage({ params: Promise.resolve({ id: "register" }) }));
    expect(screen.getByRole("link", { name: "Recorded practices" })).toHaveAttribute("href", "/app/assessment/assessment");
    expect(screen.getByText(/Current assessment context.*revision 7/i)).toBeInTheDocument();
    expect(screen.getByText(/This assessment is incomplete/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Finalise immutable/ })).toBeInTheDocument();
  });
  it("shows Could not verify and no finalisation button when essential evidence is unavailable", async () => {
    state.fixture!.failures.add("evidence_links");
    render(await SoaReviewPage({ params: Promise.resolve({ id: "register" }) }));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not verify");
    expect(screen.queryByRole("button", { name: /Finalise/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/private database/)).not.toBeInTheDocument();
  });
  it("identifies unavailable history while retaining the review", async () => {
    state.fixture!.failures.add("audit_events");
    render(await SoaReviewPage({ params: Promise.resolve({ id: "register" }) }));
    expect(screen.getByRole("status")).toHaveTextContent("Audit history");
    expect(screen.getByRole("heading", { name: "Annual control review" })).toBeInTheDocument();
  });
  it("keeps members read-only", async () => {
    state.role = "member";
    render(await SoaReviewPage({ params: Promise.resolve({ id: "register" }) }));
    expect(screen.queryByRole("button", { name: /Finalise/ })).not.toBeInTheDocument();
  });
  it("states every exact finalisation blocker without requiring an owner for exclusions", async () => {
    const first = state.fixture!.tables.soa_items[1];
    Object.assign(first, { applicable: true, status: "pending", justification: "", owner_id: null });
    state.fixture!.tables.soa_items.pop();
    render(await SoaReviewPage({ params: Promise.resolve({ id: "register" }) }));
    expect(screen.getByText(/must contain all 93 controls; 92 are present/i)).toBeInTheDocument();
    expect(screen.getByText(/1 pending, 1 missing rationale, 1 unassigned, 1 missing live evidence, 0 with stored expired evidence/i)).toBeInTheDocument();
  });
});


it("renders saved statement decisions and snapshot provenance without using later answers or current readiness", async () => {
  state.fixture = controlReviewFixture();
  finaliseControlReviewFixture(state.fixture);
  state.fixture.failures.add("memberships");
  state.fixture.failures.add("evidence_links");
  state.fixture.tables.assessment_responses[0].evidence_note = "Later private answer";
  render(await SoaReviewPage({ params: Promise.resolve({ id: "register" }) }));
  expect(screen.getByRole("heading", { name: "Saved statement" })).toBeInTheDocument();
  expect(screen.getByText("Saved rationale", { selector: "p" })).toBeInTheDocument();
  expect(screen.getByText("Saved evidence note", { selector: "p" })).toBeInTheDocument();
  expect(screen.getByText(/Assessment catalogue.*saved-questions/)).toBeInTheDocument();
  expect(screen.getByText(/Control catalogue.*saved-controls/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open current source assessment" })).toHaveAttribute("href", "/app/assessment/saved-assessment");
  expect(screen.queryByText("Later private answer")).not.toBeInTheDocument();
  expect(screen.queryByText(/Current assessment context/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Finalise/ })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Download saved PDF" })).toHaveAttribute("href", "/api/app/soa/snapshot/pdf");
});


it("shows both labelled catalogue versions in the editable source provenance", async () => {
  state.fixture = controlReviewFixture();
  render(await SoaReviewPage({ params: Promise.resolve({ id: "register" }) }));
  expect(screen.getByText(/Assessment catalogue: Assessment questions.*version 2026.1.*questions-v1/)).toBeInTheDocument();
  expect(screen.getByText(/Control catalogue: ISO control catalogue.*version 2022.1.*controls-v1/)).toBeInTheDocument();
});
