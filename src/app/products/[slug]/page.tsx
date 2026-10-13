import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { io } from "next/cache";
import { ArrowLeft, ArrowUpRight, Image as ImageIcon } from "lucide-react";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/ProductCard";
import { ShopVisitLink } from "@/components/ShopVisitLink";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { formatPrice } from "@/lib/format";
import { getPublicCatalog } from "@/lib/supabase/catalog";

type ProductPageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const catalog = await getPublicCatalog();
  const product = catalog.products.find((item) => item.slug === slug);
  return product
    ? { title: product.name, description: product.description.slice(0, 160) }
    : { title: "Product not found" };
}

async function ProductPageContent({ params }: ProductPageProps) {
  const { slug } = await params;
  await io();
  const catalog = await getPublicCatalog();

  const product = catalog.products.find((item) => item.slug === slug);
  if (!product) notFound();
  const relatedProducts = catalog.products
    .filter((item) => item.category === product.category && item.slug !== product.slug)
    .slice(0, 3);

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

export default function ProductPage({ params }: ProductPageProps) {
  return (
    <Suspense fallback={<main className="product-detail page-shell" aria-busy="true" />}>
      <ProductPageContent params={params} />
    </Suspense>
  );
}