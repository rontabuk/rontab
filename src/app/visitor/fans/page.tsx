import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowUpRight, Heart, UserRoundMinus } from "lucide-react";
import { ActionForm } from "@/components/ActionForm";
import { CreatorVerificationBadge } from "@/components/creator/CreatorVerificationBadge";
import { CreatorInfluenceBadge } from "@/components/creator/CreatorInfluence";
import { getCreatorInfluence } from "@/lib/creator/influence-server";
import { creatorSpecialties } from "@/lib/creator/catalog";
import { formatDateTime, formatNumber } from "@/lib/format";
import { getVisitorAccount } from "@/lib/visitor/access";
import { followCreatorByCode, unfollowCreator } from "@/app/visitor/creator-actions";
import type { Database } from "@/lib/supabase/database.types";
import "../visitor.css";

export const metadata: Metadata = { title: "I'm a fan of", robots: { index: false, follow: false } };
export const instant = false;

type CreatorFollow = Database["public"]["Functions"]["creator_get_my_follows"]["Returns"][number];

export default async function VisitorFansPage({
  searchParams,
}: {
  searchParams: Promise<{ follow?: string; first?: string; unfollowed?: string }>;
}) {
  await connection();
  const [{ follow, first, unfollowed }, { supabase }] = await Promise.all([searchParams, getVisitorAccount("/visitor/fans")]);
  const [followsResult, metricsResult] = await Promise.all([
    supabase.rpc("creator_get_my_follows"),
    supabase.rpc("creator_get_my_fan_stats"),
  ]);
  if (followsResult.error) throw new Error(followsResult.error.message);
  if (metricsResult.error) throw new Error(metricsResult.error.message);
  const follows: CreatorFollow[] = followsResult.data ?? [];
  const metrics = metricsResult.data?.[0] ?? { fan_count: 0, first_referral_count: 0 };
  const influenceById = await getCreatorInfluence(supabase, follows.map((creator) => creator.creator_profile_id));

  return (
    <main className="admin-overview visitor-fans-page">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">YOUR CREATOR COMMUNITY</p>
        <h1>I&apos;m a fan of</h1>
        <p>Add a creator&apos;s code to follow them here. You can follow multiple creators.</p>
      </header>
      {follow === "added" && <p className="admin-save-success" role="status">Creator added to your fan list.{first === "1" ? " This is your first creator referral." : ""}</p>}
      {follow === "already" && <p className="admin-save-success" role="status">You already follow this creator. Your list was not duplicated.</p>}
      {unfollowed === "1" && <p className="admin-save-success" role="status">Creator removed from your fan list.</p>}

      <div className="visitor-fan-summary" aria-label="Creator fan summary">
        <div><strong>{formatNumber(follows.length)}</strong><span>creators followed</span></div>
        {metrics.first_referral_count > 0 && <div><strong>{formatNumber(metrics.first_referral_count)}</strong><span>first-referral source</span></div>}
      </div>

      <section className="visitor-fan-code-section" aria-labelledby="visitor-fan-code-title">
        <div className="visitor-profile-heading">
          <p className="admin-eyebrow">FOLLOW A CREATOR</p>
          <h2 id="visitor-fan-code-title">Enter their creator code</h2>
        </div>
        <ActionForm className="visitor-fan-code-form" action={followCreatorByCode}>
          <label htmlFor="visitor-creator-code">Creator code</label>
          <div><input id="visitor-creator-code" name="creator_code" placeholder="RT-1A2B3C4D5E" autoCapitalize="characters" maxLength={13} required /><button className="admin-primary-button" type="submit"><Heart size={14} aria-hidden="true" />Add creator</button></div>
          <small>Following a creator does not give you points. Your first code is recorded as your original creator referral.</small>
        </ActionForm>
      </section>

      <section className="visitor-fan-list-section" aria-labelledby="visitor-fan-list-title">
        <div className="visitor-profile-heading">
          <p className="admin-eyebrow">YOUR LIST</p>
          <h2 id="visitor-fan-list-title">Creators you follow</h2>
        </div>
        {follows.length ? (
          <ol className="visitor-fan-list">
            {follows.map((creator) => (
              <li key={creator.creator_profile_id}>
                <div>
                  <p className="creator-directory-specialties">{creator.specialties.map((value) => creatorSpecialties.find((item) => item.value === value)?.label ?? value).join(" · ")}</p>
                  <h3><Link href={`/creators/${creator.slug}`}>{creator.display_name}<ArrowUpRight size={15} aria-hidden="true" /></Link><CreatorVerificationBadge />{influenceById.has(creator.creator_profile_id) && <CreatorInfluenceBadge points={influenceById.get(creator.creator_profile_id)!.qualified_referrals} />}</h3>
                  {creator.audience_city_name && <p>{creator.audience_city_name}, {creator.country_code}</p>}
                  <small>Following since {formatDateTime(creator.followed_at)}</small>
                  <span className="visitor-fan-code">{creator.referral_code}</span>
                </div>
                <form action={unfollowCreator}>
                  <input type="hidden" name="creator_profile_id" value={creator.creator_profile_id} />
                  <button type="submit"><UserRoundMinus size={14} aria-hidden="true" />Unfollow</button>
                </form>
              </li>
            ))}
          </ol>
        ) : (
          <div className="admin-empty-state"><h2>Your fan list is empty</h2><p>Enter a creator&apos;s code to add them to your list.</p><Link href="/creators">Browse approved creators <ArrowUpRight size={14} aria-hidden="true" /></Link></div>
        )}
      </section>
      <p className="visitor-fan-disclaimer">You can follow multiple creators. Your first creator code stays recorded as your original referral; adding another creator does not award points or change that attribution.</p>
    </main>
  );
}