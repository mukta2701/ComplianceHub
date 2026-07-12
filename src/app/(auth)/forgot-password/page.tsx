import Link from "next/link";
import { requestPasswordResetAction } from "../actions";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const { message } = await searchParams;
  return <section className="card" style={{ padding: "28px" }}>
    <h1 style={{ fontSize: "22px", letterSpacing: "-.02em" }}>Reset your password</h1>
    <p style={{ marginTop: "6px", fontSize: "13px", color: "#6d7787" }}>Enter your email and we&rsquo;ll send you a link to set a new password.</p>
    {message && <p role="status" style={{ marginTop: "16px", padding: "12px", borderRadius: "8px", background: "#eaf1fe", color: "#2d5cc4", fontSize: "13px" }}>{message}</p>}
    <form action={requestPasswordResetAction} className="app-form" style={{ padding: 0, marginTop: "18px" }}>
      <label>Email<input name="email" type="email" autoComplete="email" required /></label>
      <button className="button primary" style={{ width: "100%" }}>Send reset link</button>
    </form>
    <p style={{ marginTop: "22px", textAlign: "center", fontSize: "13px", color: "#6d7787" }}>Remembered it? <Link style={{ color: "var(--blue)", fontWeight: 700 }} href="/sign-in">Back to sign in</Link></p>
  </section>;
}
