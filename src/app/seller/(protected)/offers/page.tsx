import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Plus, X } from "lucide-react";
import { cancelProductOffer } from "@/app/seller/(protected)/product-offer-actions";
import { ActionForm } from "@/components/ActionForm";
import { SellerVoucherRedeemer } from "@/components/seller/SellerVoucherRedeemer";
import { SellerOfferRequestForm } from "@/components/seller/SellerOfferRequestForm";
import { getSupportedLocations } from "@/lib/locations";
import { isSellerOfferSchemaUnavailable } from "@/lib/seller/offer-schema";
import { getSellerAccount } from "@/lib/seller/access";

export const metadata: Metadata = { title: "Your offers", robots: { index: false, follow: false } };
export const instant = false;

export default async function SellerOfferRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string; redeemed?: string; redeemError?: string; edit?: string; published?: string; cancelled?: string }>;
}) {
  await connection();
  const [{ submitted, redeemed, redeemError, edit, published, cancelled }, { supabase, seller }, { countries, cities }] = await Promise.all([
    searchParams,
    getSellerAccount(),
    getSupportedLocations(),
  ]);
  const { data: requests, error } = await supabase
    .from("seller_offer_requests")
    .select("*")
    .eq("seller_profile_id", seller.id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (isSellerOfferSchemaUnavailable(error)) {
    return (
      <main className="admin-overview seller-overview">
        <header className="admin-page-heading"><p className="admin-eyebrow">SELLER WORKSPACE</p><h1>Offer requests</h1></header>
        <section className="seller-account-notice" role="status">
          <strong>Offer requests are not enabled in this database yet.</strong>
          <span>The required database migrations must be applied before requests can be viewed or submitted. No data was changed.</span>
        </section>
      </main>
    );
  }
  if (error) throw new Error(error.message);
  const publishedResult = await supabase.from("seller_offers").select("id,title,status,audience,points_cost,offer_kind,max_per_customer,valid_from,valid_until")
    .eq("seller_profile_id", seller.id).order("created_at", { ascending: false }).limit(30);
  if (publishedResult.error) throw new Error(publishedResult.error.message);
  const registrationCountsResult = seller.status === "active"
    ? await supabase.rpc("seller_get_location_registration_counts")
    : { data: [], error: null };
  if (registrationCountsResult.error) throw new Error(registrationCountsResult.error.message);
  const audienceResult = seller.status === "active"
    ? await supabase.rpc("seller_get_offer_audience_estimates")
    : { data: [], error: null };
  if (audienceResult.error) throw new Error(audienceResult.error.message);
  const audienceByRequest = new Map<string, typeof audienceResult.data>();
  for (const estimate of audienceResult.data ?? []) {
    audienceByRequest.set(estimate.request_id, [...(audienceByRequest.get(estimate.request_id) ?? []), estimate]);
  }

  const editableRequest = requests.find((request) => request.id === edit && ["draft", "changes_requested"].includes(request.status)) ?? null;
  let initialRequest = null;
  if (editableRequest) {
    const { data: locations, error: locationsError } = await supabase
      .from("seller_offer_request_locations")
      .select("id,city_id,branch_name,branch_address")
      .eq("request_id", editableRequest.id);
    if (locationsError) throw new Error(locationsError.message);
    const locationIds = locations.map((location) => location.id);
    const schedulesResult = locationIds.length
      ? await supabase.from("seller_offer_request_schedules")
        .select("location_id,weekday,starts_at,ends_at,requested_daily_capacity")
        .in("location_id", locationIds)
      : { data: [], error: null };
    if (schedulesResult.error) throw new Error(schedulesResult.error.message);
    const mediaPreviewResult = editableRequest.media_storage_path
      ? await supabase.storage.from("seller-offer-media").createSignedUrl(editableRequest.media_storage_path, 60 * 30)
      : null;
    if (mediaPreviewResult?.error) throw new Error(mediaPreviewResult.error.message);
    initialRequest = {
      ...editableRequest,
      media_preview_url: mediaPreviewResult?.data.signedUrl ?? editableRequest.media_url,
      locations: locations.map((location) => ({
        ...location,
        schedules: schedulesResult.data.filter((schedule) => schedule.location_id === location.id),
      })),
    };
  }

  const tomorrow = londonDate(1);
  const endDate = londonDate(14);

  return (
    <main className="admin-overview seller-overview">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">SELLER WORKSPACE</p>
        <h1>Your offers</h1>
      </header>
      {published === "1" && <p className="admin-save-success" role="status">Your product offer is published.</p>}
      {cancelled === "1" && <p className="admin-save-success" role="status">Offer ended. Unused active vouchers were cancelled and any points charged were returned.</p>}
      {submitted === "1" && <p className="admin-save-success" role="status">Your offer request was sent for review.</p>}
      {redeemed === "1" && <p className="admin-save-success" role="status">Voucher verified and marked as used.</p>}
      {redeemed === "already" && <p className="admin-save-success" role="status">This voucher was already used.</p>}
      {redeemed === "expired" && <p className="seller-account-notice" role="status">This voucher has expired and was not redeemed.</p>}
      {redeemError && <p className="visitor-rewards-error" role="alert">{redeemError === "code" ? "Enter the 20-character voucher code." : redeemError === "confirmation" ? "Confirm that you are handing over the advertised benefit." : redeemError === "notFound" ? "This voucher is not valid for your shop." : redeemError === "window" ? "This voucher is not valid at the current time." : "Voucher verification is temporarily unavailable."}</p>}
      <section className="seller-offer-request-history" aria-label="Published offers">
        <div className="seller-profile-section-heading"><h2>Published offers</h2><Link href="/seller/products"><Plus size={14} aria-hidden="true" />Create from a product</Link></div>
        {publishedResult.data.length ? <ol>{publishedResult.data.map((offer) => <li key={offer.id}>
          <div><strong>{offer.title}</strong><span>{offer.status}</span></div>
          <p>{offer.valid_from} to {offer.valid_until} · {offer.audience === "reward" ? "Exclusive reward" : "Public offer"} · {offer.points_cost > 0 ? `${offer.points_cost.toLocaleString("en-GB")} points` : "No points"}{offer.offer_kind === "discount" ? ` · ${offer.max_per_customer} per customer` : ""}</p>
          {["published", "paused"].includes(offer.status) && <details className="seller-offer-cancellation"><summary>Cancel offer</summary>
            <ActionForm action={cancelProductOffer}>
              <input type="hidden" name="offer_id" value={offer.id} />
              <label><input type="checkbox" name="confirm_cancellation" required /><span>End this offer and cancel its unused active vouchers. Any points charged will be returned.</span></label>
              <button type="submit"><X size={14} aria-hidden="true" />Confirm cancellation</button>
            </ActionForm>
          </details>}
        </li>)}</ol> : <p>No published offers yet.</p>}
      </section>
      {seller.status !== "active" ? (
        <section className="seller-account-notice" role="status">
          <strong>Offer submissions are unavailable.</strong>
          <span>Your seller profile must be active before you can request a promotion.</span>
        </section>
      ) : (
        <>
          {editableRequest && <p className="seller-account-notice" role="status">Update the requested details and resubmit this offer for review.</p>}
          <details className="seller-offer-manual-review" open={Boolean(editableRequest)}><summary>Request a reviewed offer · special cases</summary>
            <SellerOfferRequestForm key={editableRequest?.id ?? "new-offer"} requestId={editableRequest?.id ?? crypto.randomUUID()} sellerId={seller.id} initialRequest={initialRequest} countries={countries} cities={cities} registrationCounts={registrationCountsResult.data ?? []} tomorrow={tomorrow} endDate={endDate} />
          </details>
          <section className="seller-offer-request-history" aria-labelledby="seller-offer-history-title">
            <div className="seller-profile-section-heading"><h2 id="seller-offer-history-title">Your requests</h2></div>
            {requests.length ? (
              <ol>
                {requests.map((request) => (
                  <li key={request.id}>
                    <div><strong>{request.title}</strong><span>{formatStatus(request.status)}</span></div>
                    <p>{request.valid_from} to {request.valid_until}</p>
                    {request.review_note && <p>{request.review_note}</p>}
                    {(audienceByRequest.get(request.id) ?? []).length > 0 && (
                      <details>
                        <summary>Estimated local audience</summary>
                        {(audienceByRequest.get(request.id) ?? []).map((estimate) => (
                          <p key={estimate.city_id}>{estimate.city_name}: {estimate.is_withheld ? "Fewer than 5 eligible accounts; count withheld." : `${estimate.registered_audience?.toLocaleString("en-GB")} eligible registered visitors.`}</p>
                        ))}
                        <p>Estimates use the city saved to visitor profiles. A saved city is not proof of residence.</p>
                      </details>
                    )}
                    {["draft", "changes_requested"].includes(request.status) && <Link href={`/seller/offers?edit=${request.id}`}>{request.status === "draft" ? "Continue draft" : "Edit and resubmit"}</Link>}
                  </li>
                ))}
              </ol>
            ) : <p>No offer requests yet.</p>}
          </section>
        </>
      )}
      {seller.status === "active" && (
        <section className="seller-offer-redeem" aria-labelledby="seller-offer-redeem-title">
          <div className="seller-profile-section-heading">
            <h2 id="seller-offer-redeem-title">Verify a customer voucher</h2>
            <p>Check the voucher, then confirm use when handing over the advertised benefit. No additional points are charged.</p>
          </div>
          <SellerVoucherRedeemer />
        </section>
      )}
    </main>
  );
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

function formatStatus(status: string) {
  return status.replaceAll("_", " ").replace(/^./, (firstLetter) => firstLetter.toUpperCase());
}