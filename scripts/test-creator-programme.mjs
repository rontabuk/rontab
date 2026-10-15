import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const { CREATOR_TEST_URL: url, CREATOR_TEST_ANON_KEY: anonKey, CREATOR_TEST_SERVICE_KEY: serviceKey } = process.env;
if (!url || !anonKey || !serviceKey) {
  throw new Error("Set CREATOR_TEST_URL, CREATOR_TEST_ANON_KEY, and CREATOR_TEST_SERVICE_KEY for local Supabase.");
}

const service = createClient(url, serviceKey);
const publicClient = createClient(url, anonKey);
const suffix = randomUUID();
const password = `LocalTest-${suffix}-Aa1!`;
const ids = { visitor: null, sellerUser: null, sellerProfile: null, admin: null, creator: null, request: null, requests: [] };
let failure;

function throwOnError(result) {
  if (result.error) throw result.error;
  return result.data;
}

async function createAccount(email, appMetadata = {}) {
  const result = await service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: appMetadata });
  if (result.error) throw result.error;
  return result.data.user.id;
}

try {
  const enabledCountries = throwOnError(await service.from("supported_countries").select("country_code").eq("is_enabled", true).limit(1));
  assert.ok(enabledCountries.length, "local Supabase needs an enabled supported country");
  const cities = throwOnError(await service.from("supported_cities").select("city_id,country_code").eq("country_code", enabledCountries[0].country_code).eq("is_enabled", true).limit(1));
  assert.ok(cities.length, "local Supabase needs an enabled city in a supported country");

  ids.visitor = await createAccount(`creator-test-${suffix}@example.com`);
  const visitor = createClient(url, anonKey);
  throwOnError(await visitor.auth.signInWithPassword({ email: `creator-test-${suffix}@example.com`, password }));

  ids.admin = await createAccount(`creator-admin-${suffix}@example.com`, { role: "admin" });
  const admin = createClient(url, anonKey);
  throwOnError(await admin.auth.signInWithPassword({ email: `creator-admin-${suffix}@example.com`, password }));

  const profileName = `Local Creator ${suffix.slice(0, 8)}`;
  const firstPlatformHandle = `creator_${suffix.slice(0, 8)}`;
  const initial = throwOnError(await visitor.rpc("save_creator_application", {
    p_display_name: profileName,
    p_bio: "I create useful local food and home content for an engaged community.",
    p_specialties: ["food", "local"],
    p_platform_accounts: [{ platform: "instagram", handle: firstPlatformHandle, profile_url: `https://www.instagram.com/${firstPlatformHandle}/`, follower_count: 12000 }],
    p_audience_city_id: cities[0].city_id,
    p_portfolio_items: [{ title: "Approved sample", url: "https://www.instagram.com/example/reel/" }],
    p_public_profile_consent: true,
  }));
  ids.creator = initial;

  const hiddenBeforeApproval = throwOnError(await publicClient.from("creator_profiles").select("id").eq("id", ids.creator));
  assert.equal(hiddenBeforeApproval.length, 0, "unapproved applications must stay private");
  throwOnError(await admin.rpc("admin_review_creator_profile", { p_creator_profile_id: ids.creator, p_decision: "approve", p_review_note: null }));

  const firstPublic = throwOnError(await publicClient.from("creator_profiles")
    .select("published_display_name,published_audience_city_id")
    .eq("id", ids.creator).single());
  assert.equal(firstPublic.published_display_name, profileName);
  assert.equal(firstPublic.published_audience_city_id, cities[0].city_id);

  const updatedName = `${profileName} Updated`;
  const updatedHandle = `updated_${suffix.slice(0, 8)}`;
  throwOnError(await visitor.rpc("save_creator_application", {
    p_display_name: updatedName,
    p_bio: "I create useful local food and home content for an engaged community.",
    p_specialties: ["food", "local"],
    p_platform_accounts: [{ platform: "instagram", handle: updatedHandle, profile_url: `https://www.instagram.com/${updatedHandle}/`, follower_count: 18000 }],
    p_audience_city_id: cities[0].city_id,
    p_portfolio_items: [{ title: "New sample awaiting review", url: "https://www.youtube.com/@example" }],
    p_public_profile_consent: true,
  }));

  const publicDuringReview = throwOnError(await publicClient.from("creator_profiles")
    .select("published_display_name").eq("id", ids.creator).single());
  assert.equal(publicDuringReview.published_display_name, profileName, "the last approved snapshot must remain public");
  const publicPlatforms = throwOnError(await publicClient.from("creator_platform_accounts")
    .select("handle,follower_count").eq("creator_profile_id", ids.creator));
  assert.deepEqual(publicPlatforms.map((account) => [account.handle, account.follower_count]), [[firstPlatformHandle, 12000]]);
  const sellerCannotReadProfile = await publicClient.from("creator_profiles").select("display_name").eq("id", ids.creator);
  assert.ok(sellerCannotReadProfile.error, "public clients cannot read private draft columns");

  throwOnError(await admin.rpc("admin_review_creator_profile", {
    p_creator_profile_id: ids.creator,
    p_decision: "changes_requested",
    p_review_note: "Please clarify your audience.",
  }));
  const resubmitted = throwOnError(await visitor.rpc("save_creator_application", {
    p_display_name: updatedName,
    p_bio: "I create useful local food and home content for an engaged community.",
    p_specialties: ["food", "local"],
    p_platform_accounts: [{ platform: "instagram", handle: updatedHandle, profile_url: `https://www.instagram.com/${updatedHandle}/`, follower_count: 18000 }],
    p_audience_city_id: cities[0].city_id,
    p_portfolio_items: [{ title: "New sample awaiting review", url: "https://www.youtube.com/@example" }],
    p_public_profile_consent: true,
  }));
  assert.equal(resubmitted, ids.creator);
  throwOnError(await admin.rpc("admin_review_creator_profile", { p_creator_profile_id: ids.creator, p_decision: "approve", p_review_note: null }));

  const finalPublic = throwOnError(await publicClient.from("creator_profiles")
    .select("published_display_name,published_audience_city_id").eq("id", ids.creator).single());
  assert.equal(finalPublic.published_display_name, updatedName);
  const portfolio = throwOnError(await publicClient.from("creator_portfolio_items")
    .select("title,is_published").eq("creator_profile_id", ids.creator));
  assert.deepEqual(portfolio.map((item) => [item.title, item.is_published]), [["New sample awaiting review", true]]);

  ids.sellerUser = await createAccount(`creator-seller-${suffix}@example.com`);
  const sellerProfile = throwOnError(await service.from("seller_profiles").insert({
    user_id: ids.sellerUser,
    shop_name: `Local Test Shop ${suffix.slice(0, 8)}`,
    slug: `local-test-${suffix.slice(0, 8)}`,
    status: "active",
    is_public: true,
  }).select("id").single());
  ids.sellerProfile = sellerProfile.id;
  const seller = createClient(url, anonKey);
  throwOnError(await seller.auth.signInWithPassword({ email: `creator-seller-${suffix}@example.com`, password }));
  ids.request = throwOnError(await seller.rpc("seller_create_creator_collaboration_request", {
    p_creator_profile_id: ids.creator,
    p_seller_profile_id: ids.sellerProfile,
    p_title: "Local collaboration test",
    p_brief: "We would like to feature your work in a local Rontab campaign and discuss a suitable format.",
    p_proposed_compensation: "Product sample and agreed fee",
  }));
  ids.requests.push(ids.request);
  const requestNotifications = throwOnError(await visitor.rpc("get_creator_collaboration_notifications"));
  const requestNotification = requestNotifications.find((notification) => notification.notification_id === `creator-request-${ids.request}`);
  assert.ok(requestNotification, "creator receives a notification for a new collaboration request");
  assert.equal(requestNotification.href, "/visitor/creator#creator-collaboration-title");
  const readNotifications = throwOnError(await visitor.rpc("mark_notification_items_read", { p_notification_ids: [requestNotification.notification_id] }));
  assert.ok(readNotifications.includes(requestNotification.notification_id));
  const incomingRequest = throwOnError(await visitor.from("creator_collaboration_requests")
    .select("status,title").eq("id", ids.request).single());
  assert.equal(incomingRequest.status, "pending");
  throwOnError(await visitor.rpc("creator_decide_collaboration_request", {
    p_request_id: ids.request,
    p_decision: "accept",
    p_response: "Happy to discuss the campaign dates.",
  }));
  const sellerRequest = throwOnError(await seller.from("creator_collaboration_requests")
    .select("status,creator_response").eq("id", ids.request).single());
  assert.equal(sellerRequest.status, "accepted");
  assert.equal(sellerRequest.creator_response, "Happy to discuss the campaign dates.");
  const responseNotifications = throwOnError(await visitor.rpc("get_creator_collaboration_notifications"));
  assert.ok(responseNotifications.some((notification) => notification.notification_id === `creator-response-${ids.request}`));
  const sellerCannotReadDraft = throwOnError(await seller.from("creator_profiles")
    .select("display_name").eq("id", ids.creator));
  assert.equal(sellerCannotReadDraft.length, 0, "signed-in sellers cannot read creator application fields");

  const withdrawnRequestId = throwOnError(await seller.rpc("seller_create_creator_collaboration_request", {
    p_creator_profile_id: ids.creator,
    p_seller_profile_id: ids.sellerProfile,
    p_title: "Request to withdraw",
    p_brief: "This pending request is created only to verify seller withdrawal controls locally.",
    p_proposed_compensation: "",
  }));
  ids.requests.push(withdrawnRequestId);
  throwOnError(await seller.rpc("seller_withdraw_creator_collaboration_request", { p_request_id: withdrawnRequestId }));
  const withdrawnRequest = throwOnError(await seller.from("creator_collaboration_requests")
    .select("status").eq("id", withdrawnRequestId).single());
  assert.equal(withdrawnRequest.status, "withdrawn");

  console.log("PASS: public snapshots, approved audience and portfolio, draft privacy, collaboration notifications, request responses, and seller withdrawal.");
} catch (error) {
  failure = error;
} finally {
  if (ids.requests.length) await service.from("creator_collaboration_requests").delete().in("id", ids.requests);
  if (ids.creator) {
    await service.from("creator_point_transactions").delete().eq("creator_profile_id", ids.creator);
    await service.from("creator_profiles").delete().eq("id", ids.creator);
  }
  if (ids.admin) {
    await service.from("admin_audit_logs").delete().eq("actor_id", ids.admin);
    await service.auth.admin.deleteUser(ids.admin);
  }
  if (ids.sellerProfile) await service.from("seller_profiles").delete().eq("id", ids.sellerProfile);
  if (ids.sellerUser) await service.auth.admin.deleteUser(ids.sellerUser);
  if (ids.visitor) await service.auth.admin.deleteUser(ids.visitor);
}

if (failure) throw failure;