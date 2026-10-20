export const creatorSpecialties = [
  { value: "food", label: "Food & dining" },
  { value: "beauty", label: "Beauty" },
  { value: "fashion", label: "Fashion" },
  { value: "technology", label: "Technology" },
  { value: "travel", label: "Travel" },
  { value: "home", label: "Home & living" },
  { value: "fitness", label: "Fitness" },
  { value: "family", label: "Family" },
  { value: "local", label: "Local discoveries" },
  { value: "other", label: "Other" },
] as const;

export const creatorPlatforms = [
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "facebook", label: "Facebook" },
  { value: "x", label: "X" },
] as const;

export type CreatorPlatform = (typeof creatorPlatforms)[number]["value"];

export const MIN_CREATOR_OPPORTUNITY_BUDGET = 20;

export const CREATOR_MIN_TOTAL_FOLLOWERS = 3000;
