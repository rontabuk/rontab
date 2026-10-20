"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getVisitorAccount } from "@/lib/visitor/access";
import { getSafeVisitorPath } from "@/lib/visitor/paths";
import { FormError, runFormAction, type FormState } from "@/lib/form-state";
import { getProfileImageProblem, isCityId, isHttpsUrl, isUuid, normalizeUkPostcode, PROFILE_IMAGE_TYPES } from "@/lib/validation";

export async function saveVisitorProfile(_state: FormState, formData: FormData) {
  return runFormAction(() => persistVisitorProfile(formData));
}

async function persistVisitorProfile(formData: FormData) {
  const displayName = String(formData.get("display_name") ?? "").trim();
  const cityId = String(formData.get("city_id") ?? "").trim() || null;
  const requestedCountryCode = String(formData.get("city_id_country_code") ?? "").trim().toUpperCase() || null;
  const contactPhone = String(formData.get("contact_phone") ?? "").trim();
  const contactVisibility = String(formData.get("contact_visibility") ?? "private");
  const postcodeInput = String(formData.get("postcode") ?? "").trim();
  const postcode = postcodeInput ? normalizeUkPostcode(postcodeInput) : null;
  const postcodeVisibility = String(formData.get("postcode_visibility") ?? "private");
  if (postcodeInput && !postcode) throw new FormError("Enter a valid UK postcode, for example DN1 1AA.");
  if (!["private", "sellers", "creators", "public"].includes(postcodeVisibility)) throw new FormError("Choose who can see your postcode.");
  const locationSubmitted = formData.has("city_id");
  const removeAvatar = formData.get("remove_avatar") === "on";
  const avatarFileValue = formData.get("avatar_image");
  const avatarFile = avatarFileValue instanceof File && avatarFileValue.size > 0 ? avatarFileValue : null;
  if (displayName.length > 100) throw new FormError("Display name must be 100 characters or fewer.");
  if (cityId && !isCityId(cityId)) throw new FormError("Choose a city from the supported UK locations.");
  if (contactPhone && !/^\+?[0-9() -]{7,32}$/.test(contactPhone)) throw new FormError("Enter a valid phone number.");
  if (!["private", "sellers", "creators", "public"].includes(contactVisibility)) {
    throw new FormError("Choose who can see your contact details.");
  }
  const socialPlatforms = ["instagram", "tiktok", "youtube", "facebook", "x", "other"] as const;
  const socialLinks = [1, 2, 3].flatMap((position) => {
    const platform = String(formData.get(`social_${position}_platform`) ?? "").trim();
    const profileUrl = String(formData.get(`social_${position}_url`) ?? "").trim();
    if (!platform && !profileUrl) return [];
    if (!socialPlatforms.some((supportedPlatform) => supportedPlatform === platform)
      || !isHttpsUrl(profileUrl) || profileUrl.length > 500) {
      throw new FormError("Choose a social platform and enter a valid HTTPS profile link for each row.");
    }
    return [{ platform, profile_url: profileUrl }];
  });
  if (new Set(socialLinks.map((socialLink) => socialLink.platform)).size !== socialLinks.length) {
    throw new FormError("Choose each social platform only once.");
  }
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
    if (error.code === "RT014" && locationSubmitted) redirect("/visitor?cityCooldown=1");
    throw new Error(error.message);
  }

  const { error: contactError } = await supabase.rpc("save_my_member_contact_profile", {
    p_phone: contactPhone || null,
    p_contact_visibility: contactVisibility,
    p_social_links: socialLinks,
    p_postcode: postcode,
    p_postcode_visibility: postcodeVisibility,
  });
  if (contactError?.code === "22023" || contactError?.code === "42501") throw new FormError(contactError.message);
  if (contactError) throw new Error(contactError.message);

  if (existingAvatarPath && existingAvatarPath !== avatarPath) {
    await supabase.storage.from("visitor-avatars").remove([existingAvatarPath]);
  }

  revalidatePath("/visitor");
  revalidatePath(`/members/${user.id}`);
  redirect("/visitor?saved=1");
}

export async function joinLoyaltyOffer(formData: FormData) {
  const offerId = String(formData.get("offer_id") ?? "");
  if (!isUuid(offerId)) {
    redirect("/visitor/rewards?offerError=unavailable");
  }

  const { supabase, user } = await getVisitorAccount();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("email_verified_at")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (!profile?.email_verified_at) redirect("/visitor/rewards?offerError=verifyEmail");

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

export async function reportLoyaltyClaimIssue(formData: FormData) {
  const claimId = String(formData.get("claim_id") ?? "");
  const issueType = String(formData.get("issue_type") ?? "");
  const description = String(formData.get("description") ?? "").trim();
  if (!isUuid(claimId) || !["not_received", "incorrect_reward", "damaged", "other"].includes(issueType)
    || description.length < 10 || description.length > 2000) {
    redirect("/visitor/rewards?history=offers&supportError=details");
  }

  const { supabase } = await getVisitorAccount();
  const { error } = await supabase.rpc("visitor_report_loyalty_claim_issue", {
    p_claim_id: claimId,
    p_issue_type: issueType,
    p_description: description,
  });
  if (error) {
    redirect(`/visitor/rewards?history=offers&supportError=${error.code === "55000" ? "unavailable" : "submit"}`);
  }
  revalidatePath("/visitor/rewards");
  redirect("/visitor/rewards?history=offers&supportReported=1");
}


export async function reserveSellerOfferCoupon(formData: FormData) {
  const offerId = String(formData.get("offer_id") ?? "");
  const locationId = String(formData.get("location_id") ?? "");
  const offerDate = String(formData.get("offer_date") ?? "");
  const startsAt = String(formData.get("starts_at") ?? "");
  const idempotencyKey = String(formData.get("idempotency_key") ?? "");
  const confirmed = formData.get("confirm_reservation") === "on";
  const expectedPointsCost = Number(formData.get("expected_points_cost") ?? NaN);
  if (!isUuid(offerId) || !isUuid(locationId) || !isUuid(idempotencyKey)
    || !/^\d{4}-\d{2}-\d{2}$/.test(offerDate) || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(startsAt)) {
    redirect("/visitor/offers?error=unavailable");
  }
  if (!confirmed || !Number.isSafeInteger(expectedPointsCost) || expectedPointsCost < 0 || expectedPointsCost > 1_000_000) redirect("/visitor/offers?error=confirmation");

  const { supabase, user } = await getVisitorAccount();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("email_verified_at")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (!profile?.email_verified_at) redirect("/visitor/offers?error=verifyEmail");

  const { data, error } = await supabase.rpc("reserve_seller_offer_coupon_at_cost", {
    p_offer_id: offerId,
    p_location_id: locationId,
    p_offer_date: offerDate,
    p_starts_at: startsAt,
    p_idempotency_key: idempotencyKey,
    p_expected_points_cost: expectedPointsCost,
  });
  if (error) {
    if (error.code === "P0001" && error.message.includes("point cost has changed")) redirect("/visitor/offers?error=priceChanged");
    if (error.code === "P0001" && error.message.includes("per-customer reservation limit")) redirect("/visitor/offers?error=bookingLimit");
    if (error.code === "P0001" && error.message.includes("every 7 days")) redirect("/visitor/offers?error=freeCooldown");
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

export async function reportSellerVoucherIssue(formData: FormData) {
  const couponId = String(formData.get("coupon_id") ?? "");
  const issueType = String(formData.get("issue_type") ?? "");
  const description = String(formData.get("description") ?? "").trim();
  if (!isUuid(couponId) || !["not_honored", "incorrect_offer", "quality_issue", "other"].includes(issueType)
    || description.length < 10 || description.length > 2000) {
    redirect("/visitor/offers?view=vouchers&error=reportDetails");
  }

  const { supabase } = await getVisitorAccount();
  const { error } = await supabase.rpc("visitor_report_seller_voucher_issue", {
    p_coupon_id: couponId,
    p_issue_type: issueType,
    p_description: description,
  });
  if (error) {
    const errorType = error.code === "55000" ? "reportUnavailable" : "reportFailed";
    redirect(`/visitor/offers?view=vouchers&error=${errorType}`);
  }
  revalidatePath("/visitor/offers");
  redirect("/visitor/offers?view=vouchers&reported=1");
}

export async function reportMarketplaceItem(formData: FormData) {
  const returnPath = getSafeVisitorPath(String(formData.get("return_path") ?? ""));
  if (!returnPath.startsWith("/products/")) redirect("/products");
  const targetType = String(formData.get("target_type") ?? "");
  const targetId = String(formData.get(targetType === "product" ? "product_id" : "seller_profile_id") ?? "");
  const issueType = String(formData.get("issue_type") ?? "");
  const description = String(formData.get("description") ?? "").trim();
  if (!['product', 'seller_account'].includes(targetType) || !isUuid(targetId)
    || !["misleading", "prohibited", "counterfeit", "seller_conduct", "other"].includes(issueType)
    || description.length < 10 || description.length > 2000) {
    redirect(`${returnPath}?report=invalid#report`);
  }

  const { supabase } = await getVisitorAccount(returnPath);
  const { error } = await supabase.rpc("visitor_report_marketplace_item", {
    p_target_type: targetType,
    p_target_id: targetId,
    p_issue_type: issueType,
    p_description: description,
  });
  if (error) {
    const reportStatus = error.code === "42501" ? "verification" : error.code === "55000" ? "unavailable" : "failed";
    redirect(`${returnPath}?report=${reportStatus}#report`);
  }
  revalidatePath("/admin/support");
  revalidatePath(returnPath);
  redirect(`${returnPath}?report=sent#report`);
}