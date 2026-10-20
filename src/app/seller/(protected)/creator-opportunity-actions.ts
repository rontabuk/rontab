"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { FormError, runFormAction, type FormState } from "@/lib/form-state";
import { MIN_CREATOR_OPPORTUNITY_BUDGET, creatorSpecialties } from "@/lib/creator/catalog";
import { getSellerAccount } from "@/lib/seller/access";
import { isCityId, isUuid } from "@/lib/validation";

function readBudgetAndTerms(formData: FormData) {
  const budget = Number(formData.get("budget"));
  const brief = String(formData.get("brief") ?? "").trim();
  const productProvided = formData.get("product_provided") === "on";
  const allowCounterOffers = formData.get("allow_counter_offers") === "on";
  const deadlineValue = String(formData.get("deadline") ?? "").trim();
  const deadline = deadlineValue || null;
  const contactMethods = formData.getAll("contact_method").map(String);
  if (!Number.isFinite(budget) || budget < MIN_CREATOR_OPPORTUNITY_BUDGET || budget > 1_000_000
    || Math.round(budget * 100) / 100 !== budget) {
    throw new FormError(`Enter a promotion budget of at least ${MIN_CREATOR_OPPORTUNITY_BUDGET}.`);
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
  return { budget, brief, productProvided, allowCounterOffers, deadline, contactMethods };
}

function throwKnownOpportunityError(error: { code?: string; message: string } | null) {
  if (error?.code === "22023" || error?.code === "55000" || error?.code === "42501" || error?.code === "23505") {
    throw new FormError(error.message);
  }
  if (error) throw new Error(error.message);
}

export async function createCreatorProductOpportunity(_state: FormState, formData: FormData) {
  return runFormAction(async () => {
    const productId = String(formData.get("product_id") ?? "");
    const specialties = formData.getAll("specialty").map(String);
    const isNationwide = formData.get("is_nationwide") === "on";
    const cityIds = isNationwide ? [] : formData.getAll("target_city_id").map(String);
    const validSpecialties = new Set(creatorSpecialties.map(({ value }) => value));

    if (!isUuid(productId)) throw new FormError("Choose a valid product.");
    const terms = readBudgetAndTerms(formData);
    if (specialties.length < 1 || specialties.length > 5
      || specialties.some((specialty) => !validSpecialties.has(specialty as never))
      || new Set(specialties).size !== specialties.length) {
      throw new FormError("Choose one to five different creator specialties.");
    }
    if (!isNationwide && (cityIds.length < 1 || cityIds.length > 15
      || cityIds.some((cityId) => !isCityId(cityId)) || new Set(cityIds).size !== cityIds.length)) {
      throw new FormError("Choose the United Kingdom or one to 15 different supported cities.");
    }

    const { supabase, seller } = await getSellerAccount();
    if (seller.status !== "active") throw new FormError("Only active sellers can publish creator opportunities.");
    const { data: opportunityId, error } = await supabase.rpc("seller_create_creator_product_opportunity", {
      p_product_id: productId,
      p_budget: terms.budget,
      p_target_specialties: specialties,
      p_is_nationwide: isNationwide,
      p_target_city_ids: cityIds,
      p_brief: terms.brief,
      p_product_provided: terms.productProvided,
      p_deadline: terms.deadline,
      p_contact_methods: terms.contactMethods,
      p_allow_counter_offers: terms.allowCounterOffers,
    });
    throwKnownOpportunityError(error);

    revalidatePath(`/seller/products/${productId}/creator-opportunity`);
    revalidatePath("/creator/opportunities");
    redirect(`/seller/products/${productId}/creator-opportunity?created=1&opportunity=${opportunityId}`);
  });
}

export async function inviteCreatorToProductOpportunity(_state: FormState, formData: FormData) {
  return runFormAction(async () => {
    const productId = String(formData.get("product_id") ?? "");
    const creatorProfileId = String(formData.get("creator_profile_id") ?? "");
    const creatorSlug = String(formData.get("creator_slug") ?? "");
    if (!isUuid(productId)) throw new FormError("Choose one of your approved products.");
    if (!isUuid(creatorProfileId) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(creatorSlug)) throw new FormError("Invalid creator.");
    const terms = readBudgetAndTerms(formData);

    const { supabase, seller } = await getSellerAccount();
    if (seller.status !== "active") throw new FormError("Only active sellers can invite creators.");
    const { data: opportunityId, error } = await supabase.rpc("seller_create_creator_product_opportunity", {
      p_product_id: productId,
      p_budget: terms.budget,
      p_target_specialties: [],
      p_is_nationwide: true,
      p_target_city_ids: [],
      p_brief: terms.brief,
      p_product_provided: terms.productProvided,
      p_deadline: terms.deadline,
      p_contact_methods: terms.contactMethods,
      p_allow_counter_offers: terms.allowCounterOffers,
      p_invited_creator_profile_id: creatorProfileId,
    });
    throwKnownOpportunityError(error);

    revalidatePath(`/creators/${creatorSlug}`);
    revalidatePath(`/seller/products/${productId}/creator-opportunity`);
    revalidatePath("/creator/opportunities");
    redirect(`/seller/products/${productId}/creator-opportunity?invited=1&opportunity=${opportunityId}`);
  });
}

export async function selectCreatorProductOpportunityProposal(formData: FormData) {
  const productId = String(formData.get("product_id") ?? "");
  const proposalId = String(formData.get("proposal_id") ?? "");
  const opportunityId = String(formData.get("opportunity_id") ?? "");
  if (!isUuid(productId) || !isUuid(proposalId) || !isUuid(opportunityId)) throw new FormError("Invalid creator offer selection.");
  const { supabase, seller } = await getSellerAccount();
  if (seller.status !== "active") throw new FormError("Only active sellers can select a creator offer.");
  const { error } = await supabase.rpc("seller_select_creator_product_opportunity_proposal", { p_proposal_id: proposalId });
  if (error?.code === "55000" || error?.code === "42501") throw new FormError(error.message);
  if (error) throw new Error(error.message);
  revalidatePath(`/seller/products/${productId}/creator-opportunity`);
  revalidatePath("/creator/opportunities");
  redirect(`/seller/products/${productId}/creator-opportunity?selected=1&opportunity=${opportunityId}`);
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
  revalidatePath("/creator/opportunities");
  redirect(`/seller/products/${productId}/creator-opportunity?closed=1&opportunity=${opportunityId}`);
}

export async function reviewCreatorProductOpportunityDelivery(_state: FormState, formData: FormData) {
  return runFormAction(async () => {
    const productId = String(formData.get("product_id") ?? "");
    const opportunityId = String(formData.get("opportunity_id") ?? "");
    const decision = String(formData.get("decision") ?? "");
    const revisionNote = String(formData.get("revision_note") ?? "").trim();
    if (!isUuid(productId) || !isUuid(opportunityId) || (decision !== "complete" && decision !== "revise")) {
      throw new FormError("Invalid delivery review.");
    }
    if (decision === "revise" && (revisionNote.length < 10 || revisionNote.length > 1000)) {
      throw new FormError("Explain the requested changes in 10 to 1,000 characters.");
    }
    const { supabase, seller } = await getSellerAccount();
    if (seller.status !== "active") throw new FormError("Only active sellers can review creator deliveries.");
    const { error } = await supabase.rpc("seller_review_product_opportunity_delivery", {
      p_opportunity_id: opportunityId,
      p_decision: decision,
      p_revision_note: decision === "revise" ? revisionNote : null,
    });
    throwKnownOpportunityError(error);
    revalidatePath(`/seller/products/${productId}/creator-opportunity`);
    revalidatePath(`/creator/opportunities/${opportunityId}`);
    redirect(`/seller/products/${productId}/creator-opportunity?${decision === "complete" ? "completed" : "revision"}=1&opportunity=${opportunityId}`);
  });
}

export async function rateCreatorForProductOpportunity(_state: FormState, formData: FormData) {
  return runFormAction(async () => {
    const productId = String(formData.get("product_id") ?? "");
    const opportunityId = String(formData.get("opportunity_id") ?? "");
    const rating = Number(formData.get("rating"));
    const comment = String(formData.get("comment") ?? "").trim();
    if (!isUuid(productId) || !isUuid(opportunityId)) throw new FormError("Invalid collaboration.");
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new FormError("Choose a rating from 1 to 5.");
    if (comment.length > 500) throw new FormError("Keep your comment under 500 characters.");
    const { supabase } = await getSellerAccount();
    const { error } = await supabase.rpc("submit_product_opportunity_review", {
      p_opportunity_id: opportunityId,
      p_rating: rating,
      p_comment: comment || null,
    });
    throwKnownOpportunityError(error);
    revalidatePath(`/seller/products/${productId}/creator-opportunity`);
    revalidatePath("/creators");
    redirect(`/seller/products/${productId}/creator-opportunity?rated=1&opportunity=${opportunityId}`);
  });
}
