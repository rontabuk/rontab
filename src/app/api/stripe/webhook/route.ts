import { createTestStripe, getTestBillingConfig, syncTestCreditPurchase } from "@/lib/billing/stripe";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const config = getTestBillingConfig();
  if (!config) return Response.json({ error: "Test billing is unavailable." }, { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing signature." }, { status: 400 });
  const stripe = createTestStripe(config);
  let event;
  try {
    event = stripe.webhooks.constructEvent(await request.text(), signature, config.webhookSecret);
  } catch {
    return Response.json({ error: "Invalid signature." }, { status: 400 });
  }
  if (event.livemode) return Response.json({ error: "Live payments are not supported." }, { status: 400 });
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.expired") {
    return Response.json({ received: true });
  }
  try {
    await syncTestCreditPurchase(event.data.object, event.id, event.type, config, stripe, createSupabaseServiceRoleClient());
    return Response.json({ received: true });
  } catch {
    console.error("Stripe test credit webhook could not be fulfilled.");
    return Response.json({ error: "Test purchase could not be confirmed." }, { status: 500 });
  }
}