import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowUpRight, UsersRound } from "lucide-react";
import { creatorSpecialties } from "@/lib/creator/catalog";
import { formatNumber } from "@/lib/format";
import { createSupabasePublicClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Creators | Rontab", description: "Discover Rontab creators and the platforms they share on." };
export const instant = false;

export default async function CreatorsDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ specialty?: string }>;
}) {
  await connection();
  const { specialty: requestedSpecialty } = await searchParams;
  const specialty = creatorSpecialties.find(({ value }) => value === requestedSpecialty)?.value;
  const supabase = createSupabasePublicClient();
  let profilesQuery = supabase
    .from("creator_profiles")
    .select("id,slug,display_name,bio,specialties,status,is_public,submitted_at,created_at,updated_at")
    .eq("is_public", true)
    .order("updated_at", { ascending: false })
    .limit(60);
  if (specialty) profilesQuery = profilesQuery.contains("specialties", [specialty]);
  const { data: profiles, error: profileError } = await profilesQuery;
  if (profileError) throw new Error(profileError.message);

  const profileIds = profiles.map((profile) => profile.id);
  const { data: accounts, error: accountsError } = profileIds.length
    ? await supabase.from("creator_platform_accounts")
      .select("id,creator_profile_id,platform,handle,profile_url,follower_count,followers_updated_at")
      .in("creator_profile_id", profileIds)
      .order("platform")
    : { data: [], error: null };
  if (accountsError) throw new Error(accountsError.message);
  const accountsByProfile = new Map<string, typeof accounts>();
  for (const account of accounts ?? []) {
    const list = accountsByProfile.get(account.creator_profile_id) ?? [];
    list.push(account);
    accountsByProfile.set(account.creator_profile_id, list);
  }

  return (
    <main className="creator-directory">
      <header className="creator-directory-heading">
        <p className="creator-directory-eyebrow">THE RONTAB COMMUNITY</p>
        <h1>Creators worth knowing.</h1>
        <p>Explore approved creator profiles, their specialties, and the platforms where they publish.</p>
      </header>
      <div className="creator-directory-toolbar">
        <span><UsersRound size={15} aria-hidden="true" />{formatNumber(profiles.length)} creators</span>
        <form action="/creators" method="get">
          <label htmlFor="creator-specialty-filter">Specialty</label>
          <select id="creator-specialty-filter" name="specialty" defaultValue={specialty ?? "all"}>
            <option value="all">All specialties</option>
            {creatorSpecialties.map(({ value, label }) => <option value={value} key={value}>{label}</option>)}
          </select>
          <button type="submit">Filter</button>
        </form>
      </div>
      {profiles.length ? (
        <div className="creator-directory-list">
          {profiles.map((profile) => {
            const profileAccounts = accountsByProfile.get(profile.id) ?? [];
            return (
              <article className="creator-directory-item" key={profile.id}>
                <div className="creator-directory-item-main">
                  <p className="creator-directory-specialties">{profile.specialties.map((value) => creatorSpecialties.find((item) => item.value === value)?.label ?? value).join(" · ")}</p>
                  <h2><Link href={`/creators/${profile.slug}`}>{profile.display_name}<ArrowUpRight size={16} aria-hidden="true" /></Link></h2>
                  <p className="creator-directory-bio">{profile.bio}</p>
                  <div className="creator-directory-platforms">
                    {profileAccounts.map((account) => (
                      <a href={account.profile_url} target="_blank" rel="noreferrer" key={account.id}>
                        <span>{account.platform === "x" ? "X" : account.platform}</span>
                        <strong>{formatNumber(account.follower_count)}</strong>
                        <small>self-reported</small>
                      </a>
                    ))}
                  </div>
                </div>
                <Link className="creator-directory-view" href={`/creators/${profile.slug}`}>View profile <ArrowUpRight size={14} aria-hidden="true" /></Link>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="creator-directory-empty"><h2>No creators found</h2><p>There are no approved profiles for this specialty yet.</p></div>
      )}
      <p className="creator-directory-note">Follower counts are supplied by creators and may not be independently verified.</p>
    </main>
  );
}