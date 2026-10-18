import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, ArrowRight, ArrowUpRight, ListFilter, Send, UsersRound } from "lucide-react";
import { CreatorVerificationBadge } from "@/components/creator/CreatorVerificationBadge";
import { CreatorInfluenceBadge } from "@/components/creator/CreatorInfluence";
import { getCreatorInfluence } from "@/lib/creator/influence-server";
import { creatorSpecialties } from "@/lib/creator/catalog";
import { formatNumber } from "@/lib/format";
import { createSupabasePublicClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Creators", description: "Discover creators and the platforms they share on." };
export const instant = false;

export default async function CreatorsDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ specialty?: string; city?: string; followers?: string; sort?: string; page?: string }>;
}) {
  await connection();
  const { specialty: requestedSpecialty, city: requestedCity, followers: requestedFollowers, sort: requestedSort, page: requestedPage } = await searchParams;
  const specialty = creatorSpecialties.find(({ value }) => value === requestedSpecialty)?.value;
  const followerThresholds = [1000, 10000, 50000, 100000];
  const minimumFollowers = followerThresholds.find((value) => String(value) === requestedFollowers) ?? 0;
  const sort = ["name", "influence", "active"].includes(requestedSort ?? "") ? requestedSort! : "followers";
  const supabase = createSupabasePublicClient();
  async function loadProfilesBatch(offset: number) {
    const { data, error } = await supabase.from("creator_profiles")
      .select("id,slug,published_display_name,published_specialties,published_audience_city_id,creator_profile_audience_cities(city_id,is_published),creator_platform_accounts(follower_count)")
      .eq("is_public", true)
      .eq("creator_platform_accounts.is_published", true)
      .eq("creator_profile_audience_cities.is_published", true)
      .order("id")
      .range(offset, offset + 199);
    if (error) throw new Error(error.message);
    return data;
  }
  const profiles: Awaited<ReturnType<typeof loadProfilesBatch>> = [];
  for (let offset = 0; ; offset += 200) {
    const batch = await loadProfilesBatch(offset);
    profiles.push(...batch);
    if (batch.length < 200) break;
  }
  const influenceById = await getCreatorInfluence(supabase, profiles.map((profile) => profile.id));
  const profilesWithAudienceCities = profiles.map((profile) => ({
    ...profile,
    audienceCityIds: [...new Set([
      ...profile.creator_profile_audience_cities.map((city) => city.city_id),
      ...(profile.published_audience_city_id ? [profile.published_audience_city_id] : []),
    ])],
  }));
  const audienceCityIds = [...new Set(profilesWithAudienceCities.flatMap((profile) => profile.audienceCityIds))];
  const citiesById = new Map<string, string>();
  for (let offset = 0; offset < audienceCityIds.length; offset += 200) {
    const { data, error } = await supabase.from("supported_cities")
      .select("city_id,city_name")
      .in("city_id", audienceCityIds.slice(offset, offset + 200));
    if (error) throw new Error(error.message);
    for (const city of data) citiesById.set(city.city_id, city.city_name);
  }
  const cities = [...citiesById].sort((left, right) => left[1].localeCompare(right[1]));
  const city = audienceCityIds.includes(requestedCity ?? "") ? requestedCity : undefined;
  const matchingProfiles = profilesWithAudienceCities.map((profile) => ({
    ...profile,
    totalFollowers: profile.creator_platform_accounts.reduce((total, account) => total + account.follower_count, 0),
  })).filter((profile) => (!specialty || profile.published_specialties?.includes(specialty))
    && (!city || profile.audienceCityIds.includes(city))
    && (!minimumFollowers || profile.totalFollowers > minimumFollowers))
    .sort((left, right) => (sort === "influence" ? (influenceById.get(right.id)?.qualified_referrals ?? 0) - (influenceById.get(left.id)?.qualified_referrals ?? 0)
      : sort === "active" ? (influenceById.get(right.id)?.active_referrals_30d ?? 0) - (influenceById.get(left.id)?.active_referrals_30d ?? 0)
        : sort === "followers" ? right.totalFollowers - left.totalFollowers : 0)
      || (left.published_display_name ?? "").localeCompare(right.published_display_name ?? "")
      || left.id.localeCompare(right.id));
  const pageCount = Math.max(1, Math.ceil(matchingProfiles.length / 60));
  const pageNumber = Number(requestedPage);
  const page = Number.isSafeInteger(pageNumber) && pageNumber > 0 ? Math.min(pageNumber, pageCount) : 1;
  const visibleProfiles = matchingProfiles.slice((page - 1) * 60, page * 60);
  const hasFilters = Boolean(specialty || city || minimumFollowers || sort !== "followers");
  function pageHref(targetPage: number) {
    const params = new URLSearchParams({ sort, page: String(targetPage) });
    if (specialty) params.set("specialty", specialty);
    if (city) params.set("city", city);
    if (minimumFollowers) params.set("followers", String(minimumFollowers));
    return `/creators?${params}`;
  }

  return (
    <main className="creator-directory">
      <header className="creator-directory-heading">
        <p className="creator-directory-eyebrow">THE CREATOR COMMUNITY</p>
        <h1>Creators worth knowing.</h1>
        <p>Explore approved creator profiles, their specialties, and the platforms where they publish.</p>
      </header>
      <div className="creator-directory-toolbar">
        <span role="status"><UsersRound size={15} aria-hidden="true" />{formatNumber(matchingProfiles.length)} of {formatNumber(profiles.length)} creators</span>
        <form action="/creators" method="get" key={`${specialty ?? "all"}:${city ?? "all"}:${minimumFollowers}:${sort}`}>
          <label htmlFor="creator-specialty-filter">Specialty
          <select id="creator-specialty-filter" name="specialty" defaultValue={specialty ?? "all"}>
            <option value="all">All specialties</option>
            {creatorSpecialties.map(({ value, label }) => <option value={value} key={value}>{label}</option>)}
          </select>
          </label>
          <label htmlFor="creator-city-filter">Audience area
            <select id="creator-city-filter" name="city" defaultValue={city ?? "all"}>
              <option value="all">All audience areas</option>
              {cities.map(([cityId, label]) => <option value={cityId} key={cityId}>{label}</option>)}
            </select>
          </label>
          <label htmlFor="creator-followers-filter">Total social followers
            <select id="creator-followers-filter" name="followers" defaultValue={minimumFollowers || "all"}>
              <option value="all">Any follower count</option>
              {followerThresholds.map((value) => <option value={value} key={value}>More than {formatNumber(value)}</option>)}
            </select>
          </label>
          <label htmlFor="creator-sort">Sort by
            <select id="creator-sort" name="sort" defaultValue={sort}>
              <option value="followers">Most social followers</option>
              <option value="influence">Most Rontab influence</option>
              <option value="active">Most active referrals · 30 days</option>
              <option value="name">Name</option>
            </select>
          </label>
          <div className="creator-directory-filter-actions">
            <button type="submit"><ListFilter size={14} aria-hidden="true" />Filter</button>
            {hasFilters && <Link href="/creators">Clear filters</Link>}
          </div>
        </form>
      </div>
      {visibleProfiles.length ? (
        <div className="creator-directory-list">
          {visibleProfiles.map((profile) => (
              <article className="creator-directory-item" key={profile.id}>
                <div className="creator-directory-item-main">
                  <h2 className="creator-directory-name"><Link href={`/creators/${profile.slug}`}>{profile.published_display_name}</Link><CreatorVerificationBadge /></h2>
                  {influenceById.has(profile.id) && <><CreatorInfluenceBadge points={influenceById.get(profile.id)!.qualified_referrals} /><p className="creator-directory-total"><strong>{formatNumber(influenceById.get(profile.id)!.qualified_referrals)}</strong> influence points · {formatNumber(influenceById.get(profile.id)!.active_referrals_30d)} active referrals in 30 days</p></>}
                  <Link className="creator-directory-request" href={`/creators/${profile.slug}#creator-collaboration-form-title`}><Send size={13} aria-hidden="true" />Send private request</Link>
                  <p className="creator-directory-total"><strong>{formatNumber(profile.totalFollowers)}</strong> self-reported social followers</p>
                </div>
                <Link className="creator-directory-view" href={`/creators/${profile.slug}`}>View profile <ArrowUpRight size={14} aria-hidden="true" /></Link>
              </article>
          ))}
        </div>
      ) : (
        <div className="creator-directory-empty"><h2>No creators found</h2><p>{hasFilters ? "No published creators match these filters." : "There are no published creator profiles yet."}</p>{hasFilters && <Link href="/creators">Clear filters</Link>}</div>
      )}
      {pageCount > 1 && <nav className="creator-directory-pagination" aria-label="Creator directory pages">
        {page > 1 ? <Link href={pageHref(page - 1)}><ArrowLeft size={14} aria-hidden="true" />Previous</Link> : <span />}
        <span>Page {formatNumber(page)} of {formatNumber(pageCount)}</span>
        {page < pageCount ? <Link href={pageHref(page + 1)}>Next<ArrowRight size={14} aria-hidden="true" /></Link> : <span />}
      </nav>}
    </main>
  );
}