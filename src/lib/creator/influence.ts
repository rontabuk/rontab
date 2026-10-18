export const creatorInfluenceLevels = [
  { minimum: 0, label: "Building influence", symbol: "none", tone: "neutral" },
  { minimum: 100, label: "Bronze star", symbol: "star", tone: "bronze" },
  { minimum: 500, label: "Silver star", symbol: "star", tone: "silver" },
  { minimum: 1_000, label: "Gold star", symbol: "star", tone: "gold" },
  { minimum: 5_000, label: "Silver shield", symbol: "shield", tone: "silver" },
  { minimum: 10_000, label: "Gold shield", symbol: "shield", tone: "gold" },
] as const;

export type CreatorInfluence = {
  creator_profile_id: string;
  fan_count: number;
  first_referral_count: number;
  qualified_referrals: number;
  active_referrals_30d: number;
};

export function getCreatorInfluenceLevel(points: number) {
  const count = Number.isFinite(points) ? Math.max(0, Math.floor(points)) : 0;
  const level = creatorInfluenceLevels.findLast((candidate) => count >= candidate.minimum) ?? creatorInfluenceLevels[0];
  const next = creatorInfluenceLevels.find((candidate) => candidate.minimum > count) ?? null;
  return { level, next, remaining: next ? next.minimum - count : 0 };
}