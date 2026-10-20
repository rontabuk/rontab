"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { FormError, runFormAction, type FormState } from "@/lib/form-state";
import { getCreatorAccount } from "@/lib/creator/access";
import { sendCreatorEmailVerification } from "@/lib/creator/email-verification";
import { parseCreatorApplication, saveCreatorApplicationMedia, saveCreatorContactPhone, submitCreatorApplication } from "@/lib/creator/application";

export async function saveCreatorApplication(_state: FormState, formData: FormData) {
  return runFormAction(async () => {
    const input = parseCreatorApplication(formData);
    const { supabase, user, creatorProfileId } = await getCreatorAccount();
    const { data: existingMedia, error: existingMediaError } = await supabase.from("creator_profiles")
      .select("profile_image_path,published_profile_image_path,cover_image_path,published_cover_image_path")
      .eq("id", creatorProfileId)
      .maybeSingle();
    if (existingMediaError) throw new Error(existingMediaError.message);

    const savedProfileId = await submitCreatorApplication(supabase, input);
    await saveCreatorApplicationMedia(supabase, user.id, savedProfileId, input, existingMedia);

    revalidatePath("/creator");
    revalidatePath("/creators");
    redirect("/creator?submitted=1");
  });
}

export async function saveCreatorContactPreferences(_state: FormState, formData: FormData) {
  return runFormAction(async () => {
    const phone = String(formData.get("phone") ?? "").trim();
    const phoneVisibility = String(formData.get("phone_visibility") ?? "collaborations");
    const { supabase, creatorProfileId } = await getCreatorAccount();
    await saveCreatorContactPhone(supabase, phone, phoneVisibility);
    const { data: profile, error: profileLookupError } = await supabase.from("creator_profiles").select("slug").eq("id", creatorProfileId).maybeSingle();
    if (profileLookupError) throw new Error(profileLookupError.message);
    if (profile) revalidatePath(`/creators/${profile.slug}`);
    revalidatePath("/creators");
    revalidatePath("/creator");
    redirect("/creator?contactSaved=1");
  });
}

export async function resendCreatorEmailVerification() {
  const { supabase, user } = await getCreatorAccount();
  const { data: profile, error } = await supabase.from("profiles").select("email_verified_at").eq("id", user.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (profile?.email_verified_at || !user.email) redirect("/creator");
  const result = await sendCreatorEmailVerification(supabase, user.email);
  redirect(result === "sent" ? "/creator?verificationSent=1" : `/creator?verificationError=${result}`);
}

export async function withdrawCreatorProfile() {
  const { supabase } = await getCreatorAccount();
  const { error } = await supabase.rpc("creator_withdraw_public_profile");
  if (error?.code === "P0002" || error?.code === "55000" || error?.code === "42501") throw new FormError(error.message);
  if (error) throw new Error(error.message);

  revalidatePath("/creator");
  revalidatePath("/creators");
  redirect("/creator?withdrawn=1");
}
