"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/access";
import { FormError, runFormAction, type FormState } from "@/lib/form-state";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { isCityId, isHttpsUrl, isUuid } from "@/lib/validation";

async function requireAdminClient() {
  const { supabase } = await requireAdmin();
  return supabase;
}

function parseAdminLocalDateTime(formData: FormData, fieldName: string) {
  const localValue = String(formData.get(fieldName) ?? "");
  const offsetMinutes = Number(formData.get(`${fieldName}_offset`));
  const wallClockAsUtc = new Date(`${localValue}:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localValue)
    || !Number.isInteger(offsetMinutes)
    || Math.abs(offsetMinutes) > 840
    || !Number.isFinite(wallClockAsUtc.getTime())
  ) return new Date(Number.NaN);

  return new Date(wallClockAsUtc.getTime() + offsetMinutes * 60_000);
}

export async function reviewProduct(formData: FormData) {
  const productId = String(formData.get("product_id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!isUuid(productId) || (status !== "approved" && status !== "rejected")) {
    throw new Error("Invalid product review request.");
  }

  const supabase = await requireAdminClient();
  const { error } = await supabase.rpc("admin_review_product", {
    p_product_id: productId,
    p_next_status: status,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin/products");
  revalidatePath("/");
}

export async function setProductFeatured(formData: FormData) {
  const productId = String(formData.get("product_id") ?? "");
  const isFeatured = formData.get("is_featured") === "true";
  if (!isUuid(productId)) throw new Error("Invalid product feature request.");

  const supabase = await requireAdminClient();
  const { error } = await supabase.rpc("admin_set_product_featured", {
    p_product_id: productId,
    p_is_featured: isFeatured,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin/products");
  revalidatePath("/");
}

export async function saveMarketplaceSettings(formData: FormData) {
  const productApprovalMode = String(formData.get("product_approval_mode") ?? "");
  const sellerApprovalMode = String(formData.get("seller_approval_mode") ?? "");
  const featuredDurationMinutes = Number(formData.get("featured_duration_minutes"));
  const newProductsDurationMinutes = Number(formData.get("new_products_duration_minutes"));
  const clickPriceGbpPer1000 = Number(formData.get("click_price_gbp_per_1000"));
  const visitorDailyVisitPointsCap = Number(formData.get("visitor_daily_visit_points_cap"));
  const clickPricePencePer1000 = Math.round(clickPriceGbpPer1000 * 100);

  if (
    !["manual", "automatic"].includes(productApprovalMode)
    || !["manual", "automatic"].includes(sellerApprovalMode)
    || !Number.isInteger(featuredDurationMinutes)
    || featuredDurationMinutes < 1
    || featuredDurationMinutes > 10080
    || !Number.isInteger(newProductsDurationMinutes)
    || newProductsDurationMinutes < 1
    || newProductsDurationMinutes > 10080
    || !Number.isInteger(visitorDailyVisitPointsCap)
    || visitorDailyVisitPointsCap < 1
    || visitorDailyVisitPointsCap > 250
    || !Number.isFinite(clickPriceGbpPer1000)
    || clickPriceGbpPer1000 < 0.01
    || clickPriceGbpPer1000 > 1000
    || Math.abs(clickPriceGbpPer1000 * 100 - clickPricePencePer1000) > 0.000001
  ) {
    throw new Error("Enter valid approval modes, durations, a daily visitor points cap from 1 to 250, and a click value from £0.01 to £1,000 per 1,000 clicks.");
  }

  const supabase = await requireAdminClient();
  const { error } = await supabase.rpc("admin_update_marketplace_settings", {
    p_product_approval_mode: productApprovalMode as "manual" | "automatic",
    p_seller_approval_mode: sellerApprovalMode as "manual" | "automatic",
    p_featured_duration_minutes: featuredDurationMinutes,
    p_new_products_duration_minutes: newProductsDurationMinutes,
    p_click_price_pence_per_1000: clickPricePencePer1000,
    p_visitor_daily_visit_points_cap: visitorDailyVisitPointsCap,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin/settings");
  redirect("/admin/settings?saved=1");
}

export async function saveLoyaltyOffer(formData: FormData) {
  const offerId = String(formData.get("offer_id") ?? "").trim() || null;
  const title = String(formData.get("title") ?? "").trim();
  const summary = String(formData.get("summary") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const imageUrl = String(formData.get("image_url") ?? "").trim();
  const terms = String(formData.get("terms") ?? "").trim();
  const offerType = String(formData.get("offer_type") ?? "");
  const selectionMethod = String(formData.get("selection_method") ?? "");
  const minimumPoints = Number(formData.get("minimum_points"));
  const pointsCost = Number(formData.get("points_cost"));
  const globalCapacity = Number(formData.get("global_capacity"));
  const startsAtDate = parseAdminLocalDateTime(formData, "starts_at");
  const endsAtDate = parseAdminLocalDateTime(formData, "ends_at");
  let cityQuotas: { city_id: string; capacity: number }[];
  try {
    const rawCityQuotas: unknown = JSON.parse(String(formData.get("city_quotas") ?? "[]"));
    if (!Array.isArray(rawCityQuotas) || rawCityQuotas.length > 50) throw new Error("Invalid city allocations.");
    cityQuotas = rawCityQuotas.map((value) => {
      if (!value || typeof value !== "object") throw new Error("Invalid city allocation.");
      const quota = value as { city_id?: unknown; capacity?: unknown };
      if (typeof quota.city_id !== "string" || typeof quota.capacity !== "number") {
        throw new Error("Each allocation needs a supported city and click capacity.");
      }
      return { city_id: quota.city_id.trim(), capacity: quota.capacity };
    });
  } catch {
    throw new Error("Enter valid city allocations.");
  }
  const cityQuotaTotal = cityQuotas.reduce((total, quota) => total + quota.capacity, 0);
  const hasDuplicateCity = new Set(cityQuotas.map((quota) => quota.city_id)).size !== cityQuotas.length;

  if (
    (offerId && !isUuid(offerId))
    || title.length < 3 || title.length > 120
    || summary.length < 3 || summary.length > 240
    || description.length > 2000
    || !isHttpsUrl(imageUrl) || imageUrl.length > 2048
    || !terms || terms.length > 5000
    || !["participation", "redemption"].includes(offerType)
    || !["random", "first_come"].includes(selectionMethod)
    || (offerType === "redemption" && selectionMethod !== "first_come")
    || !Number.isSafeInteger(minimumPoints) || minimumPoints < 0 || minimumPoints > 1_000_000
    || !Number.isSafeInteger(pointsCost) || pointsCost < 1 || pointsCost > 1_000_000
    || !Number.isSafeInteger(globalCapacity) || globalCapacity < 1 || globalCapacity > 100_000
    || (cityQuotas.length === 0 && !Number.isSafeInteger(globalCapacity))
    || cityQuotaTotal > 100_000
    || hasDuplicateCity
    || cityQuotas.some((quota) => !isCityId(quota.city_id) || !Number.isSafeInteger(quota.capacity) || quota.capacity < 1 || quota.capacity > 100_000)
    || !Number.isFinite(startsAtDate.getTime())
    || !Number.isFinite(endsAtDate.getTime())
    || endsAtDate <= startsAtDate
  ) {
    throw new Error("Check the offer details, points, dates, location, and image URL.");
  }

  const supabase = await requireAdminClient();
  const { error } = await supabase.rpc("admin_save_loyalty_offer", {
    p_offer_id: offerId,
    p_title: title,
    p_summary: summary,
    p_description: description,
    p_image_url: imageUrl,
    p_terms: terms,
    p_offer_type: offerType as "participation" | "redemption",
    p_selection_method: selectionMethod as "random" | "first_come",
    p_minimum_points: minimumPoints,
    p_points_cost: pointsCost,
    p_global_capacity: globalCapacity,
    p_city_quotas: cityQuotas,
    p_starts_at: startsAtDate.toISOString(),
    p_ends_at: endsAtDate.toISOString(),
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin/rewards");
  revalidatePath("/visitor/rewards");
  redirect("/admin/rewards?saved=1");
}

export async function setLoyaltyRandomDrawsEnabled(formData: FormData) {
  const enabled = formData.get("enabled") === "true";
  const supabase = await requireAdminClient();
  const { error } = await supabase.rpc("admin_set_loyalty_random_draws_enabled", { p_enabled: enabled });
  if (error?.code === "55000") redirect("/admin/rewards?randomDrawError=unfinished");
  if (error) throw new Error(error.message);

  revalidatePath("/admin/rewards");
  revalidatePath("/visitor/rewards");
}

export async function setLoyaltyOfferStatus(formData: FormData) {
  const offerId = String(formData.get("offer_id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!isUuid(offerId) || !["published", "paused"].includes(status)) {
    throw new Error("Invalid offer status request.");
  }

  const supabase = await requireAdminClient();
  const { error } = await supabase.rpc("admin_set_loyalty_offer_status", {
    p_offer_id: offerId,
    p_next_status: status as "published" | "paused",
  });
  if (error?.code === "55000") redirect("/admin/rewards?offerError=state");
  if (error) throw new Error(error.message);

  revalidatePath("/admin/rewards");
  revalidatePath("/visitor/rewards");
}

export async function runLoyaltyOfferDraw(formData: FormData) {
  const offerId = String(formData.get("offer_id") ?? "");
  if (!isUuid(offerId)) {
    throw new Error("Invalid offer draw request.");
  }

  const supabase = await requireAdminClient();
  const { data: winnerCount, error } = await supabase.rpc("admin_run_loyalty_offer_draw", { p_offer_id: offerId });
  if (error?.code === "55000") redirect(`/admin/rewards?claims=${offerId}&drawError=not-ready`);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/rewards");
  revalidatePath("/visitor/rewards");
  redirect(`/admin/rewards?claims=${offerId}&drawn=${winnerCount}`);
}

export async function markLoyaltyClaimFulfilled(formData: FormData) {
  const claimId = String(formData.get("claim_id") ?? "");
  const offerId = String(formData.get("offer_id") ?? "");
  if (!isUuid(claimId) || !isUuid(offerId)) throw new Error("Invalid fulfilment request.");

  const supabase = await requireAdminClient();
  const { error } = await supabase.rpc("admin_set_loyalty_claim_fulfilled", { p_claim_id: claimId });
  if (error) throw new Error(error.message);

  revalidatePath("/admin/rewards");
  revalidatePath("/visitor/rewards");
  redirect(`/admin/rewards?claims=${offerId}&fulfilled=1#recipient-details`);
}

export async function setSellerStatus(formData: FormData) {
  const sellerId = String(formData.get("seller_id") ?? "");
  const status = String(formData.get("status") ?? "");
  const isPublic = formData.get("is_public") === "on";
  if (!isUuid(sellerId) || !["pending", "active", "suspended"].includes(status)) {
    throw new Error("Invalid seller update request.");
  }

  const supabase = await requireAdminClient();
  const { error } = await supabase.rpc("admin_set_seller_status", {
    p_seller_id: sellerId,
    p_next_status: status as "pending" | "active" | "suspended",
    p_is_public: isPublic,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin/sellers");
}

export async function setVisitorAccountStatus(formData: FormData) {
  const visitorId = String(formData.get("visitor_id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!isUuid(visitorId) || !["active", "suspended"].includes(status)) {
    throw new Error("Invalid visitor account update request.");
  }

  const { admin } = await requireAdmin();

  const supabase = createSupabaseServiceRoleClient();
  const { data, error: userError } = await supabase.auth.admin.getUserById(visitorId);
  if (userError || data.user.app_metadata?.role === "admin") {
    throw new Error("Visitor account not found.");
  }

  const { data: seller, error: sellerError } = await supabase
    .from("seller_profiles")
    .select("id")
    .eq("user_id", visitorId)
    .maybeSingle();
  if (sellerError) throw new Error(sellerError.message);
  if (seller) throw new Error("Seller accounts must be managed from the Sellers page.");

  const nextStatus = status as "active" | "suspended";
  const { error: updateError } = await supabase.auth.admin.updateUserById(visitorId, {
    ban_duration: nextStatus === "suspended" ? "876000h" : "none",
  });
  if (updateError) throw new Error(updateError.message);

  const { error: auditError } = await supabase.from("admin_audit_logs").insert({
    actor_id: admin.id,
    action: nextStatus === "suspended" ? "visitor_account_suspended" : "visitor_account_reactivated",
    entity_type: "visitor_account",
    entity_id: visitorId,
    details: { email: data.user.email ?? "", status: nextStatus },
  });
  if (auditError) throw new Error(auditError.message);

  revalidatePath("/admin/visitors");
}

export async function grantSellerAdCredits(formData: FormData) {
  const sellerId = String(formData.get("seller_id") ?? "");
  const clicks = Number(formData.get("clicks"));
  const note = String(formData.get("note") ?? "").trim();
  if (!isUuid(sellerId) || !Number.isSafeInteger(clicks) || clicks < 1 || clicks > 10_000_000 || note.length > 300) {
    throw new Error("Enter a valid click grant between 1 and 10,000,000 and a note under 300 characters.");
  }

  const supabase = await requireAdminClient();
  const { error } = await supabase.rpc("admin_grant_seller_ad_credits", {
    p_seller_id: sellerId,
    p_clicks: clicks,
    p_note: note,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin/sellers");
  revalidatePath("/seller/advertising");
}

export async function saveCategory(formData: FormData) {
  const categoryId = String(formData.get("category_id") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const imageUrl = String(formData.get("image_url") ?? "").trim();
  const sortOrder = Number(formData.get("sort_order") ?? 0);
  const isActive = formData.get("is_active") === "on";

  if ((categoryId && !isUuid(categoryId)) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !name || !Number.isInteger(sortOrder)
    || (imageUrl && !isHttpsUrl(imageUrl))) {
    throw new Error("Enter a valid category name, slug, sort order, and HTTPS image URL.");
  }

  const supabase = await requireAdminClient();
  const { error } = await supabase.rpc("admin_save_category", {
    p_category_id: categoryId || null,
    p_slug: slug,
    p_name: name,
    p_description: description || null,
    p_image_url: imageUrl || null,
    p_is_active: isActive,
    p_sort_order: sortOrder,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin/categories");
  revalidatePath("/");
}

const TOP_VIDEO_AD_PATH = /^[0-9a-f-]{36}\.(mp4|webm|jpg|png|webp)$/;

const ANNOUNCEMENT_AUDIENCES = ["everyone", "visitors", "sellers"] as const;

export async function createAnnouncement(_state: FormState, formData: FormData): Promise<FormState> {
  return runFormAction(async () => {
    const title = String(formData.get("title") ?? "").trim();
    const body = String(formData.get("body") ?? "").trim();
    const linkUrl = String(formData.get("link_url") ?? "").trim();
    const audience = String(formData.get("audience") ?? "") as (typeof ANNOUNCEMENT_AUDIENCES)[number];
    const isValidLink = !linkUrl || isHttpsUrl(linkUrl) || /^\/[a-z0-9/_?=&#-]*$/i.test(linkUrl);

    if (!title || title.length > 120 || !body || body.length > 500 || !isValidLink || !ANNOUNCEMENT_AUDIENCES.includes(audience)) {
      throw new FormError("Enter a title (up to 120 characters), a message (up to 500), an HTTPS or on-site link, and an audience.");
    }

    const supabase = await requireAdminClient();
    const { error } = await supabase.rpc("admin_create_announcement", {
      p_title: title,
      p_body: body,
      p_link_url: linkUrl || null,
      p_audience: audience,
    });
    if (error) throw new Error(error.message);

    revalidatePath("/admin/notifications");
    revalidatePath("/", "layout");
  });
}

export async function setAnnouncementActive(formData: FormData) {
  const announcementId = String(formData.get("announcement_id") ?? "");
  if (!isUuid(announcementId)) throw new Error("Invalid announcement.");

  const supabase = await requireAdminClient();
  const { error } = await supabase.rpc("admin_set_announcement_active", {
    p_announcement_id: announcementId,
    p_is_active: formData.get("is_active") === "true",
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin/notifications");
  revalidatePath("/", "layout");
}

function parseTopVideoAdFields(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const targetUrl = String(formData.get("target_url") ?? "").trim();
  const sortOrder = Number(formData.get("sort_order") ?? 0);
  const displaySeconds = Number(formData.get("display_seconds") ?? 8);
  if (!title || title.length > 120 || !Number.isInteger(sortOrder) || (targetUrl && !isHttpsUrl(targetUrl))
    || !Number.isInteger(displaySeconds) || displaySeconds < 3 || displaySeconds > 60) {
    throw new FormError("Enter a title (up to 120 characters), a whole-number order, an image time of 3–60 seconds, and an HTTPS link if needed.");
  }
  return { title, targetUrl: targetUrl || null, sortOrder, displaySeconds, isActive: formData.get("is_active") === "on" };
}

export async function createTopVideoAd(_state: FormState, formData: FormData): Promise<FormState> {
  return runFormAction(async () => {
    const storagePath = String(formData.get("storage_path") ?? "");
    if (!TOP_VIDEO_AD_PATH.test(storagePath)) throw new FormError("Upload a video (MP4, WebM) or an image (JPEG, PNG, WebP) first.");
    const fields = parseTopVideoAdFields(formData);

    const supabase = await requireAdminClient();
    const { error } = await supabase.rpc("admin_create_top_video_ad", {
      p_title: fields.title,
      p_storage_path: storagePath,
      p_media_type: /\.(mp4|webm)$/.test(storagePath) ? "video" : "image",
      p_display_seconds: fields.displaySeconds,
      p_target_url: fields.targetUrl,
      p_is_active: fields.isActive,
      p_sort_order: fields.sortOrder,
    });
    if (error) {
      await supabase.storage.from("top-video-ads").remove([storagePath]);
      throw new Error(error.message);
    }

    revalidatePath("/admin/video-ads");
    revalidatePath("/products");
  });
}

export async function updateTopVideoAd(formData: FormData) {
  const adId = String(formData.get("ad_id") ?? "");
  if (!isUuid(adId)) throw new Error("Invalid video ad.");
  const fields = parseTopVideoAdFields(formData);

  const supabase = await requireAdminClient();
  const { error } = await supabase.rpc("admin_update_top_video_ad", {
    p_ad_id: adId,
    p_title: fields.title,
    p_display_seconds: fields.displaySeconds,
    p_target_url: fields.targetUrl,
    p_is_active: fields.isActive,
    p_sort_order: fields.sortOrder,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin/video-ads");
  revalidatePath("/products");
}

export async function deleteTopVideoAd(formData: FormData) {
  const adId = String(formData.get("ad_id") ?? "");
  if (!isUuid(adId)) throw new Error("Invalid video ad.");

  const supabase = await requireAdminClient();
  const { data: storagePath, error } = await supabase.rpc("admin_delete_top_video_ad", { p_ad_id: adId });
  if (error) throw new Error(error.message);
  if (storagePath) await supabase.storage.from("top-video-ads").remove([storagePath]);

  revalidatePath("/admin/video-ads");
  revalidatePath("/products");
}