import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, ArrowUpRight, Heart, HeartOff, Mail, MapPin, Phone, UsersRound } from "lucide-react";
import { followMemberProfile, unfollowMemberProfile } from "@/app/member-actions";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { getViewer } from "@/lib/auth/viewer";
import { isUuid } from "@/lib/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import "./member-profile.css";

export const metadata: Metadata = { title: "Member profile", robots: { index: false, follow: false } };
export const instant = false;

export default async function MemberProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ profileId: string }>;
  searchParams: Promise<{ followed?: string; alreadyFollowing?: string; unfollowed?: string; followError?: string; followUnavailable?: string }>;
}) {
  await connection();
  const [{ profileId }, { followed, alreadyFollowing, unfollowed, followError, followUnavailable }, viewer] = await Promise.all([params, searchParams, getViewer()]);
  if (!isUuid(profileId)) notFound();

  const supabase = await createSupabaseServerClient();
  const [{ data, error }, { data: followerRows, error: followerError }] = await Promise.all([
    supabase.rpc("get_member_contact_profile", { p_member_user_id: profileId }),
    supabase.rpc("get_member_profile_follower_summary", { p_member_user_id: profileId }),
  ]);
  if (error) throw new Error(error.message);
  if (followerError) throw new Error(followerError.message);
  const profile = data?.[0];
  if (!profile) notFound();
  const followerSummary = followerRows?.[0] ?? { follower_count: 0, is_following: false };
  const isOwner = viewer.role !== "guest" && viewer.userId === profileId;
  const socialLinks = (data ?? []).flatMap((item) => item.social_platform && item.social_profile_url
    ? [{ platform: item.social_platform, url: item.social_profile_url }]
    : []);

  return (
    <>
      <SiteHeader />
      <main className="member-public-profile">
        <Link className="member-profile-back" href="/visitor"><ArrowLeft size={14} aria-hidden="true" />My account</Link>
        <header className="member-profile-heading">
          <div>
            <p className="admin-eyebrow">RONTAB MEMBER</p>
            <h1>{profile.display_name || "Rontab member"}</h1>
            {profile.city_name && <p className="member-profile-location"><MapPin size={14} aria-hidden="true" />{profile.city_name}{profile.country_code ? `, ${profile.country_code}` : ""}</p>}
            <p className="member-profile-followers"><UsersRound size={14} aria-hidden="true" />{new Intl.NumberFormat("en-GB").format(followerSummary.follower_count)} followers</p>
          </div>
          <div className="member-profile-actions">
            {!isOwner && viewer.role === "guest" ? (
              <Link href={`/account?next=${encodeURIComponent(`/members/${profileId}`)}`}><Heart size={14} aria-hidden="true" />Follow</Link>
            ) : !isOwner && viewer.role !== "admin" ? (
              <form action={followerSummary.is_following ? unfollowMemberProfile : followMemberProfile}>
                <input type="hidden" name="profile_id" value={profileId} />
                <button type="submit">{followerSummary.is_following ? <><HeartOff size={14} aria-hidden="true" />Unfollow</> : <><Heart size={14} aria-hidden="true" />Follow</>}</button>
              </form>
            ) : null}
          </div>
        </header>
        {followed === "1" && <p className="member-profile-feedback" role="status">You are now following this member.</p>}
        {alreadyFollowing === "1" && <p className="member-profile-feedback" role="status">You already follow this member.</p>}
        {unfollowed === "1" && <p className="member-profile-feedback" role="status">You no longer follow this member.</p>}
        {followError === "1" && <p className="member-profile-feedback is-error" role="alert">You cannot follow your own profile.</p>}
        {followUnavailable === "1" && <p className="member-profile-feedback is-error" role="alert">This profile is not available to your account.</p>}
        {(profile.phone || profile.contact_email || socialLinks.length > 0) ? (
          <section className="member-profile-contact" aria-labelledby="member-profile-contact-title">
            <h2 id="member-profile-contact-title">Contact details</h2>
            {profile.phone && <a href={`tel:${profile.phone}`}><Phone size={15} aria-hidden="true" />{profile.phone}</a>}
            {profile.contact_email && <a href={`mailto:${profile.contact_email}`}><Mail size={15} aria-hidden="true" />{profile.contact_email}</a>}
            {socialLinks.map((item) => (
              <a href={item.url} target="_blank" rel="noreferrer" key={item.platform}>
                <ArrowUpRight size={15} aria-hidden="true" />{socialPlatformLabel(item.platform)}
              </a>
            ))}
          </section>
        ) : <p className="member-profile-no-contact">This member has not added public contact details.</p>}
      </main>
      <SiteFooter />
    </>
  );
}

function socialPlatformLabel(platform: string) {
  const labels: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", facebook: "Facebook", x: "X", other: "Social profile" };
  return labels[platform] ?? "Social profile";
}
