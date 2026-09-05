import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  refresh: vi.fn(), unsubscribe: vi.fn(),
  callback: null as null | ((event: string, session: { user: { id: string } } | null) => void),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: () => ({ auth: {
  onAuthStateChange: (callback: typeof state.callback) => {
    state.callback = callback;
    return { data: { subscription: { unsubscribe: state.unsubscribe } } };
  },
} }) }));

import { WorkspaceSessionSync } from "./workspace-session-sync";

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); state.callback = null; });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const flush = () => act(() => { vi.runOnlyPendingTimers(); });

describe("workspace shell session coherence", () => {
  it("refreshes the cached layout when another account becomes active", () => {
    render(<WorkspaceSessionSync userId="local-owner" />);
    act(() => { state.callback?.("SIGNED_IN", { user: { id: "northstar-owner" } }); });
    flush();
    expect(state.refresh).toHaveBeenCalledOnce();
  });

  it("does not refresh for the same initial user or routine token renewal", () => {
    render(<WorkspaceSessionSync userId="local-owner" />);
    act(() => {
      state.callback?.("INITIAL_SESSION", { user: { id: "local-owner" } });
      state.callback?.("TOKEN_REFRESHED", { user: { id: "local-owner" } });
    });
    flush();
    expect(state.refresh).not.toHaveBeenCalled();
  });

  it("refreshes after sign-out so the server can redirect the protected route", () => {
    render(<WorkspaceSessionSync userId="local-owner" />);
    act(() => { state.callback?.("SIGNED_OUT", null); });
    flush();
    expect(state.refresh).toHaveBeenCalledOnce();
  });

  it("does not loop when browser initialization has no session snapshot", () => {
    render(<WorkspaceSessionSync userId="local-owner" />);
    act(() => { state.callback?.("INITIAL_SESSION", null); });
    flush();
    expect(state.refresh).not.toHaveBeenCalled();
  });

  it("uses the refreshed server identity for subsequent auth events", () => {
    const view = render(<WorkspaceSessionSync userId="local-owner" />);
    view.rerender(<WorkspaceSessionSync userId="northstar-owner" />);
    act(() => { state.callback?.("SIGNED_IN", { user: { id: "northstar-owner" } }); });
    flush();
    expect(state.refresh).not.toHaveBeenCalled();
  });

  it("coalesces focus and visibility refreshes for server-side cookie changes", () => {
    render(<WorkspaceSessionSync userId="local-owner" />);
    act(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    flush();
    expect(state.refresh).toHaveBeenCalledOnce();
  });

  it("refreshes a restored browser history page but not an ordinary page load", () => {
    render(<WorkspaceSessionSync userId="local-owner" />);
    act(() => { window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false })); });
    flush();
    expect(state.refresh).not.toHaveBeenCalled();
    act(() => { window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })); });
    flush();
    expect(state.refresh).toHaveBeenCalledOnce();
  });

  it("cleans up listeners, deferred refresh and auth subscription on unmount", () => {
    const view = render(<WorkspaceSessionSync userId="local-owner" />);
    act(() => { window.dispatchEvent(new Event("focus")); });
    view.unmount();
    act(() => { window.dispatchEvent(new Event("focus")); });
    flush();
    expect(state.unsubscribe).toHaveBeenCalledOnce();
    expect(state.refresh).not.toHaveBeenCalled();
  });
});
