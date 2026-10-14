import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { CalendarDays, MapPin, Pencil, Sparkles, Ticket } from "lucide-react";
import {
  runLoyaltyOfferDraw,
  markLoyaltyClaimFulfilled,
  setLoyaltyOfferStatus,
  setLoyaltyRandomDrawsEnabled,
} from "@/app/admin/(protected)/actions";
import { LoyaltyOfferEditor } from "@/components/admin/LoyaltyOfferEditor";
import { requireAdmin } from "@/lib/admin/access";
import { formatDate, formatNumber } from "@/lib/format";
import { getSupportedLocations } from "@/lib/locations";
import type { Database } from "@/lib/supabase/database.types";

export const metadata: Metadata = { title: "Loyalty & rewards", robots: { index: false, follow: false } };
export const instant = false;

type Offer = Database["public"]["Tables"]["loyalty_offers"]["Row"];

export default async function AdminRewardsPage({
  searchParams,
}: {
  searchParams: Promise<{ claims?: string; drawn?: string; drawError?: string; edit?: string; fulfilled?: string; offerError?: string; randomDrawError?: string; saved?: string }>;
}) {
  await connection();
  const [{ claims, drawn, drawError, edit, fulfilled, offerError, randomDrawError, saved }, { supabase }] = await Promise.all([searchParams, requireAdmin()]);
  const [settingsResult, offersResult, metricsResult, cityMetricsResult, { countries, cities }] = await Promise.all([
    supabase.from("marketplace_settings").select("loyalty_random_draws_enabled").eq("singleton", true).single(),
    supabase
      .from("loyalty_offers")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase.rpc("admin_get_loyalty_offer_metrics"),
    supabase.rpc("admin_get_loyalty_offer_city_metrics"),
    getSupportedLocations(),
  ]);
  if (settingsResult.error) throw new Error(settingsResult.error.message);
  if (offersResult.error) throw new Error(offersResult.error.message);
  if (metricsResult.error) throw new Error(metricsResult.error.message);
  if (cityMetricsResult.error) throw new Error(cityMetricsResult.error.message);

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
                <thead><tr><th>Recipient</th><th>Result</th><th>Fulfilment</th><th>Points spent</th><th>Location at claim</th><th>Claimed</th><th>Action</th></tr></thead>
                <tbody>
                  {recipients.map((recipient) => (
                    <tr key={recipient.visitor_id}>
                      <td><strong>{recipient.display_name || recipient.email || "Visitor"}</strong><small>{recipient.email || recipient.visitor_id}</small></td>
                      <td><span className={`admin-loyalty-status is-${recipient.status}`}>{statusLabel(recipient.status as Offer["status"])}</span></td>
                      <td><span className={`admin-loyalty-status is-${recipient.fulfillment_status}`}>{recipient.fulfillment_status === "fulfilled" ? "Delivered" : "Pending"}</span></td>
                      <td>{formatNumber(recipient.points_spent)}</td>
                      <td>{recipient.city ? `${recipient.city}, ${recipient.country_code}` : "All locations"}</td>
                      <td>{formatDate(recipient.created_at)}</td>
                      <td>{recipient.fulfillment_status !== "fulfilled" && <form action={markLoyaltyClaimFulfilled}>
                        <input type="hidden" name="claim_id" value={recipient.claim_id} />
                        <input type="hidden" name="offer_id" value={claimsOffer.id} />
                        <button className="admin-approve-button" type="submit">Mark delivered</button>
                      </form>}</td>
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