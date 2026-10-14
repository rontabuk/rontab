"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getVisitorAccount } from "@/lib/visitor/access";
import { FormError, runFormAction, type FormState } from "@/lib/form-state";
import { getProfileImageProblem, isCityId, isUuid, PROFILE_IMAGE_TYPES } from "@/lib/validation";

export async function saveVisitorProfile(_state: FormState, formData: FormData) {
  return runFormAction(() => persistVisitorProfile(formData));
}

async function persistVisitorProfile(formData: FormData) {
  const displayName = String(formData.get("display_name") ?? "").trim();
  const cityId = String(formData.get("city_id") ?? "").trim() || null;
  const requestedCountryCode = String(formData.get("city_id_country_code") ?? "").trim().toUpperCase() || null;
  const locationSubmitted = formData.has("city_id");
  const removeAvatar = formData.get("remove_avatar") === "on";
  const avatarFileValue = formData.get("avatar_image");
  const avatarFile = avatarFileValue instanceof File && avatarFileValue.size > 0 ? avatarFileValue : null;
  if (displayName.length > 100) throw new FormError("Display name must be 100 characters or fewer.");
  if (cityId && !isCityId(cityId)) throw new FormError("Choose a city from the supported UK locations.");
  const avatarProblem = avatarFile && getProfileImageProblem(avatarFile, "Profile picture");
  if (avatarProblem) throw new FormError(avatarProblem);

  const { supabase, user } = await getVisitorAccount();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("avatar_url,city_id,country_code")
    .eq("id", user.id)
    .single();
  if (profileError) throw new Error(profileError.message);
  let countryCode = requestedCountryCode;
  if (cityId) {
    const { data: selectedCity, error: selectedCityError } = await supabase
      .from("supported_cities")
      .select("city_id,country_code")
      .eq("city_id", cityId)
      .maybeSingle();
    if (selectedCityError) throw new Error(selectedCityError.message);
    if (!selectedCity) throw new FormError("Choose a city from the supported UK locations.");
    if (countryCode && countryCode !== selectedCity.country_code) throw new FormError("Choose a city that belongs to the selected country.");
    countryCode = selectedCity.country_code;
  }
  if (countryCode) {
    const { data: supportedCountry, error: countryError } = await supabase
      .from("supported_countries")
      .select("country_code")
      .eq("country_code", countryCode)
      .eq("is_enabled", true)
      .maybeSingle();
    if (countryError) throw new Error(countryError.message);
    if (!supportedCountry) throw new FormError("Choose a country currently supported by Rontab.");
  }

  const existingAvatarPath = profile.avatar_url?.startsWith(`${user.id}/`) ? profile.avatar_url : null;
  let avatarPath = removeAvatar ? null : existingAvatarPath;
  let uploadedAvatarPath: string | null = null;
  if (avatarFile) {
    uploadedAvatarPath = `${user.id}/${crypto.randomUUID()}.${PROFILE_IMAGE_TYPES[avatarFile.type]}`;
    const { error: uploadError } = await supabase.storage.from("visitor-avatars").upload(uploadedAvatarPath, avatarFile, {
      cacheControl: "3600",
      contentType: avatarFile.type,
      upsert: false,
    });
    if (uploadError) throw new Error(uploadError.message);
    avatarPath = uploadedAvatarPath;
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: displayName || null,
      avatar_url: avatarPath,
      city_id: cityId,
      country_code: countryCode,
    })
    .eq("id", user.id);

  if (error) {
    if (uploadedAvatarPath) await supabase.storage.from("visitor-avatars").remove([uploadedAvatarPath]);
    if (error.code === "55000" && locationSubmitted) redirect("/visitor?locationLocked=1");
    throw new Error(error.message);
  }

  if (existingAvatarPath && existingAvatarPath !== avatarPath) {
    await supabase.storage.from("visitor-avatars").remove([existingAvatarPath]);
  }

  revalidatePath("/visitor");
  redirect("/visitor?saved=1");
}

export async function joinLoyaltyOffer(formData: FormData) {
  const offerId = String(formData.get("offer_id") ?? "");
  if (!isUuid(offerId)) {
    redirect("/visitor/rewards?offerError=unavailable");
  }

  const { supabase } = await getVisitorAccount();
  const { data, error } = await supabase.rpc("join_loyalty_offer", { p_offer_id: offerId });
  if (error) {
    const errorType = error.code === "23514" ? "points" : error.code === "42501" ? "location" : "unavailable";
    redirect(`/visitor/rewards?offerError=${errorType}`);
  }

  const result = data as { alreadyJoined?: boolean; status?: string };
  revalidatePath("/visitor");
  revalidatePath("/visitor/rewards");
  redirect(result.alreadyJoined ? "/visitor/rewards?offerMessage=already" : "/visitor/rewards?offerMessage=joined");
}

export async function reserveSellerOfferCoupon(formData: FormData) {
  const offerId = String(formData.get("offer_id") ?? "");
  const locationId = String(formData.get("location_id") ?? "");
  const offerDate = String(formData.get("offer_date") ?? "");
  const startsAt = String(formData.get("starts_at") ?? "");
  const idempotencyKey = String(formData.get("idempotency_key") ?? "");
  const confirmed = formData.get("confirm_reservation") === "on";
  if (!isUuid(offerId) || !isUuid(locationId) || !isUuid(idempotencyKey)
    || !/^\d{4}-\d{2}-\d{2}$/.test(offerDate) || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(startsAt)) {
    redirect("/visitor/offers?error=unavailable");
  }
  if (!confirmed) redirect("/visitor/offers?error=confirmation");

  const { supabase } = await getVisitorAccount();
  const { data, error } = await supabase.rpc("reserve_seller_offer_coupon", {
    p_offer_id: offerId,
    p_location_id: locationId,
    p_offer_date: offerDate,
    p_starts_at: startsAt,
    p_idempotency_key: idempotencyKey,
  });
  if (error) {
    const errorType = error.code === "23514" ? "points" : error.code === "42501" ? "location" : "unavailable";
    redirect(`/visitor/offers?error=${errorType}`);
  }

  const result = data as { id?: string };
  revalidatePath("/visitor");
  revalidatePath("/visitor/offers");
  revalidatePath("/visitor/rewards");
  redirect(`/visitor/offers?view=vouchers&reserved=${result.id ?? ""}`);
}

export async function cancelSellerOfferCoupon(formData: FormData) {
  const couponId = String(formData.get("coupon_id") ?? "");
  if (!isUuid(couponId)) redirect("/visitor/offers?view=vouchers&error=unavailable");
  const { supabase } = await getVisitorAccount();
  const { error } = await supabase.rpc("cancel_seller_offer_coupon", { p_coupon_id: couponId });
  if (error) {
    redirect(`/visitor/offers?view=vouchers&error=${error.code === "55000" ? "cancellationClosed" : "unavailable"}`);
  }
  revalidatePath("/visitor");
  revalidatePath("/visitor/offers");
  revalidatePath("/visitor/rewards");
  redirect("/visitor/offers?view=vouchers&cancelled=1");
}