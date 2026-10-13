import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import Stripe from "stripe";

const sellerId = "11111111-1111-4111-8111-111111111111";
const purchaseId = "22222222-2222-4222-8222-222222222222";
const env = {
  STRIPE_SECRET_KEY: "sk_test_fixture",
  STRIPE_WEBHOOK_SECRET: "whsec_fixture",
  SUPABASE_SERVICE_ROLE_KEY: "fixture",
  STRIPE_TEST_SELLER_IDS: sellerId,
  BILLING_SITE_URL: "http://localhost:3000",
};

function loadModule(path, dependencies, environment = env) {
  const testModule = { exports: {} };
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(compiled, {
    module: testModule, exports: testModule.exports, process: { env: environment }, URL, Response,
    console: { error() {} },
    require(name) {
      if (name === "server-only") return {};
      if (name === "stripe") return Stripe;
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`Unexpected test import: ${name}`);
    },
  }, { filename: path });
  return testModule.exports;
}

const billing = loadModule("src/lib/billing/stripe.ts", {});

function fixture() {
  const purchase = {
    id: purchaseId, seller_profile_id: sellerId, clicks: 1000, amount_pence: 100,
    currency: "gbp", is_test: true, status: "pending", stripe_checkout_session_id: "cs_test_fixture",
  };
  const session = {
    id: "cs_test_fixture", object: "checkout.session", livemode: false, mode: "payment", currency: "gbp",
    client_reference_id: purchaseId, metadata: { purchase_id: purchaseId, seller_profile_id: sellerId },
    amount_total: 100, status: "complete", payment_status: "paid", payment_intent: "pi_fixture",
  };
  const payment = {
    id: "pi_fixture", livemode: false, status: "succeeded", currency: "gbp", amount_received: 100,
    metadata: { purchase_id: purchaseId, seller_profile_id: sellerId },
  };
  const calls = [];
  const database = {
    from() { return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: purchase, error: null }; } }; },
    async rpc(name, args) { calls.push({ name, args }); return { data: true, error: null }; },
  };
  const stripe = {
    checkout: { sessions: { async retrieve() { return session; } } },
    paymentIntents: { async retrieve() { return payment; } },
    webhooks: billing.createTestStripe(billing.getTestBillingConfig()).webhooks,
  };
  return { purchase, session, payment, calls, database, stripe };
}

test("sandbox configuration rejects live keys, missing settings and unsafe origins", () => {
  assert.equal(billing.getTestBillingConfig().origin, "http://localhost:3000");
  for (const overrides of [
    { STRIPE_SECRET_KEY: "sk_live_fixture" }, { STRIPE_WEBHOOK_SECRET: "" }, { SUPABASE_SERVICE_ROLE_KEY: "" },
    { STRIPE_TEST_SELLER_IDS: "" }, { STRIPE_TEST_SELLER_IDS: "not-a-uuid" },
    { BILLING_SITE_URL: "http://example.com" }, { BILLING_SITE_URL: "https://user:password@example.com" },
    { BILLING_SITE_URL: "https://example.com/path" }, { BILLING_SITE_URL: "https://example.com?site=1" },
  ]) {
    const configured = loadModule("src/lib/billing/stripe.ts", {}, { ...env, ...overrides });
    assert.equal(configured.getTestBillingConfig(), null);
  }
});

test("a verified completed session passes the authoritative quote to the credit RPC", async () => {
  const state = fixture();
  await billing.syncTestCreditPurchase(state.session, "evt_fixture", "checkout.session.completed", billing.getTestBillingConfig(), state.stripe, state.database);
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].name, "billing_complete_credit_purchase");
  assert.equal(state.calls[0].args.p_purchase_id, purchaseId);
  assert.equal(state.calls[0].args.p_amount_pence, 100);
  assert.equal(state.calls[0].args.p_event_id, "evt_fixture");
});

const rejectedCases = [
  ["live session", (state) => { state.session.livemode = true; }],
  ["live session ID", (state) => { state.session.id = "cs_live_fixture"; }],
  ["wrong amount", (state) => { state.session.amount_total = 101; }],
  ["wrong currency", (state) => { state.session.currency = "usd"; }],
  ["wrong seller", (state) => { state.session.metadata.seller_profile_id = purchaseId; }],
  ["wrong purchase metadata", (state) => { state.session.metadata.purchase_id = sellerId; }],
  ["unpaid session", (state) => { state.session.payment_status = "unpaid"; }],
  ["open session", (state) => { state.session.status = "open"; }],
  ["another bound checkout", (state) => { state.purchase.stripe_checkout_session_id = "cs_test_other"; }],
  ["non-test purchase", (state) => { state.purchase.is_test = false; }],
  ["live payment", (state) => { state.payment.livemode = true; }],
  ["failed payment", (state) => { state.payment.status = "requires_payment_method"; }],
  ["wrong received amount", (state) => { state.payment.amount_received = 99; }],
  ["wrong payment currency", (state) => { state.payment.currency = "eur"; }],
  ["wrong payment owner", (state) => { state.payment.metadata.seller_profile_id = purchaseId; }],
];

for (const [name, mutate] of rejectedCases) {
  test(`rejects ${name} without credit fulfilment`, async () => {
    const state = fixture();
    mutate(state);
    await assert.rejects(billing.syncTestCreditPurchase(state.session, "evt_fixture", "checkout.session.completed", billing.getTestBillingConfig(), state.stripe, state.database));
    assert.equal(state.calls.length, 0);
  });
}

test("only an allowlisted seller can receive sandbox credits", async () => {
  const state = fixture();
  await assert.rejects(billing.syncTestCreditPurchase(state.session, "evt_fixture", "checkout.session.completed", { ...billing.getTestBillingConfig(), sellerIds: [] }, state.stripe, state.database));
  assert.equal(state.calls.length, 0);
});

test("expired session calls expiry only, not credit fulfilment", async () => {
  const state = fixture();
  state.session.status = "expired";
  state.session.payment_status = "unpaid";
  await billing.syncTestCreditPurchase(state.session, "evt_fixture", "checkout.session.expired", billing.getTestBillingConfig(), state.stripe, state.database);
  assert.equal(state.calls[0].name, "billing_expire_credit_purchase");
});

function webhook(state, configured = true) {
  return loadModule("src/app/api/stripe/webhook/route.ts", {
    "@/lib/billing/stripe": { ...billing, getTestBillingConfig: () => configured ? billing.getTestBillingConfig() : null, createTestStripe: () => state.stripe },
    "@/lib/supabase/server": { createSupabaseServiceRoleClient: () => state.database },
  });
}

function signedRequest(state, overrides = {}, signature = true) {
  const payload = JSON.stringify({ id: "evt_fixture", object: "event", type: "checkout.session.completed", livemode: false, data: { object: state.session }, ...overrides });
  return new Request("http://localhost:3000/api/stripe/webhook", {
    method: "POST", body: payload,
    headers: signature ? { "stripe-signature": state.stripe.webhooks.generateTestHeaderString({ payload, secret: env.STRIPE_WEBHOOK_SECRET }) } : {},
  });
}

test("raw-body webhook accepts an SDK-signed event", async () => {
  const state = fixture();
  const response = await webhook(state).POST(signedRequest(state));
  assert.equal(response.status, 200);
  assert.equal(state.calls.length, 1);
});

test("webhook rejects missing and incorrect signatures without fulfilment", async () => {
  const state = fixture();
  assert.equal((await webhook(state).POST(signedRequest(state, {}, false))).status, 400);
  const request = signedRequest(state);
  request.headers.set("stripe-signature", "t=1,v1=invalid");
  assert.equal((await webhook(state).POST(request)).status, 400);
  assert.equal(state.calls.length, 0);
});

test("webhook rejects signed live events and returns 503 when unconfigured", async () => {
  const state = fixture();
  assert.equal((await webhook(state).POST(signedRequest(state, { livemode: true }))).status, 400);
  assert.equal((await webhook(state, false).POST(signedRequest(state))).status, 503);
  assert.equal(state.calls.length, 0);
});

test("database failure returns a retryable webhook response", async () => {
  const state = fixture();
  state.database.rpc = async () => ({ error: { message: "fixture" } });
  assert.equal((await webhook(state).POST(signedRequest(state))).status, 500);
});

function checkoutAction(state, overrides = {}) {
  const createdSessions = [];
  const database = {
    ...state.database,
    async rpc(name, args) {
      if (name === "seller_create_credit_purchase") {
        state.calls.push({ name, args });
        return { data: [{ ...state.purchase, unit_price_pence_per_1000: 100 }], error: null };
      }
      return state.database.rpc(name, args);
    },
  };
  const stripe = { checkout: { sessions: { async create(params, options) {
    createdSessions.push({ params, options });
    return { id: "cs_test_fixture", status: "open", livemode: false, url: "https://checkout.stripe.com/c/pay/cs_test_fixture" };
  } } } };
  const dependencies = {
    "next/headers": { headers: async () => new Headers({ origin: env.BILLING_SITE_URL }) },
    "@/lib/billing/stripe": { ...billing, createTestStripe: () => stripe },
    "@/lib/seller/access": { getSellerAccount: async () => ({ seller: { id: sellerId, status: "active" } }) },
    "@/lib/supabase/server": { createSupabaseServiceRoleClient: () => database },
    ...overrides,
  };
  const action = loadModule("src/app/seller/(protected)/advertising/payment-actions.ts", dependencies);
  const form = new FormData();
  form.set("clicks", "1000"); form.set("expectedRate", "100"); form.set("requestId", purchaseId);
  return { action, form, createdSessions };
}

test("checkout uses the database price and a retry-stable Stripe idempotency key", async () => {
  const state = fixture();
  const { action, form, createdSessions } = checkoutAction(state);
  assert.match((await action.startTestCreditCheckout(form)).url, /^https:\/\/checkout\.stripe\.com\//);
  assert.equal(createdSessions[0].params.line_items[0].price_data.unit_amount, 100);
  assert.equal(createdSessions[0].params.allowed_payment_method_types[0], "card");
  assert.equal(createdSessions[0].options.idempotencyKey, `rontab-test-credit-${purchaseId}`);
  assert.equal(state.calls[0].name, "seller_create_credit_purchase");
  assert.equal(state.calls[0].args.p_seller_id, sellerId);
  assert.equal(state.calls[1].name, "billing_attach_credit_checkout");
});

test("checkout rejects wrong site origin and invalid quantity before creating a session", async () => {
  const state = fixture();
  const { action, form, createdSessions } = checkoutAction(state, { "next/headers": { headers: async () => new Headers({ origin: "https://other.invalid" }) } });
  assert.equal((await action.startTestCreditCheckout(form)).url, null);
  form.set("clicks", "1001");
  assert.equal((await action.startTestCreditCheckout(form)).url, null);
  assert.equal(createdSessions.length, 0);
});

test("checkout rejects non-allowlisted sellers and stale price responses", async () => {
  const state = fixture();
  const blocked = checkoutAction(state, { "@/lib/seller/access": { getSellerAccount: async () => ({ seller: { id: purchaseId, status: "active" } }) } });
  assert.equal((await blocked.action.startTestCreditCheckout(blocked.form)).url, null);
  const stale = checkoutAction(state, { "@/lib/supabase/server": { createSupabaseServiceRoleClient: () => ({ rpc: async () => ({ data: null, error: { code: "22023", message: "Click price changed." } }) }) } });
  assert.equal((await stale.action.startTestCreditCheckout(stale.form)).error, "Click price changed.");
  assert.equal(stale.createdSessions.length, 0);
});