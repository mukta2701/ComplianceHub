import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORGANISATION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ORGANISATION_ID = "22222222-2222-4222-8222-222222222222";

const hoisted = vi.hoisted(() => ({
  requireContext: vi.fn(),
  listUserOAuthGrants: vi.fn(),
  queries: [] as Array<{ table: string; column: string; value: unknown }>,
}));

vi.mock("@/lib/app-context", () => ({ requireAppContext: hoisted.requireContext }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/settings" }));
vi.mock("@/features/auth/application/oauth-grants", () => ({ listUserOAuthGrants: hoisted.listUserOAuthGrants }));
vi.mock("../actions", () => ({
  inviteMemberAction: vi.fn(),
  changeMemberRoleAction: vi.fn(),
  removeMemberAction: vi.fn(),
  resendInvitationAction: vi.fn(),
  revokeInvitationAction: vi.fn(),
  updateMemberJobTitleAction: vi.fn(),
}));
vi.mock("./connected-applications", () => ({ ConnectedApplications: () => null }));
vi.mock("./ai-settings", () => ({ AiWorkspaceSettings: () => null }));

function activeContext() {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    organisations: [{ slug: "active-organisation", created_at: "2026-08-18T00:00:00Z" }],
    memberships: [{
      organisation_id: OTHER_ORGANISATION_ID,
      user_id: "sibling-user",
      role: "member",
      job_title: "Sibling-only member",
      created_at: "2026-08-18T00:00:00Z",
      profiles: { display_name: "Sibling-only member" },
    }],
    invitations: [],
    ai_workspace_settings: [],
  };
  const supabase = {
    from(table: string) {
      const equals: Array<[string, unknown]> = [];
      // The minimal fake deliberately leaves Supabase's fluent builder dynamic.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: Record<string, (...args: any[]) => any> = {
        select: vi.fn(() => builder),
        eq: vi.fn((column: string, value: unknown) => {
          equals.push([column, value]);
          hoisted.queries.push({ table, column, value });
          return builder;
        }),
        is: vi.fn(() => builder),
        order: vi.fn(() => builder),
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
          const data = (rows[table] ?? []).filter((row) => equals.every(([column, value]) => row[column] === value));
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
        maybeSingle: vi.fn(async () => {
          const data = (rows[table] ?? []).filter((row) => equals.every(([column, value]) => row[column] === value));
          return { data: data[0] ?? null, error: null };
        }),
      };
      return builder;
    },
  };
  return {
    supabase,
    user: { id: "active-user" },
    membership: { role: "owner" },
    organisation: { id: ORGANISATION_ID, name: "Active organisation" },
  };
}

beforeEach(() => {
  hoisted.queries.length = 0;
  hoisted.requireContext.mockResolvedValue(activeContext());
  hoisted.listUserOAuthGrants.mockResolvedValue({ status: "loaded", grants: [] });
});

describe("Settings active organisation scope", () => {
  it("does not list a member from a sibling organisation", async () => {
    const { default: SettingsPage } = await import("./page");

    render(await SettingsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.queryAllByText("Sibling-only member")).toHaveLength(0);
    expect(hoisted.queries).toContainEqual({ table: "memberships", column: "organisation_id", value: ORGANISATION_ID });
  });
});
