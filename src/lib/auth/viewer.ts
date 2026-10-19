import "server-only";

import { cache } from "react";
import { connection } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type Viewer =
  | { role: "guest" }
  | { role: "admin"; userId: string; createdAt: string }
  | { role: "seller"; userId: string; createdAt: string; displayName: string; avatarUrl: string | null; hasNewAdCreditGrants: boolean }
  | { role: "visitor"; userId: string; createdAt: string; displayName: string; emailVerifiedAt: string | null; avatarUrl: string | null; points: number | null; creatorProfileStatus: string | null; creatorProfileIsPublic: boolean };

// Shared by the header and the mobile navigation so each request resolves the account once.
export const getViewer = cache(async (): Promise<Viewer> => {
  await connection();
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user?.email_confirmed_at) return { role: "guest" };
  if (user.app_metadata?.role === "admin") return { role: "admin", userId: user.id, createdAt: user.created_at };

  const { data: seller } = await supabase
    .from("seller_profiles")
    .select("id,shop_name,logo_url")
    .eq("user_id", user.id)
    .maybeSingle();

  if (seller) {
    const { data: hasNewGrants } = await supabase.rpc("seller_has_new_ad_credit_grants");
    return { role: "seller", userId: user.id, createdAt: user.created_at, displayName: seller.shop_name, avatarUrl: seller.logo_url?.startsWith("https://") ? seller.logo_url : null, hasNewAdCreditGrants: Boolean(hasNewGrants) };
  }

  const [{ data: points, error }, { data: profile, error: profileError }, { data: creatorProfileId, error: creatorProfileIdError }] = await Promise.all([
    supabase.rpc("get_visitor_loyalty_points"),
    supabase.from("profiles").select("display_name,email_verified_at,avatar_url").eq("id", user.id).maybeSingle(),
    supabase.rpc("get_my_creator_profile_id"),
  ]);
  if (profileError) throw new Error(profileError.message);
  if (creatorProfileIdError) throw new Error(creatorProfileIdError.message);
  const avatarPath = profile?.avatar_url?.startsWith(`${user.id}/`) ? profile.avatar_url : null;
  const { data: avatar } = avatarPath
    ? await supabase.storage.from("visitor-avatars").createSignedUrl(avatarPath, 60 * 60)
    : { data: null };
  const { data: creatorProfile, error: creatorProfileError } = creatorProfileId
    ? await supabase.from("creator_profiles").select("status,is_public,display_name,profile_image_path,published_profile_image_path").eq("id", creatorProfileId).maybeSingle()
    : { data: null, error: null };
  if (creatorProfileError) throw new Error(creatorProfileError.message);
  const creatorAvatarPath = creatorProfile?.profile_image_path ?? creatorProfile?.published_profile_image_path;
  const { data: creatorAvatar } = creatorAvatarPath
    ? await supabase.storage.from("creator-profile-media").createSignedUrl(creatorAvatarPath, 60 * 60)
    : { data: null };
  return {
    role: "visitor",
    userId: user.id,
    createdAt: user.created_at,
    displayName: creatorProfile?.display_name?.trim() || profile?.display_name?.trim() || "My account",
    emailVerifiedAt: profile?.email_verified_at ?? null,
    avatarUrl: creatorAvatar?.signedUrl ?? avatar?.signedUrl ?? null,
    points: error ? null : Number(points),
    creatorProfileStatus: creatorProfile?.status ?? null,
    creatorProfileIsPublic: creatorProfile?.is_public ?? false,
  };
});
