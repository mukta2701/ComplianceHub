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

function activeContext(role: "owner" | "member" = "owner") {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    organisations: [{ slug: "active-organisation", created_at: "2026-08-18T00:00:00Z" }],
    memberships: [
      {
        organisation_id: ORGANISATION_ID,
        user_id: "active-user",
        role: "member",
        job_title: "Compliance coordinator",
        created_at: "2026-08-18T00:00:00Z",
        profiles: { display_name: "Active member" },
      },
      {
        organisation_id: OTHER_ORGANISATION_ID,
        user_id: "sibling-user",
        role: "member",
        job_title: "Sibling-only member",
        created_at: "2026-08-18T00:00:00Z",
        profiles: { display_name: "Sibling-only member" },
      },
    ],
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
    membership: { role },
    organisation: { id: ORGANISATION_ID, name: "Active organisation" },
  };
}

beforeEach(() => {
  window.history.replaceState({}, "", "/app/settings#team");
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

  it("links Settings navigation to connected assistants", async () => {
    const { default: SettingsPage } = await import("./page");

    render(await SettingsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("link", { name: "Connected assistants" })).toHaveAttribute("href", "/app/settings#connected-apps");
  });

  it("keeps member management controls out of view for workspace members", async () => {
    hoisted.requireContext.mockResolvedValue(activeContext("member"));
    const { default: SettingsPage } = await import("./page");

    render(await SettingsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("Active member")).toBeVisible();
    expect(screen.getByText("Member")).toBeVisible();
    expect(screen.queryByText("Edit details")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create invite" })).not.toBeInTheDocument();
  });

  it("offers authorised workspace owners a compact member-details disclosure", async () => {
    const { default: SettingsPage } = await import("./page");

    render(await SettingsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("Active member")).toBeVisible();
    expect(screen.getByText("Edit details")).toBeVisible();
  });

  it("opens team members after an invitation result returns without a hash", async () => {
    window.history.replaceState({}, "", "/app/settings");
    const { default: SettingsPage } = await import("./page");

    render(await SettingsPage({ searchParams: Promise.resolve({ inviteStatus: "sent", inviteId: "invite-1" }) }));

    expect(screen.getByRole("status")).toHaveTextContent("Invitation email sent.");
    expect(screen.getByText("Active member")).toBeVisible();
  });
});
