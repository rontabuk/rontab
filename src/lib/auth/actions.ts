"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const signOutDestinations = ["/", "/admin/login", "/seller/login", "/creator/login"] as const;
export type SignOutDestination = (typeof signOutDestinations)[number];

export async function signOut(destination: SignOutDestination) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect(signOutDestinations.includes(destination) ? destination : "/");
}
