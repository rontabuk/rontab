import "server-only";

import { cache } from "react";
import { connection } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type Viewer =
  | { role: "guest" }
  | { role: "admin"; userId: string }
  | { role: "seller"; userId: string; hasNewAdCreditGrants: boolean }
  | { role: "visitor"; userId: string; createdAt: string; emailVerifiedAt: string | null; points: number | null; creatorProfileStatus: string | null; creatorProfileIsPublic: boolean };

// Shared by the header and the mobile navigation so each request resolves the account once.
export const getViewer = cache(async (): Promise<Viewer> => {
  await connection();
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user?.email_confirmed_at) return { role: "guest" };
  if (user.app_metadata?.role === "admin") return { role: "admin", userId: user.id };

  const { data: seller } = await supabase
    .from("seller_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (seller) {
    const { data: hasNewGrants } = await supabase.rpc("seller_has_new_ad_credit_grants");
    return { role: "seller", userId: user.id, hasNewAdCreditGrants: Boolean(hasNewGrants) };
  }

  const [{ data: points, error }, { data: profile, error: profileError }, { data: creatorProfileId, error: creatorProfileIdError }] = await Promise.all([
    supabase.rpc("get_visitor_loyalty_points"),
    supabase.from("profiles").select("email_verified_at").eq("id", user.id).maybeSingle(),
    supabase.rpc("get_my_creator_profile_id"),
  ]);
  if (profileError) throw new Error(profileError.message);
  if (creatorProfileIdError) throw new Error(creatorProfileIdError.message);
  const { data: creatorProfile, error: creatorProfileError } = creatorProfileId
    ? await supabase.from("creator_profiles").select("status,is_public").eq("id", creatorProfileId).maybeSingle()
    : { data: null, error: null };
  if (creatorProfileError) throw new Error(creatorProfileError.message);
  return {
    role: "visitor",
    userId: user.id,
    createdAt: user.created_at,
    emailVerifiedAt: profile?.email_verified_at ?? null,
    points: error ? null : Number(points),
    creatorProfileStatus: creatorProfile?.status ?? null,
    creatorProfileIsPublic: creatorProfile?.is_public ?? false,
  };
});
