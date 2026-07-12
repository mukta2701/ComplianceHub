"use client";

import { useEffect } from "react";
import { Card } from "@/components/ui";

// Segment error boundary for the authenticated app — renders inside the shell, so
// the sidebar/header stay put. Reports to the self-hosted sink, offers recovery.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    fetch("/api/observability", {
      method: "POST", headers: { "content-type": "application/json" }, keepalive: true,
      body: JSON.stringify({ message: error.message, digest: error.digest, url: typeof window !== "undefined" ? window.location.href : undefined }),
    }).catch(() => {});
  }, [error]);
  return (
    <Card style={{ padding: "40px 32px", textAlign: "center", maxWidth: 520, margin: "40px auto" }}>
      <div style={{ width: 46, height: 46, borderRadius: 12, background: "#fbe9e9", color: "#b62c2c", display: "grid", placeItems: "center", margin: "0 auto 16px", fontSize: 22, fontWeight: 800 }}>!</div>
      <h2 style={{ fontSize: 20, margin: "0 0 8px" }}>This page hit an error</h2>
      <p style={{ fontSize: 14, color: "#596273", lineHeight: 1.55, margin: "0 0 22px" }}>The problem has been logged. Try again — if it keeps happening, come back in a moment.</p>
      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
        <button className="button" onClick={reset}>Try again</button>
        <a className="button secondary" href="/app">Go to dashboard</a>
      </div>
    </Card>
  );
}
