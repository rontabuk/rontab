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
const ids = { visitor: null, ordinaryVisitor: null, fan: null, secondOwner: null, sellerUser: null, sellerProfile: null, admin: null, creator: null, creatorMedia: [], secondCreator: null };
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

  ids.ordinaryVisitor = await createAccount(`creator-ordinary-${suffix}@example.com`);
  const ordinaryVisitor = createClient(url, anonKey);
  throwOnError(await ordinaryVisitor.auth.signInWithPassword({ email: `creator-ordinary-${suffix}@example.com`, password }));
  const visitorApplication = await ordinaryVisitor.rpc("save_creator_application", {
    p_display_name: "Visitor applicant",
    p_bio: "I create useful local food and home content for an engaged community.",
    p_specialties: ["food"],
    p_platform_accounts: [{ platform: "instagram", handle: `visitor_${suffix.slice(0, 8)}`, profile_url: `https://www.instagram.com/visitor_${suffix.slice(0, 8)}/`, follower_count: 12000 }],
    p_audience_city_id: cities[0].city_id,
    p_portfolio_items: [],
    p_public_profile_consent: true,
  });
  assert.equal(visitorApplication.error?.code, "42501", "visitor accounts cannot turn into creators; creators register separately");

  ids.visitor = await createAccount(`creator-test-${suffix}@example.com`, { account_type: "creator" });
  const visitor = createClient(url, anonKey);
  throwOnError(await visitor.auth.signInWithPassword({ email: `creator-test-${suffix}@example.com`, password }));

  ids.admin = await createAccount(`creator-admin-${suffix}@example.com`, { role: "admin" });
  const admin = createClient(url, anonKey);
  throwOnError(await admin.auth.signInWithPassword({ email: `creator-admin-${suffix}@example.com`, password }));

  const profileName = `Local Creator ${suffix.slice(0, 8)}`;
  const firstPlatformHandle = `creator_${suffix.slice(0, 8)}`;
  const tooFewFollowers = await visitor.rpc("save_creator_application", {
    p_display_name: profileName,
    p_bio: "I create useful local food and home content for an engaged community.",
    p_specialties: ["food"],
    p_platform_accounts: [{ platform: "instagram", handle: firstPlatformHandle, profile_url: `https://www.instagram.com/${firstPlatformHandle}/`, follower_count: 2999 }],
    p_audience_city_id: cities[0].city_id,
    p_portfolio_items: [],
    p_public_profile_consent: true,
  });
  assert.equal(tooFewFollowers.error?.code, "22023", "creator applications need at least 3,000 total followers");
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

  const profileImagePath = `${ids.visitor}/${ids.creator}/profile/${suffix}.png`;
  const coverImagePath = `${ids.visitor}/${ids.creator}/cover/${suffix}.png`;
  const imageFixture = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  throwOnError(await visitor.storage.from("creator-profile-media").upload(profileImagePath, imageFixture, { contentType: "image/png" }));
  ids.creatorMedia.push(profileImagePath);
  throwOnError(await visitor.storage.from("creator-profile-media").upload(coverImagePath, imageFixture, { contentType: "image/png" }));
  ids.creatorMedia.push(coverImagePath);
  throwOnError(await visitor.rpc("creator_save_profile_media_paths", {
    p_profile_image_path: profileImagePath,
    p_cover_image_path: coverImagePath,
  }));
  const privateMediaDraft = throwOnError(await service.from("creator_profiles")
    .select("profile_image_path,cover_image_path,published_profile_image_path,published_cover_image_path")
    .eq("id", ids.creator).single());
  assert.equal(privateMediaDraft.profile_image_path, profileImagePath);
  assert.equal(privateMediaDraft.cover_image_path, coverImagePath);
  assert.equal(privateMediaDraft.published_profile_image_path, null);
  assert.equal(privateMediaDraft.published_cover_image_path, null);
  const ownerDraftMediaUrl = throwOnError(await visitor.storage.from("creator-profile-media").createSignedUrl(profileImagePath, 60));
  assert.ok(ownerDraftMediaUrl.signedUrl, "creators can preview their own draft media");
  const hiddenDraftMediaUrl = await publicClient.storage.from("creator-profile-media").createSignedUrl(profileImagePath, 60);
  assert.ok(hiddenDraftMediaUrl.error, "anonymous visitors cannot create a URL for unapproved creator media");
  const adminDraftMediaUrl = throwOnError(await admin.storage.from("creator-profile-media").createSignedUrl(profileImagePath, 60));
  assert.ok(adminDraftMediaUrl.signedUrl, "administrators can inspect creator media before approval");

  const creatorOwner = throwOnError(await service.from("creator_profiles").select("owner_id").eq("id", ids.creator).single());
  assert.equal(creatorOwner.owner_id, ids.visitor, "the creator profile belongs to the standalone creator account");

  const hiddenBeforeApproval = throwOnError(await publicClient.from("creator_profiles").select("id").eq("id", ids.creator));
  assert.equal(hiddenBeforeApproval.length, 0, "unapproved applications must stay private");
  const unverifiedApproval = await admin.rpc("admin_review_creator_profile", { p_creator_profile_id: ids.creator, p_decision: "approve", p_review_note: null });
  assert.equal(unverifiedApproval.error?.code, "55000", "creators must confirm their email before approval");
  throwOnError(await service.from("profiles").update({ email_verified_at: new Date().toISOString() }).eq("id", ids.visitor));
  throwOnError(await admin.rpc("admin_review_creator_profile", { p_creator_profile_id: ids.creator, p_decision: "approve", p_review_note: null }));

  const firstPublic = throwOnError(await publicClient.from("creator_profiles")
    .select("published_display_name,published_audience_city_id,published_profile_image_path,published_cover_image_path")
    .eq("id", ids.creator).single());
  assert.equal(firstPublic.published_display_name, profileName);
  assert.equal(firstPublic.published_audience_city_id, cities[0].city_id);
  assert.equal(firstPublic.published_profile_image_path, profileImagePath, "creator approval publishes the profile picture snapshot");
  assert.equal(firstPublic.published_cover_image_path, coverImagePath, "creator approval publishes the cover snapshot");
  const publicMediaUrl = throwOnError(await publicClient.storage.from("creator-profile-media").createSignedUrl(profileImagePath, 60));
  const publicCoverUrl = throwOnError(await publicClient.storage.from("creator-profile-media").createSignedUrl(coverImagePath, 60));
  assert.ok(publicMediaUrl.signedUrl, "anonymous visitors can view approved creator media through a signed URL");
  assert.ok(publicCoverUrl.signedUrl, "anonymous visitors can view the approved creator cover through a signed URL");
  const revisedCoverPath = `${ids.visitor}/${ids.creator}/cover/revised-${suffix}.png`;
  throwOnError(await visitor.storage.from("creator-profile-media").upload(revisedCoverPath, imageFixture, { contentType: "image/png" }));
  ids.creatorMedia.push(revisedCoverPath);
  const mediaOnlyUpdate = await visitor.rpc("creator_save_profile_media_paths", {
    p_profile_image_path: profileImagePath,
    p_cover_image_path: revisedCoverPath,
  });
  assert.equal(mediaOnlyUpdate.error?.code, "55000", "published media cannot bypass full creator-profile review");
  const mediaResubmission = throwOnError(await visitor.rpc("save_creator_application_with_audience_cities", {
    p_display_name: profileName,
    p_bio: "I create useful local food and home content for an engaged community.",
    p_specialties: ["food", "local"],
    p_platform_accounts: [{ platform: "instagram", handle: firstPlatformHandle, profile_url: `https://www.instagram.com/${firstPlatformHandle}/`, follower_count: 12000 }],
    p_audience_city_ids: cities.map((city) => city.city_id),
    p_portfolio_items: [{ title: "Approved sample", url: "https://www.instagram.com/example/reel/" }],
    p_public_profile_consent: true,
  }));
  assert.equal(mediaResubmission, ids.creator, "editing creator media resubmits the existing profile rather than creating another account");
  throwOnError(await visitor.rpc("creator_save_profile_media_paths", {
    p_profile_image_path: profileImagePath,
    p_cover_image_path: revisedCoverPath,
  }));
  const coverWhileReviewing = throwOnError(await service.from("creator_profiles")
    .select("status,is_public,cover_image_path,published_cover_image_path")
    .eq("id", ids.creator).single());
  assert.equal(coverWhileReviewing.status, "submitted", "changing approved creator media returns it to review");
  assert.equal(coverWhileReviewing.is_public, true, "the previous approved creator profile remains public during review");
  assert.equal(coverWhileReviewing.cover_image_path, revisedCoverPath);
  assert.equal(coverWhileReviewing.published_cover_image_path, coverImagePath, "the previous cover remains published until approval");
  const hiddenRevisedCover = await publicClient.storage.from("creator-profile-media").createSignedUrl(revisedCoverPath, 60);
  assert.ok(hiddenRevisedCover.error, "anonymous visitors cannot access a revised cover before approval");
  throwOnError(await admin.rpc("admin_review_creator_profile", { p_creator_profile_id: ids.creator, p_decision: "approve", p_review_note: null }));
  const revisedCoverPublished = throwOnError(await publicClient.from("creator_profiles")
    .select("published_cover_image_path").eq("id", ids.creator).single());
  assert.equal(revisedCoverPublished.published_cover_image_path, revisedCoverPath, "creator approval publishes the revised cover");
  const publishedAudienceCities = throwOnError(await publicClient.from("creator_profile_audience_cities")
    .select("city_id").eq("creator_profile_id", ids.creator).eq("is_published", true).order("city_id"));
  assert.deepEqual(publishedAudienceCities.map((city) => city.city_id), cities.map((city) => city.city_id).sort(), "creator approval publishes all selected audience cities");
  throwOnError(await visitor.rpc("creator_save_contact_preferences", {
    p_phone: "+441234000001",
    p_phone_visibility: "collaborations",
  }));
  assert.equal(throwOnError(await publicClient.rpc("get_public_creator_contact_phone", { p_creator_profile_id: ids.creator })), null, "creator collaboration-only phone stays hidden from public visitors");
  assert.equal(throwOnError(await publicClient.from("creator_contact_details").select("phone").eq("creator_profile_id", ids.creator)).length, 0, "RLS hides collaboration-only creator phone rows from anonymous visitors");
  throwOnError(await visitor.rpc("creator_save_contact_preferences", {
    p_phone: "+441234000001",
    p_phone_visibility: "public",
  }));
  assert.equal(throwOnError(await publicClient.rpc("get_public_creator_contact_phone", { p_creator_profile_id: ids.creator })), "+441234000001", "creator public phone appears only after explicit opt-in");
  assert.equal(throwOnError(await publicClient.from("creator_contact_details").select("phone").eq("creator_profile_id", ids.creator)).length, 1, "RLS exposes a creator phone row to anonymous visitors only after public opt-in");
  throwOnError(await visitor.rpc("creator_save_contact_preferences", {
    p_phone: "+441234000001",
    p_phone_visibility: "collaborations",
  }));
  assert.equal(throwOnError(await publicClient.rpc("get_public_creator_contact_phone", { p_creator_profile_id: ids.creator })), null, "creator can revoke public phone visibility");
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

  ids.secondOwner = await createAccount(`creator-second-${suffix}@example.com`, { account_type: "creator" });
  const secondOwner = createClient(url, anonKey);
  throwOnError(await secondOwner.auth.signInWithPassword({ email: `creator-second-${suffix}@example.com`, password }));
  throwOnError(await service.from("profiles").update({ email_verified_at: new Date().toISOString() }).eq("id", ids.secondOwner));
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
  assert.equal(selfFollow.error?.code, "42501", "creator accounts cannot follow creators as fans");

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
  const publicSellerProfile = throwOnError(await publicClient.from("seller_profiles")
    .select("id,slug,shop_name,description,logo_url,shop_url,shop_city_id")
    .eq("id", ids.sellerProfile).single());
  assert.equal(publicSellerProfile.shop_name, `Local Test Shop ${suffix.slice(0, 8)}`, "anonymous visitors can read the public shop identity");
  const seller = createClient(url, anonKey);
  throwOnError(await seller.auth.signInWithPassword({ email: `creator-seller-${suffix}@example.com`, password }));
  throwOnError(await admin.rpc("admin_review_creator_profile", {
    p_creator_profile_id: ids.creator,
    p_decision: "suspend",
    p_review_note: "Pause creator activity during a safety review.",
  }));
  const suspendedCreatorNotifications = throwOnError(await visitor.rpc("get_creator_collaboration_notifications"));
  const suspensionNotification = suspendedCreatorNotifications.find((notification) => notification.title === "Creator profile suspended");
  assert.ok(suspensionNotification, "creator is notified when the profile is suspended");
  assert.match(suspensionNotification.notification_id, /^creator-event-[0-9a-f-]{36}$/);
  const readNotifications = throwOnError(await visitor.rpc("mark_notification_items_read", { p_notification_ids: [suspensionNotification.notification_id] }));
  assert.ok(readNotifications.includes(suspensionNotification.notification_id));
  const sellerNotifications = throwOnError(await seller.rpc("get_creator_collaboration_notifications"));
  assert.equal(sellerNotifications.some((notification) => notification.title === "Creator profile suspended"), false, "sellers do not receive creator review notifications");
  throwOnError(await admin.rpc("admin_review_creator_profile", {
    p_creator_profile_id: ids.creator,
    p_decision: "reinstate",
    p_review_note: null,
  }));
  const sellerCannotReadDraft = throwOnError(await seller.from("creator_profiles")
    .select("display_name").eq("id", ids.creator));
  assert.equal(sellerCannotReadDraft.length, 0, "signed-in sellers cannot read creator application fields");
  const removedCollaborationRequests = await seller.rpc("seller_create_creator_collaboration_request", {
    p_creator_profile_id: ids.creator,
    p_seller_profile_id: ids.sellerProfile,
    p_title: "Removed workflow",
    p_brief: "The direct collaboration request workflow was replaced by product opportunities.",
    p_proposed_compensation: "",
  });
  assert.ok(removedCollaborationRequests.error, "the retired direct collaboration request RPC is no longer available");

  console.log("PASS: creator lifecycle, private draft media and approval publication, durable review notifications, correct recipient routing, notification read tracking, and existing profile/fan workflows.");
} catch (error) {
  failure = error;
} finally {
  if (ids.creatorMedia.length) await service.storage.from("creator-profile-media").remove(ids.creatorMedia);
  const creatorIds = [ids.creator, ids.secondCreator].filter(Boolean);
  if (creatorIds.length) {
    await service.from("creator_first_referrals").delete().in("creator_profile_id", creatorIds);
    await service.from("creator_fans").delete().in("creator_profile_id", creatorIds);
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
  if (ids.ordinaryVisitor) await service.auth.admin.deleteUser(ids.ordinaryVisitor);
}

if (failure) throw failure;