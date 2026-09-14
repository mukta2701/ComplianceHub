import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve({
    organisation: { id: "org-1" },
    membership: { role: "member" },
    supabase: { from: vi.fn() },
  }),
}));

import NewEvidencePage from "./page";

describe("NewEvidencePage Member branch", () => {
  it("redirects Members back to the evidence vault before loading the form", async () => {
    redirect.mockImplementation(() => { throw new Error("NEXT_REDIRECT"); });

    await expect(NewEvidencePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/app/evidence");
  });
});
