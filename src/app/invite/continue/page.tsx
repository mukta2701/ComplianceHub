"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- The invite cookie requires a full document request. */

import { useEffect } from "react";

// A real document request to this fixed URL carries the HttpOnly invitation
// cookie, which is intentionally scoped to /invite rather than /sign-in.
export default function InviteContinuePage() {
  useEffect(() => {
    window.location.replace("/invite");
  }, []);

  return <main style={{ maxWidth: "600px", margin: "64px auto", padding: "24px" }}>
    <section className="card" style={{ padding: "28px" }}>
      <h1 style={{ fontSize: "24px", letterSpacing: "-.02em" }}>Continuing to your invitation</h1>
      <p style={{ marginTop: "10px", color: "#5f6b7a", lineHeight: 1.6 }}>
        Finishing sign-in, then loading your workspace invitation.
      </p>
      <a className="button secondary" href="/invite" style={{ display: "inline-flex", marginTop: "20px" }}>
        Continue to invitation
      </a>
    </section>
  </main>;
}
