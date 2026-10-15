import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, BadgeCheck, ExternalLink } from "lucide-react";
import { creatorSpecialties } from "@/lib/creator/catalog";
import { formatDate, formatNumber } from "@/lib/format";
import { createSupabasePublicClient } from "@/lib/supabase/server";
import "../creators.css";

export const instant = false;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const supabase = createSupabasePublicClient();
  const { data } = await supabase.from("creator_profiles").select("display_name,bio").eq("slug", slug).eq("is_public", true).maybeSingle();
  return data
    ? { title: `${data.display_name} | Rontab Creators`, description: data.bio.slice(0, 160) }
    : { title: "Creator profile | Rontab" };
}

export default async function CreatorProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  const supabase = createSupabasePublicClient();
  const { data: profile, error: profileError } = await supabase
    .from("creator_profiles")
    .select("id,slug,display_name,bio,specialties,status,is_public,submitted_at,created_at,updated_at")
    .eq("slug", slug)
    .eq("is_public", true)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (!profile) notFound();

  const { data: accounts, error: accountsError } = await supabase
    .from("creator_platform_accounts")
    .select("id,creator_profile_id,platform,handle,profile_url,follower_count,followers_updated_at")
    .eq("creator_profile_id", profile.id)
    .order("platform");
  if (accountsError) throw new Error(accountsError.message);

  return (
    <main className="creator-public-profile">
      <Link className="creator-back-link" href="/creators"><ArrowLeft size={14} aria-hidden="true" />All creators</Link>
      <header className="creator-profile-hero">
        <p className="creator-directory-eyebrow">RONTAB CREATOR PROFILE</p>
        <h1>{profile.display_name}</h1>
        <p className="creator-profile-specialties">
          {profile.specialties.map((value) => creatorSpecialties.find((item) => item.value === value)?.label ?? value).join(" · ")}
        </p>
        <p className="creator-profile-bio">{profile.bio}</p>
        <p className="creator-approved-mark"><BadgeCheck size={15} aria-hidden="true" />Profile reviewed by Rontab</p>
      </header>
      <section className="creator-public-platforms" aria-labelledby="creator-public-platforms-title">
        <div className="creator-public-section-heading">
          <div><p className="creator-directory-eyebrow">FOLLOW THEIR WORK</p><h2 id="creator-public-platforms-title">Platforms & audience</h2></div>
          <span>Counts last updated by creator</span>
        </div>
        {accounts.length ? (
          <div className="creator-public-platform-list">
            {accounts.map((account) => (
              <article key={account.id}>
                <div><p>{account.platform === "x" ? "X" : account.platform}</p><h3>@{account.handle}</h3></div>
                <div className="creator-public-followers"><strong>{formatNumber(account.follower_count)}</strong><span>followers</span><small>Updated {formatDate(account.followers_updated_at)}</small></div>
                <a href={account.profile_url} target="_blank" rel="noreferrer" aria-label={`Open ${account.platform} profile for ${profile.display_name}`}><span>Visit profile</span><ExternalLink size={15} aria-hidden="true" /></a>
              </article>
            ))}
          </div>
        ) : <p className="creator-directory-note">No social profiles have been added.</p>}
      </section>
      <p className="creator-directory-note">Rontab reviews creator applications. Follower counts are self-reported and not independently verified.</p>
    </main>
  );
}