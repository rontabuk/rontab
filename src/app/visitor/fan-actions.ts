"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { FormError, runFormAction, type FormState } from "@/lib/form-state";
import { isUuid } from "@/lib/validation";
import { getVisitorAccount } from "@/lib/visitor/access";

export async function followCreatorByCode(_state: FormState, formData: FormData) {
  return runFormAction(async () => {
    const code = String(formData.get("creator_code") ?? "").trim().toUpperCase();
    if (!/^RT-[A-F0-9]{10}$/.test(code)) throw new FormError("Enter a valid Rontab creator code.");
    const { supabase } = await getVisitorAccount("/visitor/fans");
    const { data, error } = await supabase.rpc("creator_follow_by_code", { p_code: code });
    if (error?.code === "22023" || error?.code === "P0002" || error?.code === "42501") throw new FormError(error.message);
    if (error) throw new Error(error.message);
    const result = data as { already_following?: boolean; creator_slug?: string; first_referral?: boolean };
    revalidatePath("/visitor/fans");
    revalidatePath("/creator");
    if (result.creator_slug) revalidatePath(`/creators/${result.creator_slug}`);
    redirect(`/visitor/fans?follow=${result.already_following ? "already" : "added"}&first=${result.first_referral ? "1" : "0"}`);
  });
}

export async function unfollowCreator(formData: FormData) {
  const creatorProfileId = String(formData.get("creator_profile_id") ?? "");
  if (!isUuid(creatorProfileId)) throw new FormError("Invalid creator profile.");
  const { supabase } = await getVisitorAccount("/visitor/fans");
  const { error } = await supabase.rpc("creator_unfollow", { p_creator_profile_id: creatorProfileId });
  if (error) throw new Error(error.message);
  revalidatePath("/visitor/fans");
  redirect("/visitor/fans?unfollowed=1");
}
