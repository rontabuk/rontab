"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function signOutSeller() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/seller/login");
}