"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { FormError, runFormAction, type FormState } from "@/lib/form-state";
import { creatorSpecialties } from "@/lib/creator/catalog";
import { getSellerAccount } from "@/lib/seller/access";
import { isCityId, isUuid } from "@/lib/validation";

export async function createCreatorProductOpportunity(_state: FormState, formData: FormData) {
  return runFormAction(async () => {
    const productId = String(formData.get("product_id") ?? "");
    const budget = Number(formData.get("budget"));
    const specialties = formData.getAll("specialty").map(String);
    const isNationwide = formData.get("is_nationwide") === "on";
    const cityIds = isNationwide ? [] : formData.getAll("target_city_id").map(String);
    const brief = String(formData.get("brief") ?? "").trim();
    const productProvided = formData.get("product_provided") === "on";
    const deadlineValue = String(formData.get("deadline") ?? "").trim();
    const deadline = deadlineValue || null;
    const contactMethods = formData.getAll("contact_method").map(String);
    const validSpecialties = new Set(creatorSpecialties.map(({ value }) => value));

    if (!isUuid(productId) || !Number.isFinite(budget) || budget <= 0 || budget > 1_000_000
      || Math.round(budget * 100) / 100 !== budget) {
      throw new FormError("Enter a valid product and campaign budget.");
    }
    if (specialties.length < 1 || specialties.length > 5
      || specialties.some((specialty) => !validSpecialties.has(specialty as never))
      || new Set(specialties).size !== specialties.length) {
      throw new FormError("Choose one to five different creator specialties.");
    }
    if (!isNationwide && (cityIds.length < 1 || cityIds.length > 15
      || cityIds.some((cityId) => !isCityId(cityId)) || new Set(cityIds).size !== cityIds.length)) {
      throw new FormError("Choose the United Kingdom or one to 15 different supported cities.");
    }
    if (brief.length < 30 || brief.length > 2000) throw new FormError("Describe the campaign in 30 to 2,000 characters.");
    if (deadline && (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || Number.isNaN(Date.parse(`${deadline}T00:00:00Z`)))) {
      throw new FormError("Choose a valid campaign deadline.");
    }
    if (contactMethods.length < 1 || contactMethods.length > 2
      || contactMethods.some((method) => !["email", "phone"].includes(method))
      || new Set(contactMethods).size !== contactMethods.length) {
      throw new FormError("Choose at least one verified contact method to share with the selected creator.");
    }

    const { supabase, seller } = await getSellerAccount();
    if (seller.status !== "active") throw new FormError("Only active sellers can publish creator opportunities.");
    const { data: opportunityId, error } = await supabase.rpc("seller_create_creator_product_opportunity", {
      p_product_id: productId,
      p_budget: budget,
      p_target_specialties: specialties,
      p_is_nationwide: isNationwide,
      p_target_city_ids: cityIds,
      p_brief: brief,
      p_product_provided: productProvided,
      p_deadline: deadline,
      p_contact_methods: contactMethods,
    });
    if (error?.code === "22023" || error?.code === "55000" || error?.code === "42501" || error?.code === "23505") {
      throw new FormError(error.message);
    }
    if (error) throw new Error(error.message);

    revalidatePath(`/seller/products/${productId}/creator-opportunity`);
    revalidatePath("/visitor/creator/opportunities");
    redirect(`/seller/products/${productId}/creator-opportunity?created=1&opportunity=${opportunityId}`);
  });
}

export async function selectCreatorProductOpportunityProposal(formData: FormData) {
  const productId = String(formData.get("product_id") ?? "");
  const proposalId = String(formData.get("proposal_id") ?? "");
  if (!isUuid(productId) || !isUuid(proposalId)) throw new FormError("Invalid creator offer selection.");
  const { supabase, seller } = await getSellerAccount();
  if (seller.status !== "active") throw new FormError("Only active sellers can select a creator offer.");
  const { error } = await supabase.rpc("seller_select_creator_product_opportunity_proposal", { p_proposal_id: proposalId });
  if (error?.code === "55000" || error?.code === "42501") throw new FormError(error.message);
  if (error) throw new Error(error.message);
  revalidatePath(`/seller/products/${productId}/creator-opportunity`);
  revalidatePath("/visitor/creator/opportunities");
  redirect(`/seller/products/${productId}/creator-opportunity?selected=1`);
}

export async function closeCreatorProductOpportunity(formData: FormData) {
  const productId = String(formData.get("product_id") ?? "");
  const opportunityId = String(formData.get("opportunity_id") ?? "");
  if (!isUuid(productId) || !isUuid(opportunityId)) throw new FormError("Invalid creator opportunity.");
  const { supabase, seller } = await getSellerAccount();
  if (seller.status !== "active") throw new FormError("Only active sellers can close creator opportunities.");
  const { error } = await supabase.rpc("seller_close_creator_product_opportunity", { p_opportunity_id: opportunityId });
  if (error?.code === "55000" || error?.code === "42501") throw new FormError(error.message);
  if (error) throw new Error(error.message);
  revalidatePath(`/seller/products/${productId}/creator-opportunity`);
  revalidatePath("/visitor/creator/opportunities");
  redirect(`/seller/products/${productId}/creator-opportunity?closed=1`);
}
