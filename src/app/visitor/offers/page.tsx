import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { CalendarDays, Clock3, MapPin, Ticket, X } from "lucide-react";
import { cancelSellerOfferCoupon, reportSellerVoucherIssue, reserveSellerOfferCoupon } from "@/app/visitor/actions";
import { getVisitorAccount } from "@/lib/visitor/access";
import { formatNumber } from "@/lib/format";
import { isSellerOfferSchemaUnavailable } from "@/lib/seller/offer-schema";

export const metadata: Metadata = { title: "Offer gallery", robots: { index: false, follow: false } };
export const instant = false;

export default async function VisitorOfferGalleryPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; error?: string; reserved?: string; cancelled?: string; reported?: string }>;
}) {
  await connection();
  const [{ view: requestedView, error: pageError, reserved, cancelled, reported }, { supabase, user }] = await Promise.all([searchParams, getVisitorAccount()]);
  const view = requestedView === "vouchers" ? "vouchers" : "offers";
  const today = londonDate(0);
  const [profileResult, summaryResult, offersResult, couponsResult, supportCasesResult] = await Promise.all([
    supabase.from("profiles").select("city_id").eq("id", user.id).single(),
    supabase.rpc("get_visitor_loyalty_summary"),
    supabase.from("seller_offers").select("id,title,offer_kind,description,benefit_details,discount_percent,media_url,media_storage_path,media_type,points_cost,terms,valid_from,valid_until,seller_profile_id")
      .eq("status", "published").gte("valid_until", today).order("valid_from", { ascending: true }).limit(60),
    supabase.rpc("get_visitor_seller_offer_coupons"),
    supabase.from("seller_voucher_support_cases").select("coupon_id,issue_type,status,resolution_note,created_at,updated_at").eq("visitor_id", user.id),
  ]);
  const couponsUnavailable = couponsResult.error?.code === "42501";
  if ([summaryResult.error, offersResult.error, couponsResult.error].some(isSellerOfferSchemaUnavailable)) {
    return (
      <main className="admin-overview visitor-offer-gallery">
        <header className="admin-page-heading"><p className="admin-eyebrow">LOCAL PROMOTIONS</p><h1>Offer gallery</h1></header>
        <div className="visitor-rewards-empty"><Ticket size={23} aria-hidden="true" /><h2>Offers are not available in this database yet</h2><p>The required database migrations must be applied before reservations can be made. Your points have not changed.</p></div>
      </main>
    );
  }
  if (profileResult.error) throw new Error(profileResult.error.message);
  if (summaryResult.error) throw new Error(summaryResult.error.message);
  if (offersResult.error) throw new Error(offersResult.error.message);
  if (couponsResult.error && !couponsUnavailable) throw new Error(couponsResult.error.message);
  if (supportCasesResult.error) throw new Error(supportCasesResult.error.message);

  const offers = offersResult.data ?? [];
  const displayOffers = await Promise.all(offers.map(async (offer) => {
    if (!offer.media_storage_path) return { ...offer, mediaDisplayUrl: offer.media_url ?? "" };
    const { data, error } = await supabase.storage.from("seller-offer-media").createSignedUrl(offer.media_storage_path, 60 * 30);
    if (error) throw new Error(error.message);
    return { ...offer, mediaDisplayUrl: data.signedUrl };
  }));
  const offerIds = displayOffers.map((offer) => offer.id);
  const locationsResult = offerIds.length
    ? await supabase.from("seller_offer_locations").select("id,offer_id,city_id,branch_name,branch_address").in("offer_id", offerIds)
    : { data: [], error: null };
  if (locationsResult.error) throw new Error(locationsResult.error.message);
  const locations = locationsResult.data ?? [];
  const locationIds = locations.map((location) => location.id);
  const cityIds = [...new Set(locations.map((location) => location.city_id))];
  const [quotasResult, citiesResult] = await Promise.all([
    locationIds.length
      ? supabase.from("seller_offer_daily_quotas").select("location_id,offer_date,starts_at,ends_at,capacity,reserved_count").in("location_id", locationIds).gte("offer_date", today).order("offer_date").order("starts_at").limit(500)
      : Promise.resolve({ data: [], error: null }),
    cityIds.length
      ? supabase.from("supported_cities").select("city_id,city_name,country_code").in("city_id", cityIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (quotasResult.error) throw new Error(quotasResult.error.message);
  if (citiesResult.error) throw new Error(citiesResult.error.message);

  const locationsByOffer = groupBy(locations, (location) => location.offer_id);
  const quotasByLocation = groupBy(quotasResult.data ?? [], (quota) => quota.location_id);
  const citiesById = new Map((citiesResult.data ?? []).map((city) => [city.city_id, `${city.city_name}, ${city.country_code}`]));
  const coupons = couponsUnavailable ? [] : couponsResult.data ?? [];
  const supportCasesByCouponId = new Map((supportCasesResult.data ?? []).map((supportCase) => [supportCase.coupon_id, supportCase]));
  const couponsByOfferDate = new Map(coupons.map((coupon) => [`${coupon.offer_id}:${coupon.offer_date}`, coupon]));
  const summary = summaryResult.data?.[0] ?? { points_balance: 0, points_earned: 0, points_spent: 0 };
  const cityId = profileResult.data.city_id;
  const highlightedCoupon = coupons.find((coupon) => coupon.id === reserved);

  return (
    <main className="admin-overview visitor-offer-gallery">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">LOCAL PROMOTIONS</p>
        <h1>Offer gallery</h1>
        <p>Local offers from participating shops, with daily availability and clear point costs.</p>
      </header>
      {pageError === "points" && <p className="visitor-rewards-error" role="alert">You do not have enough points for this offer.</p>}
      {pageError === "location" && <p className="visitor-rewards-error" role="alert">Choose a supported city on your profile to reserve local offers.</p>}
      {pageError === "confirmation" && <p className="visitor-rewards-error" role="alert">Confirm the points cost and voucher conditions before reserving.</p>}
      {couponsUnavailable && <p className="visitor-rewards-error" role="status">Confirm your email and choose a supported country to access vouchers. <Link href="/visitor">Update your profile</Link>.</p>}
      {pageError === "unavailable" && <p className="visitor-rewards-error" role="alert">That offer time is no longer available. Your points were not changed.</p>}
      {cancelled === "1" && <p className="admin-save-success" role="status">Reservation cancelled. Your points and the daily place were returned.</p>}
      {reported === "1" && <p className="admin-save-success" role="status">Your voucher issue was sent to the Rontab team. Your points were not changed.</p>}
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
        <Link href="/visitor/offers" aria-current={view === "offers" ? "page" : undefined}>Available offers</Link>
        <Link href="/visitor/offers?view=vouchers" aria-current={view === "vouchers" ? "page" : undefined}>My vouchers <span>{coupons.length}</span></Link>
      </nav>

      {view === "offers" ? (
        <section className="seller-offer-gallery-grid" aria-label="Published seller offers">
          {cityId ? displayOffers.filter((offer) => locationsByOffer.get(offer.id)?.some((location) => location.city_id === cityId)).map((offer) => {
            const localLocations = (locationsByOffer.get(offer.id) ?? []).filter((location) => location.city_id === cityId);
            const slots = localLocations.flatMap((location) => (quotasByLocation.get(location.id) ?? [])
              .filter((quota) => quota.offer_date >= offer.valid_from && quota.offer_date <= offer.valid_until && quota.reserved_count < quota.capacity)
              .map((quota) => ({ location, quota })))
              .sort((first, second) => first.quota.offer_date.localeCompare(second.quota.offer_date) || first.quota.starts_at.localeCompare(second.quota.starts_at))
              .slice(0, 4);

            return (
              <article className="seller-offer-card" key={offer.id}>
                <div className="seller-offer-card-media">
                  {offer.media_type === "video"
                    ? <video src={offer.mediaDisplayUrl} controls preload="metadata" aria-label={`${offer.title} offer video`} />
                    : <Image src={offer.mediaDisplayUrl} alt={offer.title} fill unoptimized sizes="(max-width: 700px) 100vw, 360px" />}
                </div>
                <div className="seller-offer-card-body">
                  <div className="seller-offer-card-meta"><span>{offer.offer_kind.replaceAll("_", " ")}</span><span><MapPin size={12} aria-hidden="true" />{citiesById.get(cityId) ?? "Your city"}</span></div>
                  <h2>{offer.title}</h2>
                  <p>{offer.benefit_details}</p>
                  <p className="seller-offer-card-description">{offer.description}</p>
                  <div className="seller-offer-card-points"><Ticket size={14} aria-hidden="true" />{formatNumber(offer.points_cost)} points per voucher</div>
                  <details className="seller-offer-card-terms"><summary>Terms and cancellation</summary><p>{offer.terms}</p></details>
                  <div className="seller-offer-slot-list">
                    <h3>Available times</h3>
                    {slots.length ? slots.map(({ location, quota }) => {
                      const existingCoupon = couponsByOfferDate.get(`${offer.id}:${quota.offer_date}`);
                      return (
                        <div className="seller-offer-slot" key={`${location.id}-${quota.offer_date}-${quota.starts_at}`}>
                          <div>
                            <strong>{formatOfferDate(quota.offer_date)} · {quota.starts_at.slice(0, 5)}–{quota.ends_at.slice(0, 5)}</strong>
                            <small>{location.branch_name} · {formatNumber(quota.capacity - quota.reserved_count)} of {formatNumber(quota.capacity)} left</small>
                          </div>
                          {existingCoupon ? (
                            <span className="seller-offer-slot-state">{existingCoupon.status === "reserved" ? "Voucher reserved" : existingCoupon.status === "cancelled" ? "Reservation cancelled" : "Already reserved today"}</span>
                          ) : summary.points_balance < offer.points_cost ? (
                            <span className="seller-offer-slot-state">Need {formatNumber(offer.points_cost - summary.points_balance)} more points</span>
                          ) : (
                            <form action={reserveSellerOfferCoupon}>
                              <input type="hidden" name="offer_id" value={offer.id} />
                              <input type="hidden" name="location_id" value={location.id} />
                              <input type="hidden" name="offer_date" value={quota.offer_date} />
                              <input type="hidden" name="starts_at" value={quota.starts_at} />
                              <input type="hidden" name="idempotency_key" value={crypto.randomUUID()} />
                              <label className="seller-offer-confirmation">
                                <input type="checkbox" name="confirm_reservation" required />
                                <span>I agree to spend {formatNumber(offer.points_cost)} points. This voucher is non-transferable; cancel before this time for a refund. Late cancellations and unused vouchers are not refunded.</span>
                              </label>
                              <button type="submit">Reserve · {formatNumber(offer.points_cost)} points</button>
                            </form>
                          )}
                        </div>
                      );
                    }) : <p className="seller-offer-no-slots">Today’s quota is full or no further times are scheduled yet.</p>}
                  </div>
                </div>
              </article>
            );
          }) : <div className="visitor-rewards-empty"><MapPin size={23} aria-hidden="true" /><h2>No published offers for this city</h2><p>New offers appear here after local shops are reviewed.</p>{!cityId && <Link href="/visitor">Choose your city</Link>}</div>}
        </section>
      ) : (
        <section className="seller-offer-voucher-list" aria-label="My vouchers">
          <p className="seller-offer-voucher-policy">Vouchers cannot be transferred. Cancel before the offer window starts to return the points and place. Unused vouchers expire when the window ends without a refund.</p>
          {couponsUnavailable ? (
            <div className="visitor-rewards-empty"><Ticket size={23} aria-hidden="true" /><h2>Vouchers are unavailable for this account</h2><p>Confirm your email and set a supported country before reserving or viewing vouchers.</p><Link href="/visitor">Update your profile</Link></div>
          ) : coupons.length ? coupons.map((coupon) => (
            <article className="seller-offer-voucher" key={coupon.id}>
              <div className="seller-offer-voucher-heading">
                <div><span className={`admin-loyalty-status is-${coupon.status}`}>{coupon.status}</span><h2>{coupon.title}</h2></div>
                <span>{formatNumber(coupon.points_cost)} points</span>
              </div>
              <p><MapPin size={13} aria-hidden="true" />{coupon.branch_name} · {coupon.city_name}</p>
              <p><CalendarDays size={13} aria-hidden="true" />{formatOfferDate(coupon.offer_date)} · {coupon.starts_at.slice(0, 5)}–{coupon.ends_at.slice(0, 5)} UK time</p>
              <code className="seller-offer-voucher-code" aria-label="Voucher code">{coupon.coupon_code}</code>
              {coupon.can_cancel && <form action={cancelSellerOfferCoupon}>
                <input type="hidden" name="coupon_id" value={coupon.id} />
                <button type="submit"><X size={14} aria-hidden="true" />Cancel and return points</button>
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

function groupBy<T, K extends string>(values: readonly T[], getKey: (value: T) => K) {
  const groups = new Map<K, T[]>();
  for (const value of values) {
    const key = getKey(value);
    groups.set(key, [...(groups.get(key) ?? []), value]);
  }
  return groups;
}

function londonDate(dayOffset: number) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [year, month, day] = today.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + dayOffset)).toISOString().slice(0, 10);
}

function formatOfferDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}