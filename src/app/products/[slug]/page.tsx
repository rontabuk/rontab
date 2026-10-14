import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { io } from "next/cache";
import { ArrowLeft, ArrowUpRight, Image as ImageIcon } from "lucide-react";
import { notFound } from "next/navigation";
import { reportMarketplaceItem } from "@/app/visitor/actions";
import { ProductCard } from "@/components/ProductCard";
import { BrowserSpeechPlayer } from "@/components/BrowserSpeechPlayer";
import { ShopVisitLink } from "@/components/ShopVisitLink";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { formatPrice } from "@/lib/format";
import { getPublicCatalog } from "@/lib/supabase/catalog";

type ProductPageProps = { params: Promise<{ slug: string }>; searchParams: Promise<{ report?: string }> };

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const catalog = await getPublicCatalog();
  const product = catalog.products.find((item) => item.slug === slug);
  return product
    ? { title: product.name, description: product.description.slice(0, 160) }
    : { title: "Product not found" };
}

async function ProductPageContent({ params, searchParams }: ProductPageProps) {
  const [{ slug }, { report }] = await Promise.all([params, searchParams]);
  await io();
  const catalog = await getPublicCatalog();

  const product = catalog.products.find((item) => item.slug === slug);
  if (!product) notFound();
  const otherProducts = catalog.products.filter((item) => item.slug !== product.slug);
  const relatedProducts = [
    ...otherProducts.filter((item) => item.category === product.category),
    ...otherProducts.filter((item) => item.category !== product.category),
  ].slice(0, 8);

  return (
    <>
      <SiteHeader />
      <main className="product-detail page-shell">
        <nav className="breadcrumbs" aria-label="Breadcrumb">
          <Link href="/products">Discover</Link><span aria-hidden="true">/</span>
          <Link href={`/products?category=${product.category}#discover`}>{product.categoryName}</Link><span aria-hidden="true">/</span>
          <span aria-current="page">{product.name}</span>
        </nav>
        <div className="product-detail-grid">
          <div className="detail-image">
            {!product.image ? (
              <div className="detail-image-placeholder" aria-label="No product image">
                <ImageIcon size={34} aria-hidden="true" />
              </div>
            ) : product.mediaType === "video" ? (
              <video src={product.image} aria-label={product.imageAlt} controls playsInline preload="metadata" />
            ) : (
              <Image src={product.image} alt={product.imageAlt} fill unoptimized priority sizes="(max-width: 760px) 100vw, 55vw" />
            )}
          </div>
          <div className="detail-copy">
            <p className="eyebrow">{product.categoryName}</p>
            <h1>{product.name}</h1>
            <p className="detail-maker">{product.maker}</p>
            <p className="detail-price">{formatPrice(product.price)}</p>
            {product.audioScript && <BrowserSpeechPlayer text={product.audioScript} />}
            <p className="detail-description">{product.description}</p>
            <div className="detail-actions">
              <ShopVisitLink className="button button-dark" slug={product.slug} productName={product.name}>
                Visit shop <ArrowUpRight size={16} aria-hidden="true" />
              </ShopVisitLink>
              {product.shopUrl && (
                <a className="detail-shop-link" href={product.shopUrl} target="_blank" rel="noreferrer">
                  {product.maker}&apos;s website <ArrowUpRight size={14} aria-hidden="true" />
                </a>
              )}
            </div>
            <p className="detail-note">Prices and availability are set by the shop and may change. Purchases are completed on the seller&apos;s website, not on Rontab.</p>
            {product.id && product.sellerProfileId && (
              <section className="marketplace-report" id="report" aria-labelledby="marketplace-report-title">
                <h2 id="marketplace-report-title">Something wrong?</h2>
                <details>
                  <summary>Report this product or seller</summary>
                  <p>Reports are reviewed by the Rontab team. Sign in with a verified visitor account to submit one.</p>
                  {report === "sent" && <p className="marketplace-report-feedback" role="status">Thank you. Your report was sent for review. <Link href="/visitor/support">View my reports</Link></p>}
                  {report === "verification" && <p className="marketplace-report-feedback is-error" role="alert">Confirm your email from the notification bell before sending a report.</p>}
                  {report === "invalid" && <p className="marketplace-report-feedback is-error" role="alert">Choose a reason and add a description of at least 10 characters.</p>}
                  {report === "unavailable" && <p className="marketplace-report-feedback is-error" role="alert">This item is no longer available to report.</p>}
                  {report === "failed" && <p className="marketplace-report-feedback is-error" role="alert">We could not send your report. Please try again.</p>}
                  <form action={reportMarketplaceItem}>
                    <input type="hidden" name="product_id" value={product.id} />
                    <input type="hidden" name="seller_profile_id" value={product.sellerProfileId} />
                    <input type="hidden" name="return_path" value={`/products/${product.slug}`} />
                    <label>Report target<select name="target_type" defaultValue="product">
                      <option value="product">Product: {product.name}</option>
                      <option value="seller_account">Seller account: {product.maker}</option>
                    </select></label>
                    <label>Reason<select name="issue_type" defaultValue="" required>
                      <option value="" disabled>Choose a reason</option>
                      <option value="misleading">Misleading information</option>
                      <option value="prohibited">Prohibited item or content</option>
                      <option value="counterfeit">Suspected counterfeit</option>
                      <option value="seller_conduct">Seller account conduct</option>
                      <option value="other">Other concern</option>
                    </select></label>
                    <label>Description<textarea name="description" minLength={10} maxLength={2000} rows={4} required /></label>
                    <button className="button button-dark" type="submit">Send report</button>
                  </form>
                </details>
              </section>
            )}
            <Link className="back-link" href="/products#discover"><ArrowLeft size={15} aria-hidden="true" /> Back to all finds</Link>
          </div>
        </div>
        {relatedProducts.length > 0 && (
          <section className="related-section" aria-labelledby="related-title">
            <div className="section-heading"><div><p className="eyebrow">In the same corner</p><h2 id="related-title">A little more to explore.</h2></div></div>
            <div className="product-grid related-grid">
              {relatedProducts.map((item) => <ProductCard product={item} key={item.slug} />)}
            </div>
          </section>
        )}
      </main>
      <SiteFooter />
    </>
  );
}

export default function ProductPage({ params, searchParams }: ProductPageProps) {
  return (
      <Suspense fallback={<main className="product-detail page-shell" aria-busy="true" />}>
        <ProductPageContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}