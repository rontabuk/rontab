import type { Metadata } from "next";
import Image from "next/image";
import { connection } from "next/server";
import Link from "next/link";
import { ArrowRight, MapPin, UserRound } from "lucide-react";
import { ActionForm } from "@/components/ActionForm";
import { CityPicker } from "@/components/CityPicker";
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
  const [{ data: profile, error: profileError }, { data: summaryRows, error: summaryError }, { data: cityLocked, error: cityLockError }, { countries, cities }] = await Promise.all([
    supabase.from("profiles").select("display_name,avatar_url,city,city_id,country_code").eq("id", user.id).single(),
    supabase.rpc("get_visitor_loyalty_summary"),
    supabase.rpc("is_visitor_city_locked"),
    getSupportedLocations(),
  ]);

  if (profileError) throw new Error(profileError.message);
  if (summaryError) throw new Error(summaryError.message);
  if (cityLockError) throw new Error(cityLockError.message);
  const summary = summaryRows?.[0] ?? { points_balance: 0, points_earned: 0, points_spent: 0 };
  const savedCity = await getSavedCity(supabase, profile.city_id);

  let avatarUrl: string | null = null;
  if (profile.avatar_url?.startsWith(`${user.id}/`)) {
    const { data, error } = await supabase.storage.from("visitor-avatars").createSignedUrl(profile.avatar_url, 60 * 60);
    if (error) throw new Error(error.message);
    avatarUrl = data.signedUrl;
  }

  return (
    <main className="admin-overview visitor-overview">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">YOUR RONTAB ACCOUNT</p>
        <h1>My account</h1>
        <p>Manage your details and your place in the Rontab community.</p>
      </header>
      {saved === "1" && <p className="admin-save-success" role="status">Your profile was saved.</p>}
      {locationLocked === "1" && <p className="visitor-rewards-error" role="alert">Your city could not be changed because a matching local offer became active. Your other profile changes were not saved.</p>}
      <div className="visitor-dashboard-grid">
        <section className="visitor-points-summary" aria-labelledby="visitor-points-title">
          <p className="admin-eyebrow">LOYALTY</p>
          <h2 id="visitor-points-title">Your points balance</h2>
          <strong>{formatNumber(summary.points_balance)}</strong>
          <p>{formatNumber(summary.points_earned)} earned · {formatNumber(summary.points_spent)} used</p>
          <Link className="visitor-rewards-link" href="/visitor/rewards">Points & rewards <ArrowRight size={15} aria-hidden="true" /></Link>
        </section>
        <section className="visitor-profile-section" aria-labelledby="visitor-profile-title">
          <div className="visitor-profile-heading">
            <p className="admin-eyebrow">PROFILE</p>
            <h2 id="visitor-profile-title">Your details</h2>
          </div>
          <ActionForm className="visitor-profile-form" action={saveVisitorProfile}>
            <div className="visitor-avatar-control">
              <label className="visitor-avatar-label" htmlFor="visitor-avatar-image">Profile picture</label>
              <div className="visitor-avatar-preview">
                {avatarUrl ? <Image src={avatarUrl} alt="Your profile picture" fill sizes="88px" unoptimized /> : <UserRound size={34} aria-hidden="true" />}
              </div>
              <input id="visitor-avatar-image" name="avatar_image" type="file" accept="image/jpeg,image/png,image/webp" />
              <small>JPEG, PNG, or WebP. Maximum 5 MB.</small>
              {avatarUrl && (
                <label className="visitor-avatar-remove">
                  <input name="remove_avatar" type="checkbox" />
                  Remove current picture
                </label>
              )}
            </div>
            <label>
              Display name
              <input name="display_name" defaultValue={profile.display_name ?? ""} maxLength={100} autoComplete="name" />
              <small>This name is for your Rontab account.</small>
            </label>
            <label>
              Registered email
              <input type="email" value={user.email ?? ""} readOnly />
              <small className="seller-profile-verified">Email confirmed</small>
            </label>
            <div className="visitor-location-heading">
              <MapPin size={15} aria-hidden="true" />
              <span>Offer location</span>
            </div>
            {cityLocked && (
              <p className="visitor-location-lock" role="status">
                Your city is locked while a local offer is active. You can update it when that offer ends.
              </p>
            )}
            <CityPicker
              name="city_id"
              countries={countries}
              cities={cities}
              initialCity={savedCity}
              initialCountryCode={profile.country_code}
              disabled={cityLocked}
            />
            <button className="admin-primary-button" type="submit">Save profile</button>
          </ActionForm>
        </section>
      </div>
    </main>
  );
}