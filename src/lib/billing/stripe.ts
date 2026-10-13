import "server-only";

import Stripe from "stripe";
import type { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

export const purchaseIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getTestBillingConfig() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const sellerIds = (process.env.STRIPE_TEST_SELLER_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  if (!secretKey?.startsWith("sk_test_") || !webhookSecret?.startsWith("whsec_")
    || !process.env.SUPABASE_SERVICE_ROLE_KEY || !sellerIds.length
    || sellerIds.some((id) => !purchaseIdPattern.test(id))) return null;
  try {
    const site = new URL(process.env.BILLING_SITE_URL ?? "");
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(site.hostname);
    if ((site.protocol !== "https:" && !(local && site.protocol === "http:"))
      || site.username || site.password || site.pathname !== "/" || site.search || site.hash) return null;
    return { secretKey, webhookSecret, sellerIds, origin: site.origin };
  } catch {
    return null;
  }
}

export type TestBillingConfig = NonNullable<ReturnType<typeof getTestBillingConfig>>;

export function createTestStripe(config: TestBillingConfig) {
  return new Stripe(config.secretKey, { maxNetworkRetries: 2, timeout: 20_000 });
}

export async function syncTestCreditPurchase(
  eventSession: Stripe.Checkout.Session,
  eventId: string,
  eventType: "checkout.session.completed" | "checkout.session.expired",
  config: TestBillingConfig,
  stripe: Stripe,
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
) {
  const purchaseId = eventSession.client_reference_id;
  if (eventSession.livemode || !eventSession.id.startsWith("cs_test_")
    || !purchaseId || !purchaseIdPattern.test(purchaseId)) throw new Error("Invalid test checkout.");
  const session = await stripe.checkout.sessions.retrieve(eventSession.id);
  const { data: purchase, error } = await supabase.from("seller_credit_purchases").select("*").eq("id", purchaseId).maybeSingle();
  if (error) throw new Error("Purchase lookup failed.");
  if (!purchase || !purchase.is_test || !config.sellerIds.includes(purchase.seller_profile_id)
    || session.livemode || session.mode !== "payment" || session.currency !== "gbp"
    || session.client_reference_id !== purchase.id || session.metadata?.purchase_id !== purchase.id
    || session.metadata?.seller_profile_id !== purchase.seller_profile_id
    || session.amount_total !== purchase.amount_pence
    || (purchase.stripe_checkout_session_id && purchase.stripe_checkout_session_id !== session.id)) {
    throw new Error("Checkout does not match the recorded test purchase.");
  }
  if (eventType === "checkout.session.expired") {
    if (session.status !== "expired") throw new Error("Checkout is not expired.");
    const result = await supabase.rpc("billing_expire_credit_purchase", { p_purchase_id: purchase.id, p_session_id: session.id });
    if (result.error) throw new Error("Purchase expiry failed.");
    return;
  }
  if (session.status !== "complete" || session.payment_status !== "paid" || typeof session.payment_intent !== "string") {
    throw new Error("Checkout payment is not complete.");
  }
  const payment = await stripe.paymentIntents.retrieve(session.payment_intent);
  if (payment.livemode || payment.status !== "succeeded" || payment.currency !== "gbp"
    || payment.amount_received !== purchase.amount_pence || payment.metadata.purchase_id !== purchase.id
    || payment.metadata.seller_profile_id !== purchase.seller_profile_id) throw new Error("Payment does not match the purchase.");
  const result = await supabase.rpc("billing_complete_credit_purchase", {
    p_purchase_id: purchase.id,
    p_session_id: session.id,
    p_payment_intent_id: payment.id,
    p_amount_pence: session.amount_total,
    p_currency: session.currency,
    p_event_id: eventId,
  });
  if (result.error) throw new Error("Credit fulfilment failed.");
}