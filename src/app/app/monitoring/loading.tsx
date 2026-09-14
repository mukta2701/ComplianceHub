import { Card } from "@/components/ui";

export default function MonitoringLoading() {
  return <Card className="monitor-route-state" aria-labelledby="monitoring-loading-title">
    <h2 id="monitoring-loading-title">Loading monitoring</h2>
    <p role="status" aria-live="polite">Loading monitoring status…</p>
  </Card>;
}
