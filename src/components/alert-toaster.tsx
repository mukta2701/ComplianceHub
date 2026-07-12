"use client";

import { useEffect, useRef, useState } from "react";
import { fetchRecentAlertsAction } from "@/app/app/monitoring/actions";
import { Icon } from "./icons";

type Toast = { id: number; message: string; kind: string };

// A lightweight in-app pop-up for continuous-monitoring alerts. It polls for
// unread monitoring notifications (the same rows the bell counts) and slides in a
// toast the first time it sees each one — so a finding raised by a "Run checks
// now" or the hourly cron surfaces while you're in the app, without a refresh.
// (Realtime push is a Phase 2 upgrade; polling needs no publication changes.)
export function AlertToaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seen = useRef<Set<number>>(new Set());
  const primed = useRef(false);

  useEffect(() => {
    let active = true;
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
            setTimeout(() => { if (active) setToasts((cur) => cur.filter((t) => t.id !== toast.id)); }, 12_000);
          }
        }
      } catch { /* transient — try again next tick */ }
    }
    poll();
    const timer = setInterval(poll, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, []);

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
