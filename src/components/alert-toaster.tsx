"use client";

import { useEffect, useRef, useState } from "react";
import { fetchRecentAlertsAction } from "@/app/app/monitoring/actions";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Icon } from "./icons";

type Toast = { id: number; message: string; kind: string };

const POLL_INTERVAL_MS = 15_000;
const TOAST_DURATION_MS = 12_000;
const REALTIME_SETUP_TIMEOUT_MS = 10_000;
const REALTIME_RETRY_DELAYS_MS = [250, 1_000, 2_500] as const;

export function isRealtimeFailureStatus(status: string): boolean {
  return status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED";
}

// Realtime prompts an immediate refresh when a finding lands. The original poll
// continues as a deliberately boring safety net for missing env, unavailable
// Realtime, publication/configuration errors, and dropped channels.
export function AlertToaster({ organisationId }: { organisationId: string | null }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seen = useRef<Set<number>>(new Set());
  const primed = useRef(false);

  useEffect(() => {
    let active = true;
    const dismissTimers = new Set<ReturnType<typeof setTimeout>>();
    const realtimeRetryTimers = new Set<ReturnType<typeof setTimeout>>();
    let removeRealtime: (() => void) | null = null;
    async function poll() {
      try {
        const alerts = await fetchRecentAlertsAction();
        if (!active) return;
        const fresh: Toast[] = [];
        for (const alert of alerts) {
          if (seen.current.has(alert.id)) continue;
          seen.current.add(alert.id);
          // On the first poll, mark everything already-seen without popping — we
          // only toast alerts that arrive *after* the page is open.
          if (primed.current) fresh.push({ id: alert.id, message: alert.message, kind: alert.kind });
        }
        primed.current = true;
        if (fresh.length > 0) {
          setToasts((current) => [...fresh, ...current].slice(0, 4));
          for (const toast of fresh) {
            const timer = setTimeout(() => {
              dismissTimers.delete(timer);
              if (active) setToasts((cur) => cur.filter((t) => t.id !== toast.id));
            }, TOAST_DURATION_MS);
            dismissTimers.add(timer);
          }
        }
      } catch { /* transient — try again next tick */ }
    }
    poll();
    const pollTimer = setInterval(poll, POLL_INTERVAL_MS);

    function refreshAfterRealtimeInsert() {
      for (const timer of realtimeRetryTimers) clearTimeout(timer);
      realtimeRetryTimers.clear();
      void poll();
      for (const delay of REALTIME_RETRY_DELAYS_MS) {
        const timer = setTimeout(() => {
          realtimeRetryTimers.delete(timer);
          void poll();
        }, delay);
        realtimeRetryTimers.add(timer);
      }
    }

    async function setupRealtime() {
      if (!organisationId) return;
      try {
        const client = createSupabaseBrowserClient();
        if (!client) return;
        const { data: { session } } = await client.auth.getSession();
        if (!active || !session?.access_token) return;
        await client.realtime.setAuth(session.access_token);
        if (!active) return;

        const channel = client
          .channel(`monitoring-findings:${organisationId}`)
          .on("postgres_changes", {
            event: "INSERT",
            schema: "public",
            table: "monitoring_findings",
            filter: `organisation_id=eq.${organisationId}`,
          }, refreshAfterRealtimeInsert);
        let channelRemoved = false;
        const removeChannel = () => {
          if (channelRemoved) return;
          channelRemoved = true;
          void client.removeChannel(channel);
        };

        channel.subscribe((status) => {
          if (active && isRealtimeFailureStatus(status)) {
            // Polling is already active; discard the failed channel rather than
            // retaining a broken socket until unmount.
            removeChannel();
          }
        }, REALTIME_SETUP_TIMEOUT_MS);
        removeRealtime = removeChannel;
      } catch { /* Invalid/missing client setup: polling remains active. */ }
    }
    void setupRealtime();

    return () => {
      active = false;
      clearInterval(pollTimer);
      for (const timer of dismissTimers) clearTimeout(timer);
      dismissTimers.clear();
      for (const timer of realtimeRetryTimers) clearTimeout(timer);
      realtimeRetryTimers.clear();
      removeRealtime?.();
    };
  }, [organisationId]);

  const dismiss = (id: number) => setToasts((cur) => cur.filter((t) => t.id !== id));
  if (toasts.length === 0) return null;

  return (
    <div className="alert-toaster" role="region" aria-label="Monitoring alerts" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`alert-toast ${toast.kind === "policy_violation" ? "sev-high" : "sev-med"}`} role="alert">
          <span className="alert-toast-icon"><Icon name="alert" /></span>
          <div className="alert-toast-body">
            <strong>{toast.kind === "policy_violation" ? "Policy violation detected" : "Control drift detected"}</strong>
            <p>{toast.message}</p>
            <a href="/app/monitoring">View in Monitoring →</a>
          </div>
          <button className="alert-toast-close" onClick={() => dismiss(toast.id)} aria-label="Dismiss alert">×</button>
        </div>
      ))}
    </div>
  );
}
