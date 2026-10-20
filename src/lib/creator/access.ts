import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Only the service role can set app_metadata, so this marker cannot be self-assigned.
export function isCreatorUser(user: Pick<User, "app_metadata"> | null | undefined) {
  return user?.app_metadata?.account_type === "creator";
}

export const getCreatorAccount = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user?.email_confirmed_at) redirect("/creator/login");
  if (authData.user.app_metadata?.role === "admin") redirect("/admin");
  if (!isCreatorUser(authData.user)) redirect("/creator/register");

  const { data: creatorProfileId, error } = await supabase.rpc("get_my_creator_profile_id");
  if (error) throw new Error(error.message);
  // Registration creates the profile atomically, so a creator account without one needs support rather than a redirect loop.
  if (!creatorProfileId) throw new Error("This creator account has no creator profile. Please contact Rontab support.");

  return { supabase, user: authData.user, creatorProfileId };
});
