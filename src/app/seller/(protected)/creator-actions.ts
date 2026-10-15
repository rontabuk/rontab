"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { FormError, runFormAction, type FormState } from "@/lib/form-state";
import { getSellerAccount } from "@/lib/seller/access";
import { isUuid } from "@/lib/validation";

export async function sendCreatorCollaborationRequest(_state: FormState, formData: FormData) {
  return runFormAction(async () => {
    const creatorProfileId = String(formData.get("creator_profile_id") ?? "");
    const creatorSlug = String(formData.get("creator_slug") ?? "");
    const title = String(formData.get("title") ?? "").trim();
    const brief = String(formData.get("brief") ?? "").trim();
    const proposedCompensation = String(formData.get("proposed_compensation") ?? "").trim();
    if (!isUuid(creatorProfileId) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(creatorSlug)
      || title.length < 3 || title.length > 120
      || brief.length < 30 || brief.length > 2000 || proposedCompensation.length > 500) {
      throw new FormError("Add a title, a brief of at least 30 characters, and compensation details under 500 characters.");
    }

    const { supabase, seller } = await getSellerAccount();
    if (seller.status !== "active") throw new FormError("Only active sellers can request creator collaborations.");
    const { error } = await supabase.rpc("seller_create_creator_collaboration_request", {
      p_creator_profile_id: creatorProfileId,
      p_seller_profile_id: seller.id,
      p_title: title,
      p_brief: brief,
      p_proposed_compensation: proposedCompensation,
    });
    if (error?.code === "22023" || error?.code === "55000" || error?.code === "42501") throw new FormError(error.message);
    if (error) throw new Error(error.message);

    revalidatePath("/creators");
    revalidatePath(`/creators/${creatorSlug}`);
    redirect(`/creators/${creatorSlug}?request=sent`);
  });
}