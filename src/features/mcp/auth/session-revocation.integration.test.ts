// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { isDestructiveIntegrationTargetAllowed } from "@/test/destructive-integration-target";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const live = Boolean(url && publicKey && serviceKey && isDestructiveIntegrationTargetAllowed(url));
if (!live) {
  throw new Error(
    "Session-revocation integration tests require NEXT_PUBLIC_SUPABASE_URL, "
    + "NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY for a disposable localhost Supabase stack.",
  );
}

describe("real Supabase Auth session revocation", () => {
  it("makes the exact getUser token check return session_not_found after revocation", async () => {
    const admin = createClient(String(url), String(serviceKey), { auth: { persistSession: false } });
    let getUserWireError: unknown = null;
    const userClient = createClient(String(url), String(publicKey), {
      auth: { persistSession: false },
      global: { fetch: async (input, init) => {
        const response = await fetch(input, init);
        if (String(input).endsWith("/auth/v1/user") && !response.ok) getUserWireError = await response.clone().json();
        return response;
      } },
    });
    const email = `mcp-revoke-${crypto.randomUUID()}@example.test`;
    const password = `Mcp-${crypto.randomUUID()}-9a!`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(created.error).toBeNull();
    const userId = created.data.user?.id;
    expect(userId).toBeTruthy();
    try {
      const signedIn = await userClient.auth.signInWithPassword({ email, password });
      expect(signedIn.error).toBeNull();
      const token = signedIn.data.session?.access_token;
      expect(token).toBeTruthy();
      const before = await userClient.auth.getUser(String(token));
      expect(before.error).toBeNull();
      expect(before.data.user?.id).toBe(userId);

      const revoked = await admin.auth.admin.signOut(String(token), "global");
      expect(revoked.error).toBeNull();
      const after = await userClient.auth.getUser(String(token));
      expect(after.data.user).toBeNull();
      expect(getUserWireError).toMatchObject({ code: "session_not_found" });
      // auth-js intentionally maps the wire code to AuthSessionMissingError.
      expect(after.error?.name).toBe("AuthSessionMissingError");
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });
});
