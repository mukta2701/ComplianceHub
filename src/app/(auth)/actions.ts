"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signInSchema, signUpSchema } from "@/features/auth/application/auth";
import { enforceRateLimit } from "@/lib/security/rate-limit";

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
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const { error } = await supabase.auth.signUp({ email: result.data.email, password: result.data.password, options: { data: { display_name: result.data.displayName }, emailRedirectTo: `${origin}/auth/callback` } });
  if (error) redirect(message("/sign-up", "Account creation failed. Please try again."));
  redirect(message("/sign-in", "Check your email to confirm your account."));
}
