export const PRODUCT_REWARD_POINTS = 100;
export const MIN_PRODUCT_REWARD_POINTS = 50;
export const MAX_PRODUCT_REWARD_POINTS = 1_000_000;

export type OfferAudience = "general" | "reward";
export type OfferFulfillment = "branch" | "online";

export function isValidProductRewardPoints(points: number): boolean {
  return Number.isSafeInteger(points) && points >= MIN_PRODUCT_REWARD_POINTS && points <= MAX_PRODUCT_REWARD_POINTS;
}

export function getProductOfferPoints(fulfillment: OfferFulfillment, pointsCost = PRODUCT_REWARD_POINTS): number {
  return fulfillment === "branch" ? pointsCost : 0;
}

export function getOfferDateCount(validFrom: string, validUntil: string): number {
  const start = new Date(`${validFrom}T00:00:00.000Z`);
  const end = new Date(`${validUntil}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)
    || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())
    || start.toISOString().slice(0, 10) !== validFrom || end.toISOString().slice(0, 10) !== validUntil || end < start) return 0;
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

export function getMaximumOfferClaims(validFrom: string, validUntil: string, dailyCapacity: number): number {
  if (!Number.isSafeInteger(dailyCapacity) || dailyCapacity < 1 || dailyCapacity > 1000) return 0;
  return Math.min(getOfferDateCount(validFrom, validUntil) * dailyCapacity, 1000);
}

export function isOfferCombinationSupported(audience: OfferAudience, fulfillment: OfferFulfillment): boolean {
  return audience !== "reward" || fulfillment === "branch";
}

export function getOfferBookingBlock(kind: string, reservationsUsed: number, nextFreeAt: string | null, now: number): string | null {
  if (kind === "discount" && reservationsUsed >= 3) return "You have reached the 3-reservation limit for this discount offer.";
  if ((kind === "free_item" || kind === "meal") && nextFreeAt && new Date(nextFreeAt).getTime() > now) {
    return `Available again ${new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" }).format(new Date(nextFreeAt))} UK time`;
  }
  return null;
}

export function getOfferAvailabilityVersion(
  totals: { offer_id: string; remaining_claims: number }[],
  daily: { offer_id: string; offer_date: string; remaining_claims: number }[],
) {
  return JSON.stringify([
    totals.map((entry) => [entry.offer_id, entry.remaining_claims]).sort((first, second) => String(first[0]).localeCompare(String(second[0]))),
    daily.map((entry) => [entry.offer_id, entry.offer_date, entry.remaining_claims]).sort((first, second) => `${first[0]}:${first[1]}`.localeCompare(`${second[0]}:${second[1]}`)),
  ]);
}