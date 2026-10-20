import "server-only";

import { FormError } from "@/lib/form-state";
import { CREATOR_MIN_TOTAL_FOLLOWERS, creatorPlatforms, creatorSpecialties, type CreatorPlatform } from "@/lib/creator/catalog";
import { formatNumber } from "@/lib/format";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { getProfileImageProblem, isCityId, isHttpsUrl, PROFILE_IMAGE_TYPES } from "@/lib/validation";

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const allowedHosts: Record<CreatorPlatform, string[]> = {
  instagram: ["instagram.com", "www.instagram.com"],
  tiktok: ["tiktok.com", "www.tiktok.com"],
  youtube: ["youtube.com", "www.youtube.com"],
  facebook: ["facebook.com", "www.facebook.com", "fb.com", "www.fb.com"],
  x: ["x.com", "www.x.com", "twitter.com", "www.twitter.com"],
};

export type CreatorApplicationInput = ReturnType<typeof parseCreatorApplication>;

export function parseCreatorApplication(formData: FormData) {
  const displayName = String(formData.get("display_name") ?? "").trim();
  const bio = String(formData.get("bio") ?? "").trim();
  const audienceCityIds = formData.getAll("audience_city_id").map(String).filter(Boolean);
  const specialties = formData.getAll("specialty").map(String);
  const publicConsent = formData.get("public_profile_consent") === "on";
  const profileImageValue = formData.get("profile_image");
  const coverImageValue = formData.get("cover_image");
  const profileImage = profileImageValue instanceof File && profileImageValue.size > 0 ? profileImageValue : null;
  const coverImage = coverImageValue instanceof File && coverImageValue.size > 0 ? coverImageValue : null;
  const removeProfileImage = formData.get("remove_profile_image") === "on";
  const removeCoverImage = formData.get("remove_cover_image") === "on";
  if (profileImage && removeProfileImage) throw new FormError("Choose a new profile picture or remove the current one, not both.");
  if (coverImage && removeCoverImage) throw new FormError("Choose a new cover image or remove the current one, not both.");
  const profileImageProblem = profileImage && getProfileImageProblem(profileImage, "Creator profile picture");
  const coverImageProblem = coverImage && getProfileImageProblem(coverImage, "Creator cover image");
  if (profileImageProblem) throw new FormError(profileImageProblem);
  if (coverImageProblem) throw new FormError(coverImageProblem);
  const validSpecialties = new Set(creatorSpecialties.map(({ value }) => value));
  if (displayName.length < 2 || displayName.length > 100 || bio.length < 30 || bio.length > 2000) {
    throw new FormError("Add a display name and a short introduction of at least 30 characters.");
  }
  if (specialties.length < 1 || specialties.length > 5 || specialties.some((value) => !validSpecialties.has(value as never))) {
    throw new FormError("Choose between one and five content specialties.");
  }
  if (audienceCityIds.length > 10 || audienceCityIds.some((cityId) => !isCityId(cityId))
    || new Set(audienceCityIds).size !== audienceCityIds.length) {
    throw new FormError("Choose up to ten different supported audience cities.");
  }
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
  if (accounts.reduce((total, account) => total + account.follower_count, 0) < CREATOR_MIN_TOTAL_FOLLOWERS) {
    throw new FormError(`Creator accounts need at least ${formatNumber(CREATOR_MIN_TOTAL_FOLLOWERS)} followers across your social platforms.`);
  }

  const portfolioItems = [1, 2, 3].flatMap((position) => {
    const title = String(formData.get(`portfolio_${position}_title`) ?? "").trim();
    const url = String(formData.get(`portfolio_${position}_url`) ?? "").trim();
    if (!title && !url) return [];
    if (title.length < 3 || title.length > 120 || url.length > 500 || !isHttpsUrl(url)) {
      throw new FormError(`Add a title and valid HTTPS link for work sample ${position}.`);
    }
    return [{ title, url }];
  });

  return {
    displayName, bio, audienceCityIds, specialties, publicConsent, accounts, portfolioItems,
    profileImage, coverImage, removeProfileImage, removeCoverImage,
  };
}

export async function submitCreatorApplication(supabase: ServerClient, input: CreatorApplicationInput) {
  const { data: creatorProfileId, error } = await supabase.rpc("save_creator_application_with_audience_cities", {
    p_display_name: input.displayName,
    p_bio: input.bio,
    p_specialties: input.specialties,
    p_platform_accounts: input.accounts,
    p_audience_city_ids: input.audienceCityIds,
    p_portfolio_items: input.portfolioItems,
    p_public_profile_consent: input.publicConsent,
  });
  if (error?.code === "22023" || error?.code === "55000" || error?.code === "42501") throw new FormError(error.message);
  if (error) throw new Error(error.message);
  if (!creatorProfileId) throw new Error("The creator profile could not be loaded after saving.");
  return creatorProfileId;
}

type ExistingCreatorMedia = {
  profile_image_path: string | null;
  published_profile_image_path: string | null;
  cover_image_path: string | null;
  published_cover_image_path: string | null;
} | null;

export async function saveCreatorApplicationMedia(
  supabase: ServerClient,
  userId: string,
  creatorProfileId: string,
  input: CreatorApplicationInput,
  existingMedia: ExistingCreatorMedia,
) {
  const uploadedPaths: string[] = [];
  const uploadImage = async (file: File | null, kind: "profile" | "cover") => {
    if (!file) return null;
    const extension = PROFILE_IMAGE_TYPES[file.type];
    if (!extension) throw new FormError("Creator images must be JPEG, PNG, or WebP files.");
    const path = `${userId}/${creatorProfileId}/${kind}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from("creator-profile-media").upload(path, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false,
    });
    if (uploadError) {
      if (uploadedPaths.length) await supabase.storage.from("creator-profile-media").remove(uploadedPaths);
      throw new FormError(`We couldn't upload the ${kind === "profile" ? "profile picture" : "cover image"}. Please try again.`);
    }
    uploadedPaths.push(path);
    return path;
  };

  const profileImagePath = input.removeProfileImage
    ? null
    : await uploadImage(input.profileImage, "profile") ?? existingMedia?.profile_image_path ?? existingMedia?.published_profile_image_path ?? null;
  const coverImagePath = input.removeCoverImage
    ? null
    : await uploadImage(input.coverImage, "cover") ?? existingMedia?.cover_image_path ?? existingMedia?.published_cover_image_path ?? null;
  const { error: mediaError } = await supabase.rpc("creator_save_profile_media_paths", {
    p_profile_image_path: profileImagePath,
    p_cover_image_path: coverImagePath,
  });
  if (mediaError) {
    if (uploadedPaths.length) await supabase.storage.from("creator-profile-media").remove(uploadedPaths);
    if (["22023", "42501", "55000"].includes(mediaError.code ?? "")) throw new FormError(mediaError.message);
    throw new Error(mediaError.message);
  }

  const obsoleteDraftPaths = [
    existingMedia?.profile_image_path !== existingMedia?.published_profile_image_path
      ? existingMedia?.profile_image_path
      : null,
    existingMedia?.cover_image_path !== existingMedia?.published_cover_image_path
      ? existingMedia?.cover_image_path
      : null,
  ].filter((path): path is string => Boolean(path) && path !== profileImagePath && path !== coverImagePath);
  if (obsoleteDraftPaths.length) await supabase.storage.from("creator-profile-media").remove(obsoleteDraftPaths);
  return uploadedPaths;
}

export async function saveCreatorContactPhone(supabase: ServerClient, phone: string, phoneVisibility: string) {
  if (phone && (phone.length > 32 || !/^\+?[0-9() -]{7,32}$/.test(phone))) {
    throw new FormError("Enter a valid phone number, preferably with its country code.");
  }
  if (!["collaborations", "public"].includes(phoneVisibility)) {
    throw new FormError("Choose whether your phone is public or visible only to selected sellers.");
  }
  if (phoneVisibility === "public" && !phone) throw new FormError("Add a phone number before making it public.");
  const { error } = await supabase.rpc("creator_save_contact_preferences", {
    p_phone: phone || null,
    p_phone_visibility: phoneVisibility,
  });
  if (error?.code === "22023" || error?.code === "55000" || error?.code === "42501") throw new FormError(error.message);
  if (error) throw new Error(error.message);
}
