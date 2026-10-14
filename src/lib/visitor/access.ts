import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSafeVisitorPath } from "@/lib/visitor/paths";

export const getVisitorAccount = cache(async (returnPath = "/visitor") => {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user?.email_confirmed_at) {
    redirect(`/account?next=${encodeURIComponent(getSafeVisitorPath(returnPath))}`);
  }
  if (authData.user.app_metadata?.role === "admin") redirect("/admin");

  const { data: seller, error: sellerError } = await supabase
    .from("seller_profiles")
    .select("id")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (sellerError) throw new Error(sellerError.message);
  if (seller) redirect("/");

  return { supabase, user: authData.user };
});