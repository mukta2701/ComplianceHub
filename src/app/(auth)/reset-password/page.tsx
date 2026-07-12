import { updatePasswordAction } from "../actions";

// Reached after clicking the emailed recovery link, which /auth/callback exchanges
// for a recovery session before redirecting here. The form updates that session's
// password.
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const { message } = await searchParams;
  return <section className="card" style={{ padding: "28px" }}>
    <h1 style={{ fontSize: "22px", letterSpacing: "-.02em" }}>Set a new password</h1>
    <p style={{ marginTop: "6px", fontSize: "13px", color: "#6d7787" }}>Choose a new password for your account.</p>
    {message && <p role="status" style={{ marginTop: "16px", padding: "12px", borderRadius: "8px", background: "#eaf1fe", color: "#2d5cc4", fontSize: "13px" }}>{message}</p>}
    <form action={updatePasswordAction} className="app-form" style={{ padding: 0, marginTop: "18px" }}>
      <label>New password<input name="password" type="password" autoComplete="new-password" minLength={10} required /></label>
      <label>Confirm new password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={10} required /></label>
      <button className="button primary" style={{ width: "100%" }}>Update password</button>
    </form>
  </section>;
}
