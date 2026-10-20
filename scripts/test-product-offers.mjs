import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
function loadSource(path, dependencies = {}, globals = {}) {
  const target = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    module: target, exports: target.exports, Intl, Date, console, URL, Response, ...globals,
    require: (name) => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name),
  });
  return target.exports;
}

const policy = loadSource("lib/seller/offer-policy.ts");
const cities = [{ city_id: "GB-test", city_name: "London", country_code: "GB" }, { city_id: "GB-second", city_name: "Coventry", country_code: "GB" }, { city_id: "GB-third", city_name: "Birmingham", country_code: "GB" }];
const fixtureOffer = (pointsCost, audience = pointsCost ? "reward" : "general") => ({
  id: `${audience}-fixture`, audience, title: "Trainers", benefit_details: "Half price on the advertised product.",
  mediaDisplayUrl: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400", media_type: "image", points_cost: pointsCost, remainingClaims: 5,
});
const Image = ({ fill, unoptimized, sizes, ...props }) => React.createElement("img", { ...props, ...(fill ? { style: { position: "absolute", width: "100%", height: "100%" } } : {}), "data-sizes": sizes, "data-unoptimized": Boolean(unoptimized) });
const Link = ({ children, ...props }) => React.createElement("a", props, children);
const ActionForm = ({ children, className }) => React.createElement("form", { className, "data-fixture": "true" }, children);
const cityModule = loadSource("components/CityPicker.tsx");
const multiCityModule = loadSource("components/MultiCityPicker.tsx");
const availableOffersModule = loadSource("lib/seller/available-offers.ts", {
  "server-only": {}, "@/lib/seller/offer-schema": { isSellerOfferSchemaUnavailable: () => false },
  "@/lib/supabase/storage": { createProductMediaUrls: async () => new Map() },
});
const profileModule = loadSource("components/visitor/ProfileOffers.tsx", {
  "next/image": { default: Image }, "next/link": { default: Link },
  "@/lib/format": { formatNumber: (value) => value.toLocaleString("en-GB") },
  "@/lib/seller/available-offers": availableOffersModule,
});

function formFixture(rewardPoints = 100) {
  const hooks = [];
  let cursor = 0;
  const { ProductOfferForm } = loadSource("components/seller/ProductOfferForm.tsx", {
    react: { useState(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = initial; return [hooks[index], (value) => { hooks[index] = typeof value === "function" ? value(hooks[index]) : value; }]; } },
    "@/components/ActionForm": { ActionForm }, "@/components/CityPicker": cityModule, "@/components/MultiCityPicker": multiCityModule,
    "@/lib/format": { formatNumber: (value) => value.toLocaleString("en-GB") },
    "@/app/seller/(protected)/product-offer-actions": { publishProductOffer() {} },
    "@/lib/seller/offer-policy": policy,
  });
  return { render() {
    cursor = 0;
    return ProductOfferForm({ productId: "product-fixture", requestId: "request-fixture", countries: [{ country_code: "GB", country_name: "United Kingdom" }], cities, rewardPoints, postcode: "SW1A 1AA", today: "2026-10-19", audienceCounts: [{ city_id: "GB-test", eligible_count: null, is_withheld: true }, { city_id: "GB-second", eligible_count: 12, is_withheld: false }], shopUrl: "https://example.invalid/product" });
  } };
}
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
const field = (tree, name, value) => nodes(tree).find((node) => node.props?.name === name && (value === undefined || node.props.value === value));

function publishFixture(error = null) {
  const calls = [];
  const { publishProductOffer } = loadSource("app/seller/(protected)/product-offer-actions.ts", {
    "next/cache": { revalidatePath() {} }, "next/navigation": { redirect() {} },
    "@/lib/form-state": { FormError: class FormError extends Error {}, runFormAction: (callback) => callback() },
    "@/lib/seller/access": { getSellerAccount: async () => ({ supabase: { rpc: async (name, parameters) => { calls.push({ name, parameters }); return { error }; } } }) },
    "@/lib/seller/offer-policy": policy,
    "@/lib/seller/offer-schema": loadSource("lib/seller/offer-schema.ts"),
    "@/lib/validation": loadSource("lib/validation.ts"),
  });
  return { calls, publish(cityIds, overrides = {}) {
    const data = new FormData();
    for (const [name, value] of Object.entries({ product_id: "10000000-0000-4000-8000-000000000001", request_id: "10000000-0000-4000-8000-000000000002", audience: "reward", fulfillment: "branch", postcode: "SW1A 1AA", valid_from: "2026-10-20", valid_until: "2026-10-21", offer_kind: "discount", benefit_details: "Half price on this product", discount_percent: "50", starts_at: "10:00", ends_at: "15:00", max_claims: "50", max_per_customer: "3", accept_terms: "on", ...overrides })) data.set(name, value);
    for (const cityId of cityIds) data.append("city_ids", cityId);
    return publishProductOffer({}, data);
  } };
}

test("branch vouchers use the configured points cost independently of audience and online offers stay free", () => {
  assert.equal(policy.getProductOfferPoints("branch"), 100);
  assert.equal(policy.getProductOfferPoints("branch", 75), 75);
  assert.equal(policy.getProductOfferPoints("online", 75), 0);
  for (const points of [0, 49, 50.5, NaN, 1_000_001]) assert.equal(policy.isValidProductRewardPoints(points), false);
  for (const points of [50, 75, 100, 1_000_000]) assert.equal(policy.isValidProductRewardPoints(points), true);
  assert.equal(policy.isOfferCombinationSupported("reward", "online"), false);
  assert.equal(policy.isOfferCombinationSupported("general", "online"), true);
});

test("total voucher count and per-customer discount limit are direct seller choices", () => {
  for (const quantity of [1, 10, 150, 1000]) assert.equal(policy.isValidOfferQuantity(quantity), true);
  for (const quantity of [0, -1, 1.5, 1001, NaN]) assert.equal(policy.isValidOfferQuantity(quantity), false);
  assert.equal(policy.isValidCustomerOfferLimit(3, 50), true);
  assert.equal(policy.isValidCustomerOfferLimit(50, 50), true);
  assert.equal(policy.isValidCustomerOfferLimit(51, 50), false);
  assert.equal(policy.isValidCustomerOfferLimit(0, 50), false);
});

test("selecting a reward switches an online offer back to branch redemption", () => {
  const fixture = formFixture();
  field(fixture.render(), "fulfillment", "online").props.onChange();
  assert.ok(field(fixture.render(), "external_code"));
  field(fixture.render(), "audience", "reward").props.onChange();
  const tree = fixture.render();
  assert.equal(field(tree, "fulfillment", "online").props.disabled, true);
  assert.equal(field(tree, "fulfillment", "branch").props.checked, true);
  assert.equal(field(tree, "external_code"), undefined);
  assert.equal(field(tree, "max_claims").props.value, 50);
  assert.equal(field(tree, "max_per_customer").props.value, 1);
  assert.equal(field(tree, "points_cost"), undefined);
});

test("discount eligibility allows three uses and free-product eligibility unlocks exactly after seven days", () => {
  const now = Date.parse("2026-10-19T12:00:00Z");
  for (const used of [0, 1, 2]) assert.equal(policy.getOfferBookingBlock("discount", used, null, now, 3), null);
  assert.match(policy.getOfferBookingBlock("discount", 3, null, now, 3), /3-reservation limit/);
  assert.equal(policy.getOfferBookingBlock("discount", 3, null, now, 5), null);
  assert.match(policy.getOfferBookingBlock("discount", 5, null, now, 5), /5-reservation limit/);
  for (const kind of ["free_item", "meal"]) {
    assert.match(policy.getOfferBookingBlock(kind, 0, "2026-10-19T12:00:01Z", now), /Available again.*UK time/);
    assert.equal(policy.getOfferBookingBlock(kind, 1, "2026-10-19T12:00:00Z", now), null);
    assert.equal(policy.getOfferBookingBlock(kind, 0, null, now), null);
  }
});

test("availability versions ignore result order and detect newly reopened daily places", () => {
  const totals = [{ offer_id: "first", remaining_claims: 0 }, { offer_id: "second", remaining_claims: 10 }];
  const daily = [{ offer_id: "first", offer_date: "2026-10-20", remaining_claims: 0 }, { offer_id: "second", offer_date: "2026-10-20", remaining_claims: 2 }];
  assert.equal(policy.getOfferAvailabilityVersion(totals, daily), policy.getOfferAvailabilityVersion([...totals].reverse(), [...daily].reverse()));
  assert.notEqual(policy.getOfferAvailabilityVersion(totals, daily), policy.getOfferAvailabilityVersion(totals, [{ ...daily[0], remaining_claims: 1 }, daily[1]]));
});

test("capacity progress closes full or ended offers and re-enables cancelled places", () => {
  const context = { remaining: new Map(), londonNow: "2026-10-20T12:00:00" };
  const { OfferCapacity } = loadSource("components/visitor/OfferAvailability.tsx", {
    react: { ...React, useContext: () => context }, "next/navigation": { useRouter() {} },
  });
  const props = { offerId: "first", maximum: 20, remaining: 4, closesAt: "2026-10-20T15:00:00", children: React.createElement("button", {}, "Reserve") };
  const render = () => OfferCapacity(props);
  assert.equal(nodes(render()).find((node) => node.type === "progress").props.value, 16);
  assert.equal(nodes(render()).find((node) => node.type === "fieldset").props.disabled, false);
  context.remaining.set("first", 0);
  assert.equal(nodes(render()).find((node) => node.type === "progress").props.value, 20);
  assert.equal(nodes(render()).find((node) => node.type === "fieldset").props.disabled, true);
  context.remaining.set("first", 1);
  assert.equal(nodes(render()).find((node) => node.type === "fieldset").props.disabled, false);
  context.londonNow = "2026-10-20T15:00:00";
  assert.equal(nodes(render()).find((node) => node.type === "fieldset").props.disabled, true);
});

test("public availability endpoint bounds IDs, exposes only aggregate RPCs and disables caching", async () => {
  const calls = [];
  let unavailable = false;
  const { GET } = loadSource("app/api/seller-offer-availability/route.ts", {
    "@/lib/supabase/server": { createSupabasePublicClient: () => ({ rpc: async (name, parameters) => {
      calls.push({ name, parameters });
      return { data: [], error: unavailable ? { message: "Unavailable" } : null };
    } }) }, "@/lib/validation": loadSource("lib/validation.ts"), "@/lib/seller/offer-policy": policy,
  });
  for (const ids of ["", "not-a-uuid", Array.from({ length: 61 }, (_, index) => `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`).join(",")]) {
    assert.equal((await GET({ url: `https://example.invalid/api?ids=${ids}` })).status, 400);
  }
  assert.equal(calls.length, 0);
  const response = await GET({ url: "https://example.invalid/api?ids=10000000-0000-4000-8000-000000000001" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(calls.map((call) => call.name), ["get_public_seller_offer_availability", "get_public_seller_offer_daily_availability"]);
  assert.deepEqual(Object.keys(await response.json()).sort(), ["availability", "version"]);
  unavailable = true;
  assert.equal((await GET({ url: "https://example.invalid/api?ids=10000000-0000-4000-8000-000000000001" })).status, 503);
});

test("free-product eligibility refreshes when its seven-day deadline arrives even with unchanged capacity", async () => {
  let receive;
  let refreshes = 0;
  const { OfferAvailabilityProvider } = loadSource("components/visitor/OfferAvailability.tsx", {
    react: { ...React, useState: (value) => [value, () => {}], useEffect() {}, useEffectEvent: (callback) => { receive = callback; return callback; }, startTransition: (callback) => callback() },
    "next/navigation": { useRouter: () => ({ refresh: () => refreshes++ }) },
  });
  OfferAvailabilityProvider({ offerIds: ["first"], initialAvailability: [], version: "same", renderedAt: Date.now() - 1000, refreshAt: Date.now() - 1, children: null });
  receive({ availability: [], version: "same" });
  assert.equal(refreshes, 1);
});

test("one visibility-aware poller refreshes changed slots and cleans up its listeners and request", async () => {
  let effect;
  let interval;
  let cleared = false;
  let refreshes = 0;
  let fetches = 0;
  let signal;
  let version = "initial";
  const listeners = new Map();
  const document = { hidden: false, addEventListener: (name, handler) => listeners.set(name, handler), removeEventListener: (name) => listeners.delete(name) };
  const { OfferAvailabilityProvider } = loadSource("components/visitor/OfferAvailability.tsx", {
    react: { ...React, useState: (value) => [value, () => {}], useEffect: (callback) => { effect = callback; }, useEffectEvent: (callback) => callback, startTransition: (callback) => callback() },
    "next/navigation": { useRouter: () => ({ refresh: () => refreshes++ }) },
  }, { document, AbortController, window: {
    setInterval: (callback, delay) => { assert.equal(delay, 10_000); interval = callback; return 1; },
    clearInterval: () => { cleared = true; }, addEventListener: (name, handler) => listeners.set(name, handler), removeEventListener: (name) => listeners.delete(name),
  }, fetch: async (_url, options) => { fetches++; signal = options.signal; return { ok: true, json: async () => ({ availability: [], version }) }; } });
  OfferAvailabilityProvider({ offerIds: ["first", "second"], initialAvailability: [], version: "initial", renderedAt: Date.now(), children: null });
  const cleanup = effect();
  await new Promise(setImmediate);
  assert.equal(fetches, 1);
  assert.equal(refreshes, 0);
  version = "reopened";
  await listeners.get("focus")();
  assert.equal(refreshes, 1);
  document.hidden = true;
  interval();
  assert.equal(fetches, 2);
  cleanup();
  assert.equal(signal.aborted, true);
  assert.equal(cleared, true);
  assert.equal(listeners.size, 0);
});

test("seller offer copy explains audience-independent branch voucher costs", () => {
  const fixture = formFixture(75);
  const text = (node) => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : text(node?.props?.children ?? "");
  assert.match(text(fixture.render()), /Available to all eligible customers/);
  assert.match(text(fixture.render()), /75 points to reserve.*public offers and exclusive rewards/);
  field(fixture.render(), "audience", "reward").props.onChange();
  const rewardText = text(fixture.render());
  assert.match(rewardText, /Exclusive to RonTab loyalty members/);
  assert.match(rewardText, /I will honor this offer/);
  assert.match(rewardText, /75 points to reserve/);
  field(fixture.render(), "audience", "general").props.onChange();
  field(fixture.render(), "fulfillment", "online").props.onChange();
  assert.match(text(fixture.render()), /Online offers are public and do not use points/);
});

test("multi-city picker keeps multiple selections, shows city counts and respects disabled state", () => {
  const hooks = [];
  let cursor = 0;
  const { MultiCityPicker } = loadSource("components/MultiCityPicker.tsx", {
    react: { useState(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial; return [hooks[index], (value) => { hooks[index] = typeof value === "function" ? value(hooks[index]) : value; }]; } },
  });
  const props = { cities, name: "city_ids", initialCityIds: [cities[0].city_id], maxSelected: 2, emptySelectionLabel: "All UK", cityDetails: { "GB-test": "12 eligible customers", "GB-second": "Fewer than 5 eligible customers" } };
  const render = (disabled = false) => { cursor = 0; return MultiCityPicker({ ...props, disabled }); };
  const options = (tree) => nodes(tree).filter((node) => node.props?.type === "checkbox");
  options(render())[1].props.onChange();
  const tree = render();
  assert.deepEqual(nodes(tree).filter((node) => node.props?.name === "city_ids").map((node) => node.props.value), ["GB-test", "GB-second"]);
  assert.deepEqual(nodes(tree).filter((node) => node.props?.className === "multi-city-audience").slice(-2).map((node) => node.props.children), ["12 eligible customers", "Fewer than 5 eligible customers"]);
  assert.ok(options(render(true)).every((node) => node.props.disabled));
  assert.equal(options(tree)[2].props.disabled, true);
  options(render())[0].props.onChange();
  options(render())[1].props.onChange();
  assert.equal(nodes(render()).find((node) => node.props?.className === "multi-city-count").props.children, "All UK");
});

test("admin point controls enforce a minimum of 50 and send default or per-offer updates through the admin client", async () => {
  const calls = [];
  const { updateSellerRewardPoints } = loadSource("app/admin/(protected)/actions.ts", {
    "next/cache": { revalidatePath() {}, updateTag() {} }, "next/navigation": { redirect() {} },
    "@/lib/admin/access": { requireAdmin: async () => ({ supabase: { rpc: async (name, parameters) => { calls.push({ name, parameters }); return { error: null }; } } }) },
    "@/lib/form-state": { FormError: class FormError extends Error {} },
    "@/lib/supabase/server": {}, "@/lib/validation": loadSource("lib/validation.ts"), "@/lib/seller/offer-policy": policy,
  });
  const data = new FormData();
  data.set("points_cost", "49");
  await assert.rejects(updateSellerRewardPoints(data), /50 to 1,000,000/);
  assert.equal(calls.length, 0);
  data.set("points_cost", "50");
  await updateSellerRewardPoints(data);
  assert.equal(calls[0].name, "admin_set_seller_reward_points");
  assert.equal(calls[0].parameters.p_points_cost, 50);
  assert.equal(calls[0].parameters.p_offer_id, undefined);
  data.set("offer_id", "10000000-0000-4000-8000-000000000003");
  data.set("points_cost", "125");
  await updateSellerRewardPoints(data);
  assert.equal(calls[1].parameters.p_offer_id, data.get("offer_id"));
  assert.equal(calls[1].parameters.p_points_cost, 125);
});

test("product offer form submits a total quantity and clamps the discount limit to it", () => {
  const fixture = formFixture();
  const picker = field(fixture.render(), "city_ids");
  assert.equal(picker.props.maxSelected, 10);
  assert.equal(picker.props.initialCityIds, undefined);
  assert.match(picker.props.emptySelectionLabel, /All UK/);
  assert.equal(picker.props.cityDetails["GB-test"], "Fewer than 5 eligible customers");
  assert.equal(picker.props.cityDetails["GB-second"], "12 eligible customers");
  assert.equal(picker.props.cityDetails["GB-third"], "Audience count unavailable");
  field(fixture.render(), "max_per_customer").props.onChange({ target: { value: "4" } });
  field(fixture.render(), "max_claims").props.onChange({ target: { value: "2" } });
  assert.equal(field(fixture.render(), "max_per_customer").props.value, 2);
});

test("publishing normalizes multiple cities and retains the original RPC for a single city", async () => {
  const fixture = publishFixture();
  await fixture.publish(["GB-test", "GB-second", "GB-test"]);
  assert.equal(fixture.calls[0].name, "seller_publish_product_offer_in_cities");
  assert.equal(fixture.calls[0].parameters.p_payload.max_claims, 50);
  assert.equal(fixture.calls[0].parameters.p_payload.daily_capacity, 50);
  assert.equal(fixture.calls[0].parameters.p_payload.max_per_customer, 3);
  assert.deepEqual(Array.from(fixture.calls[0].parameters.p_city_ids), ["GB-second", "GB-test"]);
  await fixture.publish(["GB-test"]);
  assert.equal(fixture.calls[1].name, "seller_publish_product_offer");
  assert.equal(fixture.calls[1].parameters.p_payload.city_id, "GB-test");
  const invalid = publishFixture();
  await assert.rejects(invalid.publish(["GB-test"], { max_claims: "2", max_per_customer: "3" }), /per-customer limit/);
  assert.equal(invalid.calls.length, 0);
});

test("publishing treats no selected cities as All UK and rejects invalid or excessive cities", async () => {
  const fixture = publishFixture();
  await fixture.publish([]);
  assert.equal(fixture.calls[0].name, "seller_publish_product_offer_in_cities");
  assert.equal(fixture.calls[0].parameters.p_city_ids.length, 0);
  for (const cityIds of [["invalid"], Array.from({ length: 11 }, (_, index) => `GB-city-${index}`)]) {
    await assert.rejects(fixture.publish(cityIds), /up to 10 supported UK cities/);
  }
  assert.equal(fixture.calls.length, 1);
});

test("an unmigrated database never silently publishes a multi-city offer to just one city", async () => {
  const fixture = publishFixture({ code: "PGRST202", message: "Function missing from schema cache" });
  await assert.rejects(fixture.publish(["GB-test", "GB-second"]), /No offer was published/);
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].name, "seller_publish_product_offer_in_cities");
});

test("profile previews separate audiences independently of points cost", () => {
  const tree = profileModule.ProfileOffers({ offers: [fixtureOffer(100, "general"), fixtureOffer(0, "reward")], cityId: "GB-test", available: true });
  const hrefs = nodes(tree).filter((node) => node.props?.href).map((node) => node.props.href);
  assert.ok(hrefs.includes("/visitor/offers?view=general#offer-general-fixture"));
  assert.ok(hrefs.includes("/visitor/offers?view=reward#offer-reward-fixture"));
});

test("shared offer query filters by the saved city before limiting results and signs durable product paths", async () => {
  const calls = [];
  const row = { ...fixtureOffer(0), seller_profile_id: "seller-fixture", fulfillment: "in_store", valid_from: "2000-01-01", valid_until: "2999-12-31", product_media_path: "seller/product/photo.jpg", media_storage_path: null, media_url: null, seller_offer_locations: [{ id: "location", city_id: "GB-test" }] };
  const tables = {
    seller_offers: [row],
    seller_offer_daily_quotas: [{ location_id: "location", offer_date: "2999-01-01", ends_at: "23:59:59" }],
    seller_profiles: [{ id: "seller-fixture", shop_name: "Fixture shop", slug: "fixture-shop", logo_url: null }],
  };
  const from = (table) => {
    const query = { then(resolve) { return Promise.resolve({ data: tables[table], error: null }).then(resolve); } };
    for (const name of ["select", "eq", "in", "or", "gte", "order", "limit"]) query[name] = (...args) => { if (table === "seller_offers") calls.push([name, ...args]); return query; };
    return query;
  };
  const { getAvailableSellerOffers } = loadSource("lib/seller/available-offers.ts", {
    "server-only": {}, "@/lib/seller/offer-schema": { isSellerOfferSchemaUnavailable: () => false },
    "@/lib/supabase/storage": { createProductMediaUrls: async (_client, paths) => { assert.equal(paths[0], row.product_media_path); return new Map([[paths[0], "https://signed.invalid/photo"]]); } },
  });
  const result = await getAvailableSellerOffers({ from, rpc: async () => ({ data: [{ offer_id: row.id, remaining_claims: 3 }], error: null }) }, "GB-test");
  assert.ok(calls.findIndex((call) => call[1] === "audience_locations.city_id") < calls.findIndex((call) => call[0] === "limit"));
  assert.ok(calls.some((call) => call[0] === "or" && call[1] === "target_all_uk.eq.true,audience_locations.not.is.null"));
  assert.equal(result.offers[0].mediaDisplayUrl, "https://signed.invalid/photo");
  assert.equal(result.offers[0].remainingClaims, 3);
});

test("offer discovery retains city-filtered results when the All UK migration is not yet installed", async () => {
  const queries = [];
  const client = { from(table) {
    const calls = [];
    const index = table === "seller_offers" ? queries.push(calls) - 1 : -1;
    const result = index === 0 ? { data: null, error: { code: "42703" } }
      : index === 1 ? { data: [{ ...fixtureOffer(0), seller_profile_id: "seller-fixture", fulfillment: "online", product_media_path: null, media_storage_path: null, seller_offer_locations: [] }], error: null }
      : { data: [], error: null };
    const query = { then(resolve) { return Promise.resolve(result).then(resolve); } };
    for (const name of ["select", "eq", "in", "or", "gte", "order", "limit"]) query[name] = (...args) => { calls.push([name, ...args]); return query; };
    return query;
  }, rpc: async () => ({ data: [], error: null }) };
  const { getAvailableSellerOffers } = loadSource("lib/seller/available-offers.ts", {
    "server-only": {}, "@/lib/seller/offer-schema": { isSellerOfferSchemaUnavailable: () => false },
    "@/lib/supabase/storage": { createProductMediaUrls: async () => new Map() },
  });
  const result = await getAvailableSellerOffers(client, "GB-test");
  assert.equal(queries.length, 2);
  assert.ok(queries[1].findIndex((call) => call[1] === "seller_offer_locations.city_id") < queries[1].findIndex((call) => call[0] === "limit"));
  assert.equal(result.offers[0].target_all_uk, false);
});

if (process.argv.includes("--preview")) {
  const { createServer } = await import("node:http");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const availabilityModule = loadSource("components/visitor/OfferAvailability.tsx", { "next/navigation": { useRouter: () => ({ refresh() {} }) } });
  const css = () => ["src/app/globals.css", "src/app/admin/admin.css", "src/app/seller/seller.css", "src/app/visitor/visitor.css"].map((path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")).join("\n");
  createServer((request, response) => {
    const fixture = formFixture();
    if (request.url === "/reward") field(fixture.render(), "audience", "reward").props.onChange();
    if (request.url === "/online") field(fixture.render(), "fulfillment", "online").props.onChange();
    const capacityPreview = React.createElement("section", { className: "seller-offer-gallery-grid" }, ...[4, 0, 1].map((remaining, index) => React.createElement("article", { className: "seller-offer-card", key: index },
      React.createElement("div", { className: "seller-offer-card-media" }, React.createElement("img", { src: fixtureOffer(0).mediaDisplayUrl, alt: "Advertised trainers", style: { width: "100%", height: "100%", objectFit: "cover" } })),
      React.createElement("div", { className: "seller-offer-card-body" }, React.createElement("h2", {}, "Trainers"), React.createElement("p", {}, "Half price on this product"),
        React.createElement(availabilityModule.OfferCapacity, { offerId: String(index), maximum: 20, remaining, closesAt: "2099-10-20T15:00:00" }, React.createElement("div", { className: "seller-offer-slot-list" }, React.createElement("p", {}, "0 of 3 reservations used. Cancelled reservations do not count."), React.createElement("button", { type: "button" }, "Reserve voucher")))))));
    const content = request.url === "/capacity" ? capacityPreview : request.url === "/profile" ? profileModule.ProfileOffers({ offers: [fixtureOffer(0), fixtureOffer(100)], cityId: "GB-test", available: true }) : fixture.render();
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css()}</style></head><body><main style="max-width:900px;margin:auto;padding:20px">${renderToStaticMarkup(content)}</main></body></html>`);
  }).listen(3002, "127.0.0.1", () => console.log("Isolated offer layout preview: http://127.0.0.1:3002"));
}