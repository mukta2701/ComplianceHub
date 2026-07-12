"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signInSchema, signUpSchema, requestPasswordResetSchema, updatePasswordSchema } from "@/features/auth/application/auth";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { siteUrl } from "@/lib/site-url";

function message(path: string, value: string) { return `${path}?message=${encodeURIComponent(value)}`; }

export async function signInAction(formData: FormData) {
  await enforceRateLimit(`sign-in:${String(formData.get("email")).trim().toLowerCase()}`, { limit: 8, windowMs: 15 * 60_000 });
  const result = signInSchema.safeParse(Object.fromEntries(formData));
  if (!result.success) redirect(message("/sign-in", "Enter a valid email and password."));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(result.data);
  if (error) redirect(message("/sign-in", "Sign-in failed. Check your details and try again."));
  redirect("/app");
}

export async function signUpAction(formData: FormData) {
  await enforceRateLimit(`sign-up:${String(formData.get("email")).trim().toLowerCase()}`, { limit: 4, windowMs: 60 * 60_000 });
  const result = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!result.success) redirect(message("/sign-up", result.error.issues[0]?.message ?? "Check your details."));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signUp({ email: result.data.email, password: result.data.password, options: { data: { display_name: result.data.displayName }, emailRedirectTo: `${siteUrl()}/auth/callback` } });
  if (error) redirect(message("/sign-up", "Account creation failed. Please try again."));
  redirect(message("/sign-in", "Check your email to confirm your account."));
}

export async function requestPasswordResetAction(formData: FormData) {
  await enforceRateLimit(`pw-reset:${String(formData.get("email")).trim().toLowerCase()}`, { limit: 4, windowMs: 60 * 60_000 });
  const result = requestPasswordResetSchema.safeParse(Object.fromEntries(formData));
  // Always show the same confirmation, whether or not the email exists, so this
  // can't be used to enumerate accounts.
  const done = message("/sign-in", "If that email has an account, a password-reset link is on its way.");
  if (!result.success) redirect(done);
  const supabase = await createSupabaseServerClient();
  await supabase.auth.resetPasswordForEmail(result.data.email, { redirectTo: `${siteUrl()}/auth/callback?next=/reset-password` });
  redirect(done);
}

export async function updatePasswordAction(formData: FormData) {
  const result = updatePasswordSchema.safeParse(Object.fromEntries(formData));
  if (!result.success) redirect(message("/reset-password", result.error.issues[0]?.message ?? "Enter a valid new password."));
  // The recovery link established a session via /auth/callback; updateUser applies
  // to that authenticated recovery session.
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: result.data.password });
  if (error) redirect(message("/reset-password", "Could not update your password. The reset link may have expired — request a new one."));
  await supabase.auth.signOut();
  redirect(message("/sign-in", "Your password has been updated. Please sign in."));
}
