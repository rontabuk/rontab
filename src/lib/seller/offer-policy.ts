export const PRODUCT_REWARD_POINTS = 100;
export const MIN_PRODUCT_REWARD_POINTS = 50;
export const MAX_PRODUCT_REWARD_POINTS = 1_000_000;
export const DEFAULT_DISCOUNT_PER_CUSTOMER = 1;
export const MAX_PRODUCT_OFFER_VOUCHERS = 1000;

export type OfferAudience = "general" | "reward";
export type OfferFulfillment = "branch" | "online";

export function isValidProductRewardPoints(points: number): boolean {
  return Number.isSafeInteger(points) && points >= MIN_PRODUCT_REWARD_POINTS && points <= MAX_PRODUCT_REWARD_POINTS;
}

export function getProductOfferPoints(fulfillment: OfferFulfillment, pointsCost = PRODUCT_REWARD_POINTS): number {
  return fulfillment === "branch" ? pointsCost : 0;
}

export function isValidOfferQuantity(quantity: number): boolean {
  return Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= MAX_PRODUCT_OFFER_VOUCHERS;
}

export function isValidCustomerOfferLimit(limit: number, totalQuantity: number): boolean {
  return isValidOfferQuantity(totalQuantity) && Number.isSafeInteger(limit) && limit >= 1 && limit <= totalQuantity;
}

export function isOfferCombinationSupported(audience: OfferAudience, fulfillment: OfferFulfillment): boolean {
  return audience !== "reward" || fulfillment === "branch";
}

export function getOfferBookingBlock(kind: string, reservationsUsed: number, nextFreeAt: string | null, now: number, customerLimit = DEFAULT_DISCOUNT_PER_CUSTOMER): string | null {
  if (kind === "discount" && reservationsUsed >= customerLimit) return `You have reached the ${customerLimit}-reservation limit for this discount offer.`;
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