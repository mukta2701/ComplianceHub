"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicEnvironment } from "./env";

let client: ReturnType<typeof createBrowserClient> | undefined;

export function createClient() {
  const environment = getSupabasePublicEnvironment();
  client ??= createBrowserClient(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  return client;
}
