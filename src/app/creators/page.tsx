import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, ArrowRight, ArrowUpRight, ListFilter, UsersRound } from "lucide-react";
import { creatorSpecialties } from "@/lib/creator/catalog";
import { formatNumber } from "@/lib/format";
import { createSupabasePublicClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Creators | Rontab", description: "Discover Rontab creators and the platforms they share on." };
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
  const sort = requestedSort === "name" ? "name" : "followers";
  const supabase = createSupabasePublicClient();
  async function loadProfilesBatch(offset: number) {
    const { data, error } = await supabase.from("creator_profiles")
      .select("id,slug,published_display_name,published_bio,published_specialties,published_audience_city_id,creator_platform_accounts(id,platform,profile_url,follower_count),creator_portfolio_items(id,title,url,position)")
      .eq("is_public", true)
      .eq("creator_platform_accounts.is_published", true)
      .eq("creator_portfolio_items.is_published", true)
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
  const audienceCityIds = [...new Set(profiles.map((profile) => profile.published_audience_city_id).filter((cityId): cityId is string => Boolean(cityId)))];
  const citiesById = new Map<string, string>();
  for (let offset = 0; offset < audienceCityIds.length; offset += 200) {
    const { data, error } = await supabase.from("supported_cities")
      .select("city_id,city_name,country_code")
      .in("city_id", audienceCityIds.slice(offset, offset + 200));
    if (error) throw new Error(error.message);
    for (const city of data) citiesById.set(city.city_id, `${city.city_name}, ${city.country_code}`);
  }
  const cities = [...citiesById].sort((left, right) => left[1].localeCompare(right[1]));
  const city = audienceCityIds.includes(requestedCity ?? "") ? requestedCity : undefined;
  const matchingProfiles = profiles.map((profile) => ({
    ...profile,
    totalFollowers: profile.creator_platform_accounts.reduce((total, account) => total + account.follower_count, 0),
  })).filter((profile) => (!specialty || profile.published_specialties?.includes(specialty))
    && (!city || profile.published_audience_city_id === city)
    && (!minimumFollowers || profile.totalFollowers > minimumFollowers))
    .sort((left, right) => (sort === "followers" ? right.totalFollowers - left.totalFollowers : 0)
      || (left.published_display_name ?? "").localeCompare(right.published_display_name ?? "")
      || left.id.localeCompare(right.id));
  const pageCount = Math.max(1, Math.ceil(matchingProfiles.length / 60));
  const pageNumber = Number(requestedPage);
  const page = Number.isSafeInteger(pageNumber) && pageNumber > 0 ? Math.min(pageNumber, pageCount) : 1;
  const visibleProfiles = matchingProfiles.slice((page - 1) * 60, page * 60);
  const hasFilters = Boolean(specialty || city || minimumFollowers || sort === "name");
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
        <p className="creator-directory-eyebrow">THE RONTAB COMMUNITY</p>
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
          {visibleProfiles.map((profile) => {
            const profileAccounts = [...profile.creator_platform_accounts].sort((left, right) => left.platform.localeCompare(right.platform));
            const portfolio = [...profile.creator_portfolio_items].sort((left, right) => left.position - right.position);
            return (
              <article className="creator-directory-item" key={profile.id}>
                <div className="creator-directory-item-main">
                  <p className="creator-directory-specialties">{(profile.published_specialties ?? []).map((value) => creatorSpecialties.find((item) => item.value === value)?.label ?? value).join(" · ")}</p>
                  <h2><Link href={`/creators/${profile.slug}`}>{profile.published_display_name}<ArrowUpRight size={16} aria-hidden="true" /></Link></h2>
                  <p className="creator-directory-bio">{profile.published_bio}</p>
                  {profile.published_audience_city_id && <p className="creator-directory-location">Audience: {citiesById.get(profile.published_audience_city_id) ?? profile.published_audience_city_id}</p>}
                  <p className="creator-directory-total"><strong>{formatNumber(profile.totalFollowers)}</strong> total social followers <small>Self-reported, unverified</small></p>
                  <div className="creator-directory-platforms">
                    {profileAccounts.map((account) => (
                      <a href={account.profile_url} target="_blank" rel="noreferrer" key={account.id}>
                        <span>{account.platform === "x" ? "X" : account.platform}</span>
                        <strong>{formatNumber(account.follower_count)}</strong>
                        <small>self-reported</small>
                      </a>
                    ))}
                  </div>
                  {portfolio.length > 0 && <div className="creator-directory-portfolio">{portfolio.map((item) => <a href={item.url} target="_blank" rel="noreferrer" key={item.id}>{item.title}<ArrowUpRight size={13} aria-hidden="true" /></a>)}</div>}
                </div>
                <Link className="creator-directory-view" href={`/creators/${profile.slug}`}>View profile <ArrowUpRight size={14} aria-hidden="true" /></Link>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="creator-directory-empty"><h2>No creators found</h2><p>{hasFilters ? "No published creators match these filters." : "There are no published creator profiles yet."}</p>{hasFilters && <Link href="/creators">Clear filters</Link>}</div>
      )}
      {pageCount > 1 && <nav className="creator-directory-pagination" aria-label="Creator directory pages">
        {page > 1 ? <Link href={pageHref(page - 1)}><ArrowLeft size={14} aria-hidden="true" />Previous</Link> : <span />}
        <span>Page {formatNumber(page)} of {formatNumber(pageCount)}</span>
        {page < pageCount ? <Link href={pageHref(page + 1)}>Next<ArrowRight size={14} aria-hidden="true" /></Link> : <span />}
      </nav>}
      <p className="creator-directory-note">Social follower totals are supplied by creators and are unverified. They may include the same person on multiple platforms and exclude Rontab code followers.</p>
    </main>
  );
}