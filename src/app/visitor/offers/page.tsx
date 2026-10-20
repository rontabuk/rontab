import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowUpRight, CalendarDays, Clock3, MapPin, Ticket, X } from "lucide-react";
import { cancelSellerOfferCoupon, reportSellerVoucherIssue, reserveSellerOfferCoupon } from "@/app/visitor/actions";
import { getVisitorAccount } from "@/lib/visitor/access";
import { formatNumber } from "@/lib/format";
import { isSellerOfferSchemaUnavailable } from "@/lib/seller/offer-schema";
import { formatOfferPrice, getAvailableSellerOffers, londonOfferDate } from "@/lib/seller/available-offers";
import { getOfferAvailabilityVersion, getOfferBookingBlock } from "@/lib/seller/offer-policy";
import { OfferAvailabilityProvider, OfferCapacity } from "@/components/visitor/OfferAvailability";
import { groupBy } from "@/lib/collections";

export const metadata: Metadata = { title: "Offer gallery", robots: { index: false, follow: false } };
export const instant = false;

export default async function VisitorOfferGalleryPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; error?: string; reserved?: string; cancelled?: string; reported?: string }>;
}) {
  await connection();
  const renderedAt = new Date().getTime();
  const [{ view: requestedView, error: pageError, reserved, cancelled, reported }, { supabase, user }] = await Promise.all([searchParams, getVisitorAccount()]);
  const view = requestedView === "vouchers" ? "vouchers" : requestedView === "reward" ? "reward" : "general";
  const today = londonOfferDate();
  const currentTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date());
  const profileResult = await supabase.from("profiles").select("city_id").eq("id", user.id).single();
  if (profileResult.error) throw new Error(profileResult.error.message);
  const [summaryResult, offersResult, couponsResult, supportCasesResult] = await Promise.all([
    supabase.rpc("get_visitor_loyalty_summary"),
    getAvailableSellerOffers(supabase, profileResult.data.city_id),
    supabase.rpc("get_visitor_seller_offer_coupons"),
    supabase.from("seller_voucher_support_cases").select("coupon_id,issue_type,status,resolution_note,created_at,updated_at").eq("visitor_id", user.id),
  ]);
  const couponsUnavailable = couponsResult.error?.code === "42501";
  if (!offersResult.available || [summaryResult.error, couponsResult.error].some(isSellerOfferSchemaUnavailable)) {
    return (
      <main className="admin-overview visitor-offer-gallery">
        <header className="admin-page-heading"><p className="admin-eyebrow">LOCAL PROMOTIONS</p><h1>Offer gallery</h1></header>
        <div className="visitor-rewards-empty"><Ticket size={23} aria-hidden="true" /><h2>Offers are not available in this database yet</h2><p>The required database migrations must be applied before reservations can be made. Your points have not changed.</p></div>
      </main>
    );
  }
  if (summaryResult.error) throw new Error(summaryResult.error.message);
  if (couponsResult.error && !couponsUnavailable) throw new Error(couponsResult.error.message);
  if (supportCasesResult.error) throw new Error(supportCasesResult.error.message);

  const displayOffers = offersResult.offers.filter((offer) => offer.audience === view);
  const locations = displayOffers.flatMap((offer) => offer.locations);
  const locationIds = locations.map((location) => location.id);
  const cityIds = [...new Set(locations.map((location) => location.city_id))];
  const [quotasResult, citiesResult, dailyAvailabilityResult, bookingLimitsResult] = await Promise.all([
    locationIds.length
      ? supabase.from("seller_offer_daily_quotas").select("location_id,offer_date,starts_at,ends_at,capacity,reserved_count").in("location_id", locationIds).gte("offer_date", today).order("offer_date").order("starts_at").limit(500)
      : Promise.resolve({ data: [], error: null }),
    cityIds.length
      ? supabase.from("supported_cities").select("city_id,city_name,country_code").in("city_id", cityIds)
      : Promise.resolve({ data: [], error: null }),
    displayOffers.length
      ? supabase.rpc("get_public_seller_offer_daily_availability", { p_offer_ids: displayOffers.map((offer) => offer.id) })
      : Promise.resolve({ data: [], error: null }),
    displayOffers.length && !couponsUnavailable
      ? supabase.rpc("get_my_seller_offer_booking_limits", { p_offer_ids: displayOffers.map((offer) => offer.id) })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (quotasResult.error) throw new Error(quotasResult.error.message);
  if (citiesResult.error) throw new Error(citiesResult.error.message);
  if (dailyAvailabilityResult.error && !isSellerOfferSchemaUnavailable(dailyAvailabilityResult.error)) throw new Error(dailyAvailabilityResult.error.message);
  const bookingLimitsUnavailable = isSellerOfferSchemaUnavailable(bookingLimitsResult.error);
  if (bookingLimitsResult.error && !bookingLimitsUnavailable) throw new Error(bookingLimitsResult.error.message);

  const bookingLimits = new Map((bookingLimitsResult.data ?? []).map((entry) => [entry.offer_id, entry]));
  const nextEligibilityAt = (bookingLimitsResult.data ?? []).flatMap((entry) => entry.next_free_at ? [new Date(entry.next_free_at).getTime()] : [])
    .filter((timestamp) => timestamp > renderedAt).sort((first, second) => first - second)[0];
  const initialAvailability = displayOffers.flatMap((offer) => offer.remainingClaims === null ? [] : [{ offer_id: offer.id, remaining_claims: offer.remainingClaims }]);
  const availabilityVersion = getOfferAvailabilityVersion(initialAvailability, dailyAvailabilityResult.data ?? []);
  const dailyRemaining = new Map((dailyAvailabilityResult.data ?? []).map((entry) => [`${entry.offer_id}:${entry.offer_date}`, entry.remaining_claims]));
  const locationsByOffer = groupBy(locations, (location) => location.offer_id);
  const quotasByLocation = groupBy(quotasResult.data ?? [], (quota) => quota.location_id);
  const citiesById = new Map((citiesResult.data ?? []).map((city) => [city.city_id, `${city.city_name}, ${city.country_code}`]));
  const coupons = couponsUnavailable ? [] : couponsResult.data ?? [];
  const supportCasesByCouponId = new Map((supportCasesResult.data ?? []).map((supportCase) => [supportCase.coupon_id, supportCase]));
  const summary = summaryResult.data?.[0] ?? { points_balance: 0, points_earned: 0, points_spent: 0 };
  const cityId = profileResult.data.city_id;
  const highlightedCoupon = coupons.find((coupon) => coupon.id === reserved);

  return (
    <main className="admin-overview visitor-offer-gallery">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">LOCAL PROMOTIONS</p>
        <h1>Offer gallery</h1>
        <p>Public offers and exclusive rewards from local shops.</p>
      </header>
      {pageError === "points" && <p className="visitor-rewards-error" role="alert">You do not have enough points for this offer.</p>}
      {pageError === "location" && <p className="visitor-rewards-error" role="alert">Choose a supported city on your profile to reserve local offers.</p>}
      {pageError === "confirmation" && <p className="visitor-rewards-error" role="alert">Confirm the points cost and voucher conditions before reserving.</p>}
      {pageError === "priceChanged" && <p className="visitor-rewards-error" role="alert">The point cost changed before your reservation. No new points were charged. Check the updated cost and confirm again.</p>}
      {pageError === "bookingLimit" && <p className="visitor-rewards-error" role="alert">You have reached this offer&apos;s per-customer reservation limit. Cancelled reservations do not count.</p>}
      {pageError === "freeCooldown" && <p className="visitor-rewards-error" role="alert">A free benefit for this product is available once every 7 days. No points were charged.</p>}
      {pageError === "verifyEmail" && <p className="visitor-rewards-error" role="alert">Confirm your email before reserving a voucher. <Link href="/notifications">Open notifications</Link>.</p>}
      {couponsUnavailable && <p className="visitor-rewards-error" role="status">Confirm your email and choose a supported country to access vouchers. <Link href="/visitor">Update your profile</Link>.</p>}
      {pageError === "unavailable" && <p className="visitor-rewards-error" role="alert">That offer time is no longer available. Your points were not changed.</p>}
      {cancelled === "1" && <p className="admin-save-success" role="status">Reservation cancelled. The place and any points charged were returned.</p>}
      {reported === "1" && <p className="admin-save-success" role="status">Your voucher issue was sent to the support team. Your points were not changed.</p>}
      {pageError === "cancellationClosed" && <p className="visitor-rewards-error" role="alert">The offer window has started, so this voucher can no longer be cancelled.</p>}
      {pageError === "reportDetails" && <p className="visitor-rewards-error" role="alert">Choose an issue and describe it in at least 10 characters.</p>}
      {pageError === "reportUnavailable" && <p className="visitor-rewards-error" role="alert">This voucher cannot be reported right now. Your points were not changed.</p>}
      {pageError === "reportFailed" && <p className="visitor-rewards-error" role="alert">We could not submit the issue. Please try again.</p>}
      {highlightedCoupon && <p className="admin-save-success" role="status">Reservation confirmed for {highlightedCoupon.title}. Your voucher is in My vouchers.</p>}

      <section className="seller-offer-gallery-summary" aria-label="Points and location">
        <span><Ticket size={15} aria-hidden="true" />{formatNumber(summary.points_balance)} points available</span>
        <span><MapPin size={15} aria-hidden="true" />{cityId ? "Offers for your saved city" : "Choose a city to see local offers"}</span>
        {!cityId && <Link href="/visitor">Set your city</Link>}
      </section>

      <nav className="seller-offer-gallery-tabs" aria-label="Offer gallery views">
        <Link href="/visitor/offers?view=general" aria-current={view === "general" ? "page" : undefined}>Public offers</Link>
        <Link href="/visitor/offers?view=reward" aria-current={view === "reward" ? "page" : undefined}>Exclusive rewards</Link>
        <Link href="/visitor/offers?view=vouchers" aria-current={view === "vouchers" ? "page" : undefined}>My vouchers <span>{coupons.length}</span></Link>
      </nav>

      {view !== "vouchers" ? (
        <OfferAvailabilityProvider offerIds={displayOffers.map((offer) => offer.id)} initialAvailability={initialAvailability} version={availabilityVersion} renderedAt={renderedAt} refreshAt={nextEligibilityAt}>
        <section className="seller-offer-gallery-grid" aria-label="Published seller offers">
          {cityId && displayOffers.length ? displayOffers.map((offer) => {
            const localLocations = (locationsByOffer.get(offer.id) ?? []).filter((location) => offer.target_all_uk || location.city_id === cityId);
            const usage = bookingLimits.get(offer.id);
            const bookingBlock = getOfferBookingBlock(offer.offer_kind, usage?.reservations_used ?? 0, usage?.next_free_at ?? null, renderedAt, offer.max_per_customer);
            const slots = localLocations.flatMap((location) => (quotasByLocation.get(location.id) ?? [])
              .map((quota) => ({ ...quota, remaining: Math.min(quota.capacity - quota.reserved_count, dailyRemaining.get(`${offer.id}:${quota.offer_date}`) ?? Infinity) }))
              .filter((quota) => quota.offer_date >= offer.valid_from && quota.offer_date <= offer.valid_until && quota.remaining > 0
                && (quota.offer_date > today || quota.ends_at > currentTime) && offer.remainingClaims !== 0)
              .map((quota) => ({ location, quota })))
              .sort((first, second) => first.quota.offer_date.localeCompare(second.quota.offer_date) || first.quota.starts_at.localeCompare(second.quota.starts_at))
              .slice(0, 8);

            return (
              <article className="seller-offer-card" id={`offer-${offer.id}`} key={offer.id}>
                <div className="seller-offer-card-media">
                  {!offer.mediaDisplayUrl ? <Ticket size={36} aria-label="Offer image unavailable" /> : offer.media_type === "video"
                    ? <video src={offer.mediaDisplayUrl} controls preload="metadata" aria-label={`${offer.title} offer video`} />
                    : <Image src={offer.mediaDisplayUrl} alt={offer.title} fill unoptimized sizes="(max-width: 700px) 100vw, 360px" />}
                </div>
                <div className="seller-offer-card-body">
                  <div className="seller-offer-card-meta"><span>{offer.offer_kind.replaceAll("_", " ")}</span><span><MapPin size={12} aria-hidden="true" />{offer.target_all_uk ? "All UK" : citiesById.get(cityId) ?? "Your city"}</span></div>
                  {offer.seller && (() => {
                    const seller = offer.seller;
                    const identity = <>
                      {seller.logoUrl ? <Image src={seller.logoUrl} alt="" width={26} height={26} unoptimized /> : <span aria-hidden="true">{seller.name.charAt(0).toUpperCase()}</span>}
                      <strong>{seller.name}</strong>
                    </>;
                    return seller.slug
                      ? <Link className="seller-offer-card-seller" href={`/shops/${seller.slug}`}>{identity}<small>Visit shop</small></Link>
                      : <p className="seller-offer-card-seller">{identity}</p>;
                  })()}
                  <h2>{offer.title}</h2>
                  <p>{offer.benefit_details}</p>
                  <p className="seller-offer-card-description">{offer.description}</p>
                  <div className="seller-offer-card-points"><Ticket size={14} aria-hidden="true" />{formatOfferPrice(offer)}{offer.points_cost > 0 && " per voucher"}</div>
                  <p>{formatOfferDate(offer.valid_from)} to {formatOfferDate(offer.valid_until)}</p>
                  <details className="seller-offer-card-terms"><summary>Terms and cancellation</summary><p>{offer.terms}</p></details>
                  {offer.fulfillment === "online" ? <div className="seller-offer-online">
                    {offer.external_code && <p>Discount code <code>{offer.external_code}</code>{offer.online_code_uses ? <small> · limited to {formatNumber(offer.online_code_uses)} uses on the seller website</small> : null}</p>}
                    {offer.valid_from <= today && offer.external_url ? <a href={offer.external_url} target="_blank" rel="noopener noreferrer">Open seller website<ArrowUpRight size={14} aria-hidden="true" /></a> : <p>Available from {formatOfferDate(offer.valid_from)}</p>}
                    <p>Purchases, delivery and returns are arranged with the seller. External code usage is not tracked by RonTab.</p>
                  </div> : <OfferCapacity offerId={offer.id} maximum={offer.max_claims} remaining={offer.remainingClaims} closesAt={`${offer.valid_until}T23:59:59`}><div className="seller-offer-slot-list">
                    <h3>Available times{slots.length > 1 && <span> · {slots.length} times, swipe to see more</span>}</h3>
                    {offer.offer_kind === "discount" && <p>{usage?.reservations_used ?? 0} of {formatNumber(offer.max_per_customer)} reservations used. Cancelled reservations do not count.</p>}
                    {slots.length ? <div className="seller-offer-slot-track">{slots.map(({ location, quota }) => {
                      const alreadyReservedToday = !["discount", "free_item", "meal"].includes(offer.offer_kind)
                        && coupons.some((coupon) => coupon.offer_id === offer.id && coupon.offer_date === quota.offer_date && coupon.status !== "cancelled");
                      return (
                        <div className="seller-offer-slot" key={`${location.id}-${quota.offer_date}-${quota.starts_at}`}>
                          <div>
                            <strong>{formatOfferDate(quota.offer_date)} · {quota.starts_at.slice(0, 5)}–{quota.ends_at.slice(0, 5)}</strong>
                            <small>{location.branch_name}{location.branch_address && ` · ${location.branch_address}`} · {formatNumber(quota.remaining)} vouchers left</small>
                          </div>
                          {bookingLimitsUnavailable ? (
                            <span className="seller-offer-slot-state">Reservations temporarily unavailable.</span>
                          ) : bookingBlock ? (
                            <span className="seller-offer-slot-state">{bookingBlock}</span>
                          ) : alreadyReservedToday ? (
                            <span className="seller-offer-slot-state">Already reserved today</span>
                          ) : couponsUnavailable ? (
                            <Link href="/visitor">Confirm email and set your location</Link>
                          ) : summary.points_balance < offer.points_cost ? (
                            <span className="seller-offer-slot-state">Need {formatNumber(offer.points_cost - summary.points_balance)} more points</span>
                          ) : (
                            <form action={reserveSellerOfferCoupon}>
                              <input type="hidden" name="offer_id" value={offer.id} />
                              <input type="hidden" name="location_id" value={location.id} />
                              <input type="hidden" name="offer_date" value={quota.offer_date} />
                              <input type="hidden" name="starts_at" value={quota.starts_at} />
                              <input type="hidden" name="idempotency_key" value={crypto.randomUUID()} />
                              <input type="hidden" name="expected_points_cost" value={offer.points_cost} />
                              <label className="seller-offer-confirmation">
                                <input type="checkbox" name="confirm_reservation" required />
                                <span>{offer.points_cost > 0 ? `I agree to spend ${formatNumber(offer.points_cost)} points. Cancel before this time for a refund; unused vouchers are not refunded.` : "No points will be charged. I will use this voucher during the selected time or cancel before it starts."} This voucher is non-transferable.</span>
                              </label>
                              <button type="submit"><Ticket size={14} aria-hidden="true" />{offer.points_cost > 0 ? `Reserve · ${formatNumber(offer.points_cost)} points` : "Reserve free voucher"}</button>
                            </form>
                          )}
                        </div>
                      );
                    })}</div> : <p className="seller-offer-no-slots">{offer.remainingClaims === 0 ? "All vouchers for this offer have been reserved." : "No more available times are scheduled."}</p>}
                  </div></OfferCapacity>}
                </div>
              </article>
            );
          }) : <div className="visitor-rewards-empty"><MapPin size={23} aria-hidden="true" /><h2>{cityId ? `No ${view === "reward" ? "exclusive rewards" : "public offers"} in your city yet` : "Choose your offer city"}</h2><p>Offers from participating shops will appear here.</p>{!cityId && <Link href="/visitor">Choose your city</Link>}</div>}
        </section>
        </OfferAvailabilityProvider>
      ) : (
        <section className="seller-offer-voucher-list" aria-label="My vouchers">
          <p className="seller-offer-voucher-policy">Vouchers cannot be transferred. Cancel before the offer window starts to return the points and place. Unused vouchers expire when the window ends without a refund.</p>
          {couponsUnavailable ? (
            <div className="visitor-rewards-empty"><Ticket size={23} aria-hidden="true" /><h2>Vouchers are unavailable for this account</h2><p>Confirm your email and set a supported country before reserving or viewing vouchers.</p><Link href="/visitor">Update your profile</Link></div>
          ) : coupons.length ? coupons.map((coupon) => (
            <article className="seller-offer-voucher" key={coupon.id}>
              <div className="seller-offer-voucher-heading">
                <div><span className={`admin-loyalty-status is-${coupon.status}`}>{coupon.status}</span><h2>{coupon.title}</h2></div>
                <span>{coupon.points_cost > 0 ? `${formatNumber(coupon.points_cost)} points` : "Free voucher"}</span>
              </div>
              <p><MapPin size={13} aria-hidden="true" />{coupon.branch_name}</p>
              {coupon.branch_address && <p>{coupon.branch_address}</p>}
              <p><CalendarDays size={13} aria-hidden="true" />{formatOfferDate(coupon.offer_date)} · {coupon.starts_at.slice(0, 5)}–{coupon.ends_at.slice(0, 5)} UK time</p>
              <code className="seller-offer-voucher-code" aria-label="Voucher code">{coupon.coupon_code}</code>
              {coupon.can_cancel && <form action={cancelSellerOfferCoupon}>
                <input type="hidden" name="coupon_id" value={coupon.id} />
                <button type="submit"><X size={14} aria-hidden="true" />{coupon.points_cost > 0 ? "Cancel and return points" : "Cancel reservation"}</button>
              </form>}
              {(() => {
                const supportCase = supportCasesByCouponId.get(coupon.id);
                if (supportCase) return <p className="seller-offer-voucher-note">Support case: {supportCase.status.replaceAll("_", " ")}{supportCase.resolution_note && ` · ${supportCase.resolution_note}`}</p>;
                if (coupon.status === "cancelled" || coupon.can_cancel) return null;
                return <details className="seller-offer-voucher-report">
                  <summary>Report a voucher problem</summary>
                  <form action={reportSellerVoucherIssue}>
                    <input type="hidden" name="coupon_id" value={coupon.id} />
                    <label>Issue type<select name="issue_type" defaultValue="not_honored">
                      <option value="not_honored">Shop did not honor the voucher</option>
                      <option value="incorrect_offer">Offer details were incorrect</option>
                      <option value="quality_issue">Problem with the product or service</option>
                      <option value="other">Other problem</option>
                    </select></label>
                    <label>What happened?<textarea name="description" minLength={10} maxLength={2000} rows={3} required /></label>
                    <button type="submit">Send report</button>
                  </form>
                </details>;
              })()}
              {coupon.status === "reserved" && !coupon.can_cancel && <p className="seller-offer-voucher-note"><Clock3 size={13} aria-hidden="true" />Cancellation closes when the offer window begins.</p>}
            </article>
          )) : <div className="visitor-rewards-empty"><Ticket size={23} aria-hidden="true" /><h2>No vouchers yet</h2><p>Confirmed reservations will appear here with their unique codes.</p><Link href="/visitor/offers">Browse offers</Link></div>}
        </section>
      )}
    </main>
  );
}


function formatOfferDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}