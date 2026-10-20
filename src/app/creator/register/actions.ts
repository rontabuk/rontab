"use server";

import { redirect } from "next/navigation";
import { FormError, runFormAction, type FormState } from "@/lib/form-state";
import { parseCreatorApplication, saveCreatorApplicationMedia, saveCreatorContactPhone, submitCreatorApplication } from "@/lib/creator/application";
import { sendCreatorEmailVerification } from "@/lib/creator/email-verification";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { isCityId } from "@/lib/validation";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Creator accounts are standalone: a new sign-in, profile, and influence balance, never added to a visitor or seller account.
export async function registerCreatorAccount(_state: FormState, formData: FormData) {
  return runFormAction(async () => {
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");
    const cityId = String(formData.get("city_id") ?? "").trim();
    const countryCode = String(formData.get("city_id_country_code") ?? "").trim().toUpperCase();
    const phone = String(formData.get("phone") ?? "").trim();
    if (!EMAIL_PATTERN.test(email) || email.length > 254) throw new FormError("Enter a valid email address.");
    if (password.length < 8 || password.length > 72) throw new FormError("Use a password between 8 and 72 characters.");
    if (!isCityId(cityId) || !/^[A-Z]{2}$/.test(countryCode)) throw new FormError("Choose your country and city.");
    if (phone && (phone.length > 32 || !/^\+?[0-9() -]{7,32}$/.test(phone))) {
      throw new FormError("Enter a valid phone number, preferably with its country code, or leave it empty.");
    }
    const input = parseCreatorApplication(formData);
    if (!input.profileImage) throw new FormError("Add a profile picture for your creator account.");

    let admin;
    try {
      admin = createSupabaseServiceRoleClient();
    } catch {
      throw new FormError("Creator registration is temporarily unavailable. Please try again shortly.");
    }

    const [{ data: city, error: cityError }, { data: country, error: countryError }] = await Promise.all([
      admin.from("supported_cities").select("city_id,country_code").eq("city_id", cityId).eq("is_enabled", true).maybeSingle(),
      admin.from("supported_countries").select("country_code").eq("country_code", countryCode).eq("is_enabled", true).maybeSingle(),
    ]);
    if (cityError || countryError) throw new FormError("We couldn't verify your location. Please try again.");
    if (!country) throw new FormError("Choose a country currently supported by Rontab.");
    if (!city || city.country_code !== countryCode) throw new FormError("Choose a city in the selected country.");

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { account_type: "creator", display_name: input.displayName },
      app_metadata: { account_type: "creator" },
    });
    if (createError) {
      if (createError.status === 422 || /already/i.test(createError.message)) {
        throw new FormError("This email already belongs to a Rontab account. A creator account needs its own email address.");
      }
      if (/password/i.test(createError.message)) throw new FormError("Choose a stronger password with at least 8 characters.");
      console.error("Creator registration failed:", createError.message);
      throw new FormError("We couldn't create your creator account. Please try again.");
    }

    const userId = created.user.id;
    const supabase = await createSupabaseServerClient();
    let uploadedPaths: string[] = [];
    try {
      const { error: profileError } = await admin
        .from("profiles")
        .update({ city_id: cityId, country_code: countryCode, display_name: input.displayName })
        .eq("id", userId);
      if (profileError) throw new Error(profileError.message);

      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw new Error(signInError.message);

      const creatorProfileId = await submitCreatorApplication(supabase, input);
      uploadedPaths = await saveCreatorApplicationMedia(supabase, userId, creatorProfileId, input, null);
      if (phone) await saveCreatorContactPhone(supabase, phone, "collaborations");
    } catch (error) {
      if (uploadedPaths.length) await admin.storage.from("creator-profile-media").remove(uploadedPaths);
      await supabase.auth.signOut();
      const { error: rollbackError } = await admin.auth.admin.deleteUser(userId);
      if (rollbackError) console.error("Creator registration rollback failed:", rollbackError.message);
      if (error instanceof FormError) throw error;
      console.error("Creator registration setup failed:", error instanceof Error ? error.message : error);
      throw new FormError("We couldn't finish creating your creator account, so nothing was saved. Please try again.");
    }

    const verification = await sendCreatorEmailVerification(supabase, email);
    redirect(`/creator?registered=1${verification === "sent" ? "&verificationSent=1" : ""}`);
  });
}
