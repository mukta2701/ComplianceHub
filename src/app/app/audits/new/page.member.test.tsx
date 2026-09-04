import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve({ membership: { role: "member" }, organisation: { id: "org-1" }, supabase: { from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [] }) }) }) } }),
}));

import NewAuditPage from "./page";

describe("NewAuditPage member branch", () => {
  it("redirects Members away from audit creation", async () => {
    redirect.mockImplementation(() => { throw new Error("NEXT_REDIRECT"); });

    await expect(NewAuditPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/app/audits");
  });
});
