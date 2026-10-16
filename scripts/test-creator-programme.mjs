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
const ids = { visitor: null, fan: null, secondOwner: null, sellerUser: null, sellerProfile: null, admin: null, creator: null, secondCreator: null, request: null, requests: [] };
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
  const cities = throwOnError(await service.from("supported_cities").select("city_id,country_code").eq("country_code", enabledCountries[0].country_code).eq("is_enabled", true).order("city_id").limit(2));
  assert.equal(cities.length, 2, "local Supabase needs two enabled audience cities");

  ids.visitor = await createAccount(`creator-test-${suffix}@example.com`);
  const visitor = createClient(url, anonKey);
  throwOnError(await visitor.auth.signInWithPassword({ email: `creator-test-${suffix}@example.com`, password }));

  ids.admin = await createAccount(`creator-admin-${suffix}@example.com`, { role: "admin" });
  const admin = createClient(url, anonKey);
  throwOnError(await admin.auth.signInWithPassword({ email: `creator-admin-${suffix}@example.com`, password }));

  const profileName = `Local Creator ${suffix.slice(0, 8)}`;
  const firstPlatformHandle = `creator_${suffix.slice(0, 8)}`;
  const initial = throwOnError(await visitor.rpc("save_creator_application_with_audience_cities", {
    p_display_name: profileName,
    p_bio: "I create useful local food and home content for an engaged community.",
    p_specialties: ["food", "local"],
    p_platform_accounts: [{ platform: "instagram", handle: firstPlatformHandle, profile_url: `https://www.instagram.com/${firstPlatformHandle}/`, follower_count: 12000 }],
    p_audience_city_ids: cities.map((city) => city.city_id),
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
  const publishedAudienceCities = throwOnError(await publicClient.from("creator_profile_audience_cities")
    .select("city_id").eq("creator_profile_id", ids.creator).eq("is_published", true).order("city_id"));
  assert.deepEqual(publishedAudienceCities.map((city) => city.city_id), cities.map((city) => city.city_id).sort(), "creator approval publishes all selected audience cities");
  const approvalNotifications = throwOnError(await visitor.rpc("get_creator_collaboration_notifications"));
  assert.ok(approvalNotifications.some((notification) => notification.title === "Creator profile approved"), "creator receives profile review decisions");

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

  const pendingName = `${updatedName} Pending`;
  const pendingHandle = `pending_${suffix.slice(0, 8)}`;
  throwOnError(await visitor.rpc("save_creator_application", {
    p_display_name: pendingName,
    p_bio: "I create useful local food and home content for an engaged community.",
    p_specialties: ["food", "local"],
    p_platform_accounts: [{ platform: "instagram", handle: pendingHandle, profile_url: `https://www.instagram.com/${pendingHandle}/`, follower_count: 21000 }],
    p_audience_city_id: cities[0].city_id,
    p_portfolio_items: [],
    p_public_profile_consent: true,
  }));
  throwOnError(await admin.rpc("admin_review_creator_profile", {
    p_creator_profile_id: ids.creator,
    p_decision: "suspend",
    p_review_note: "Temporary review hold.",
  }));
  const hiddenSuspendedCreator = throwOnError(await publicClient.from("creator_profiles")
    .select("id").eq("id", ids.creator));
  assert.equal(hiddenSuspendedCreator.length, 0, "suspension removes the public profile");
  throwOnError(await admin.rpc("admin_review_creator_profile", {
    p_creator_profile_id: ids.creator,
    p_decision: "reinstate",
    p_review_note: null,
  }));
  const reinstatedDraft = throwOnError(await service.from("creator_profiles")
    .select("status,suspended_from_status,is_public,published_display_name")
    .eq("id", ids.creator).single());
  assert.equal(reinstatedDraft.status, "submitted", "reinstatement restores the review state before suspension");
  assert.equal(reinstatedDraft.suspended_from_status, null);
  assert.equal(reinstatedDraft.is_public, true);
  assert.equal(reinstatedDraft.published_display_name, updatedName, "reinstatement restores the last approved snapshot");
  throwOnError(await admin.rpc("admin_review_creator_profile", { p_creator_profile_id: ids.creator, p_decision: "approve", p_review_note: null }));
  const approvedAfterReinstatement = throwOnError(await publicClient.from("creator_profiles")
    .select("published_display_name").eq("id", ids.creator).single());
  assert.equal(approvedAfterReinstatement.published_display_name, pendingName);

  ids.fan = await createAccount(`creator-fan-${suffix}@example.com`);
  const fan = createClient(url, anonKey);
  throwOnError(await fan.auth.signInWithPassword({ email: `creator-fan-${suffix}@example.com`, password }));
  const creatorCodeResult = throwOnError(await publicClient.from("creator_profiles").select("referral_code").eq("id", ids.creator).single());
  const firstFollow = throwOnError(await fan.rpc("creator_follow_by_code", { p_code: creatorCodeResult.referral_code }));
  assert.equal(firstFollow.already_following, false);
  assert.equal(firstFollow.first_referral, true);
  const duplicateFollow = throwOnError(await fan.rpc("creator_follow_by_code", { p_code: creatorCodeResult.referral_code.toLowerCase() }));
  assert.equal(duplicateFollow.already_following, true);
  assert.equal(duplicateFollow.first_referral, false);

  ids.secondOwner = await createAccount(`creator-second-${suffix}@example.com`);
  const secondOwner = createClient(url, anonKey);
  throwOnError(await secondOwner.auth.signInWithPassword({ email: `creator-second-${suffix}@example.com`, password }));
  const secondCreatorName = `Second Creator ${suffix.slice(0, 8)}`;
  const secondPlatformHandle = `second_${suffix.slice(0, 8)}`;
  const secondCreatorApplication = throwOnError(await secondOwner.rpc("save_creator_application", {
    p_display_name: secondCreatorName,
    p_bio: "I share useful local lifestyle and product recommendations with my community.",
    p_specialties: ["local", "home"],
    p_platform_accounts: [{ platform: "youtube", handle: secondPlatformHandle, profile_url: `https://www.youtube.com/@${secondPlatformHandle}`, follower_count: 8000 }],
    p_audience_city_id: cities[0].city_id,
    p_portfolio_items: [],
    p_public_profile_consent: true,
  }));
  ids.secondCreator = secondCreatorApplication;
  throwOnError(await admin.rpc("admin_review_creator_profile", { p_creator_profile_id: ids.secondCreator, p_decision: "approve", p_review_note: null }));
  const secondCreatorCode = throwOnError(await publicClient.from("creator_profiles")
    .select("referral_code").eq("id", ids.secondCreator).single());
  const secondFollow = throwOnError(await fan.rpc("creator_follow_by_code", { p_code: secondCreatorCode.referral_code }));
  assert.equal(secondFollow.already_following, false);
  assert.equal(secondFollow.first_referral, false, "following a second creator must not rewrite first-referral attribution");
  const unrelatedNotifications = throwOnError(await fan.rpc("get_creator_collaboration_notifications"));
  assert.equal(unrelatedNotifications.length, 0, "creator programme notifications are private to event recipients");
  const followedCreators = throwOnError(await fan.rpc("creator_get_my_follows"));
  assert.equal(followedCreators.length, 2, "a visitor can follow multiple creators");
  const fanPointTransactions = throwOnError(await service.from("loyalty_point_transactions")
    .select("id").eq("visitor_id", ids.fan));
  assert.equal(fanPointTransactions.length, 0, "following creators does not award visitor loyalty points");
  const creatorFanStats = throwOnError(await visitor.rpc("creator_get_my_fan_stats"));
  assert.equal(creatorFanStats[0].fan_count, 1);
  assert.equal(creatorFanStats[0].first_referral_count, 1);
  const selfFollow = await visitor.rpc("creator_follow_by_code", { p_code: creatorCodeResult.referral_code });
  assert.equal(selfFollow.error?.code, "55000", "a creator cannot count themselves as a fan");

  throwOnError(await secondOwner.rpc("creator_withdraw_public_profile"));
  const withdrawnPublicProfile = throwOnError(await publicClient.from("creator_profiles")
    .select("id").eq("id", ids.secondCreator));
  assert.equal(withdrawnPublicProfile.length, 0, "creator withdrawal removes the profile from public access");
  const withdrawnCodeFollow = await fan.rpc("creator_follow_by_code", { p_code: secondCreatorCode.referral_code });
  assert.equal(withdrawnCodeFollow.error?.code, "P0002", "withdrawn creators cannot receive new follows");
  const secondCreatorReapplication = throwOnError(await secondOwner.rpc("save_creator_application", {
    p_display_name: secondCreatorName,
    p_bio: "I share useful local lifestyle and product recommendations with my community.",
    p_specialties: ["local", "home"],
    p_platform_accounts: [{ platform: "youtube", handle: secondPlatformHandle, profile_url: `https://www.youtube.com/@${secondPlatformHandle}`, follower_count: 9000 }],
    p_audience_city_id: cities[0].city_id,
    p_portfolio_items: [],
    p_public_profile_consent: true,
  }));
  assert.equal(secondCreatorReapplication, ids.secondCreator, "withdrawn creators can reapply using the same profile");
  throwOnError(await admin.rpc("admin_review_creator_profile", { p_creator_profile_id: ids.secondCreator, p_decision: "approve", p_review_note: null }));

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
  const requestNotification = requestNotifications.find((notification) => notification.title === "New collaboration request");
  assert.ok(requestNotification, "creator receives a notification for a new collaboration request");
  assert.match(requestNotification.notification_id, /^creator-event-[0-9a-f-]{36}$/);
  assert.equal(requestNotification.href, "/visitor/creator#creator-collaboration-title");
  const readNotifications = throwOnError(await visitor.rpc("mark_notification_items_read", { p_notification_ids: [requestNotification.notification_id] }));
  assert.ok(readNotifications.includes(requestNotification.notification_id));
  const incomingRequest = throwOnError(await visitor.from("creator_collaboration_requests")
    .select("status,title").eq("id", ids.request).single());
  assert.equal(incomingRequest.status, "pending");
  throwOnError(await admin.rpc("admin_review_creator_profile", {
    p_creator_profile_id: ids.creator,
    p_decision: "suspend",
    p_review_note: "Pause collaboration responses during a safety review.",
  }));
  const suspendedCreatorNotifications = throwOnError(await visitor.rpc("get_creator_collaboration_notifications"));
  assert.ok(suspendedCreatorNotifications.some((notification) => notification.title === "Creator profile suspended"));
  const unavailableSellerNotifications = throwOnError(await seller.rpc("get_creator_collaboration_notifications"));
  assert.ok(unavailableSellerNotifications.some((notification) => notification.title === "Creator profile is temporarily unavailable"));
  const suspendedResponse = await visitor.rpc("creator_decide_collaboration_request", {
    p_request_id: ids.request,
    p_decision: "accept",
    p_response: "This response must be blocked while the profile is suspended.",
  });
  assert.equal(suspendedResponse.error?.code, "55000", "suspended creators cannot respond to pending collaboration requests");
  throwOnError(await admin.rpc("admin_review_creator_profile", {
    p_creator_profile_id: ids.creator,
    p_decision: "reinstate",
    p_review_note: null,
  }));
  const restoredSellerNotifications = throwOnError(await seller.rpc("get_creator_collaboration_notifications"));
  assert.ok(restoredSellerNotifications.some((notification) => notification.title === "Creator profile is available again"));
  throwOnError(await visitor.rpc("creator_decide_collaboration_request", {
    p_request_id: ids.request,
    p_decision: "accept",
    p_response: "Happy to discuss the campaign dates.",
  }));
  const sellerRequest = throwOnError(await seller.from("creator_collaboration_requests")
    .select("status,creator_response").eq("id", ids.request).single());
  assert.equal(sellerRequest.status, "accepted");
  assert.equal(sellerRequest.creator_response, "Happy to discuss the campaign dates.");
  const responseNotifications = throwOnError(await seller.rpc("get_creator_collaboration_notifications"));
  assert.ok(responseNotifications.some((notification) => notification.title === "Creator accepted your request"));
  const creatorNotificationsAfterResponse = throwOnError(await visitor.rpc("get_creator_collaboration_notifications"));
  assert.ok(creatorNotificationsAfterResponse.some((notification) => notification.notification_id === requestNotification.notification_id), "the original request event remains after its status changes");
  assert.equal(creatorNotificationsAfterResponse.some((notification) => notification.title === "Creator accepted your request"), false, "creators do not receive their own seller response notification");
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
  const sellerWithdrawalNotifications = throwOnError(await visitor.rpc("get_creator_collaboration_notifications"));
  assert.ok(sellerWithdrawalNotifications.some((notification) => notification.title === "Seller withdrew a collaboration request"));

  console.log("PASS: creator lifecycle, private durable review/collaboration notifications, correct recipient routing, notification read tracking, and existing profile/fan/collaboration workflows.");
} catch (error) {
  failure = error;
} finally {
  if (ids.requests.length) await service.from("creator_collaboration_requests").delete().in("id", ids.requests);
  const creatorIds = [ids.creator, ids.secondCreator].filter(Boolean);
  if (creatorIds.length) {
    await service.from("creator_first_referrals").delete().in("creator_profile_id", creatorIds);
    await service.from("creator_fans").delete().in("creator_profile_id", creatorIds);
    await service.from("creator_point_transactions").delete().in("creator_profile_id", creatorIds);
    await service.from("creator_profiles").delete().in("id", creatorIds);
  }
  if (ids.admin) {
    await service.from("admin_audit_logs").delete().eq("actor_id", ids.admin);
    await service.auth.admin.deleteUser(ids.admin);
  }
  if (ids.sellerProfile) await service.from("seller_profiles").delete().eq("id", ids.sellerProfile);
  if (ids.sellerUser) await service.auth.admin.deleteUser(ids.sellerUser);
  if (ids.fan) await service.auth.admin.deleteUser(ids.fan);
  if (ids.secondOwner) await service.auth.admin.deleteUser(ids.secondOwner);
  if (ids.visitor) await service.auth.admin.deleteUser(ids.visitor);
}

if (failure) throw failure;