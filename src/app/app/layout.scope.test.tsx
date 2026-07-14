import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ notificationEq: vi.fn() }));

vi.mock("@/lib/app-context", () => ({
  getAuthUser: () => Promise.resolve({ id: "user-1", email: "member@example.test" }),
  getMembership: () => Promise.resolve({
    organisation_id: "org-1", role: "member", job_title: "Developer",
    organisations: { id: "org-1", name: "Example Ltd" },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => Promise.resolve({
    from: (table: string) => {
      if (table === "notifications") {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.eq = vi.fn((column: string, value: unknown) => {
          hoisted.notificationEq(column, value);
          return chain;
        });
        chain.is = vi.fn(() => Promise.resolve({ count: 2 }));
        return chain;
      }
      if (table === "profiles") {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.eq = vi.fn(() => chain);
        chain.maybeSingle = vi.fn(() => Promise.resolve({ data: { display_name: "Preview Member" } }));
        return chain;
      }
      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ unreadCount, children }: { unreadCount: number; children: React.ReactNode }) => <div data-testid="shell" data-unread={unreadCount}>{children}</div>,
}));

import ProtectedLayout from "./layout";

describe("protected layout active workspace scope", () => {
  it("counts unread notifications only in the active organisation", async () => {
    render(await ProtectedLayout({ children: <p>Content</p> }));

    expect(screen.getByTestId("shell")).toHaveAttribute("data-unread", "2");
    expect(hoisted.notificationEq).toHaveBeenCalledWith("organisation_id", "org-1");
  });
});
