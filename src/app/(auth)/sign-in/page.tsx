import Link from "next/link";
import { safePostAuthPath } from "@/lib/auth-destination";
import { signInAction, signInWithOAuthAction } from "../actions";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ message?: string; next?: string }> }) {
  const { message, next: requestedNext } = await searchParams;
  const next = safePostAuthPath(requestedNext);
  const invitationContinuation = next === "/invite";
  const googleEnabled = process.env.GOOGLE_AUTH_ENABLED === "1";
  const microsoftEnabled = process.env.MICROSOFT_AUTH_ENABLED === "1";
  return <section className="card" style={{ padding: "28px" }}>
    <h1 style={{ fontSize: "22px", letterSpacing: "-.02em" }}>Sign in</h1><p style={{ marginTop: "6px", fontSize: "13px", color: "#6d7787" }}>{invitationContinuation ? "Sign in to continue to your workspace invitation." : "Continue your ISO 27001 readiness work."}</p>
    {message && <p role="status" style={{ marginTop: "16px", padding: "12px", borderRadius: "8px", background: "#eaf1fe", color: "#2d5cc4", fontSize: "13px" }}>{message}</p>}
    {(googleEnabled || microsoftEnabled) && <div style={{ display: "grid", gap: "10px", marginTop: "18px" }}>
      {googleEnabled && <form action={signInWithOAuthAction}>
        <input type="hidden" name="provider" value="google" />
        <input type="hidden" name="next" value={next} />
        <button className="button secondary" style={{ width: "100%" }}>Continue with Google</button>
      </form>}
      {microsoftEnabled && <form action={signInWithOAuthAction}>
        <input type="hidden" name="provider" value="azure" />
        <input type="hidden" name="next" value={next} />
        <button className="button secondary" style={{ width: "100%" }}>Continue with Microsoft</button>
      </form>}
      <p aria-hidden="true" style={{ textAlign: "center", color: "#8a94a3", fontSize: "12px" }}>or use your password</p>
    </div>}
    <form action={signInAction} className="app-form" style={{ padding: 0, marginTop: "18px" }}>
      <input type="hidden" name="next" value={next} />
      <label>Email<input name="email" type="email" autoComplete="email" required /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" minLength={10} required /></label>
      <div style={{ textAlign: "right", marginTop: "-6px" }}><Link style={{ color: "var(--blue)", fontWeight: 600, fontSize: "12.5px" }} href="/forgot-password">Forgot password?</Link></div>
      <button className="button primary" style={{ width: "100%" }}>Sign in</button>
    </form>
    <p style={{ marginTop: "22px", textAlign: "center", fontSize: "13px", color: "#6d7787" }}>New to ComplianceHub? <Link style={{ color: "var(--blue)", fontWeight: 700 }} href={`/sign-up?next=${encodeURIComponent(next)}`}>Create an account</Link></p>
  </section>;
}
