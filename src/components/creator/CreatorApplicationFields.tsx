import { CreatorMediaPicker } from "@/components/creator/CreatorMediaPicker";
import { MultiCityPicker } from "@/components/MultiCityPicker";
import type { SupportedCity } from "@/components/CityPicker";
import { CREATOR_MIN_TOTAL_FOLLOWERS, creatorPlatforms, creatorSpecialties } from "@/lib/creator/catalog";
import { formatNumber } from "@/lib/format";

type PlatformAccount = { platform: string; handle: string; profile_url: string; follower_count: number };
type PortfolioItem = { title: string; url: string; position: number };

export function CreatorApplicationFields({
  cities,
  profile = null,
  audienceCityIds = [],
  accounts = [],
  portfolioItems = [],
  profileImageUrl = null,
  coverImageUrl = null,
  requireProfileImage = false,
  showDisplayName = true,
}: {
  cities: SupportedCity[];
  profile?: { display_name: string; bio: string; specialties: string[] } | null;
  audienceCityIds?: string[];
  accounts?: PlatformAccount[];
  portfolioItems?: PortfolioItem[];
  profileImageUrl?: string | null;
  coverImageUrl?: string | null;
  requireProfileImage?: boolean;
  showDisplayName?: boolean;
}) {
  const accountsByPlatform = new Map(accounts.map((account) => [account.platform, account]));
  const portfolioByPosition = new Map(portfolioItems.map((item) => [item.position, item]));

  return (
    <>
      <fieldset className="creator-profile-media">
        <legend>Profile images <small>These images are published after the profile is approved.</small></legend>
        <div className="creator-profile-media-grid">
          <CreatorMediaPicker kind="profile" initialUrl={profileImageUrl} required={requireProfileImage} />
          <CreatorMediaPicker kind="cover" initialUrl={coverImageUrl} />
        </div>
      </fieldset>
      {showDisplayName && <label>
        Public display name
        <input name="display_name" defaultValue={profile?.display_name ?? ""} minLength={2} maxLength={100} autoComplete="nickname" required />
      </label>}

      <div className="creator-audience-location">
        <p>Audience cities <small>Optional. Choose up to 10 cities where your audience is based, not your home address.</small></p>
        <MultiCityPicker name="audience_city_id" cities={cities} initialCityIds={audienceCityIds} maxSelected={10} />
      </div>
      <label>
        About you and your content
        <textarea name="bio" defaultValue={profile?.bio ?? ""} minLength={30} maxLength={2000} rows={6} required />
        <small>30 to 2,000 characters. Do not include private contact details.</small>
      </label>

      <fieldset className="creator-specialties">
        <legend>Content specialties <small>Choose 1 to 5</small></legend>
        <div>
          {creatorSpecialties.map(({ value, label }) => (
            <label key={value}>
              <input name="specialty" type="checkbox" value={value} defaultChecked={profile?.specialties.includes(value)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="creator-platforms">
        <legend>Social platforms <small>Add at least one. Your followers across all platforms must total at least {formatNumber(CREATOR_MIN_TOTAL_FOLLOWERS)}.</small></legend>
        <div className="creator-platform-list">
          {creatorPlatforms.map(({ value, label }) => {
            const account = accountsByPlatform.get(value);
            return (
              <div className="creator-platform-row" key={value}>
                <h3>{label}</h3>
                <label>
                  Handle
                  <input name={`platform_${value}_handle`} defaultValue={account?.handle ?? ""} maxLength={100} autoComplete="off" />
                </label>
                <label>
                  Profile link
                  <input name={`platform_${value}_url`} type="url" defaultValue={account?.profile_url ?? ""} maxLength={500} placeholder="https://" />
                </label>
                <label>
                  Followers
                  <input name={`platform_${value}_followers`} type="number" min="0" max="1000000000" step="1" defaultValue={account?.follower_count ?? ""} inputMode="numeric" />
                </label>
              </div>
            );
          })}
        </div>
        <p className="creator-metrics-disclaimer">Follower counts are self-reported, checked during review, and shown with their last update date.</p>
      </fieldset>

      <fieldset className="creator-portfolio">
        <legend>Work samples <small>Optional. Add up to three public links.</small></legend>
        {[1, 2, 3].map((position) => {
          const item = portfolioByPosition.get(position);
          return (
            <div className="creator-portfolio-row" key={position}>
              <label>Sample {position} title<input name={`portfolio_${position}_title`} defaultValue={item?.title ?? ""} maxLength={120} /></label>
              <label>HTTPS link<input name={`portfolio_${position}_url`} type="url" defaultValue={item?.url ?? ""} maxLength={500} placeholder="https://" /></label>
            </div>
          );
        })}
      </fieldset>

      <label className="creator-public-consent">
        <input name="public_profile_consent" type="checkbox" required />
        <span>I agree that my profile picture, cover image, name, introduction, specialties, audience cities, platform links, follower counts, and work samples may appear on my public creator profile.</span>
      </label>
    </>
  );
}
