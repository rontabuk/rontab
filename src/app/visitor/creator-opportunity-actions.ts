"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { FormError, runFormAction, type FormState } from "@/lib/form-state";
import { getVisitorAccount } from "@/lib/visitor/access";
import { isUuid } from "@/lib/validation";

export async function submitCreatorProductOpportunityProposal(_state: FormState, formData: FormData) {
  return runFormAction(async () => {
    const opportunityId = String(formData.get("opportunity_id") ?? "");
    const amount = Number(formData.get("amount"));
    const offerDetails = String(formData.get("offer_details") ?? "").trim();
    const shareEmail = formData.get("share_email") === "on";
    const sharePhone = formData.get("share_phone") === "on";
    const contactPhone = String(formData.get("contact_phone") ?? "").trim();
    if (!isUuid(opportunityId) || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000
      || Math.round(amount * 100) / 100 !== amount) {
      throw new FormError("Enter a valid offer amount.");
    }
    if (offerDetails.length < 30 || offerDetails.length > 2000) {
      throw new FormError("Describe what you will deliver in 30 to 2,000 characters.");
    }
    if (!shareEmail && !sharePhone) throw new FormError("Choose at least one contact method to share if your offer is selected.");
    if (sharePhone && !/^\+?[0-9() -]{7,32}$/.test(contactPhone)) {
      throw new FormError("Enter a valid phone number to share with the seller.");
    }

    const { supabase } = await getVisitorAccount("/visitor/creator/opportunities");
    const { error } = await supabase.rpc("creator_submit_product_opportunity_proposal", {
      p_opportunity_id: opportunityId,
      p_amount: amount,
      p_offer_details: offerDetails,
      p_share_email: shareEmail,
      p_share_phone: sharePhone,
      p_contact_phone: sharePhone ? contactPhone : null,
    });
    if (error?.code === "22023" || error?.code === "55000" || error?.code === "42501") {
      throw new FormError(error.message);
    }
    if (error) throw new Error(error.message);
    revalidatePath("/visitor/creator/opportunities");
    redirect("/visitor/creator/opportunities?submitted=1");
  });
}

export async function withdrawCreatorProductOpportunityProposal(formData: FormData) {
  const proposalId = String(formData.get("proposal_id") ?? "");
  if (!isUuid(proposalId)) throw new FormError("Invalid creator offer.");
  const { supabase } = await getVisitorAccount("/visitor/creator/opportunities");
  const { error } = await supabase.rpc("creator_withdraw_product_opportunity_proposal", { p_proposal_id: proposalId });
  if (error?.code === "55000" || error?.code === "42501") throw new FormError(error.message);
  if (error) throw new Error(error.message);
  revalidatePath("/visitor/creator/opportunities");
  redirect("/visitor/creator/opportunities?withdrawn=1");
}
