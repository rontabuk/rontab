import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { CalendarDays, MapPin, Pencil, Sparkles, Ticket } from "lucide-react";
import {
  runLoyaltyOfferDraw,
  setLoyaltyOfferStatus,
  setLoyaltyRandomDrawsEnabled,
} from "@/app/admin/(protected)/actions";
import { LoyaltyOfferEditor } from "@/components/admin/LoyaltyOfferEditor";
import { LoyaltyFulfilmentForm } from "@/components/admin/LoyaltyFulfilmentForm";
import { requireAdmin } from "@/lib/admin/access";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { getSupportedLocations } from "@/lib/locations";
import type { Database } from "@/lib/supabase/database.types";

export const metadata: Metadata = { title: "Loyalty & rewards", robots: { index: false, follow: false } };
export const instant = false;

type Offer = Database["public"]["Tables"]["loyalty_offers"]["Row"];

export default async function AdminRewardsPage({
  searchParams,
}: {
  searchParams: Promise<{ claims?: string; drawn?: string; drawError?: string; edit?: string; fulfilled?: string; fulfillmentPage?: string; offerError?: string; randomDrawError?: string; saved?: string }>;
}) {
  await connection();
  const [{ claims, drawn, drawError, edit, fulfilled, fulfillmentPage: requestedFulfillmentPage, offerError, randomDrawError, saved }, { supabase }] = await Promise.all([searchParams, requireAdmin()]);
  const parsedFulfillmentPage = Number.parseInt(requestedFulfillmentPage ?? "1", 10);
  const fulfillmentPage = Number.isSafeInteger(parsedFulfillmentPage) ? Math.max(1, parsedFulfillmentPage) : 1;
  const fulfillmentPageSize = 50;
  const [settingsResult, offersResult, metricsResult, cityMetricsResult, locationMetricsResult, countryMetricsResult, sellerVoucherMetricsResult, pendingFulfillmentsResult, { countries, cities }] = await Promise.all([
    supabase.from("marketplace_settings").select("loyalty_random_draws_enabled").eq("singleton", true).single(),
    supabase
      .from("loyalty_offers")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase.rpc("admin_get_loyalty_offer_metrics"),
    supabase.rpc("admin_get_loyalty_offer_city_metrics"),
    supabase.rpc("admin_get_loyalty_location_metrics"),
    supabase.rpc("admin_get_loyalty_country_metrics"),
    supabase.rpc("admin_get_seller_voucher_location_metrics"),
    supabase.rpc("admin_get_loyalty_pending_fulfillments", {
      p_limit: fulfillmentPageSize,
      p_offset: (fulfillmentPage - 1) * fulfillmentPageSize,
    }),
    getSupportedLocations(),
  ]);
  if (settingsResult.error) throw new Error(settingsResult.error.message);
  if (offersResult.error) throw new Error(offersResult.error.message);
  if (metricsResult.error) throw new Error(metricsResult.error.message);
  if (cityMetricsResult.error) throw new Error(cityMetricsResult.error.message);
  const locationMetricsUnavailable = locationMetricsResult.error?.code === "PGRST202";
  if (locationMetricsResult.error && !locationMetricsUnavailable) throw new Error(locationMetricsResult.error.message);
  const countryMetricsUnavailable = countryMetricsResult.error?.code === "PGRST202";
  if (countryMetricsResult.error && !countryMetricsUnavailable) throw new Error(countryMetricsResult.error.message);
  const sellerVoucherMetricsUnavailable = sellerVoucherMetricsResult.error?.code === "PGRST202";
  if (sellerVoucherMetricsResult.error && !sellerVoucherMetricsUnavailable) throw new Error(sellerVoucherMetricsResult.error.message);
  const pendingFulfillmentsUnavailable = pendingFulfillmentsResult.error?.code === "PGRST202";
  if (pendingFulfillmentsResult.error && !pendingFulfillmentsUnavailable) throw new Error(pendingFulfillmentsResult.error.message);
  const pendingFulfillments = pendingFulfillmentsResult.data ?? [];
  const totalPendingFulfillments = pendingFulfillments[0]?.total_pending_count ?? 0;
  const fulfillmentPageCount = Math.max(1, Math.ceil(totalPendingFulfillments / fulfillmentPageSize));
  if (!pendingFulfillmentsUnavailable && fulfillmentPage > 1 && pendingFulfillments.length === 0) {
    redirect("/admin/rewards#fulfilment-queue");
  }

  const offers = offersResult.data as Offer[];
  const quotasByOffer = new Map<string, { city_id: string; city: string; admin_name: string; country_code: string; capacity: number }[]>();
  const cityMetricsByOffer = new Map<string, NonNullable<typeof cityMetricsResult.data>>();
  for (const metric of cityMetricsResult.data ?? []) {
    const currentMetrics = cityMetricsByOffer.get(metric.offer_id) ?? [];
    currentMetrics.push(metric);
    cityMetricsByOffer.set(metric.offer_id, currentMetrics);
    if (metric.city_id && metric.city) {
      const quotas = quotasByOffer.get(metric.offer_id) ?? [];
      quotas.push({
        city_id: metric.city_id,
        city: metric.city,
        admin_name: metric.admin_name ?? "",
        country_code: metric.country_code ?? "GB",
        capacity: metric.capacity,
      });
      quotasByOffer.set(metric.offer_id, quotas);
    }
  }
  const selectedDraft = edit ? offers.find((offer) => offer.id === edit && offer.status === "draft") ?? null : null;
  const selectedOffer = selectedDraft ? { ...selectedDraft, cityQuotas: quotasByOffer.get(selectedDraft.id) ?? [] } : null;
  const now = Date.parse(metricsResult.data?.[0]?.database_now ?? "1970-01-01T00:00:00.000Z");
  const claimsOffer = claims ? offers.find((offer) => offer.id === claims) ?? null : null;
  const recipientsResult = claimsOffer
    ? await supabase.rpc("admin_get_loyalty_offer_recipients", { p_offer_id: claimsOffer.id })
    : null;
  if (recipientsResult?.error) throw new Error(recipientsResult.error.message);
  const recipients = recipientsResult?.data ?? [];
  const signedEvidenceResults = await Promise.all(recipients
    .filter((recipient) => recipient.fulfillment_evidence_path)
    .map(async (recipient) => {
      const { data, error } = await supabase.storage
        .from("loyalty-fulfilment-evidence")
        .createSignedUrl(recipient.fulfillment_evidence_path!, 5 * 60);
      if (error) throw new Error(error.message);
      return [recipient.claim_id, data.signedUrl] as const;
    }));
  const evidenceUrlsByClaim = new Map(signedEvidenceResults);
  const metricsByOfferId = new Map((metricsResult.data ?? []).map((metric) => [metric.offer_id, metric]));
  const offerMetrics = offers.map((offer) => {
    const metric = metricsByOfferId.get(offer.id);
    return {
      offer,
      locations: cityMetricsByOffer.get(offer.id) ?? [],
      eligible: Number(metric?.eligible_count ?? 0),
      claimCount: Number(metric?.claim_count ?? 0),
      wonCount: Number(metric?.winner_count ?? 0),
    };
  });
  const locationMetrics = locationMetricsUnavailable ? [] : locationMetricsResult.data ?? [];
  const countryMetricsByCode = new Map((countryMetricsResult.data ?? []).map((metric) => [metric.country_code, metric]));
  const countryLocations = locationMetrics
    .filter((location) => location.city_id === null)
    .map((location) => ({ ...location, ...(countryMetricsByCode.get(location.country_code) ?? {}) }));
  const citiesByCountry = new Map<string, typeof locationMetricsResult.data>();
  const sellerVoucherMetricsByLocation = new Map((sellerVoucherMetricsResult.data ?? []).map((metric) => [`${metric.country_code}:${metric.city_id ?? ""}`, metric]));
  for (const location of locationMetrics) {
    if (!location.city_id) continue;
    const locations = citiesByCountry.get(location.country_code) ?? [];
    locations.push(location);
    citiesByCountry.set(location.country_code, locations);
  }
  const randomDrawsEnabled = settingsResult.data.loyalty_random_draws_enabled;
  const publishedCount = offers.filter((offer) => offer.status === "published" && Date.parse(offer.starts_at) <= now && Date.parse(offer.ends_at) > now).length;
  const draftCount = offers.filter((offer) => offer.status === "draft").length;

  return (
    <main className="admin-overview admin-loyalty-page">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">VISITOR PROGRAMME</p>
        <h1>Loyalty & rewards</h1>
        <p>Create local gifts, guaranteed redemptions, and limited participation offers.</p>
      </header>

      {saved === "1" && <p className="admin-save-success" role="status">Draft saved. It is not visible to visitors until you publish it.</p>}
      {drawn !== undefined && <p className="admin-save-success" role="status">Draw complete. {formatNumber(Number(drawn))} winners were selected. All other participants spent their entry points as shown before joining.</p>}
      {fulfilled === "1" && <p className="admin-save-success" role="status">Gift fulfilment recorded.</p>}
      {randomDrawError === "unfinished" && <p className="admin-loyalty-error" role="alert">Finish or run every published or paused random offer before disabling random selection.</p>}
      {offerError === "state" && <p className="admin-loyalty-error" role="alert">This offer cannot be published in its current state. Check that random selection is enabled and the offer is still a draft or paused.</p>}
      {drawError === "not-ready" && <p className="admin-loyalty-error" role="alert">This draw is not ready. The offer must have ended and random selection must remain enabled.</p>}

      <section className="admin-loyalty-stats" aria-label="Rewards overview">
        <div><strong>{formatNumber(offers.length)}</strong><span>Total offers</span></div>
        <div><strong>{formatNumber(draftCount)}</strong><span>Drafts</span></div>
        <div><strong>{formatNumber(publishedCount)}</strong><span>Published now</span></div>
        <div><strong>{formatNumber(offerMetrics.reduce((total, metric) => total + metric.claimCount, 0))}</strong><span>Total claims</span></div>
      </section>

      <section className="admin-loyalty-fulfilment-queue" id="fulfilment-queue" aria-labelledby="fulfilment-queue-title">
        <div className="admin-loyalty-list-heading">
          <div><p className="admin-eyebrow">OPERATIONS</p><h2 id="fulfilment-queue-title">Pending reward fulfilments</h2></div>
          <span>{pendingFulfillmentsUnavailable ? "Unavailable" : `${formatNumber(totalPendingFulfillments)} pending`}</span>
        </div>
        {pendingFulfillmentsUnavailable ? (
          <p className="admin-seller-schema-notice" role="status">The fulfilment queue will appear after the loyalty fulfilment queue migration is applied.</p>
        ) : pendingFulfillments.length ? (
          <>
            <div className="admin-table-wrap">
              <table className="admin-table admin-loyalty-fulfilment-table">
                <thead><tr><th>Recipient</th><th>Reward</th><th>Type</th><th>Points</th><th>Location at claim</th><th>Claimed</th><th>Record delivery</th></tr></thead>
                <tbody>{pendingFulfillments.map((claim) => (
                  <tr key={claim.claim_id}>
                    <td><strong>{claim.visitor_name || claim.visitor_email || "Visitor"}</strong><small>{claim.visitor_email || claim.visitor_id}</small></td>
                    <td><strong>{claim.offer_title}</strong><small>{statusLabel(claim.claim_status as Offer["status"])}</small></td>
                    <td>{claim.claim_type === "redemption" ? "Guaranteed redemption" : "Selected winner"}</td>
                    <td>{formatNumber(claim.points_spent)}</td>
                    <td>{claim.city ? `${claim.city}, ${claim.country_code}` : "All locations"}</td>
                    <td>{formatDateTime(claim.created_at)}</td>
                    <td><details className="admin-loyalty-fulfilment-details">
                      <summary>Record delivery</summary>
                      <LoyaltyFulfilmentForm claimId={claim.claim_id} offerId={claim.offer_id} queuePage={fulfillmentPage} />
                    </details></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <nav className="admin-audit-pagination" aria-label="Fulfilment queue pages">
              {fulfillmentPage > 1
                ? <Link href={`/admin/rewards?fulfillmentPage=${fulfillmentPage - 1}#fulfilment-queue`}>Previous</Link>
                : <span aria-disabled="true">Previous</span>}
              <span>Page {formatNumber(fulfillmentPage)} of {formatNumber(fulfillmentPageCount)}</span>
              {fulfillmentPage < fulfillmentPageCount
                ? <Link href={`/admin/rewards?fulfillmentPage=${fulfillmentPage + 1}#fulfilment-queue`}>Next</Link>
                : <span aria-disabled="true">Next</span>}
            </nav>
          </>
        ) : (
          <div className="admin-empty-state"><h2>No pending reward fulfilments</h2><p>Selected winners and claimed rewards will appear here until delivery is recorded.</p></div>
        )}
      </section>

      <section className="admin-dashboard-section" aria-labelledby="support-cases-title">
        <div className="admin-loyalty-list-heading">
          <div><p className="admin-eyebrow">VISITOR SUPPORT</p><h2 id="support-cases-title">Reward issues</h2></div>
          <Link href="/admin/support#reward-cases">Open support center</Link>
        </div>
        <p className="admin-loyalty-location-disclaimer">Review reward reports and record resolutions in the central support queue.</p>
      </section>

      <section className="admin-loyalty-location-overview" aria-labelledby="loyalty-location-overview-title">
        <div className="admin-loyalty-list-heading">
          <div><p className="admin-eyebrow">MARKET COVERAGE</p><h2 id="loyalty-location-overview-title">Country and city overview</h2></div>
          <span>{formatNumber(countryLocations.length)} supported countries</span>
        </div>
        <p className="admin-loyalty-location-disclaimer">Visitor locations are self-reported. Eligible point holders have a verified account in an enabled market and a positive points balance. City rows appear when they have visitors, shops, products, live offers, or recent claims.</p>
        {!locationMetricsUnavailable && countryMetricsUnavailable && <p className="admin-seller-schema-notice" role="status">Country totals are being refreshed after the country-rollup migration is applied.</p>}
        {!locationMetricsUnavailable && sellerVoucherMetricsUnavailable && <p className="admin-seller-schema-notice" role="status">Seller voucher metrics will appear after the seller-voucher location metrics migration is applied.</p>}
        {locationMetricsUnavailable ? (
          <p className="admin-seller-schema-notice" role="status">Country and city metrics will appear after the loyalty location metrics migration is applied to this database.</p>
        ) : countryLocations.length ? (
          <div className="admin-loyalty-location-countries">
            {countryLocations.map((country) => {
              const countryCities = citiesByCountry.get(country.country_code) ?? [];
              return (
                <details className="admin-loyalty-location-country" key={country.country_code} open={countryLocations.length === 1}>
                  <summary>
                    <span className="admin-loyalty-location-country-name"><strong>{country.country_name}</strong><small>{country.country_code}</small></span>
                    <span>{formatNumber(country.registered_visitor_count)} visitors</span>
                    <span>{formatNumber(country.verified_visitor_count)} verified</span>
                    <span>{formatNumber(country.eligible_point_holder_count)} with points</span>
                    <span>{formatNumber(country.claims_last_30_days)} loyalty claims / entries in 30 days</span>
                  </summary>
                  <dl className="admin-loyalty-location-country-supply">
                    <div><dt>Active public sellers</dt><dd>{formatNumber(country.active_seller_count)}</dd></div>
                    <div><dt>Approved products</dt><dd>{formatNumber(country.approved_product_count)}</dd></div>
                    <div><dt>Live rewards offers</dt><dd>{formatNumber(country.active_loyalty_offer_count)}</dd></div>
                    <div><dt>Live seller offers</dt><dd>{formatNumber(country.active_seller_offer_count)}</dd></div>
                    <div><dt>Seller vouchers issued, 30 days</dt><dd>{sellerVoucherMetricsUnavailable ? "—" : formatNumber(sellerVoucherMetricsByLocation.get(`${country.country_code}:`)?.vouchers_issued_last_30_days ?? 0)}</dd></div>
                    <div><dt>Seller vouchers redeemed, 30 days</dt><dd>{sellerVoucherMetricsUnavailable ? "—" : formatNumber(sellerVoucherMetricsByLocation.get(`${country.country_code}:`)?.vouchers_redeemed_last_30_days ?? 0)}</dd></div>
                  </dl>
                  {countryCities.length ? (
                    <div className="admin-table-wrap admin-loyalty-city-table-wrap">
                      <table className="admin-table admin-loyalty-city-table">
                        <thead><tr><th>City</th><th>Visitors</th><th>Verified</th><th>With points</th><th>Active sellers</th><th>Approved products</th><th>Rewards offers</th><th>Seller offers</th><th>Loyalty claims / entries, 30 days</th><th>Seller vouchers issued, 30 days</th><th>Seller vouchers redeemed, 30 days</th></tr></thead>
                        <tbody>{countryCities.map((city) => {
                          const voucherMetrics = sellerVoucherMetricsByLocation.get(`${city.country_code}:${city.city_id}`);
                          return (
                            <tr key={city.city_id}>
                            <td><strong>{city.city_name}</strong>{city.admin_name && city.admin_name !== city.city_name && <small>{city.admin_name}</small>}</td>
                            <td>{formatNumber(city.registered_visitor_count)}</td>
                            <td>{formatNumber(city.verified_visitor_count)}</td>
                            <td>{formatNumber(city.eligible_point_holder_count)}</td>
                            <td>{formatNumber(city.active_seller_count)}</td>
                            <td>{formatNumber(city.approved_product_count)}</td>
                            <td>{formatNumber(city.active_loyalty_offer_count)}</td>
                            <td>{formatNumber(city.active_seller_offer_count)}</td>
                            <td>{formatNumber(city.claims_last_30_days)}</td>
                            <td>{sellerVoucherMetricsUnavailable ? "—" : formatNumber(voucherMetrics?.vouchers_issued_last_30_days ?? 0)}</td>
                            <td>{sellerVoucherMetricsUnavailable ? "—" : formatNumber(voucherMetrics?.vouchers_redeemed_last_30_days ?? 0)}</td>
                            </tr>
                          );
                        })}</tbody>
                      </table>
                    </div>
                  ) : <p className="admin-empty-note">No city activity or marketplace supply to report yet.</p>}
                </details>
              );
            })}
          </div>
        ) : <div className="admin-empty-state"><h2>No supported markets</h2><p>Enable a country and its cities to see location metrics.</p></div>}
      </section>

      <section className="admin-loyalty-random-control" aria-labelledby="random-control-title">
        <div className="admin-loyalty-random-icon"><Sparkles size={20} aria-hidden="true" /></div>
        <div className="admin-loyalty-random-copy">
          <h2 id="random-control-title">Random selection</h2>
          <p>{randomDrawsEnabled
            ? "Enabled for administrators. Random offers can be published and entries are visible to eligible visitors."
            : "Off by default. Random offers remain drafts or hidden until you explicitly enable this setting."}</p>
        </div>
        <form action={setLoyaltyRandomDrawsEnabled}>
          <input type="hidden" name="enabled" value={String(!randomDrawsEnabled)} />
          <button className={randomDrawsEnabled ? "admin-loyalty-toggle is-enabled" : "admin-loyalty-toggle"} type="submit">
            {randomDrawsEnabled ? "Disable draws" : "Enable draws"}
          </button>
        </form>
      </section>

      <section className="admin-loyalty-guardrail" role="note">
        <strong>Publication is always manual.</strong>
        <span>Eligible counts are estimates based on current points and profile location. Random participation spends the displayed entry cost whether selected or not. Review offer terms before enabling or publishing.</span>
      </section>

      <LoyaltyOfferEditor key={selectedOffer?.id ?? "new-offer"} offer={selectedOffer} countries={countries} cities={cities} />

      <section className="admin-loyalty-offers-section" aria-labelledby="admin-offers-title">
        <div className="admin-loyalty-list-heading">
          <div><p className="admin-eyebrow">CAMPAIGNS</p><h2 id="admin-offers-title">Offers</h2></div>
          <span>{formatNumber(offers.length)} total</span>
        </div>
        {offerMetrics.length ? (
          <div className="admin-loyalty-offer-list">
            {offerMetrics.map(({ offer, locations, eligible, claimCount, wonCount }) => (
              <article className="admin-loyalty-offer-item" key={offer.id}>
                <div className="admin-loyalty-offer-main">
                  <div className="admin-loyalty-offer-tags">
                    <span className={`admin-loyalty-status is-${offer.status}`}>
                      {offer.status === "published" && Date.parse(offer.starts_at) > now
                        ? "Scheduled"
                        : offer.status === "published" && Date.parse(offer.ends_at) <= now
                          ? "Expired"
                          : statusLabel(offer.status)}
                    </span>
                    <span className={`admin-loyalty-kind${offer.offer_type === "redemption" ? " is-redemption" : ""}`}>
                      {offer.offer_type === "redemption" ? "Guaranteed redemption" : "Participation"}
                    </span>
                    {offer.offer_type === "participation" && <span className="admin-loyalty-kind">{offer.selection_method === "random" ? "Random selection" : "First come"}</span>}
                  </div>
                  <h3>{offer.title}</h3>
                  <p>{offer.summary}</p>
                  <div className="admin-loyalty-offer-details">
                    <span><Ticket size={13} aria-hidden="true" />{formatNumber(offer.minimum_points)} minimum · {formatNumber(offer.points_cost)} cost</span>
                    <span><CalendarDays size={13} aria-hidden="true" />{formatDate(offer.starts_at)} – {formatDate(offer.ends_at)}</span>
                    {locations.length ? locations.map((location) => (
                      <span key={`${location.city ?? "all"}-${location.country_code ?? "all"}`}>
                        <MapPin size={13} aria-hidden="true" />{location.city ? `${location.city}, ${location.country_code}` : "All locations"}: {formatNumber(location.eligible_count)} eligible · {formatNumber(location.capacity)} quota · {formatNumber(location.claim_count)} claimed
                      </span>
                    )) : <span><MapPin size={13} aria-hidden="true" />No location metrics</span>}
                  </div>
                </div>
                <dl className="admin-loyalty-offer-metrics">
                  <div><dt>Eligible now</dt><dd>{formatNumber(eligible)}</dd></div>
                  <div><dt>{offer.offer_type === "participation" ? "Entries" : "Claims"}</dt><dd>{formatNumber(claimCount)}</dd></div>
                  <div><dt>{offer.offer_type === "participation" ? "Selected" : "Capacity"}</dt><dd>{offer.offer_type === "participation" ? formatNumber(wonCount) : formatNumber(offer.capacity)}</dd></div>
                </dl>
                <div className="admin-loyalty-offer-actions">
                  {offer.status === "draft" && <Link href={`/admin/rewards?edit=${offer.id}`} aria-label={`Edit ${offer.title}`}><Pencil size={14} aria-hidden="true" />Edit draft</Link>}
                  {(offer.status === "draft" || offer.status === "paused") && (
                    <form action={setLoyaltyOfferStatus}>
                      <input type="hidden" name="offer_id" value={offer.id} />
                      <input type="hidden" name="status" value="published" />
                      <button type="submit" disabled={offer.offer_type === "participation" && offer.selection_method === "random" && !randomDrawsEnabled}>Publish</button>
                    </form>
                  )}
                  {offer.status === "published" && (
                    <form action={setLoyaltyOfferStatus}>
                      <input type="hidden" name="offer_id" value={offer.id} />
                      <input type="hidden" name="status" value="paused" />
                      <button type="submit" className="is-secondary">Pause</button>
                    </form>
                  )}
                  {offer.offer_type === "participation" && offer.selection_method === "random"
                    && ["published", "paused"].includes(offer.status)
                    && Date.parse(offer.ends_at) <= now
                    && <form action={runLoyaltyOfferDraw}>
                      <input type="hidden" name="offer_id" value={offer.id} />
                      <button type="submit" className="is-draw" disabled={!randomDrawsEnabled}>Run draw</button>
                    </form>}
                  {wonCount > 0 && <Link href={`/admin/rewards?claims=${offer.id}#recipient-details`}><Ticket size={14} aria-hidden="true" />View recipients</Link>}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="admin-empty-state"><h2>No rewards offers yet</h2><p>Save an offer draft above. It stays private until an administrator publishes it.</p></div>
        )}
      </section>

      {claimsOffer && (
        <section className="admin-loyalty-recipients" id="recipient-details" aria-labelledby="recipient-details-title">
          <div className="admin-loyalty-list-heading">
            <div><p className="admin-eyebrow">FULFILMENT</p><h2 id="recipient-details-title">Recipients: {claimsOffer.title}</h2></div>
            <Link href="/admin/rewards">Close</Link>
          </div>
          {recipients.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Recipient</th><th>Result</th><th>Fulfilment</th><th>Delivery record</th><th>Points spent</th><th>Location at claim</th><th>Claimed</th></tr></thead>
                <tbody>
                  {recipients.map((recipient) => (
                    <tr key={recipient.claim_id}>
                      <td><strong>{recipient.display_name || recipient.email || "Visitor"}</strong><small>{recipient.email || recipient.visitor_id}</small></td>
                      <td><span className={`admin-loyalty-status is-${recipient.status}`}>{statusLabel(recipient.status as Offer["status"])}</span></td>
                      <td><span className={`admin-loyalty-status is-${recipient.fulfillment_status}`}>{recipient.fulfillment_status === "fulfilled" ? "Delivered" : "Pending"}</span></td>
                      <td>{recipient.fulfillment_status === "fulfilled" ? (
                        recipient.fulfilled_at ? <details className="admin-loyalty-fulfilment-details">
                          <summary>View record</summary>
                          <dl>
                            <dt>Note</dt><dd>{recipient.fulfillment_note || "No note recorded"}</dd>
                            <dt>Reference</dt><dd>{recipient.fulfillment_reference || "No reference"}</dd>
                            <dt>Recorded</dt><dd>{formatDateTime(recipient.fulfilled_at)}</dd>
                            <dt>Administrator</dt><dd>{recipient.fulfilled_by_email || "Unavailable"}</dd>
                          </dl>
                          {evidenceUrlsByClaim.get(recipient.claim_id) && <a className="admin-loyalty-evidence-link" href={evidenceUrlsByClaim.get(recipient.claim_id)} target="_blank" rel="noreferrer">Open private delivery evidence</a>}
                        </details> : <span className="admin-muted">Delivered before tracking was added</span>
                      ) : <details className="admin-loyalty-fulfilment-details">
                        <summary>Record delivery</summary>
                        <LoyaltyFulfilmentForm claimId={recipient.claim_id} offerId={claimsOffer.id} />
                      </details>}</td>
                      <td>{formatNumber(recipient.points_spent)}</td>
                      <td>{recipient.city ? `${recipient.city}, ${recipient.country_code}` : "All locations"}</td>
                      <td>{formatDate(recipient.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="admin-empty-state"><h2>No selected recipients yet</h2><p>Entries that have not won are not listed in this fulfilment view.</p></div>
          )}
        </section>
      )}
    </main>
  );
}

function statusLabel(status: Offer["status"]) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}