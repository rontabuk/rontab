import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowUpRight, RotateCcw } from "lucide-react";
import { withdrawCreatorCollaborationRequest } from "@/app/seller/(protected)/creator-actions";
import { getSellerAccount } from "@/lib/seller/access";
import { createSupabasePublicClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import "../../seller.css";
import "./creator-requests.css";

export const metadata: Metadata = { title: "Creator collaborations", robots: { index: false, follow: false } };
export const instant = false;

export default async function SellerCreatorRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ withdrawn?: string }>;
}) {
  await connection();
  const [{ withdrawn }, { supabase, seller }] = await Promise.all([searchParams, getSellerAccount()]);
  const { data: requests, error } = await supabase
    .from("creator_collaboration_requests")
    .select("id,creator_profile_id,title,brief,proposed_compensation,status,creator_response,created_at,responded_at")
    .eq("seller_profile_id", seller.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);

  const creatorIds = [...new Set(requests.map((request) => request.creator_profile_id))];
  const publicClient = createSupabasePublicClient();
  const { data: creators, error: creatorsError } = creatorIds.length
    ? await publicClient.from("creator_profiles")
      .select("id,slug,published_display_name")
      .in("id", creatorIds)
      .eq("is_public", true)
    : { data: [], error: null };
  if (creatorsError) throw new Error(creatorsError.message);
  const creatorsById = new Map((creators ?? []).map((creator) => [creator.id, creator]));

  return (
    <main className="admin-overview seller-overview seller-creator-requests">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">SELLER WORKSPACE</p>
        <h1>Creator collaborations</h1>
        <p>Review your private collaboration requests and creator responses.</p>
      </header>
      {withdrawn === "1" && <p className="admin-save-success" role="status">The pending request was withdrawn.</p>}
      {seller.status !== "active" && <p className="seller-account-notice" role="status">Only active sellers can send new collaboration requests.</p>}
      {requests.length ? (
        <ol className="seller-creator-request-list">
          {requests.map((request) => {
            const creator = creatorsById.get(request.creator_profile_id);
            return (
              <li key={request.id}>
                <div className="seller-creator-request-heading">
                  <div><span className={`creator-collaboration-status is-${request.status}`}>{request.status.replaceAll("_", " ")}</span><time>{formatDateTime(request.created_at)}</time></div>
                  {creator && <Link href={`/creators/${creator.slug}`}>{creator.published_display_name}<ArrowUpRight size={14} aria-hidden="true" /></Link>}
                </div>
                <h2>{request.title}</h2>
                <p>{request.brief}</p>
                {request.proposed_compensation && <p><strong>Proposed compensation:</strong> {request.proposed_compensation}</p>}
                {request.creator_response && <p className="seller-creator-request-response"><strong>Creator response:</strong> {request.creator_response}{request.responded_at && <time>{formatDateTime(request.responded_at)}</time>}</p>}
                {request.status === "pending" && (
                  <form action={withdrawCreatorCollaborationRequest}>
                    <input type="hidden" name="request_id" value={request.id} />
                    <button type="submit"><RotateCcw size={14} aria-hidden="true" />Withdraw request</button>
                  </form>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="admin-empty-state"><h2>No collaboration requests yet</h2><p>Send a private request from an approved creator profile.</p><Link href="/creators">Browse creators <ArrowUpRight size={14} aria-hidden="true" /></Link></div>
      )}
    </main>
  );
}