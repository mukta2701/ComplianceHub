import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("Settings workspace-access ownership", () => {
  it("routes Settings navigation and page-level role presentation through the shared section", () => {
    const shell = read("src/components/app-shell.tsx");
    const page = read("src/app/app/settings/page.tsx");

    expect(shell).toContain('section("settings")');
    expect(shell).not.toContain('["/app/settings", "settings", "Settings"]');
    expect(page).toContain('section("settings")');
    expect(page).not.toContain('membership.role === "owner"');
    expect(page).not.toContain("hasCapability(");
  });

  it("routes the existing team, invitation-lifecycle and AI action gates through Settings", () => {
    for (const file of [
      "src/features/organisations/application/membership-actions.ts",
      "src/features/organisations/application/invitation-actions.ts",
      "src/app/app/settings/ai-actions.ts",
    ]) {
      const source = read(file);
      expect(source).toContain('section("settings")');
      expect(source).not.toContain("hasCapability(");
      expect(source).not.toContain('membership.role !== "owner"');
    }
  });

  it("preserves target-role invitation validation and its rate-limit ordering", () => {
    const invitations = read("src/features/organisations/application/invitation-actions.ts");
    const organisation = read("src/features/organisations/application/organisation.ts");
    const inviteAction = invitations.slice(
      invitations.indexOf("export async function inviteMemberAction"),
      invitations.indexOf("export async function revokeInvitationAction"),
    );

    expect(invitations.indexOf("await enforceRateLimit(`invite:${user.id}`")).toBeLessThan(
      invitations.indexOf("const result = await inviteMember("),
    );
    expect(inviteAction).not.toContain('section("settings")');
    expect(organisation).toContain("canInviteRole(context.actorRole, parsed.role)");
  });

  it("keeps personal OAuth grants and workspace creation/switching outside Settings role policy", () => {
    const oauth = read("src/app/app/settings/oauth-actions.ts");
    const workspaceActions = read("src/features/organisations/application/workspace-actions.ts");

    expect(oauth).not.toContain("workspaceAccess(");
    expect(workspaceActions).not.toContain("workspaceAccess(");
  });
});
