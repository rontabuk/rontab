"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { FormError, runFormAction, type FormState } from "@/lib/form-state";
import { creatorPlatforms, creatorSpecialties, type CreatorPlatform } from "@/lib/creator/catalog";
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
    const specialties = formData.getAll("specialty").map(String);
    const validSpecialties = new Set(creatorSpecialties.map(({ value }) => value));
    if (displayName.length < 2 || displayName.length > 100 || bio.length < 30 || bio.length > 2000) {
      throw new FormError("Add a display name and a short introduction of at least 30 characters.");
    }
    if (specialties.length < 1 || specialties.length > 5 || specialties.some((value) => !validSpecialties.has(value as never))) {
      throw new FormError("Choose between one and five content specialties.");
    }

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

    const { supabase } = await getVisitorAccount("/visitor/creator");
    const { error } = await supabase.rpc("save_creator_application", {
      p_display_name: displayName,
      p_bio: bio,
      p_specialties: specialties,
      p_platform_accounts: accounts,
    });
    if (error?.code === "22023" || error?.code === "55000") throw new FormError(error.message);
    if (error) throw new Error(error.message);

    revalidatePath("/visitor/creator");
    revalidatePath("/creators");
    redirect("/visitor/creator?submitted=1");
  });
}