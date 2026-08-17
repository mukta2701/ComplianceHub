import { describe, expect, it, vi } from "vitest";
const hoisted = vi.hoisted(() => ({ revoke: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: () => Promise.resolve({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u" } } }) } }) }));
vi.mock("@/features/auth/application/oauth-grants", () => ({ revokeUserOAuthGrant: hoisted.revoke }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
import { revokeOAuthGrantAction } from "./oauth-actions";

describe("revokeOAuthGrantAction", () => {
  it.each([true, false])("never places a spoofable success claim in the redirect (%s)", async (ok) => {
    hoisted.revoke.mockResolvedValueOnce({ ok });
    const form = new FormData(); form.set("clientId", "11111111-1111-4111-8111-111111111111");
    await expect(revokeOAuthGrantAction(form)).rejects.toThrow("REDIRECT:/app/settings#connected-apps");
  });
});
