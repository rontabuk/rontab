"use server";

import { headers } from "next/headers";
import { isBetaMode } from "@/lib/beta";
import { createTestStripe, getTestBillingConfig, purchaseIdPattern } from "@/lib/billing/stripe";
import { getSellerAccount } from "@/lib/seller/access";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

export async function startTestCreditCheckout(formData: FormData): Promise<{ error: string | null; url: string | null }> {
  if (isBetaMode()) return { error: "Payments are not enabled during the beta.", url: null };
  const config = getTestBillingConfig();
  if (!config) return { error: "Test payments are not configured.", url: null };
  const clicks = Number(formData.get("clicks"));
  const expectedRate = Number(formData.get("expectedRate"));
  const requestId = String(formData.get("requestId") ?? "");
  if (!Number.isSafeInteger(clicks) || clicks < 1000 || clicks > 1_000_000 || clicks % 1000 !== 0
    || !Number.isSafeInteger(expectedRate) || expectedRate < 1 || expectedRate > 100_000 || !purchaseIdPattern.test(requestId)) {
    return { error: "Choose a valid number of clicks and refresh the page if its price changed.", url: null };
  }
  const origin = (await headers()).get("origin");
  if (origin !== config.origin) return { error: "Checkout must start from the configured Rontab site.", url: null };
  const { seller } = await getSellerAccount();
  if (seller.status !== "active" || !config.sellerIds.includes(seller.id)) {
    return { error: "Test checkout is available only to designated active test shops.", url: null };
  }
  try {
    const serviceClient = createSupabaseServiceRoleClient();
    const { data, error } = await serviceClient.rpc("seller_create_credit_purchase", {
      p_seller_id: seller.id, p_clicks: clicks, p_expected_rate: expectedRate, p_request_id: requestId,
    });
    if (error || !data?.[0]) return { error: error?.code === "22023" ? error.message : "We couldn't create your purchase. Please try again.", url: null };
    const purchase = data[0];
    if (purchase.status !== "pending") return { error: "This purchase is already completed or expired. Refresh before starting another.", url: null };
    const stripe = createTestStripe(config);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      allowed_payment_method_types: ["card"],
      client_reference_id: purchase.id,
      metadata: { purchase_id: purchase.id, seller_profile_id: seller.id },
      payment_intent_data: { metadata: { purchase_id: purchase.id, seller_profile_id: seller.id } },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "gbp",
          unit_amount: purchase.amount_pence,
          product_data: { name: `${purchase.clicks.toLocaleString("en-GB")} advertising click credits (TEST)` },
        },
      }],
      success_url: `${config.origin}/seller/advertising?purchase=${purchase.id}`,
      cancel_url: `${config.origin}/seller/advertising?purchase=${purchase.id}&cancelled=1`,
    }, { idempotencyKey: `rontab-test-credit-${purchase.id}` });
    if (session.livemode || session.status !== "open" || !session.id.startsWith("cs_test_") || !session.url) {
      return { error: "Test checkout is unavailable. Refresh and try again.", url: null };
    }
    const checkoutUrl = new URL(session.url);
    if (checkoutUrl.protocol !== "https:" || checkoutUrl.hostname !== "checkout.stripe.com" || checkoutUrl.username || checkoutUrl.password) {
      return { error: "Unexpected checkout address. No payment was started.", url: null };
    }
    const attached = await serviceClient.rpc("billing_attach_credit_checkout", {
      p_purchase_id: purchase.id, p_session_id: session.id,
    });
    if (attached.error) return { error: "We couldn't save the checkout session. Please try again.", url: null };
    return { error: null, url: checkoutUrl.href };
  } catch {
    return { error: "Test checkout is temporarily unavailable. Please try again.", url: null };
  }
}