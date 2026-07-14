"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signInSchema, signUpSchema, requestPasswordResetSchema, updatePasswordSchema } from "@/features/auth/application/auth";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { siteUrl } from "@/lib/site-url";
import { safePostAuthPath } from "@/lib/auth-destination";

function message(path: string, value: string, next?: string) {
  const params = new URLSearchParams({ message: value });
  if (next) params.set("next", next);
  return `${path}?${params.toString()}`;
}

function safeNext(formData: FormData): string {
  return safePostAuthPath(formData.get("next"));
}

function authCallbackUrl(next: string): string {
  const callback = new URL("/auth/callback", siteUrl());
  callback.searchParams.set("next", next);
  return callback.toString();
}

export async function signInAction(formData: FormData) {
  const next = safeNext(formData);
  await enforceRateLimit(`sign-in:${String(formData.get("email")).trim().toLowerCase()}`, { limit: 8, windowMs: 15 * 60_000 });
  const result = signInSchema.safeParse(Object.fromEntries(formData));
  if (!result.success) redirect(message("/sign-in", "Enter a valid email and password.", next));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(result.data);
  if (error) redirect(message("/sign-in", "Sign-in failed. Check your details and try again.", next));
  redirect(next);
}

export async function signUpAction(formData: FormData) {
  const next = safeNext(formData);
  await enforceRateLimit(`sign-up:${String(formData.get("email")).trim().toLowerCase()}`, { limit: 4, windowMs: 60 * 60_000 });
  const result = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!result.success) redirect(message("/sign-up", result.error.issues[0]?.message ?? "Check your details.", next));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signUp({ email: result.data.email, password: result.data.password, options: { data: { display_name: result.data.displayName }, emailRedirectTo: authCallbackUrl(next) } });
  if (error) redirect(message("/sign-up", "Account creation failed. Please try again.", next));
  redirect(message("/sign-in", "Check your email to confirm your account.", next));
}

export async function signInWithOAuthAction(formData: FormData) {
  const next = safeNext(formData);
  const provider = formData.get("provider");
  if (provider !== "google" && provider !== "azure") {
    redirect(message("/sign-in", "That sign-in method is unavailable.", next));
  }

  const enabled = provider === "google"
    ? process.env.GOOGLE_AUTH_ENABLED === "1"
    : process.env.MICROSOFT_AUTH_ENABLED === "1";
  if (!enabled) redirect(message("/sign-in", "That sign-in method is unavailable.", next));

  const supabase = await createSupabaseServerClient();
  const options: { redirectTo: string; scopes?: string } = { redirectTo: authCallbackUrl(next) };
  if (provider === "azure") options.scopes = "email";
  const { data, error } = await supabase.auth.signInWithOAuth({ provider, options });

  let providerUrl: URL | null = null;
  try {
    providerUrl = data.url ? new URL(data.url) : null;
  } catch {
    providerUrl = null;
  }
  const safeProtocol = providerUrl?.protocol === "https:"
    || (process.env.NODE_ENV !== "production" && providerUrl?.protocol === "http:");
  if (error || !providerUrl || !safeProtocol || providerUrl.username || providerUrl.password) {
    redirect(message("/sign-in", "Could not start that sign-in method. Please try again.", next));
  }
  redirect(providerUrl.toString());
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
