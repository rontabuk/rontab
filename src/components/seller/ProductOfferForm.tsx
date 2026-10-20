"use client";

import { useState } from "react";
import { Gift, Send, Tag } from "lucide-react";
import { ActionForm } from "@/components/ActionForm";
import type { SupportedCity, SupportedCountry } from "@/components/CityPicker";
import { MultiCityPicker } from "@/components/MultiCityPicker";
import { publishProductOffer } from "@/app/seller/(protected)/product-offer-actions";
import { formatNumber } from "@/lib/format";
import { DEFAULT_DISCOUNT_PER_CUSTOMER, getProductOfferPoints, MAX_PRODUCT_OFFER_VOUCHERS, PRODUCT_REWARD_POINTS, type OfferAudience, type OfferFulfillment } from "@/lib/seller/offer-policy";
import type { Database } from "@/lib/supabase/database.types";

export function ProductOfferForm({ productId, requestId, countries, cities, postcode, today, audienceCounts, shopUrl, rewardPoints = PRODUCT_REWARD_POINTS }: {
  productId: string;
  requestId: string;
  countries: SupportedCountry[];
  cities: SupportedCity[];
  postcode: string;
  today: string;
  audienceCounts: Database["public"]["Functions"]["seller_get_product_offer_audience"]["Returns"];
  shopUrl: string;
  rewardPoints?: number;
}) {
  const [audience, setAudience] = useState<OfferAudience>("general");
  const [fulfillment, setFulfillment] = useState<OfferFulfillment>("branch");
  const [kind, setKind] = useState("discount");
  const [maxClaims, setMaxClaims] = useState(50);
  const [maxPerCustomer, setMaxPerCustomer] = useState(DEFAULT_DISCOUNT_PER_CUSTOMER);
  const branchPointsCost = getProductOfferPoints("branch", rewardPoints);
  const countsByCity = new Map(audienceCounts.map((count) => [count.city_id, count]));
  const cityDetails = Object.fromEntries(cities.map((city) => {
    const estimate = countsByCity.get(city.city_id);
    return [city.city_id, estimate?.is_withheld ? "Fewer than 5 eligible customers" : estimate?.eligible_count != null ? `${estimate.eligible_count.toLocaleString("en-GB")} eligible customers` : "Audience count unavailable"];
  }));
  return <ActionForm className="seller-product-offer-form" action={publishProductOffer}>
    <input type="hidden" name="product_id" value={productId} />
    <input type="hidden" name="request_id" value={requestId} />
    <fieldset className="seller-offer-choice"><legend>Offer audience</legend>
      <label><input type="radio" name="audience" value="general" checked={audience === "general"} onChange={() => setAudience("general")} /><Tag size={16} aria-hidden="true" /><span>Public offer<small>Available to all eligible customers</small></span></label>
      <label><input type="radio" name="audience" value="reward" checked={audience === "reward"} onChange={() => { setAudience("reward"); setFulfillment("branch"); }} /><Gift size={16} aria-hidden="true" /><span>Exclusive reward<small>Exclusive to RonTab loyalty members</small></span></label>
    </fieldset>
    <p className="seller-product-offer-note">{fulfillment === "branch" ? `Branch vouchers cost ${formatNumber(branchPointsCost)} points to reserve, for both public offers and exclusive rewards.` : "Online offers are public and do not use points."}</p>
    <div className="seller-product-offer-row">
      <label>Benefit<select name="offer_kind" value={kind} onChange={(event) => { setKind(event.target.value); if (event.target.value !== "discount") setFulfillment("branch"); }}><option value="discount">Percentage discount</option><option value="free_item">Free product</option><option value="meal">Free meal</option><option value="other">Special offer</option></select></label>
      {kind === "discount" && <label>Discount %<input name="discount_percent" type="number" min="0.01" max="100" step="0.01" required /></label>}
    </div>
    <label>Offer details<textarea name="benefit_details" rows={3} minLength={3} maxLength={1000} placeholder="State exactly what is included, exclusions and any minimum spend." required /></label>
    <p className="seller-product-offer-note">{kind === "discount" ? `Each customer can reserve this discount up to ${formatNumber(maxPerCustomer)} times. Cancelled reservations do not count.` : kind === "free_item" || kind === "meal" ? "One free benefit per customer for this product every 7 days, including republished offers." : "One reservation per customer per day."}</p>
    <fieldset className="seller-offer-targeting"><legend>Audience cities</legend>
      <p className="seller-product-offer-note">{countries.find((country) => country.country_code === "GB")?.country_name ?? "United Kingdom"}</p>
      <MultiCityPicker name="city_ids" cities={cities} maxSelected={10} cityDetails={cityDetails} emptySelectionLabel="All UK · no specific cities selected" />
      <p className="seller-product-offer-note">Verified eligible customer accounts, based on saved profile cities, not verified residence. Exact counts below 5 are withheld for privacy.</p>
    </fieldset>
    <div className="seller-product-offer-row"><label>Starts<input name="valid_from" type="date" min={today} defaultValue={today} required /></label><label>Ends<input name="valid_until" type="date" min={today} defaultValue={today} required /></label></div>
    <fieldset className="seller-offer-choice"><legend>Redemption</legend>
      <label><input type="radio" name="fulfillment" value="branch" checked={fulfillment === "branch"} onChange={() => setFulfillment("branch")} /><span>Branch voucher</span></label>
      <label><input type="radio" name="fulfillment" value="online" checked={fulfillment === "online"} disabled={audience === "reward" || kind !== "discount" || !shopUrl.startsWith("https://")} onChange={() => setFulfillment("online")} /><span>Seller website<small>Public discounts with a code only</small></span></label>
    </fieldset>
    {fulfillment === "branch" ? <>
      <p className="seller-product-offer-note">One redemption branch. Total vouchers are shared across all selected cities and dates.</p>
      <label>Branch postcode<input name="postcode" autoComplete="postal-code" maxLength={8} defaultValue={postcode} placeholder="SW1A 1AA" required /></label>
      <div className="seller-product-offer-row"><label>From · UK time<input name="starts_at" type="time" defaultValue="10:00" required /></label><label>Until · UK time<input name="ends_at" type="time" defaultValue="18:00" required /></label></div>
      <div className="seller-product-offer-row">
        <label>Total vouchers<input name="max_claims" type="number" min="1" max={MAX_PRODUCT_OFFER_VOUCHERS} step="1" value={maxClaims} onChange={(event) => { const nextTotal = Number(event.target.value); setMaxClaims(nextTotal); setMaxPerCustomer((current) => Math.min(current, nextTotal || 1)); }} required /></label>
        {kind === "discount" && <label>Maximum vouchers per customer<input name="max_per_customer" type="number" min="1" max={maxClaims} step="1" value={maxPerCustomer} onChange={(event) => setMaxPerCustomer(Number(event.target.value))} required /></label>}
      </div>
    </> : <><p className="seller-product-offer-note">{shopUrl}</p><div className="seller-product-offer-row"><label>Discount code<input name="external_code" minLength={3} maxLength={40} pattern="[A-Za-z0-9_\-]{3,40}" title="3 to 40 letters, numbers, hyphens or underscores, no spaces" autoComplete="off" spellCheck={false} placeholder="SAVE10" required /></label><label>Code uses available<input name="online_code_uses" type="number" min="1" max="100000" step="1" defaultValue={50} required /></label></div><p className="seller-product-offer-note">Create this code on your website with the same discount and number of uses. Customers see it on RonTab; usage is checked by your website, not by RonTab.</p></>}
    <label className="seller-product-offer-accept"><input name="accept_terms" type="checkbox" required /><span>I will honor this offer as described{audience === "reward" ? " as an exclusive benefit for RonTab voucher holders" : ""}. {fulfillment === "branch" ? "Early customer cancellation releases the reserved place. Cancelling the offer cancels unused active vouchers." : "Payment, delivery and returns remain my responsibility."}</span></label>
    <button className="seller-auth-submit" type="submit"><Send size={15} aria-hidden="true" />Publish offer</button>
  </ActionForm>;
}