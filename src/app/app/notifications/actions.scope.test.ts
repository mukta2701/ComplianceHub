import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  eq: vi.fn(),
  is: vi.fn(),
}));

vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve({
    organisation: { id: "org-1", name: "Example Ltd" },
    supabase: {
      from: () => {
        const chain = {
          update: vi.fn(),
          eq: hoisted.eq,
          is: hoisted.is,
        };
        chain.update.mockReturnValue(chain);
        hoisted.eq.mockReturnValue(chain);
        hoisted.is.mockResolvedValue({ error: null });
        (chain as typeof chain & { then: (resolve: (value: { error: null }) => unknown) => Promise<unknown> }).then = (resolve) => Promise.resolve({ error: null }).then(resolve);
        return chain;
      },
    },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { markAllNotificationsReadAction, markNotificationReadAction } from "./actions";

describe("notification mutations active workspace scope", () => {
  beforeEach(() => vi.clearAllMocks());

  it("scopes a single-notification update to the active organisation", async () => {
    const form = new FormData();
    form.set("id", "42");

    await markNotificationReadAction(form);

    expect(hoisted.eq).toHaveBeenCalledWith("organisation_id", "org-1");
  });

  it("scopes the mark-all update to the active organisation", async () => {
    await markAllNotificationsReadAction();

    expect(hoisted.eq).toHaveBeenCalledWith("organisation_id", "org-1");
    expect(hoisted.is).toHaveBeenCalledWith("read_at", null);
  });
});
