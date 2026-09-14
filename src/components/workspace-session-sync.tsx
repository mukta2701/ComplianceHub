"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// Shared layouts survive soft navigation. A sign-in in another tab can change
// the cookies used by page requests while leaving this tab's shell unchanged.
// Refresh the complete server tree; browser session data never sets its labels
// or permissions. Focus also covers server-action sign-ins that do not emit a
// browser-client auth event, and workspace-cookie changes for the same user.
export function WorkspaceSessionSync({ userId }: { userId: string }) {
  const router = useRouter();
  useEffect(() => {
    let active = true;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    function scheduleRefresh() {
      if (!active || refreshTimer !== null) return;
      // Leave the synchronous Supabase auth callback before starting work.
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        if (active) router.refresh();
      }, 0);
    }
    function onVisible() {
      if (document.visibilityState === "visible") scheduleRefresh();
    }
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) scheduleRefresh();
    }
    window.addEventListener("focus", scheduleRefresh);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    const client = createSupabaseBrowserClient();
    const subscription = client?.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || (session && session.user.id !== userId)) scheduleRefresh();
    }).data.subscription;
    return () => {
      active = false;
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      window.removeEventListener("focus", scheduleRefresh);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
      subscription?.unsubscribe();
    };
  }, [router, userId]);
  return null;
}
