"use client";

import { useEffect } from "react";
import { Card } from "@/components/ui";

export default function MonitoringError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (!error.digest) return;
    void fetch("/api/observability", {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ digest: error.digest }),
    }).catch(() => undefined);
  }, [error.digest]);

  return <Card className="monitor-route-state" aria-labelledby="monitoring-error-title">
    <h2 id="monitoring-error-title">Monitoring could not be loaded</h2>
    <p>We could not load the current monitoring status. No changes were made.</p>
    <button className="button" type="button" onClick={reset}>Try again</button>
  </Card>;
}
