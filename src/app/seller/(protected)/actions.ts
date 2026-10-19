"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { FormError, runFormAction, type FormState } from "@/lib/form-state";
import { getSellerAccount } from "@/lib/seller/access";
import { normalizeSellerSocialUrl, sellerSocialPlatforms } from "@/lib/seller/social-links";
import { getProfileImageProblem, isCityId, isHttpsUrl, isUuid, normalizeUkPostcode } from "@/lib/validation";

export async function saveSellerProfile(_state: FormState, formData: FormData) {
  return runFormAction(() => persistSellerProfile(formData));
}

export async function sendSellerPhoneConfirmation() {
  return runFormAction(requestPhoneConfirmation);
}

async function persistSellerProfile(formData: FormData) {
  const shopName = String(formData.get("shop_name") ?? "").trim();
  const shopCityId = String(formData.get("shop_city_id") ?? "").trim() || null;
  const shopUrl = String(formData.get("shop_url") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const contactName = String(formData.get("contact_name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const phoneVisibility = String(formData.get("phone_visibility") ?? "collaborations");
  const websiteUrl = String(formData.get("website_url") ?? "").trim();
  const instagramUrl = String(formData.get("instagram_url") ?? "").trim();
  const socialUrls = Object.fromEntries(sellerSocialPlatforms.map((platform) => {
    const url = normalizeSellerSocialUrl(String(formData.get(platform.field) ?? ""), platform.hosts);
    if (url === null) throw new FormError(`Enter a valid HTTPS ${platform.label} profile link.`);
    return [platform.field, url || null];
  }));
  const businessAddress = String(formData.get("business_address") ?? "").trim();
  const businessPostcode = normalizeUkPostcode(String(formData.get("business_postcode") ?? ""));
  if (businessPostcode === null) throw new FormError("Enter a valid UK postcode, such as DN1 1AA.");
  const requestedLogoUrl = String(formData.get("logo_url") ?? "").trim();
  const removeLogo = formData.get("remove_logo") === "on";
  const logoFileValue = formData.get("logo_image");
  const logoFile = logoFileValue instanceof File && logoFileValue.size > 0 ? logoFileValue : null;

  if (shopName.length < 2 || shopName.length > 100) {
    throw new FormError("Shop name must be between 2 and 100 characters.");
  }
  if (shopUrl && !isHttpsUrl(shopUrl)) {
    throw new FormError("Enter a valid HTTPS shop website URL.");
  }
  if (description.length > 500) {
    throw new FormError("Shop description must be 500 characters or fewer.");
  }
  if (contactName.length > 100 || phone.length > 32 || businessAddress.length > 300) {
    throw new FormError("Contact name, phone, or business address is too long.");
  }
  if (phone && !/^\+?[0-9() -]{7,32}$/.test(phone)) {
    throw new FormError("Enter a valid phone number, preferably with its country code.");
  }
  if (!["collaborations", "public"].includes(phoneVisibility)) {
    throw new FormError("Choose whether your phone is public or shared only with selected creators.");
  }
  if (websiteUrl && !isHttpsUrl(websiteUrl)) {
    throw new FormError("Business website must use HTTPS.");
  }
  if (instagramUrl && !/^https:\/\/(www\.)?instagram\.com\//i.test(instagramUrl)) {
    throw new FormError("Enter a valid HTTPS Instagram profile URL.");
  }
  if (!logoFile && requestedLogoUrl && !isHttpsUrl(requestedLogoUrl)) {
    throw new FormError("Logo URL must be a valid HTTPS address.");
  }

  const { supabase, seller } = await getSellerAccount();
  if (seller.status === "suspended") throw new FormError("Suspended sellers cannot update their profile.");
  if (phoneVisibility === "public") {
    const { data: existingContact, error: existingContactError } = await supabase
      .from("seller_contact_details")
      .select("phone,phone_contact_confirmed_at")
      .eq("seller_profile_id", seller.id)
      .maybeSingle();
    if (existingContactError) throw new Error(existingContactError.message);
    if (!phone || phone !== existingContact?.phone || !existingContact.phone_contact_confirmed_at) {
      throw new FormError("Save and confirm this phone number first, then choose public visibility.");
    }
  }
  if (shopCityId) {
    if (!isCityId(shopCityId)) throw new FormError("Choose a supported United Kingdom city.");
    const { data: selectedCity, error: selectedCityError } = await supabase
      .from("supported_cities")
      .select("city_id")
      .eq("city_id", shopCityId)
      .maybeSingle();
    if (selectedCityError) throw new Error(selectedCityError.message);
    if (!selectedCity) throw new FormError("Choose a supported United Kingdom city.");
  }

  const logoProblem = logoFile && getProfileImageProblem(logoFile, "Shop logo");
  if (logoProblem) throw new FormError(logoProblem);

  const { data: existingProfile, error: existingProfileError } = await supabase
    .from("seller_profiles")
    .select("logo_url")
    .eq("id", seller.id)
    .single();
  if (existingProfileError) throw new Error(existingProfileError.message);

  let logoUrl = removeLogo ? null : requestedLogoUrl || existingProfile.logo_url;
  let newLogoPath: string | null = null;

  if (logoFile) {
    const safeFileName = logoFile.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    newLogoPath = `${seller.id}/${crypto.randomUUID()}-${safeFileName}`;
    const { error: uploadError } = await supabase.storage.from("seller-logos").upload(newLogoPath, logoFile, {
      cacheControl: "3600",
      contentType: logoFile.type,
      upsert: false,
    });

    if (uploadError) throw new Error(uploadError.message);
    logoUrl = supabase.storage.from("seller-logos").getPublicUrl(newLogoPath).data.publicUrl;
  }

  const { error } = await supabase
    .from("seller_profiles")
    .update({
      shop_name: shopName,
      shop_url: shopUrl || null,
      shop_city_id: shopCityId,
      description: description || null,
      logo_url: logoUrl || null,
    })
    .eq("id", seller.id);

  if (error && newLogoPath) {
    await supabase.storage.from("seller-logos").remove([newLogoPath]);
  }
  if (error?.code === "23505") {
    throw new FormError("That shop URL is already in use. Choose another one.");
  }
  if (error) throw new Error(error.message);

  const { error: contactError } = await supabase.rpc("seller_save_contact_details", {
    p_contact_name: contactName || null,
    p_phone: phone || null,
    p_website_url: websiteUrl || null,
    p_instagram_url: instagramUrl || null,
    p_business_address: businessAddress || null,
  });
  if (contactError) throw new Error(contactError.message);
  const { error: visibilityError } = await supabase.rpc("seller_set_phone_visibility", { p_phone_visibility: phoneVisibility });
  if (visibilityError?.code === "22023" || visibilityError?.code === "55000" || visibilityError?.code === "42501") {
    throw new FormError(visibilityError.message);
  }
  if (visibilityError) throw new Error(visibilityError.message);

  const { error: socialError } = await supabase.rpc("seller_save_social_links", {
    p_facebook_url: socialUrls.facebook_url,
    p_twitter_url: socialUrls.twitter_url,
    p_youtube_url: socialUrls.youtube_url,
    p_tiktok_url: socialUrls.tiktok_url,
  });
  if (socialError) throw new Error(socialError.message);

  const { error: postcodeError } = await supabase.rpc("seller_save_business_postcode", {
    p_business_postcode: businessPostcode || null,
  });
  if (postcodeError) throw new Error(postcodeError.message);

  const oldLogoPrefix = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/seller-logos/`;
  if (existingProfile.logo_url?.startsWith(oldLogoPrefix) && existingProfile.logo_url !== logoUrl) {
    const oldLogoPath = decodeURIComponent(existingProfile.logo_url.slice(oldLogoPrefix.length).split("?")[0]);
    if (oldLogoPath) await supabase.storage.from("seller-logos").remove([oldLogoPath]);
  }

  revalidatePath("/seller/profile");
  revalidatePath("/seller/profile/edit");
  revalidatePath("/seller");
  revalidatePath("/seller/products");
  revalidatePath("/admin/sellers");
  updateTag("public-catalog");
  revalidatePath("/");
  revalidatePath("/products", "page");
  revalidatePath("/products/[slug]", "page");
  redirect("/seller/profile?saved=1");
}

async function requestPhoneConfirmation() {
  const { supabase, seller } = await getSellerAccount();
  if (seller.status === "suspended") throw new FormError("Suspended sellers cannot verify contact details.");

  const [{ data: authResult, error: authError }, { data: contact, error: contactError }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("seller_contact_details").select("phone").eq("seller_profile_id", seller.id).maybeSingle(),
  ]);

  if (authError || !authResult.user?.email) throw new Error(authError?.message ?? "Registered email not found.");
  if (contactError) throw new Error(contactError.message);
  if (!contact?.phone) throw new FormError("Save a phone number before requesting confirmation.");

  const origin = (await headers()).get("origin");
  if (!origin) throw new Error("Could not determine the profile URL for email confirmation.");
  const emailRedirectTo = new URL("/auth/callback?flow=contact-phone", origin).toString();
  const { error } = await supabase.auth.signInWithOtp({
    email: authResult.user.email,
    options: { shouldCreateUser: false, emailRedirectTo },
  });
  if (error) throw new Error(error.message);

  redirect("/seller/profile/edit?verificationSent=1");
}

export async function saveSellerAdAllocations(formData: FormData) {
  const { supabase, seller } = await getSellerAccount();
  if (seller.status !== "active") throw new Error("Only active sellers can manage advertising credits.");

  const allocations: { product_id: string; clicks_remaining: number; clicks_limit: number }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("allocation_") || key.startsWith("allocation_limit_") || typeof value !== "string") continue;
    const productId = key.slice("allocation_".length);
    if (value === "shared") continue;
    const clicks = Number(value);
    const requestedLimit = Number(formData.get(`allocation_limit_${productId}`));
    if (!productId || !Number.isSafeInteger(clicks) || clicks < 0 || !Number.isSafeInteger(requestedLimit) || requestedLimit < clicks) {
      throw new Error("Enter a valid click allocation for each product.");
    }
    allocations.push({ product_id: productId, clicks_remaining: clicks, clicks_limit: requestedLimit });
  }

  const { error } = await supabase.rpc("seller_set_product_click_allocations", { p_allocations: allocations });
  if (error) throw new Error(error.message);

  revalidatePath("/seller/advertising");
  redirect("/seller/advertising?saved=1");
}

export async function markSellerAdCreditGrantsSeen() {
  const { supabase } = await getSellerAccount();
  const { error } = await supabase.rpc("seller_mark_ad_credit_grants_seen");
  if (error) throw new Error(error.message);
  revalidatePath("/seller", "layout");
}

export async function redeemSellerOfferCoupon(formData: FormData) {
  const code = String(formData.get("coupon_code") ?? "").trim().toUpperCase();
  if (!/^[A-F0-9]{20}$/.test(code)) redirect("/seller/offers?redeemError=code");
  if (formData.get("confirm_handover") !== "on") redirect("/seller/offers?redeemError=confirmation");

  const { supabase, seller } = await getSellerAccount();
  if (seller.status !== "active") redirect("/seller/offers?redeemError=unavailable");
  const { data, error } = await supabase.rpc("seller_redeem_offer_coupon", { p_coupon_code: code });
  if (error) {
    const errorType = error.code === "55000" ? "window" : error.code === "P0002" ? "notFound" : "unavailable";
    redirect(`/seller/offers?redeemError=${errorType}`);
  }

  const result = data as { status?: string; alreadyRedeemed?: boolean };
  revalidatePath("/seller/offers");
  revalidatePath("/visitor/offers");
  redirect(result.status === "expired"
    ? "/seller/offers?redeemed=expired"
    : result.alreadyRedeemed ? "/seller/offers?redeemed=already" : "/seller/offers?redeemed=1");
}

export async function deleteSellerProduct(formData: FormData) {
  const productId = String(formData.get("product_id") ?? "");
  if (!isUuid(productId)) throw new Error("Invalid product deletion request.");

  const { supabase, seller } = await getSellerAccount();
  if (seller.status !== "active") throw new Error("Only active sellers can delete products.");

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id")
    .eq("id", productId)
    .eq("seller_profile_id", seller.id)
    .maybeSingle();

  if (productError) throw new Error(productError.message);
  if (!product) {
    revalidatePath("/seller/products");
    revalidatePath("/seller");
    return;
  }

  const { data: media, error: mediaError } = await supabase
    .from("product_images")
    .select("storage_path")
    .eq("product_id", product.id);

  if (mediaError) throw new Error(mediaError.message);

  const storagePaths = (media ?? []).map((item) => item.storage_path);
  if (storagePaths.length) {
    const { error: storageError } = await supabase.storage.from("product-images").remove(storagePaths);
    if (storageError) throw new Error(storageError.message);
  }

  const { error: deleteError } = await supabase
    .from("products")
    .delete()
    .eq("id", product.id)
    .eq("seller_profile_id", seller.id);

  if (deleteError) throw new Error(deleteError.message);

  updateTag("public-catalog");
  revalidatePath("/seller/products");
  revalidatePath("/seller");
  revalidatePath("/");
}

export async function refreshSellerCatalog() {
  await getSellerAccount();
  updateTag("public-catalog");
  revalidatePath("/seller/products");
}