import Link from "next/link";
import { signInAction } from "../actions";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const { message } = await searchParams;
  return <section className="card" style={{ padding: "28px" }}>
    <h1 style={{ fontSize: "22px", letterSpacing: "-.02em" }}>Sign in</h1><p style={{ marginTop: "6px", fontSize: "13px", color: "#6d7787" }}>Continue your ISO 27001 readiness work.</p>
    {message && <p role="status" style={{ marginTop: "16px", padding: "12px", borderRadius: "8px", background: "#eaf1fe", color: "#2d5cc4", fontSize: "13px" }}>{message}</p>}
    <form action={signInAction} className="app-form" style={{ padding: 0, marginTop: "18px" }}>
      <label>Email<input name="email" type="email" autoComplete="email" required /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" minLength={10} required /></label>
      <div style={{ textAlign: "right", marginTop: "-6px" }}><Link style={{ color: "var(--blue)", fontWeight: 600, fontSize: "12.5px" }} href="/forgot-password">Forgot password?</Link></div>
      <button className="button primary" style={{ width: "100%" }}>Sign in</button>
    </form>
    <p style={{ marginTop: "22px", textAlign: "center", fontSize: "13px", color: "#6d7787" }}>New to ComplianceHub? <Link style={{ color: "var(--blue)", fontWeight: 700 }} href="/sign-up">Create an account</Link></p>
  </section>;
}
