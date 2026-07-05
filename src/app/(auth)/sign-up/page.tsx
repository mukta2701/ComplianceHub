import Link from "next/link";
import { signUpAction } from "../actions";

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const { message } = await searchParams;
  return <section className="card" style={{ padding: "28px" }}>
    <h1 style={{ fontSize: "22px", letterSpacing: "-.02em" }}>Create your account</h1><p style={{ marginTop: "6px", fontSize: "13px", color: "#6d7787" }}>Start a private readiness workspace for your organisation.</p>
    {message && <p role="alert" style={{ marginTop: "16px", padding: "12px", borderRadius: "8px", background: "#fdf2f2", color: "#b62c2c", fontSize: "13px" }}>{message}</p>}
    <form action={signUpAction} className="app-form" style={{ padding: 0, marginTop: "18px" }}>
      <label>Name<input name="displayName" autoComplete="name" maxLength={120} required /></label>
      <label>Email<input name="email" type="email" autoComplete="email" required /></label>
      <label>Password<input name="password" type="password" autoComplete="new-password" minLength={10} required /></label>
      <label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={10} required /></label>
      <button className="button primary" style={{ width: "100%" }}>Create account</button>
    </form>
    <p style={{ marginTop: "22px", textAlign: "center", fontSize: "13px", color: "#6d7787" }}>Already registered? <Link style={{ color: "var(--blue)", fontWeight: 700 }} href="/sign-in">Sign in</Link></p>
  </section>;
}
