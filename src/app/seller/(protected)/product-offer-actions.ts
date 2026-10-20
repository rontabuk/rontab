"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { FormError, runFormAction, type FormState } from "@/lib/form-state";
import { getSellerAccount } from "@/lib/seller/access";
import { isOfferCombinationSupported, isValidCustomerOfferLimit, isValidOfferQuantity } from "@/lib/seller/offer-policy";
import { isSellerOfferSchemaUnavailable } from "@/lib/seller/offer-schema";
import { isCityId, isUuid, normalizeUkPostcode } from "@/lib/validation";

export async function publishProductOffer(_state: FormState, formData: FormData) {
  return runFormAction(async () => {
    const productId = String(formData.get("product_id") ?? "");
    const requestId = String(formData.get("request_id") ?? "");
    const audience = String(formData.get("audience") ?? "");
    const fulfillment = String(formData.get("fulfillment") ?? "");
    const submittedCities = formData.getAll("city_ids");
    const cityIds = [...new Set((submittedCities.length ? submittedCities : formData.getAll("city_id")).map((value) => String(value).trim()))].sort();
    const postcode = normalizeUkPostcode(String(formData.get("postcode") ?? ""));
    const validFrom = String(formData.get("valid_from") ?? "");
    const validUntil = String(formData.get("valid_until") ?? "");
    const kind = String(formData.get("offer_kind") ?? "");
    const benefit = String(formData.get("benefit_details") ?? "").trim();
    if (!isUuid(productId) || !isUuid(requestId) || cityIds.length > 10 || cityIds.some((cityId) => !isCityId(cityId))) throw new FormError("Choose a product and up to 10 supported UK cities, or none for All UK.");
    if ((audience !== "general" && audience !== "reward") || (fulfillment !== "branch" && fulfillment !== "online")
      || !isOfferCombinationSupported(audience, fulfillment)) throw new FormError("Points rewards must use a branch voucher.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) throw new FormError("Choose valid offer dates.");
    if (!["discount", "free_item", "meal", "other"].includes(kind) || benefit.length < 3 || benefit.length > 1000) throw new FormError("Describe the offer benefit in 3 to 1,000 characters.");
    if (fulfillment === "branch" && !postcode) throw new FormError("Enter a valid UK postcode for the redemption branch.");
    const externalCode = String(formData.get("external_code") ?? "").trim();
    const onlineCodeUses = Number(formData.get("online_code_uses"));
    if (fulfillment === "online" && kind !== "discount") throw new FormError("Seller website offers must be percentage discounts. Free products, meals and special offers use RonTab branch vouchers.");
    if (fulfillment === "online" && !/^[A-Za-z0-9_-]{3,40}$/.test(externalCode)) throw new FormError("Enter a discount code of 3 to 40 letters, numbers, hyphens or underscores.");
    if (fulfillment === "online" && (!Number.isInteger(onlineCodeUses) || onlineCodeUses < 1 || onlineCodeUses > 100000)) throw new FormError("Enter how many times the code can be used, from 1 to 100,000.");
    if (formData.get("accept_terms") !== "on") throw new FormError("Accept the offer and cancellation conditions.");
    const maxClaims = Number(formData.get("max_claims"));
    const maxPerCustomer = Number(formData.get("max_per_customer"));
    if (fulfillment === "branch" && !isValidOfferQuantity(maxClaims)) throw new FormError("Total vouchers must be a whole number from 1 to 1,000.");
    if (fulfillment === "branch" && kind === "discount" && !isValidCustomerOfferLimit(maxPerCustomer, maxClaims)) {
      throw new FormError("The per-customer limit must be a whole number between 1 and the total voucher count.");
    }
    const { supabase } = await getSellerAccount();
    const parameters = {
      p_request_id: requestId,
      p_product_id: productId,
      p_payload: {
        audience, fulfillment, city_id: cityIds[0], postcode, valid_from: validFrom, valid_until: validUntil,
        offer_kind: kind, benefit_details: benefit,
        discount_percent: kind === "discount" ? String(formData.get("discount_percent") ?? "") : null,
        starts_at: fulfillment === "branch" ? String(formData.get("starts_at") ?? "") : null,
        ends_at: fulfillment === "branch" ? String(formData.get("ends_at") ?? "") : null,
        daily_capacity: fulfillment === "branch" ? maxClaims : null,
        max_claims: fulfillment === "branch" ? maxClaims : null,
        max_per_customer: fulfillment === "branch" && kind === "discount" ? maxPerCustomer : null,
        external_code: fulfillment === "online" ? externalCode : null,
        accept_terms: true,
      },
    };
    const { error } = fulfillment === "online"
      ? await supabase.rpc("seller_publish_online_discount_offer", { ...parameters, p_city_ids: cityIds, p_code_uses: onlineCodeUses })
      : cityIds.length !== 1
      ? await supabase.rpc("seller_publish_product_offer_in_cities", { ...parameters, p_city_ids: cityIds })
      : await supabase.rpc("seller_publish_product_offer", parameters);
    if (cityIds.length !== 1 && isSellerOfferSchemaUnavailable(error)) throw new FormError("All UK and multi-city publishing require the latest database migrations. No offer was published.");
    if (isSellerOfferSchemaUnavailable(error)) throw new FormError("Product offers are not enabled yet. No changes were made.");
    if (error && ["22023", "42501", "55000"].includes(error.code)) throw new FormError(error.message);
    if (error) throw new Error(error.message);
    revalidateOfferPages();
    redirect("/seller/offers?published=1");
  });
}

export async function cancelProductOffer(_state: FormState, formData: FormData) {
  return runFormAction(async () => {
    const offerId = String(formData.get("offer_id") ?? "");
    if (!isUuid(offerId) || formData.get("confirm_cancellation") !== "on") throw new FormError("Confirm cancellation of this offer and its unused active vouchers.");
    const { supabase } = await getSellerAccount();
    const { error } = await supabase.rpc("seller_cancel_product_offer", { p_offer_id: offerId });
    if (error) throw new FormError("The offer could not be cancelled. Please try again.");
    revalidateOfferPages();
    redirect("/seller/offers?cancelled=1");
  });
}

function revalidateOfferPages() {
  revalidatePath("/seller/offers");
  revalidatePath("/visitor");
  revalidatePath("/visitor/offers");
  revalidatePath("/visitor/rewards");
}

export type VoucherInspection = {
  code: string;
  title: string;
  benefit: string;
  branch: string;
  postcode: string | null;
  date: string;
  startsAt: string;
  endsAt: string;
  status: string;
  canRedeem: boolean;
};

export type VoucherInspectionState = { error: string | null; voucher: VoucherInspection | null };

export async function inspectSellerOfferVoucher(_state: VoucherInspectionState, formData: FormData): Promise<VoucherInspectionState> {
  const code = String(formData.get("coupon_code") ?? "").trim().toUpperCase();
  if (!/^[A-F0-9]{20}$/.test(code)) return { error: "Enter the 20-character voucher code.", voucher: null };
  const { supabase } = await getSellerAccount();
  const { data, error } = await supabase.rpc("seller_inspect_offer_coupon", { p_coupon_code: code });
  if (error) return { error: error.code === "P0002" ? "Voucher not found for your shop." : "Voucher checking is currently unavailable.", voucher: null };
  return { error: null, voucher: data as VoucherInspection };
}