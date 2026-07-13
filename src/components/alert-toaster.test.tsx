import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlertToaster } from "./alert-toaster";

const { fetchRecentAlertsAction, createBrowserClient } = vi.hoisted(() => ({
  fetchRecentAlertsAction: vi.fn(),
  createBrowserClient: vi.fn(),
}));

vi.mock("@/app/app/monitoring/actions", () => ({ fetchRecentAlertsAction }));
vi.mock("@supabase/ssr", () => ({ createBrowserClient }));

function realtimeClient() {
  const getSession = vi.fn().mockResolvedValue({ data: { session: { access_token: "user-access-token" } } });
  const setAuth = vi.fn().mockResolvedValue(undefined);
  const subscribe = vi.fn<(callback?: (status: string) => void, timeout?: number) => void>();
  const on = vi.fn<(type: string, config: unknown, callback: () => void) => { subscribe: typeof subscribe }>();
  on.mockReturnValue({ subscribe });
  const channel = vi.fn(() => ({ on, subscribe }));
  const removeChannel = vi.fn().mockResolvedValue("ok");
  return { client: { auth: { getSession }, realtime: { setAuth }, channel, removeChannel }, getSession, setAuth, channel, on, subscribe, removeChannel };
}

describe("AlertToaster updates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-anon-key-for-tests");
    fetchRecentAlertsAction.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("subscribes to monitoring finding inserts for the active organisation", async () => {
    const realtime = realtimeClient();
    createBrowserClient.mockReturnValue(realtime.client);
    render(<AlertToaster organisationId="org-1" />);
    await act(async () => undefined);

    expect(realtime.getSession).toHaveBeenCalledTimes(1);
    expect(realtime.setAuth).toHaveBeenCalledWith("user-access-token");
    expect(realtime.channel).toHaveBeenCalledWith("monitoring-findings:org-1");
    expect(realtime.on).toHaveBeenCalledWith(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "monitoring_findings",
        filter: "organisation_id=eq.org-1",
      },
      expect.any(Function),
    );
    expect(createBrowserClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "public-anon-key-for-tests",
    );
  });

  it("keeps the 15 second poll fallback when Realtime setup fails", async () => {
    createBrowserClient.mockImplementation(() => { throw new Error("Realtime unavailable"); });
    render(<AlertToaster organisationId="org-1" />);

    await act(async () => undefined);
    expect(fetchRecentAlertsAction).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(15_000); });
    expect(fetchRecentAlertsAction).toHaveBeenCalledTimes(2);
  });

  it("refreshes promptly on an insert and removes the channel on unmount", async () => {
    const realtime = realtimeClient();
    createBrowserClient.mockReturnValue(realtime.client);
    const view = render(<AlertToaster key="org-1" organisationId="org-1" />);
    await act(async () => undefined);

    expect(realtime.on).toHaveBeenCalled();
    const onInsert = realtime.on.mock.calls[0][2] as () => void;
    await act(async () => { onInsert(); });
    expect(fetchRecentAlertsAction).toHaveBeenCalledTimes(2);

    view.unmount();
    expect(realtime.removeChannel).toHaveBeenCalledTimes(1);
  });

  it("keeps polling after a Realtime timeout and cleans the failed channel only once", async () => {
    const realtime = realtimeClient();
    createBrowserClient.mockReturnValue(realtime.client);
    const view = render(<AlertToaster key="org-1" organisationId="org-1" />);
    await act(async () => undefined);

    const onStatus = realtime.subscribe.mock.calls[0][0] as (status: string) => void;
    await act(async () => { onStatus("TIMED_OUT"); });
    await act(async () => { vi.advanceTimersByTime(15_000); });
    expect(fetchRecentAlertsAction).toHaveBeenCalledTimes(2);

    view.unmount();
    expect(realtime.removeChannel).toHaveBeenCalledTimes(1);
  });

  it("primes the next organisation without showing its existing alerts", async () => {
    const realtime = realtimeClient();
    createBrowserClient.mockReturnValue(realtime.client);
    fetchRecentAlertsAction
      .mockResolvedValueOnce([{ id: 1, message: "Existing in org one", kind: "control_drift", createdAt: "2026-07-13" }])
      .mockResolvedValueOnce([{ id: 2, message: "Existing in org two", kind: "control_drift", createdAt: "2026-07-13" }]);
    const view = render(<AlertToaster key="org-1" organisationId="org-1" />);
    await act(async () => undefined);

    view.rerender(<AlertToaster key="org-2" organisationId="org-2" />);
    await act(async () => undefined);

    expect(view.queryByText("Existing in org two")).not.toBeInTheDocument();
    expect(realtime.removeChannel).toHaveBeenCalledTimes(1);
  });
});
