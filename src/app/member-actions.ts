"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";

function memberProfilePath(profileId: string, status: string) {
  return `/members/${profileId}?${new URLSearchParams({ [status]: "1" })}`;
}

export async function followMemberProfile(formData: FormData) {
  const profileId = String(formData.get("profile_id") ?? "");
  if (!isUuid(profileId)) throw new Error("Invalid member profile.");
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email_confirmed_at) redirect(`/account?next=${encodeURIComponent(`/members/${profileId}`)}`);

  const { data, error } = await supabase.rpc("follow_member_profile", { p_member_user_id: profileId });
  if (error?.code === "22023") redirect(memberProfilePath(profileId, "followError"));
  if (error?.code === "42501") redirect(memberProfilePath(profileId, "followUnavailable"));
  if (error) throw new Error(error.message);
  revalidatePath(`/members/${profileId}`);
  redirect(memberProfilePath(profileId, data ? "followed" : "alreadyFollowing"));
}

export async function unfollowMemberProfile(formData: FormData) {
  const profileId = String(formData.get("profile_id") ?? "");
  if (!isUuid(profileId)) throw new Error("Invalid member profile.");
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email_confirmed_at) redirect(`/account?next=${encodeURIComponent(`/members/${profileId}`)}`);

  const { error } = await supabase.rpc("unfollow_member_profile", { p_member_user_id: profileId });
  if (error?.code === "42501") redirect(memberProfilePath(profileId, "followUnavailable"));
  if (error) throw new Error(error.message);
  revalidatePath(`/members/${profileId}`);
  redirect(memberProfilePath(profileId, "unfollowed"));
}
