import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ replacement: null as null | { id: string; title: string; status: string; collected_on: string; valid_until: string | null }, statuses: [] as string[] }));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("../actions", () => ({ createEvidenceAction: vi.fn() }));
vi.mock("@/lib/app-context", () => ({ requireAppContext: async () => ({
  organisation: { id: "org-1" }, membership: { role: "owner" },
  supabase: { from(table: string) {
    const query = {
      select: () => query,
      eq: () => query,
      in: (_column: string, values: string[]) => { state.statuses = values; return query; },
      maybeSingle: async () => ({ data: state.replacement, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "memberships" ? [] : null, error: null }).then(resolve),
    };
    return query;
  } },
}) }));

import NewEvidencePage from "./page";

const replacementId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => { state.replacement = null; state.statuses = []; });
afterEach(cleanup);

it("does not submit a missing or historical replacement target", async () => {
  render(await NewEvidencePage({ searchParams: Promise.resolve({ replaces: replacementId }) }));
  expect(screen.getByRole("alert")).toHaveTextContent(/unavailable or already in history/i);
  expect(document.querySelector('input[name="replacesEvidenceId"]')).toBeNull();
  expect(state.statuses).toEqual(["current", "expiring", "expired"]);
});

it("submits a verified active replacement target and explains retained history", async () => {
  state.replacement = { id: replacementId, title: "Earlier access review", status: "current", collected_on: "2026-08-01", valid_until: null };
  render(await NewEvidencePage({ searchParams: Promise.resolve({ replaces: replacementId }) }));
  expect(screen.getByText("Earlier access review")).toBeInTheDocument();
  expect(document.querySelector('input[name="replacesEvidenceId"]')).toHaveValue(replacementId);
  expect(screen.getByText(/older record stays in history/i)).toBeInTheDocument();
});
