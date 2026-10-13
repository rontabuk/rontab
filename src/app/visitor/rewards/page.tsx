import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { CalendarDays, Gift, MapPin, Ticket } from "lucide-react";
import { joinLoyaltyOffer } from "@/app/visitor/actions";
import { formatDateTime, formatNumber as formatPoints } from "@/lib/format";
import { getVisitorAccount } from "@/lib/visitor/access";
import type { Database } from "@/lib/supabase/database.types";

export const metadata: Metadata = { title: "Points & rewards", robots: { index: false, follow: false } };
export const instant = false;

type VisitorOffer = Database["public"]["Functions"]["get_visitor_loyalty_offers"]["Returns"][number];
type PointTransaction = Database["public"]["Functions"]["get_visitor_loyalty_activity"]["Returns"][number];
type OfferClaim = Pick<
  Database["public"]["Tables"]["loyalty_offer_claims"]["Row"],
  "claim_type" | "created_at" | "offer_id" | "points_spent" | "status"
>;

export default async function VisitorRewardsPage({
  searchParams,
}: {
  searchParams: Promise<{ offerError?: string; offerMessage?: string }>;
}) {
  await connection();
  const [{ offerError, offerMessage }, { supabase, user }] = await Promise.all([searchParams, getVisitorAccount()]);
  const [summaryResult, offersResult, transactionsResult, claimsResult, profileResult] = await Promise.all([
    supabase.rpc("get_visitor_loyalty_summary"),
    supabase.rpc("get_visitor_loyalty_offers"),
    supabase.rpc("get_visitor_loyalty_activity"),
    supabase.rpc("get_visitor_offer_history"),
    supabase.from("profiles").select("city,country_code").eq("id", user.id).single(),
  ]);

  if (summaryResult.error) throw new Error(summaryResult.error.message);
  if (offersResult.error) throw new Error(offersResult.error.message);
  if (transactionsResult.error) throw new Error(transactionsResult.error.message);
  if (claimsResult.error) throw new Error(claimsResult.error.message);
  if (profileResult.error) throw new Error(profileResult.error.message);

  const summary = summaryResult.data?.[0] ?? { points_balance: 0, points_earned: 0, points_spent: 0 };
  const offers = offersResult.data ?? [];
  const transactions = (transactionsResult.data ?? []) as PointTransaction[];
  const claims = (claimsResult.data ?? []) as (OfferClaim & { title: string })[];
  const nearestTarget = offers
    .map((offer) => Math.max(offer.minimum_points, offer.points_cost))
    .filter((target) => target > summary.points_balance)
    .sort((first, second) => first - second)[0];
  const pointsReady = offers.length > 0 && !nearestTarget;
  const progress = nearestTarget
    ? Math.min(100, summary.points_balance / nearestTarget * 100)
    : pointsReady ? 100 : 0;
  const activityHeading = nearestTarget
    ? `${formatPoints(nearestTarget - summary.points_balance)} points to your next offer`
    : pointsReady
      ? "Your points are ready to use"
      : summary.points_balance > 0
        ? "Your points are saved for the next offer"
        : "Start earning with your first visit";

  return (
    <main className="admin-overview visitor-rewards-page">
      <header className="admin-page-heading visitor-rewards-heading">
        <p className="admin-eyebrow">POINTS & REWARDS</p>
        <h1>Good things add up.</h1>
        <p>Earn points through eligible product visits and choose how to use them.</p>
      </header>

      {offerMessage === "joined" && <p className="admin-save-success" role="status">Your points were used and your place is confirmed.</p>}
      {offerMessage === "already" && <p className="admin-save-success" role="status">You already joined this offer. Your points were not charged again.</p>}
      {offerError === "points" && <p className="visitor-rewards-error" role="alert">You do not have enough points for this offer.</p>}
      {offerError === "location" && <p className="visitor-rewards-error" role="alert">This offer is only available in the city shown on your profile.</p>}
      {offerError === "unavailable" && <p className="visitor-rewards-error" role="alert">This offer is no longer available. Your points were not changed.</p>}

      <section className="visitor-rewards-overview" aria-label="Points summary">
        <div className="visitor-points-gauge" style={{ "--points-progress": `${progress}%` } as React.CSSProperties}>
          <div className="visitor-points-gauge-core">
            <span>Available</span>
            <strong>{formatPoints(summary.points_balance)}</strong>
            <small>points</small>
          </div>
        </div>
        <div className="visitor-rewards-overview-copy">
          <p className="admin-eyebrow">YOUR ACTIVITY</p>
          <h2>{activityHeading}</h2>
          {nearestTarget ? (
            <div className="visitor-progress-track" role="progressbar" aria-label="Progress to next offer" aria-valuemin={0} aria-valuemax={nearestTarget} aria-valuenow={Math.min(summary.points_balance, nearestTarget)}>
              <span style={{ width: `${progress}%` }} />
            </div>
          ) : <div className={`visitor-progress-track${pointsReady ? " is-complete" : ""}`}><span /></div>}
          <div className="visitor-rewards-stats">
            <div><strong>{formatPoints(summary.points_earned)}</strong><span>earned</span></div>
            <div><strong>{formatPoints(summary.points_spent)}</strong><span>used</span></div>
          </div>
          <p className="visitor-rewards-location"><MapPin size={14} aria-hidden="true" />{profileResult.data.city ? `${profileResult.data.city}, ${profileResult.data.country_code}` : "Add a city to see local offers"}<Link href="/visitor">Edit profile</Link></p>
        </div>
      </section>

      <section className="visitor-offers-section" aria-labelledby="visitor-offers-title">
        <div className="visitor-rewards-section-heading">
          <div><p className="admin-eyebrow">CURRENTLY AVAILABLE</p><h2 id="visitor-offers-title">Offers for you</h2></div>
          <span>{offers.length} available</span>
        </div>
        {offers.length ? (
          <div className="visitor-offer-list">
            {offers.map((offer) => (
              <VisitorOfferCard key={offer.id} offer={offer} balance={summary.points_balance} />
            ))}
          </div>
        ) : (
          <div className="visitor-rewards-empty">
            <Gift size={25} aria-hidden="true" />
            <h3>No active offers for your location</h3>
            <p>New gifts and point offers will appear here when they are available to you.</p>
            {!profileResult.data.city && <Link href="/visitor">Add your city to find local offers</Link>}
          </div>
        )}
      </section>

      <div className="visitor-rewards-lower-grid">
        <section className="visitor-activity-section" aria-labelledby="visitor-activity-title">
          <div className="visitor-rewards-section-heading">
            <div><p className="admin-eyebrow">POINTS LEDGER</p><h2 id="visitor-activity-title">Recent activity</h2></div>
          </div>
          {transactions.length ? (
            <ol className="visitor-activity-list">
              {transactions.map((transaction) => (
                <li key={transaction.id}>
                  <span className={`visitor-activity-icon${transaction.points_delta < 0 ? " is-spent" : ""}`} aria-hidden="true">
                    {transaction.points_delta > 0 ? <MapPin size={15} /> : <Ticket size={15} />}
                  </span>
                  <span className="visitor-activity-label">
                    {transactionLabel(transaction.transaction_type)}
                    {(transaction.product_name || transaction.offer_title) && <small>{transaction.product_name ?? transaction.offer_title}</small>}
                  </span>
                  <time dateTime={transaction.created_at}>{formatDateTime(transaction.created_at)}</time>
                  <strong className={transaction.points_delta < 0 ? "is-spent" : ""}>{transaction.points_delta > 0 ? "+" : "−"}{formatPoints(Math.abs(transaction.points_delta))}</strong>
                </li>
              ))}
            </ol>
          ) : (
            <p className="visitor-rewards-quiet">Eligible first visits will appear here.</p>
          )}
        </section>

        <section className="visitor-claims-section" aria-labelledby="visitor-claims-title">
          <div className="visitor-rewards-section-heading">
            <div><p className="admin-eyebrow">YOUR ENTRIES</p><h2 id="visitor-claims-title">Offer history</h2></div>
          </div>
          {claims.length ? (
            <ol className="visitor-claim-list">
              {claims.map((claim, index) => {
                return (
                  <li key={`${claim.offer_id}-${index}`}>
                    <span><strong>{claim.title}</strong><small>{claim.claim_type === "redemption" ? "Redemption" : "Participation"} · {formatDateTime(claim.created_at)}</small></span>
                    <span className={`visitor-claim-status is-${claim.status}`}>{claimStatusLabel(claim.status)}</span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="visitor-rewards-quiet">Your entries and redemptions will appear here.</p>
          )}
        </section>
      </div>

      <section className="visitor-points-explainer" aria-labelledby="visitor-points-explainer-title">
        <p className="admin-eyebrow">HOW POINTS WORK</p>
        <h2 id="visitor-points-explainer-title">One point for a first visit</h2>
        <p>Earn one point the first time you visit each eligible product while signed in with a confirmed visitor account. Returning to a product does not earn another point. Guests and seller accounts do not earn visitor rewards.</p>
        <p>Joining a limited offer spends its stated points whether or not you are selected. Choosing not to join never costs points. A guaranteed redemption spends points only when your gift is successfully claimed.</p>
      </section>
    </main>
  );
}

function VisitorOfferCard({ offer, balance }: { offer: VisitorOffer; balance: number }) {
  const eligible = balance >= offer.minimum_points && balance >= offer.points_cost;
  const soldOut = offer.remaining_count <= 0 && offer.offer_type === "redemption";
  const alreadyJoined = offer.already_joined;
  const canJoin = eligible && !soldOut && !alreadyJoined;
  const isRedemption = offer.offer_type === "redemption";
  const enoughForEntry = Math.max(offer.minimum_points, offer.points_cost);

  return (
    <article className="visitor-offer-row">
      <div className="visitor-offer-image">
        <Image src={offer.image_url} alt={offer.title} fill unoptimized sizes="(max-width: 700px) 100vw, 190px" />
      </div>
      <div className="visitor-offer-body">
        <div className="visitor-offer-meta">
          <span className={`visitor-offer-type${isRedemption ? " is-redemption" : ""}`}>{isRedemption ? "Guaranteed redemption" : offer.selection_method === "random" ? "Limited participation" : "First to claim"}</span>
          {!offer.locations.includes("All locations") && offer.locations.length > 0 && (
            <span className="visitor-offer-location"><MapPin size={12} aria-hidden="true" />{offer.locations.join(" · ")}</span>
          )}
        </div>
        <h3>{offer.title}</h3>
        <p>{offer.summary}</p>
        {offer.description && <p className="visitor-offer-description">{offer.description}</p>}
        <div className="visitor-offer-facts">
          <span><Ticket size={13} aria-hidden="true" />{formatPoints(offer.points_cost)} points</span>
          <span><CalendarDays size={13} aria-hidden="true" />Until {formatDateTime(offer.ends_at)}</span>
          {isRedemption && <span>{offer.remaining_count} remaining</span>}
          {!isRedemption && <span>{offer.capacity} {offer.capacity === 1 ? "gift" : "gifts"}</span>}
        </div>
        <details className="visitor-offer-terms">
          <summary>Offer terms</summary>
          <p>{offer.terms}</p>
        </details>
      </div>
      <div className="visitor-offer-action">
        <strong>{formatPoints(offer.points_cost)}<small>points</small></strong>
        {alreadyJoined ? (
          <span className="visitor-offer-result">Already joined</span>
        ) : soldOut ? (
          <span className="visitor-offer-result is-unavailable">Fully claimed</span>
        ) : !eligible ? (
          <span className="visitor-offer-result is-unavailable">Need {formatPoints(Math.max(enoughForEntry - balance, 0))} more</span>
        ) : (
          <form action={joinLoyaltyOffer}>
            <input type="hidden" name="offer_id" value={offer.id} />
            <button className="visitor-offer-claim-button" type="submit" disabled={!canJoin}>
              {isRedemption ? "Confirm redemption" : "Confirm entry"}
            </button>
          </form>
        )}
        <small>{isRedemption ? "Deducted only if the gift is claimed." : "Deducted if you enter, win or not."}</small>
      </div>
    </article>
  );
}

function transactionLabel(type: PointTransaction["transaction_type"]) {
  if (type === "visit_earned") return "First eligible product visit";
  if (type === "participation_spent") return "Offer entry";
  return "Gift redemption";
}

function claimStatusLabel(status: OfferClaim["status"]) {
  if (status === "entered") return "Awaiting result";
  if (status === "won") return "Selected";
  if (status === "lost") return "Not selected";
  return "Gift claimed";
}