"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";

export async function markNotificationReadAction(formData: FormData) {
  const { supabase } = await requireAppContext();
  const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", Number(formData.get("id"))); if (error) throw new Error("Could not mark the notification read");
  revalidatePath("/app/notifications"); revalidatePath("/app", "layout");
}

export async function markAllNotificationsReadAction() {
  const { supabase } = await requireAppContext();
  const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null); if (error) throw new Error("Could not mark notifications read");
  revalidatePath("/app/notifications"); revalidatePath("/app", "layout");
}
