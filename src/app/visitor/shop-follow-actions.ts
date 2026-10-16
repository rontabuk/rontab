"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { FormError, runFormAction, type FormState } from "@/lib/form-state";
import { getVisitorAccount } from "@/lib/visitor/access";
import { isUuid } from "@/lib/validation";

const SHOP_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export async function toggleShopFollow(
  state: FormState & { following: boolean },
  formData: FormData,
): Promise<FormState & { following: boolean }> {
  const sellerProfileId = String(formData.get("seller_profile_id") ?? "");
  const shopSlug = String(formData.get("shop_slug") ?? "");
  if (!isUuid(sellerProfileId) || !SHOP_SLUG_PATTERN.test(shopSlug)) {
    return { error: "Invalid public shop.", following: state.following };
  }

  const requestedAction = String(formData.get("follow_action") ?? "follow");
  if (requestedAction !== "follow" && requestedAction !== "unfollow") {
    return { error: "Invalid shop follow action.", following: state.following };
  }
  const result = await runFormAction(async () => {
    const { supabase } = await getVisitorAccount(`/shops/${shopSlug}`);
    const { error } = requestedAction === "follow"
      ? await supabase.rpc("visitor_follow_seller_shop", { p_seller_profile_id: sellerProfileId })
      : await supabase.rpc("visitor_unfollow_seller_shop", { p_seller_profile_id: sellerProfileId });
    if (error?.code === "42501" || error?.code === "P0002") throw new FormError(error.message);
    if (error) throw new Error(error.message);
  });

  if (result.error) return { ...result, following: state.following };
  revalidatePath(`/shops/${shopSlug}`);
  revalidatePath("/visitor/shops-following");
  revalidatePath("/seller/profile");
  return { error: null, following: requestedAction === "follow" };
}

export async function followShop(_state: FormState, formData: FormData) {
  return runFormAction(async () => {
    const sellerProfileId = String(formData.get("seller_profile_id") ?? "");
    const shopSlug = String(formData.get("shop_slug") ?? "");
    if (!isUuid(sellerProfileId) || !SHOP_SLUG_PATTERN.test(shopSlug)) throw new FormError("Invalid public shop.");

    const { supabase } = await getVisitorAccount(`/shops/${shopSlug}`);
    const { error } = await supabase.rpc("visitor_follow_seller_shop", { p_seller_profile_id: sellerProfileId });
    if (error?.code === "42501" || error?.code === "P0002") throw new FormError(error.message);
    if (error) throw new Error(error.message);
    revalidatePath(`/shops/${shopSlug}`);
    revalidatePath("/visitor/shops-following");
    revalidatePath("/seller/profile");
    redirect(`/shops/${shopSlug}?followed=1`);
  });
}

export async function unfollowShop(_state: FormState, formData: FormData) {
  return runFormAction(async () => {
    const sellerProfileId = String(formData.get("seller_profile_id") ?? "");
    const shopSlug = String(formData.get("shop_slug") ?? "");
    if (!isUuid(sellerProfileId) || !SHOP_SLUG_PATTERN.test(shopSlug)) throw new FormError("Invalid followed shop.");

    const { supabase } = await getVisitorAccount("/visitor/shops-following");
    const { error } = await supabase.rpc("visitor_unfollow_seller_shop", { p_seller_profile_id: sellerProfileId });
    if (error?.code === "42501") throw new FormError(error.message);
    if (error) throw new Error(error.message);
    revalidatePath(`/shops/${shopSlug}`);
    revalidatePath("/visitor/shops-following");
    revalidatePath("/seller/profile");
    redirect("/visitor/shops-following?unfollowed=1");
  });
}
