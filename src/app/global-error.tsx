"use client";

import { useEffect } from "react";

// Root error boundary — replaces the whole document (so it renders its own
// <html>/<body> and cannot rely on globals.css). Reports to the self-hosted sink.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    fetch("/api/observability", {
      method: "POST", headers: { "content-type": "application/json" }, keepalive: true,
      body: JSON.stringify({ message: error.message, digest: error.digest, url: typeof window !== "undefined" ? window.location.href : undefined }),
    }).catch(() => {});
  }, [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#f7f8fa", fontFamily: "system-ui, sans-serif", color: "#1c2737" }}>
        <div style={{ maxWidth: 460, padding: "36px 32px", textAlign: "center" }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: "#fbe9e9", color: "#b62c2c", display: "grid", placeItems: "center", margin: "0 auto 18px", fontSize: 24 }}>!</div>
          <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: "#596273", lineHeight: 1.55, margin: "0 0 22px" }}>An unexpected error occurred and has been logged. You can try again, or head back to your dashboard.</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button onClick={reset} style={{ minHeight: 42, padding: "10px 18px", borderRadius: 9, border: "none", background: "#2f6bed", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Try again</button>
            <a href="/app" style={{ minHeight: 42, padding: "10px 18px", borderRadius: 9, border: "1px solid #d3d9e6", background: "#fff", color: "#30394a", fontWeight: 700, fontSize: 14, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>Go to dashboard</a>
          </div>
        </div>
      </body>
    </html>
  );
}
