import type { Metadata } from "next";
import { connection } from "next/server";
import { SellerAdvertisingManager, type AdvertisingProduct } from "@/components/seller/SellerAdvertisingManager";
import { getOverlayTone } from "@/data/products";
import { getSellerAccount } from "@/lib/seller/access";
import { getSellerProductDetails } from "@/lib/seller/products";

export const metadata: Metadata = { title: "Advertising balance", robots: { index: false, follow: false } };
export const instant = false;

export default async function SellerAdvertisingPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  await connection();
  const [{ saved }, { supabase, seller }] = await Promise.all([searchParams, getSellerAccount()]);
  const [accountResult, productsResult, allocationsResult, clickRateResult] = await Promise.all([
    supabase
      .from("seller_ad_accounts")
      .select("clicks_remaining,welcome_clicks_remaining,admin_clicks_remaining")
      .eq("seller_profile_id", seller.id)
      .maybeSingle(),
    supabase
      .from("products")
      .select("id,name,slug,price,click_count,clicks_since_top_up,featured_until,new_until,description,category_id")
      .eq("seller_profile_id", seller.id)
      .eq("status", "approved")
      .order("name", { ascending: true }),
    supabase
      .from("seller_product_click_allocations")
      .select("product_id,clicks_remaining,clicks_limit")
      .eq("seller_profile_id", seller.id),
    supabase.rpc("get_click_price_pence_per_1000"),
  ]);

  if (accountResult.error) throw new Error(accountResult.error.message);
  if (productsResult.error) throw new Error(productsResult.error.message);
  if (allocationsResult.error) throw new Error(allocationsResult.error.message);
  if (clickRateResult.error) throw new Error(clickRateResult.error.message);

  const balance = Number(accountResult.data?.clicks_remaining ?? 0);
  const welcomeClicks = Number(accountResult.data?.welcome_clicks_remaining ?? 0);
  const adminClicks = Number(accountResult.data?.admin_clicks_remaining ?? 0);
  const paidClicks = Math.max(0, balance - welcomeClicks - adminClicks);
  const products = productsResult.data;
  const approvedProductIds = new Set(products.map((product) => product.id));
  const allocations = Object.fromEntries(
    allocationsResult.data
      .filter((allocation) => approvedProductIds.has(allocation.product_id))
      .map((allocation) => [allocation.product_id, {
        remaining: Number(allocation.clicks_remaining),
        limit: Number(allocation.clicks_limit),
      }]),
  );
  const { categoryById, leadMedia, leadMediaUrl } = await getSellerProductDetails(supabase, products);
  const advertisingProducts: AdvertisingProduct[] = products.map((product) => {
    const category = categoryById.get(product.category_id);
    const media = leadMedia.get(product.id);
    const clickCount = Number(product.click_count);
    const clicksSinceTopUp = Number(product.clicks_since_top_up);

    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      category: category?.slug ?? "home",
      categoryName: category?.name ?? "Uncategorised",
      price: product.price,
      featuredUntil: product.featured_until,
      newUntil: product.new_until,
      mediaType: media?.media_type ?? "image",
      clickCount,
      clicksSinceTopUp,
      clicksPreviously: Math.max(0, clickCount - clicksSinceTopUp),
      description: product.description,
      image: leadMediaUrl(product.id) ?? "",
      imageAlt: media?.alt_text || product.name,
      maker: seller.shop_name,
      shopUrl: seller.shop_url,
      makerImage: seller.logo_url?.startsWith("https://") ? seller.logo_url : "",
      overlayTone: getOverlayTone(category?.slug),
    };
  });

  return (
    <main className="admin-overview seller-overview">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">SELLER WORKSPACE</p>
        <h1>Advertising</h1>
        <p>Manage click credits and choose how they are shared across {seller.shop_name} products.</p>
      </header>
      {saved === "1" && <p className="admin-save-success" role="status">Product click allocations saved.</p>}
      {seller.status !== "active" && (
        <section className="seller-account-notice" role="status">
          <strong>Advertising is unavailable for this account.</strong>
          <span>Your seller profile must be active before product allocations can be changed.</span>
        </section>
      )}
      <SellerAdvertisingManager
        balance={balance}
        clickPricePencePer1000={clickRateResult.data}
        welcomeClicks={welcomeClicks}
        adminClicks={adminClicks}
        paidClicks={paidClicks}
        products={advertisingProducts}
        initialAllocations={allocations}
        canManage={seller.status === "active"}
      />
    </main>
  );
}