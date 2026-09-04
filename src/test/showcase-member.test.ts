import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertMemberEnvironment } from "../../scripts/showcase-member";

const source = readFileSync("scripts/showcase-member.ts", "utf8");
describe("showcase member rehearsal", () => {
  it("requires exact local targets and explicit keys", () => {
    expect(() => assertMemberEnvironment({ NEXT_PUBLIC_SUPABASE_URL: "https://hosted.example", NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100", NEXT_PUBLIC_SUPABASE_ANON_KEY: "x", SUPABASE_SERVICE_ROLE_KEY: "y" })).toThrow();
    expect(() => assertMemberEnvironment({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100" })).toThrow(/explicit local/);
  });
  it("uses stable fictional identity and has no deletion or external delivery path", () => {
    expect(source).toContain("showcase-member@example.test");
    expect(source).toContain("issue_invitation");
    expect(source).toContain("accept_invitation");
    expect(source).not.toMatch(/delete\s+from|admin\.deleteUser|sendEmail|RESEND_API_KEY|fetch\("https:/);
  });
});
