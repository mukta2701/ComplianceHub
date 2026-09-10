import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { controlReviewFixture } from "@/test/control-review-fixture";
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
});
