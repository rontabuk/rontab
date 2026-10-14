import type { Metadata } from "next";
import { connection } from "next/server";
import { CalendarDays, Check, MapPin, Pause, Play, Ticket, X } from "lucide-react";
import { decideSellerOfferRequest, setSellerOfferStatus } from "@/app/admin/(protected)/actions";
import { requireAdmin } from "@/lib/admin/access";
import { formatDate, formatNumber } from "@/lib/format";
import { isSellerOfferSchemaUnavailable } from "@/lib/seller/offer-schema";

export const metadata: Metadata = { title: "Seller offer review", robots: { index: false, follow: false } };
export const instant = false;

export default async function AdminSellerOffersPage({
  searchParams,
}: {
  searchParams: Promise<{ reviewed?: string; changed?: string }>;
}) {
  await connection();
  const [{ reviewed, changed }, { supabase }] = await Promise.all([searchParams, requireAdmin()]);
  const [requestsResult, offersResult] = await Promise.all([
    supabase.from("seller_offer_requests").select("*").eq("status", "submitted").order("submitted_at", { ascending: true }),
    supabase.from("seller_offers").select("*").in("status", ["approved", "published", "paused"]).order("created_at", { ascending: false }),
  ]);
  if (isSellerOfferSchemaUnavailable(requestsResult.error) || isSellerOfferSchemaUnavailable(offersResult.error)) {
    return (
      <main className="admin-overview admin-seller-offers-page">
        <header className="admin-page-heading"><p className="admin-eyebrow">SELLER PROMOTIONS</p><h1>Offer review</h1></header>
        <section className="admin-empty-state"><h2>Offer schema is not installed</h2><p>Apply the seller-offer database migrations to this environment before reviewing requests. No production changes were made.</p></section>
      </main>
    );
  }
  if (requestsResult.error) throw new Error(requestsResult.error.message);
  if (offersResult.error) throw new Error(offersResult.error.message);
  const requests = requestsResult.data;
  const offers = offersResult.data;
  const requestMediaUrls = new Map<string, string>();
  const signedRequestMedia = await Promise.all(requests.filter((request) => request.media_storage_path).map(async (request) => {
    const { data, error } = await supabase.storage.from("seller-offer-media").createSignedUrl(request.media_storage_path!, 60 * 30);
    if (error) throw new Error(error.message);
    return [request.id, data.signedUrl] as const;
  }));
  for (const [requestId, mediaUrl] of signedRequestMedia) requestMediaUrls.set(requestId, mediaUrl);
  const requestIds = requests.map((request) => request.id);
  const offerIds = offers.map((offer) => offer.id);
  const sellerIds = [...new Set([...requests.map((request) => request.seller_profile_id), ...offers.map((offer) => offer.seller_profile_id)])];

  const [requestLocationsResult, sellersResult, offerLocationsResult] = await Promise.all([
    requestIds.length
      ? supabase.from("seller_offer_request_locations").select("id,request_id,city_id,branch_name,branch_address").in("request_id", requestIds)
      : Promise.resolve({ data: [], error: null }),
    sellerIds.length
      ? supabase.from("seller_profiles").select("id,shop_name").in("id", sellerIds)
      : Promise.resolve({ data: [], error: null }),
    offerIds.length
      ? supabase.from("seller_offer_locations").select("id,offer_id,city_id,branch_name").in("offer_id", offerIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (requestLocationsResult.error) throw new Error(requestLocationsResult.error.message);
  if (sellersResult.error) throw new Error(sellersResult.error.message);
  if (offerLocationsResult.error) throw new Error(offerLocationsResult.error.message);

  const requestLocationIds = requestLocationsResult.data.map((location) => location.id);
  const offerLocationIds = offerLocationsResult.data.map((location) => location.id);
  const cityIds = [...new Set([...requestLocationsResult.data.map((location) => location.city_id), ...offerLocationsResult.data.map((location) => location.city_id)])];
  const [requestSchedulesResult, offerQuotasResult, citiesResult] = await Promise.all([
    requestLocationIds.length
      ? supabase.from("seller_offer_request_schedules").select("location_id,weekday,starts_at,ends_at,requested_daily_capacity").in("location_id", requestLocationIds)
      : Promise.resolve({ data: [], error: null }),
    offerLocationIds.length
      ? supabase.from("seller_offer_daily_quotas").select("location_id,capacity,reserved_count").in("location_id", offerLocationIds)
      : Promise.resolve({ data: [], error: null }),
    cityIds.length
      ? supabase.from("supported_cities").select("city_id,city_name,country_code").in("city_id", cityIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (requestSchedulesResult.error) throw new Error(requestSchedulesResult.error.message);
  if (offerQuotasResult.error) throw new Error(offerQuotasResult.error.message);
  if (citiesResult.error) throw new Error(citiesResult.error.message);

  const sellersById = new Map(sellersResult.data.map((seller) => [seller.id, seller.shop_name]));
  const citiesById = new Map(citiesResult.data.map((city) => [city.city_id, `${city.city_name}, ${city.country_code}`]));
  const schedulesByLocation = groupBy(requestSchedulesResult.data, (schedule) => schedule.location_id);
  const requestLocationsByRequest = groupBy(requestLocationsResult.data, (location) => location.request_id);
  const offerLocationsByOffer = groupBy(offerLocationsResult.data, (location) => location.offer_id);
  const quotasByLocation = groupBy(offerQuotasResult.data, (quota) => quota.location_id);

  return (
    <main className="admin-overview admin-seller-offers-page">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">SELLER PROMOTIONS</p>
        <h1>Offer review</h1>
        <p>Set final points, terms, and daily capacity before approving and publishing a promotion.</p>
      </header>
      {reviewed === "1" && <p className="admin-save-success" role="status">Offer review decision saved.</p>}
      {changed === "1" && <p className="admin-save-success" role="status">Offer status updated.</p>}

      <section aria-labelledby="seller-offer-queue-title">
        <div className="admin-loyalty-list-heading"><div><p className="admin-eyebrow">REVIEW QUEUE</p><h2 id="seller-offer-queue-title">Submitted offers</h2></div><span>{requests.length} awaiting review</span></div>
        {requests.length ? (
          <div className="admin-loyalty-offer-list">
            {requests.map((request) => {
              const locations = requestLocationsByRequest.get(request.id) ?? [];
              const requestedSchedules = locations.flatMap((location) => schedulesByLocation.get(location.id) ?? []);
              return (
                <article className="admin-loyalty-offer-item admin-seller-offer-review-item" key={request.id}>
                  <div className="admin-loyalty-offer-main">
                    <div className="admin-loyalty-offer-tags"><span className="admin-loyalty-status is-draft">Submitted</span><span className="admin-loyalty-kind">{request.offer_kind.replaceAll("_", " ")}</span></div>
                    <h3>{request.title}</h3>
                    <p>From {sellersById.get(request.seller_profile_id) ?? "Seller"}</p>
                    <p>{request.description}</p>
                    <div className="admin-loyalty-offer-details">
                      <span><Ticket size={13} aria-hidden="true" />{request.benefit_details}{request.discount_percent ? ` · ${request.discount_percent}%` : ""}</span>
                      <span><CalendarDays size={13} aria-hidden="true" />{formatDate(request.valid_from)} – {formatDate(request.valid_until)}</span>
                      {locations.map((location) => (
                        <span key={location.id}><MapPin size={13} aria-hidden="true" />{location.branch_name} · {citiesById.get(location.city_id) ?? location.city_id}</span>
                      ))}
                      {requestedSchedules.map((schedule) => (
                        <span key={`${schedule.location_id}-${schedule.weekday}-${schedule.starts_at}`}>{weekdayLabel(schedule.weekday)} · {schedule.starts_at.slice(0, 5)}–{schedule.ends_at.slice(0, 5)} · seller requests {formatNumber(schedule.requested_daily_capacity)}/day</span>
                      ))}
                    </div>
                    <a className="admin-seller-offer-media" href={requestMediaUrls.get(request.id) ?? request.media_url ?? undefined} target="_blank" rel="noreferrer">Open submitted {request.media_type ?? "offer"} media</a>
                  </div>
                  <div className="admin-seller-offer-decisions">
                    <form action={decideSellerOfferRequest} className="admin-seller-offer-approval-form">
                      <input type="hidden" name="request_id" value={request.id} />
                      <input type="hidden" name="decision" value="approve" />
                      <label>Final points cost<input name="points_cost" type="number" min="1" max="1000000" defaultValue="10" required /></label>
                      <label>Final daily capacity<input name="daily_capacity" type="number" min="1" max="1000" defaultValue={requestedSchedules[0]?.requested_daily_capacity ?? 5} required /></label>
                      <label>Final terms<textarea name="final_terms" minLength={10} maxLength={5000} defaultValue={`Show this non-transferable voucher at ${locations[0]?.branch_name ?? "the listed branch"}. Valid only during the published offer hours. Cancel before the offer window opens for a points and quota refund. Unused vouchers expire without a refund.`} required /></label>
                      <button className="admin-approve-button" type="submit"><Check size={14} aria-hidden="true" />Approve</button>
                    </form>
                    <form action={decideSellerOfferRequest} className="admin-seller-offer-note-form">
                      <input type="hidden" name="request_id" value={request.id} />
                      <input type="hidden" name="decision" value="changes_requested" />
                      <label>Requested changes<textarea name="review_note" maxLength={2000} required /></label>
                      <button type="submit">Request changes</button>
                    </form>
                    <form action={decideSellerOfferRequest} className="admin-seller-offer-note-form">
                      <input type="hidden" name="request_id" value={request.id} />
                      <input type="hidden" name="decision" value="reject" />
                      <label>Rejection reason<textarea name="review_note" maxLength={2000} required /></label>
                      <button className="is-secondary" type="submit"><X size={14} aria-hidden="true" />Reject</button>
                    </form>
                  </div>
                </article>
              );
            })}
          </div>
        ) : <div className="admin-empty-state"><h2>No offers awaiting review</h2><p>New seller requests will appear here.</p></div>}
      </section>

      <section className="admin-seller-offer-live-section" aria-labelledby="seller-offer-live-title">
        <div className="admin-loyalty-list-heading"><div><p className="admin-eyebrow">APPROVED PROMOTIONS</p><h2 id="seller-offer-live-title">Publication</h2></div><span>{offers.length} offers</span></div>
        {offers.length ? (
          <div className="admin-loyalty-offer-list">
            {offers.map((offer) => {
              const locations = offerLocationsByOffer.get(offer.id) ?? [];
              const quotas = locations.flatMap((location) => quotasByLocation.get(location.id) ?? []);
              return (
                <article className="admin-loyalty-offer-item" key={offer.id}>
                  <div className="admin-loyalty-offer-main">
                    <div className="admin-loyalty-offer-tags"><span className={`admin-loyalty-status is-${offer.status}`}>{offer.status}</span><span className="admin-loyalty-kind">{sellersById.get(offer.seller_profile_id) ?? "Seller"}</span></div>
                    <h3>{offer.title}</h3>
                    <p>{offer.benefit_details}</p>
                    <div className="admin-loyalty-offer-details">
                      <span><Ticket size={13} aria-hidden="true" />{formatNumber(offer.points_cost)} points</span>
                      <span><CalendarDays size={13} aria-hidden="true" />{formatDate(offer.valid_from)} – {formatDate(offer.valid_until)}</span>
                      <span>{formatNumber(quotas.reduce((total, quota) => total + quota.reserved_count, 0))} reserved · {formatNumber(quotas.reduce((total, quota) => total + quota.capacity, 0))} capacity</span>
                    </div>
                  </div>
                  <div className="admin-loyalty-offer-actions">
                    {(offer.status === "approved" || offer.status === "paused") && <form action={setSellerOfferStatus}>
                      <input type="hidden" name="offer_id" value={offer.id} /><input type="hidden" name="status" value="published" />
                      <button type="submit"><Play size={13} aria-hidden="true" />Publish</button>
                    </form>}
                    {offer.status === "published" && <form action={setSellerOfferStatus}>
                      <input type="hidden" name="offer_id" value={offer.id} /><input type="hidden" name="status" value="paused" />
                      <button className="is-secondary" type="submit"><Pause size={13} aria-hidden="true" />Pause</button>
                    </form>}
                    {offer.status !== "ended" && <form action={setSellerOfferStatus}>
                      <input type="hidden" name="offer_id" value={offer.id} /><input type="hidden" name="status" value="ended" />
                      <button className="is-secondary" type="submit">End offer</button>
                    </form>}
                  </div>
                </article>
              );
            })}
          </div>
        ) : <div className="admin-empty-state"><h2>No approved seller offers</h2><p>Approved offers can be published from this list.</p></div>}
      </section>
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

function weekdayLabel(weekday: number) {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][weekday] ?? "Day";
}