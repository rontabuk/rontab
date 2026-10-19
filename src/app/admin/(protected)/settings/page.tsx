import type { Metadata } from "next";
import { connection } from "next/server";
import { requireAdmin } from "@/lib/admin/access";
import { saveMarketplaceSettings } from "@/app/admin/(protected)/actions";

export const metadata: Metadata = { title: "Marketplace settings", robots: { index: false, follow: false } };
export const instant = false;

const approvalModeOptions = (
  <>
    <option value="manual">Require admin approval</option>
    <option value="automatic">Approve automatically</option>
  </>
);

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  await connection();
  const { saved } = await searchParams;
  const { supabase } = await requireAdmin();
  const { data: settings, error } = await supabase
    .from("marketplace_settings")
    .select("product_approval_mode,seller_approval_mode,featured_duration_minutes,new_products_duration_minutes,click_price_pence_per_1000,visitor_daily_visit_points_cap,seller_reel_upload_enabled")
    .eq("singleton", true)
    .single();

  if (error) throw new Error(error.message);

  return (
    <main className="admin-overview">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">MARKETPLACE</p>
        <h1>Marketplace settings</h1>
        <p>Choose how new sellers and product submissions enter the catalogue.</p>
      </header>
      {saved === "1" && <p className="admin-save-success" role="status">Marketplace settings saved successfully.</p>}
      <form className="admin-settings-form" action={saveMarketplaceSettings}>
        <section className="admin-settings-section" aria-labelledby="product-approval-title">
          <div>
            <h2 id="product-approval-title">Product approval</h2>
            <p>Automatic approval publishes complete submissions from active sellers. Manual approval sends them to Product review.</p>
          </div>
          <label>
            New product submissions
            <select name="product_approval_mode" defaultValue={settings.product_approval_mode}>
              {approvalModeOptions}
            </select>
          </label>
        </section>
        <section className="admin-settings-section" aria-labelledby="seller-approval-title">
          <div>
            <h2 id="seller-approval-title">Seller accounts</h2>
            <p>Automatic approval activates new seller shops and makes them public. This affects new registrations only.</p>
          </div>
          <label>
            New seller registrations
            <select name="seller_approval_mode" defaultValue={settings.seller_approval_mode}>
              {approvalModeOptions}
            </select>
          </label>
        </section>
        <section className="admin-settings-section" aria-labelledby="featured-duration-title">
          <div>
            <h2 id="featured-duration-title">Featured product duration</h2>
            <p>Admins can feature approved products from Product review. The duration is applied each time a product is featured or renewed.</p>
          </div>
          <label>
            Duration in minutes
            <input name="featured_duration_minutes" type="number" min="1" max="10080" step="1" defaultValue={settings.featured_duration_minutes} required />
            <small>Minimum 1 minute. Maximum 10,080 minutes (7 days).</small>
          </label>
        </section>
        <section className="admin-settings-section" aria-labelledby="new-products-duration-title">
          <div>
            <h2 id="new-products-duration-title">New products window</h2>
            <p>Each product gets this fixed New period when approved. Changing the setting affects future approvals only; expired products will not return to New.</p>
          </div>
          <label>
            Duration in minutes
            <input name="new_products_duration_minutes" type="number" min="1" max="10080" step="1" defaultValue={settings.new_products_duration_minutes} required />
            <small>Minimum 1 minute. Maximum 10,080 minutes (7 days).</small>
          </label>
        </section>
        <section className="admin-settings-section" aria-labelledby="click-price-title">
          <div>
            <h2 id="click-price-title">Advertising click value</h2>
            <p>Set the equivalent price used to display click-credit values to sellers. This does not charge sellers; online payments remain disabled.</p>
          </div>
          <label>
            Price per 1,000 clicks (GBP)
            <input name="click_price_gbp_per_1000" type="number" min="0.01" max="1000" step="0.01" defaultValue={(settings.click_price_pence_per_1000 / 100).toFixed(2)} required />
            <small>Between £0.01 and £1,000. Example: £1.25 displays 1,000 clicks as £1.25.</small>
          </label>
        </section>
        <section className="admin-settings-section" aria-labelledby="daily-visitor-points-title">
          <div>
            <h2 id="daily-visitor-points-title">Daily visitor points cap</h2>
            <p>Limit points earned from distinct eligible product visits during any rolling 24-hour period. Shop visits remain available after the cap, but do not earn points.</p>
          </div>
          <label>
            Maximum points per visitor
            <input name="visitor_daily_visit_points_cap" type="number" min="1" max="250" step="1" defaultValue={settings.visitor_daily_visit_points_cap} required />
            <small>Between 1 and 250 points per rolling 24 hours. Default: 250.</small>
          </label>
        </section>
        <section className="admin-settings-section" aria-labelledby="seller-reel-upload-title">
          <div>
            <h2 id="seller-reel-upload-title">Seller Reel uploads</h2>
            <p>Control whether sellers can add new Reel videos or replace product media with a Reel. Existing Reels remain visible when uploads are disabled.</p>
          </div>
          <label className="admin-settings-toggle">
            <input type="checkbox" name="seller_reel_upload_enabled" defaultChecked={settings.seller_reel_upload_enabled} />
            <span>Allow sellers to upload Reels</span>
          </label>
        </section>
        <button className="admin-primary-button" type="submit">Save marketplace settings</button>
      </form>
    </main>
  );
}
