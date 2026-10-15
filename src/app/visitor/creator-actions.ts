"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { FormError, runFormAction, type FormState } from "@/lib/form-state";
import { creatorPlatforms, creatorSpecialties, type CreatorPlatform } from "@/lib/creator/catalog";
import { isCityId, isHttpsUrl, isUuid } from "@/lib/validation";
import { getVisitorAccount } from "@/lib/visitor/access";

const allowedHosts: Record<CreatorPlatform, string[]> = {
  instagram: ["instagram.com", "www.instagram.com"],
  tiktok: ["tiktok.com", "www.tiktok.com"],
  youtube: ["youtube.com", "www.youtube.com"],
  facebook: ["facebook.com", "www.facebook.com", "fb.com", "www.fb.com"],
  x: ["x.com", "www.x.com", "twitter.com", "www.twitter.com"],
};

export async function saveCreatorApplication(_state: FormState, formData: FormData) {
  return runFormAction(async () => {
    const displayName = String(formData.get("display_name") ?? "").trim();
    const bio = String(formData.get("bio") ?? "").trim();
    const audienceCityId = String(formData.get("audience_city_id") ?? "").trim() || null;
    const specialties = formData.getAll("specialty").map(String);
    const publicConsent = formData.get("public_profile_consent") === "on";
    const validSpecialties = new Set(creatorSpecialties.map(({ value }) => value));
    if (displayName.length < 2 || displayName.length > 100 || bio.length < 30 || bio.length > 2000) {
      throw new FormError("Add a display name and a short introduction of at least 30 characters.");
    }
    if (specialties.length < 1 || specialties.length > 5 || specialties.some((value) => !validSpecialties.has(value as never))) {
      throw new FormError("Choose between one and five content specialties.");
    }
    if (audienceCityId && !isCityId(audienceCityId)) throw new FormError("Choose a supported audience city.");
    if (!publicConsent) throw new FormError("Confirm that these details and links may appear on your public creator profile.");

    const accounts = creatorPlatforms.flatMap(({ value: platform }) => {
      const handle = String(formData.get(`platform_${platform}_handle`) ?? "").trim();
      const profileUrl = String(formData.get(`platform_${platform}_url`) ?? "").trim();
      const followerValue = String(formData.get(`platform_${platform}_followers`) ?? "").trim();
      if (!handle && !profileUrl && !followerValue) return [];
      if (!handle || !profileUrl || !/^[0-9]{1,10}$/.test(followerValue)) {
        throw new FormError(`Complete the handle, profile link, and follower count for ${platform}.`);
      }
      let url: URL;
      try {
        url = new URL(profileUrl);
      } catch {
        throw new FormError(`Enter a valid ${platform} profile link.`);
      }
      if (url.protocol !== "https:" || !allowedHosts[platform].includes(url.hostname.toLowerCase())
        || url.pathname === "/" || url.search || url.hash || profileUrl.length > 500) {
        throw new FormError(`Use a secure ${platform} profile link from the official platform domain.`);
      }
      const followerCount = Number(followerValue);
      if (!Number.isSafeInteger(followerCount) || followerCount > 1_000_000_000 || handle.length > 100) {
        throw new FormError(`Enter a valid follower count and handle for ${platform}.`);
      }
      return [{ platform, handle, profile_url: url.toString(), follower_count: followerCount }];
    });
    if (accounts.length < 1) throw new FormError("Add at least one social platform.");

    const portfolioItems = [1, 2, 3].flatMap((position) => {
      const title = String(formData.get(`portfolio_${position}_title`) ?? "").trim();
      const url = String(formData.get(`portfolio_${position}_url`) ?? "").trim();
      if (!title && !url) return [];
      if (title.length < 3 || title.length > 120 || url.length > 500 || !isHttpsUrl(url)) {
        throw new FormError(`Add a title and valid HTTPS link for work sample ${position}.`);
      }
      return [{ title, url }];
    });

    const { supabase } = await getVisitorAccount("/visitor/creator");
    const { error } = await supabase.rpc("save_creator_application", {
      p_display_name: displayName,
      p_bio: bio,
      p_specialties: specialties,
      p_platform_accounts: accounts,
      p_audience_city_id: audienceCityId,
      p_portfolio_items: portfolioItems,
      p_public_profile_consent: publicConsent,
    });
    if (error?.code === "22023" || error?.code === "55000") throw new FormError(error.message);
    if (error) throw new Error(error.message);

    revalidatePath("/visitor/creator");
    revalidatePath("/creators");
    redirect("/visitor/creator?submitted=1");
  });
}

export async function withdrawCreatorProfile() {
  const { supabase } = await getVisitorAccount("/visitor/creator");
  const { error } = await supabase.rpc("creator_withdraw_public_profile");
  if (error?.code === "P0002" || error?.code === "55000" || error?.code === "42501") throw new FormError(error.message);
  if (error) throw new Error(error.message);

  revalidatePath("/visitor/creator");
  revalidatePath("/creators");
  redirect("/visitor/creator?withdrawn=1");
}

export async function respondToCreatorCollaborationRequest(formData: FormData) {
  const requestId = String(formData.get("request_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const response = String(formData.get("response") ?? "").trim();
  if (!isUuid(requestId) || !["accept", "decline"].includes(decision) || response.length > 2000) {
    throw new FormError("Invalid collaboration response.");
  }

  const { supabase } = await getVisitorAccount("/visitor/creator");
  const { error } = await supabase.rpc("creator_decide_collaboration_request", {
    p_request_id: requestId,
    p_decision: decision,
    p_response: response,
  });
  if (error?.code === "22023" || error?.code === "55000" || error?.code === "42501") throw new FormError(error.message);
  if (error) throw new Error(error.message);

  revalidatePath("/visitor/creator");
  redirect("/visitor/creator?replied=1");
}

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
    revalidatePath("/visitor/creator");
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