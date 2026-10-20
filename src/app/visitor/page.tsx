import type { Metadata } from "next";
import Image from "next/image";
import { connection } from "next/server";
import Link from "next/link";
import { ArrowLeft, MapPin, UserRound } from "lucide-react";
import { ActionForm } from "@/components/ActionForm";
import { ProfileImageUpload } from "@/components/ProfileImageUpload";
import { CityPicker } from "@/components/CityPicker";
import { VisitorProfileEditDialog } from "@/components/VisitorProfileEditDialog";
import { ProfileOffers } from "@/components/visitor/ProfileOffers";
import { getAvailableSellerOffers } from "@/lib/seller/available-offers";
import { formatNumber } from "@/lib/format";
import { getSavedCity, getSupportedLocations } from "@/lib/locations";
import { getVisitorAccount } from "@/lib/visitor/access";
import { saveVisitorProfile } from "@/app/visitor/actions";

export const metadata: Metadata = { title: "My account", robots: { index: false, follow: false } };
export const instant = false;

export default async function VisitorAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ locationLocked?: string; saved?: string }>;
}) {
  await connection();
  const [{ locationLocked, saved }, { supabase, user }] = await Promise.all([searchParams, getVisitorAccount()]);
  const [{ data: profile, error: profileError }, { data: summaryRows, error: summaryError }, { data: offers, error: offersError }, { data: cityLocked, error: cityLockError }, { data: followedShops, error: shopsError }, { data: followedCreators, error: creatorsError }, { data: followerSummaryRows, error: followerSummaryError }, { data: contactPreferences, error: contactError }, { data: socialLinks, error: socialLinksError }, { countries, cities }] = await Promise.all([
    supabase.from("profiles").select("display_name,avatar_url,city,city_id,country_code,email_verified_at").eq("id", user.id).single(),
    supabase.rpc("get_visitor_loyalty_summary"),
    supabase.rpc("get_visitor_loyalty_offers"),
    supabase.rpc("is_visitor_city_locked"),
    supabase.rpc("visitor_get_my_followed_shops"),
    supabase.rpc("creator_get_my_follows"),
    supabase.rpc("get_member_profile_follower_summary", { p_member_user_id: user.id }),
    supabase.from("member_contact_preferences").select("phone,contact_visibility,postcode,postcode_visibility").eq("user_id", user.id).maybeSingle(),
    supabase.from("member_social_links").select("position,platform,profile_url").eq("user_id", user.id).order("position"),
    getSupportedLocations(),
  ]);

  if (profileError) throw new Error(profileError.message);
  if (summaryError) throw new Error(summaryError.message);
  if (offersError) throw new Error(offersError.message);
  if (cityLockError) throw new Error(cityLockError.message);
  if (shopsError) throw new Error(shopsError.message);
  if (creatorsError) throw new Error(creatorsError.message);
  if (followerSummaryError) throw new Error(followerSummaryError.message);
  if (contactError) throw new Error(contactError.message);
  if (socialLinksError) throw new Error(socialLinksError.message);
  const summary = summaryRows?.[0] ?? { points_balance: 0, points_earned: 0, points_spent: 0 };
  const followerCount = followerSummaryRows?.[0]?.follower_count ?? 0;
  const availableOffers = offers ?? [];
  const sellerOffers = await getAvailableSellerOffers(supabase, profile.city_id);
  const targets = [...availableOffers.map((offer) => Math.max(offer.minimum_points, offer.points_cost)),
    ...sellerOffers.offers.filter((offer) => offer.points_cost > 0 && offer.remainingClaims !== 0).map((offer) => offer.points_cost)];
  const nearestTarget = targets
    .filter((target) => target > summary.points_balance)
    .sort((first, second) => first - second)[0];
  const pointsReady = targets.length > 0 && !nearestTarget;
  const pointsProgress = nearestTarget
    ? Math.min(100, summary.points_balance / nearestTarget * 100)
    : pointsReady ? 100 : 0;
  const pointsCaption = nearestTarget
    ? `${formatNumber(nearestTarget - summary.points_balance)} points to next offer`
    : pointsReady
      ? "Ready to use"
      : summary.points_balance > 0
        ? "Saved for future offers"
        : "Earn from eligible visits";
  const savedCity = await getSavedCity(supabase, profile.city_id);

  let avatarUrl: string | null = null;
  if (profile.avatar_url?.startsWith(`${user.id}/`)) {
    const { data, error } = await supabase.storage.from("visitor-avatars").createSignedUrl(profile.avatar_url, 60 * 60);
    if (error) throw new Error(error.message);
    avatarUrl = data.signedUrl;
  }

  return (
    <main className="admin-overview visitor-overview">
      <Link className="visitor-account-back" href="/products"><ArrowLeft size={14} aria-hidden="true" />Back to products</Link>
      {saved === "1" && <p className="admin-save-success" role="status">Your profile was saved.</p>}
      {locationLocked === "1" && <p className="visitor-rewards-error" role="alert">Your city could not be changed because a matching local offer became active. Your other profile changes were not saved.</p>}
      <section className="visitor-account-profile" aria-label="Profile overview">
        <div className="visitor-account-topline">
          <div className="visitor-account-identity">
            <div className="visitor-avatar-preview">
              {avatarUrl ? <Image src={avatarUrl} alt="Your profile picture" fill sizes="104px" unoptimized /> : <UserRound size={38} aria-hidden="true" />}
            </div>
            <div>
              <h2>{profile.display_name || "Member"}</h2>
              {savedCity ? <p><MapPin size={14} aria-hidden="true" />{savedCity.city_name}, {savedCity.country_code}</p> : <p><MapPin size={14} aria-hidden="true" />Choose an offer location</p>}
            </div>
            <div className="visitor-account-profile-actions">
              <VisitorProfileEditDialog>
                <ActionForm className="visitor-profile-form" action={saveVisitorProfile}>
                  <ProfileImageUpload
                    className="visitor-avatar-control"
                    inputId="visitor-avatar-image"
                    name="avatar_image"
                    removeName="remove_avatar"
                    label="Profile picture"
                    removeLabel="Remove current picture"
                    currentUrl={avatarUrl}
                    alt="Your profile picture"
                  />
                  <label>Display name<input name="display_name" defaultValue={profile.display_name ?? ""} maxLength={100} autoComplete="name" /><small>This name is for your account.</small></label>
                  <label>Registered email<input type="email" value={user.email ?? ""} readOnly />
                    {profile.email_verified_at
                      ? <small className="seller-profile-verified">Email confirmed</small>
                      : <small role="status">Email not confirmed. Confirm it before spending points; use Notifications to resend the link.</small>}
                  </label>
                  <label>Phone number<input name="contact_phone" type="tel" autoComplete="tel" maxLength={32} defaultValue={contactPreferences?.phone ?? ""} placeholder="+44…" /></label>
                  <label>Who can see your contact details?
                    <select name="contact_visibility" defaultValue={contactPreferences?.contact_visibility ?? "private"}>
                      <option value="private">Only me</option><option value="sellers">Sellers</option><option value="creators">Creators</option><option value="public">Everyone</option>
                    </select>
                    <small>This setting applies to your confirmed email, phone number and social links. It is private by default.</small>
                  </label>
                  <div className="visitor-postcode-row">
                    <label>Postcode <small>(optional)</small><input name="postcode" defaultValue={contactPreferences?.postcode ?? ""} autoComplete="postal-code" autoCapitalize="characters" maxLength={8} placeholder="DN1 1AA" /></label>
                    <label>Who can see your postcode?
                      <select name="postcode_visibility" defaultValue={contactPreferences?.postcode_visibility ?? "private"}>
                        <option value="private">Only me</option><option value="sellers">Sellers</option><option value="creators">Creators</option><option value="public">Everyone</option>
                      </select>
                    </label>
                  </div>
                  <fieldset className="visitor-social-links">
                    <legend>Social profiles <small>Optional. Add up to three.</small></legend>
                    {[1, 2, 3].map((position) => {
                      const socialLink = socialLinks.find((item) => item.position === position);
                      return <div className="visitor-social-link-row" key={position}>
                        <label>Platform<select name={`social_${position}_platform`} defaultValue={socialLink?.platform ?? ""}>
                          <option value="">Choose a platform</option><option value="instagram">Instagram</option><option value="tiktok">TikTok</option><option value="youtube">YouTube</option><option value="facebook">Facebook</option><option value="x">X</option><option value="other">Other</option>
                        </select></label>
                        <label>Profile link<input name={`social_${position}_url`} type="url" maxLength={500} defaultValue={socialLink?.profile_url ?? ""} placeholder="https://" /></label>
                      </div>;
                    })}
                  </fieldset>
                  <div className="visitor-location-heading"><MapPin size={15} aria-hidden="true" /><span>Offer location</span></div>
                  {cityLocked && <p className="visitor-location-lock" role="status">Your city is locked while a local offer is active. You can update it when that offer ends.</p>}
                  <CityPicker name="city_id" countries={countries} cities={cities} initialCity={savedCity} initialCountryCode={profile.country_code} disabled={cityLocked} />
                  <button className="admin-primary-button" type="submit">Save profile</button>
                </ActionForm>
              </VisitorProfileEditDialog>
              <Link href={`/members/${user.id}`}>View profile</Link>
            </div>
          </div>
        </div>
        <nav className="visitor-account-stats" aria-label="Your activity">
          <Link href={`/members/${user.id}`}><strong>{formatNumber(followerCount)}</strong><span>Followers</span></Link>
          <Link href="/visitor/shops-following"><strong>{formatNumber(followedShops.length)}</strong><span>Shops followed</span></Link>
          <Link href="/visitor/fans"><strong>{formatNumber(followedCreators.length)}</strong><span>Creators followed</span></Link>
        </nav>
        <section className="visitor-account-points" aria-label="Available points">
          <Link className="visitor-account-points-link" href="/visitor/rewards" aria-label="View points and rewards">
            <div className="visitor-account-points-gauge-column">
              <div className="visitor-points-gauge" style={{ "--points-progress": `${pointsProgress}%` } as React.CSSProperties}>
                <div className="visitor-points-gauge-core"><strong>{formatNumber(summary.points_balance)}</strong><small>points</small></div>
              </div>
              <span>Available</span>
            </div>
            <div className="visitor-account-points-progress">
              <strong>{pointsCaption}</strong>
              {nearestTarget ? (
                <div className="visitor-progress-track" role="progressbar" aria-label="Progress to next offer" aria-valuemin={0} aria-valuemax={nearestTarget} aria-valuenow={Math.min(summary.points_balance, nearestTarget)}>
                  <span style={{ width: `${pointsProgress}%` }} />
                </div>
              ) : <div className={`visitor-progress-track${pointsReady ? " is-complete" : ""}`}><span /></div>}
              <p>{formatNumber(summary.points_earned)} earned · {formatNumber(summary.points_spent)} used</p>
            </div>
          </Link>
        </section>
      </section>
      <ProfileOffers offers={sellerOffers.offers} cityId={profile.city_id} available={sellerOffers.available} />
    </main>
  );
}