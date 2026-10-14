import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { updateLoyaltyClaimSupportCase, updateMarketplaceSupportCase, updateSellerVoucherSupportCase } from "@/app/admin/(protected)/actions";
import { AdminListPagination } from "@/components/admin/AdminListPagination";
import { requireAdmin } from "@/lib/admin/access";
import { ADMIN_LIST_PAGE_SIZE, buildAdminListHref, parseAdminListPage } from "@/lib/admin/listing";
import { formatDateTime, formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Support cases", robots: { index: false, follow: false } };
export const instant = false;

export default async function AdminSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ marketplacePage?: string; rewardPage?: string; voucherPage?: string; updated?: string }>;
}) {
  await connection();
  const [{ marketplacePage: requestedMarketplacePage, rewardPage: requestedRewardPage, voucherPage: requestedVoucherPage, updated }, { supabase }] = await Promise.all([searchParams, requireAdmin()]);
  const marketplacePage = Math.min(parseAdminListPage(requestedMarketplacePage), 4001);
  const rewardPage = Math.min(parseAdminListPage(requestedRewardPage), 4001);
  const voucherPage = Math.min(parseAdminListPage(requestedVoucherPage), 4001);
  const [marketplaceResult, rewardResult, voucherResult] = await Promise.all([
    supabase.rpc("admin_get_marketplace_support_cases", {
      p_limit: ADMIN_LIST_PAGE_SIZE,
      p_offset: (marketplacePage - 1) * ADMIN_LIST_PAGE_SIZE,
    }),
    supabase.rpc("admin_get_loyalty_claim_support_cases", {
      p_limit: ADMIN_LIST_PAGE_SIZE,
      p_offset: (rewardPage - 1) * ADMIN_LIST_PAGE_SIZE,
    }),
    supabase.rpc("admin_get_seller_voucher_support_cases", {
      p_limit: ADMIN_LIST_PAGE_SIZE,
      p_offset: (voucherPage - 1) * ADMIN_LIST_PAGE_SIZE,
    }),
  ]);

  const marketplaceUnavailable = marketplaceResult.error?.code === "PGRST202";
  const rewardUnavailable = rewardResult.error?.code === "PGRST202";
  const voucherUnavailable = voucherResult.error?.code === "PGRST202";
  if (marketplaceResult.error && !marketplaceUnavailable) throw new Error(marketplaceResult.error.message);
  if (rewardResult.error && !rewardUnavailable) throw new Error(rewardResult.error.message);
  if (voucherResult.error && !voucherUnavailable) throw new Error(voucherResult.error.message);

  const marketplaceCases = marketplaceResult.data ?? [];
  const rewardCases = rewardResult.data ?? [];
  const voucherCases = voucherResult.data ?? [];
  const marketplaceCount = marketplaceCases[0]?.total_case_count ?? 0;
  const rewardCount = rewardCases[0]?.total_case_count ?? 0;
  const voucherCount = voucherCases[0]?.total_case_count ?? 0;
  const marketplacePages = Math.max(1, Math.ceil(marketplaceCount / ADMIN_LIST_PAGE_SIZE));
  const rewardPages = Math.max(1, Math.ceil(rewardCount / ADMIN_LIST_PAGE_SIZE));
  const voucherPages = Math.max(1, Math.ceil(voucherCount / ADMIN_LIST_PAGE_SIZE));
  const marketplaceFilters = {
    rewardPage: rewardPage > 1 ? String(rewardPage) : undefined,
    voucherPage: voucherPage > 1 ? String(voucherPage) : undefined,
  };
  const rewardFilters = { voucherPage: voucherPage > 1 ? String(voucherPage) : undefined };
  const voucherFilters = { rewardPage: rewardPage > 1 ? String(rewardPage) : undefined };

  if (marketplacePage > marketplacePages) {
    redirect(buildAdminListHref("/admin/support", marketplaceFilters, marketplacePages, "marketplacePage"));
  }
  if (rewardPage > rewardPages) {
    redirect(buildAdminListHref("/admin/support", rewardFilters, rewardPages, "rewardPage"));
  }
  if (voucherPage > voucherPages) {
    redirect(buildAdminListHref("/admin/support", voucherFilters, voucherPages, "voucherPage"));
  }

  return (
    <main className="admin-overview admin-support-page">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">VISITOR SUPPORT</p>
        <h1>Support cases</h1>
        <p>Review product and seller reports, reward issues, and seller voucher problems in one place.</p>
      </header>
      {updated === "reward" && <p className="admin-save-success" role="status">Reward case updated.</p>}
      {updated === "voucher" && <p className="admin-save-success" role="status">Voucher case updated.</p>}
      {updated === "marketplace" && <p className="admin-save-success" role="status">Marketplace report updated.</p>}

      <section className="admin-dashboard-stats" aria-label="Open support cases">
        <div><span>Product and seller reports</span><strong>{marketplaceUnavailable ? "—" : formatNumber(marketplaceCount)}</strong></div>
        <div><span>Reward issues</span><strong>{rewardUnavailable ? "—" : formatNumber(rewardCount)}</strong></div>
        <div><span>Voucher issues</span><strong>{voucherUnavailable ? "—" : formatNumber(voucherCount)}</strong></div>
      </section>

      <section className="admin-loyalty-support-queue" id="marketplace-cases" aria-labelledby="marketplace-cases-title">
        <div className="admin-loyalty-list-heading">
          <div><p className="admin-eyebrow">MARKETPLACE</p><h2 id="marketplace-cases-title">Product and seller reports</h2></div>
          <span>{marketplaceUnavailable ? "Unavailable" : `${formatNumber(marketplaceCount)} open or in review`}</span>
        </div>
        {marketplaceUnavailable ? (
          <p className="admin-seller-schema-notice" role="status">Marketplace reports are unavailable until the marketplace support migration is applied.</p>
        ) : marketplaceCases.length ? (
          <div className="admin-loyalty-support-list">
            {marketplaceCases.map((supportCase) => (
              <article className="admin-loyalty-support-item" key={supportCase.case_id}>
                <div className="admin-loyalty-support-summary">
                  <div>
                    <span className="admin-loyalty-status is-pending">{supportCase.status.replaceAll("_", " ")}</span>
                    <span className="admin-loyalty-kind">{supportCase.target_type === "product" ? "Product listing" : "Seller account"}</span>
                    <span className="admin-loyalty-kind">{supportCase.issue_type.replaceAll("_", " ")}</span>
                  </div>
                  <h3>{supportCase.target_url
                    ? <a href={supportCase.target_url} target="_blank" rel="noreferrer">{supportCase.target_name}</a>
                    : supportCase.target_name}</h3>
                  <p>{supportCase.reporter_email ?? supportCase.reporter_id}</p>
                  <p>{supportCase.description}</p>
                  <small>Reported {formatDateTime(supportCase.created_at)}</small>
                </div>
                <form className="admin-loyalty-support-action" action={updateMarketplaceSupportCase}>
                  <input type="hidden" name="case_id" value={supportCase.case_id} />
                  <label>Case status<select name="status" defaultValue={supportCase.status}>
                    <option value="open">Open</option><option value="in_review">In review</option><option value="resolved">Resolved</option>
                  </select></label>
                  <label>Resolution note<textarea name="resolution_note" minLength={5} maxLength={1000} rows={3} defaultValue={supportCase.resolution_note ?? ""} placeholder="Required when resolving" /></label>
                  <button className="admin-approve-button" type="submit">Save case</button>
                </form>
              </article>
            ))}
          </div>
        ) : <div className="admin-empty-state"><h2>No open marketplace reports</h2><p>Visitor reports about product listings and seller accounts will appear here.</p></div>}
        {!marketplaceUnavailable && <AdminListPagination path="/admin/support" filters={marketplaceFilters} page={marketplacePage} totalPages={marketplacePages} totalCount={marketplaceCount} pageSize={ADMIN_LIST_PAGE_SIZE} label="Marketplace report" pageParam="marketplacePage" />}
      </section>

      <section className="admin-loyalty-support-queue" id="reward-cases" aria-labelledby="reward-cases-title">
        <div className="admin-loyalty-list-heading">
          <div><p className="admin-eyebrow">LOYALTY</p><h2 id="reward-cases-title">Reward issues</h2></div>
          <span>{rewardUnavailable ? "Unavailable" : `${formatNumber(rewardCount)} open or in review`}</span>
        </div>
        {rewardUnavailable ? (
          <p className="admin-seller-schema-notice" role="status">Reward support cases are unavailable until the loyalty support migration is applied.</p>
        ) : rewardCases.length ? (
          <div className="admin-loyalty-support-list">
            {rewardCases.map((supportCase) => (
              <article className="admin-loyalty-support-item" key={supportCase.case_id}>
                <div className="admin-loyalty-support-summary">
                  <div><span className="admin-loyalty-status is-pending">{supportCase.status.replaceAll("_", " ")}</span><span className="admin-loyalty-kind">{supportCase.issue_type.replaceAll("_", " ")}</span></div>
                  <h3>{supportCase.offer_title}</h3>
                  <p>{supportCase.visitor_name || supportCase.visitor_email || supportCase.visitor_id}{supportCase.visitor_email && ` · ${supportCase.visitor_email}`}</p>
                  <p>{supportCase.description}</p>
                  <small>Reported {formatDateTime(supportCase.created_at)}</small>
                </div>
                <form className="admin-loyalty-support-action" action={updateLoyaltyClaimSupportCase}>
                  <input type="hidden" name="case_id" value={supportCase.case_id} />
                  <input type="hidden" name="return_to" value="support" />
                  <label>Case status<select name="status" defaultValue={supportCase.status}>
                    <option value="open">Open</option><option value="in_review">In review</option><option value="resolved">Resolved</option>
                  </select></label>
                  <label>Resolution note<textarea name="resolution_note" minLength={5} maxLength={1000} rows={3} defaultValue={supportCase.resolution_note ?? ""} placeholder="Required when resolving" /></label>
                  <button className="admin-approve-button" type="submit">Save case</button>
                </form>
              </article>
            ))}
          </div>
        ) : <div className="admin-empty-state"><h2>No open reward issues</h2><p>Visitor reports about selected or redeemed rewards will appear here.</p></div>}
        {!rewardUnavailable && <AdminListPagination path="/admin/support" filters={rewardFilters} page={rewardPage} totalPages={rewardPages} totalCount={rewardCount} pageSize={ADMIN_LIST_PAGE_SIZE} label="Reward case" pageParam="rewardPage" />}
      </section>

      <section className="admin-loyalty-support-queue" id="voucher-cases" aria-labelledby="voucher-cases-title">
        <div className="admin-loyalty-list-heading">
          <div><p className="admin-eyebrow">SELLER OFFERS</p><h2 id="voucher-cases-title">Voucher issues</h2></div>
          <span>{voucherUnavailable ? "Unavailable" : `${formatNumber(voucherCount)} open or in review`}</span>
        </div>
        {voucherUnavailable ? (
          <p className="admin-seller-schema-notice" role="status">Voucher support cases are unavailable until the seller voucher support migration is applied.</p>
        ) : voucherCases.length ? (
          <div className="admin-loyalty-support-list">
            {voucherCases.map((supportCase) => (
              <article className="admin-loyalty-support-item" key={supportCase.case_id}>
                <div className="admin-loyalty-support-summary">
                  <div><span className="admin-loyalty-status is-pending">{supportCase.status.replaceAll("_", " ")}</span><span className="admin-loyalty-kind">{supportCase.issue_type.replaceAll("_", " ")}</span></div>
                  <h3>{supportCase.offer_title}</h3>
                  <p><strong>{supportCase.shop_name}</strong></p>
                  <p>{supportCase.visitor_email ?? supportCase.visitor_id}</p>
                  <p>{supportCase.description}</p>
                  <small>Reported {formatDateTime(supportCase.created_at)}</small>
                </div>
                <form className="admin-loyalty-support-action" action={updateSellerVoucherSupportCase}>
                  <input type="hidden" name="case_id" value={supportCase.case_id} />
                  <input type="hidden" name="return_to" value="support" />
                  <label>Case status<select name="status" defaultValue={supportCase.status}>
                    <option value="open">Open</option><option value="in_review">In review</option><option value="resolved">Resolved</option>
                  </select></label>
                  <label>Resolution note<textarea name="resolution_note" minLength={5} maxLength={1000} rows={3} defaultValue={supportCase.resolution_note ?? ""} placeholder="Required when resolving" /></label>
                  <button className="admin-approve-button" type="submit">Save case</button>
                </form>
              </article>
            ))}
          </div>
        ) : <div className="admin-empty-state"><h2>No open voucher issues</h2><p>Visitor reports for seller vouchers will appear here. Resolving a report does not refund points automatically.</p></div>}
        {!voucherUnavailable && <AdminListPagination path="/admin/support" filters={voucherFilters} page={voucherPage} totalPages={voucherPages} totalCount={voucherCount} pageSize={ADMIN_LIST_PAGE_SIZE} label="Voucher case" pageParam="voucherPage" />}
      </section>
    </main>
  );
}