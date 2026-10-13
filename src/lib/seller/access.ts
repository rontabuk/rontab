import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const getSellerAccount = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) redirect("/seller/login");

  const { data: seller, error: sellerError } = await supabase
    .from("seller_profiles")
    .select("*")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (sellerError || !seller) redirect("/seller/register");

  return { supabase, seller };
});