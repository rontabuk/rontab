import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { io } from "next/cache";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/ProductCard";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { formatPrice, products as sampleProducts } from "@/data/products";
import { getDevelopmentSampleCatalog, getPublicCatalog } from "@/lib/supabase/catalog";

type ProductPageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const sampleProduct =
    process.env.NODE_ENV === "development"
      ? sampleProducts.find((product) => product.slug === slug)
      : undefined;
  return { title: sampleProduct?.name ?? slug.replaceAll("-", " ") };
}

async function ProductPageContent({ params }: ProductPageProps) {
  const { slug } = await params;
  await io();
  const catalog = await getPublicCatalog();

  const liveProduct = catalog.products.find((item) => item.slug === slug);
  const sampleProduct =
    process.env.NODE_ENV === "development"
      ? sampleProducts.find((item) => item.slug === slug)
      : undefined;
  const product = liveProduct ?? sampleProduct;
  if (!product) notFound();
  const relatedProducts = (liveProduct ? catalog.products : getDevelopmentSampleCatalog().products)
    .filter((item) => item.category === product.category && item.slug !== product.slug)
    .slice(0, 3);

  return (
    <>
      <SiteHeader />
      <main className="product-detail page-shell">
        <nav className="breadcrumbs" aria-label="Breadcrumb">
          <Link href="/">Home</Link><span aria-hidden="true">/</span>
          <Link href={`/?category=${product.category}#discover`}>{product.category}</Link><span aria-hidden="true">/</span>
          <span aria-current="page">{product.name}</span>
        </nav>
        <div className="product-detail-grid">
          <div className="detail-image">
            <Image src={product.image} alt={product.imageAlt} fill unoptimized priority sizes="(max-width: 760px) 100vw, 55vw" />
            {!liveProduct && <span className="demo-label">SAMPLE FIND</span>}
          </div>
          <div className="detail-copy">
            <p className="eyebrow">{product.category}{!liveProduct && " · sample listing"}</p>
            <h1>{product.name}</h1>
            <p className="detail-maker">{liveProduct ? product.maker : `An illustrative listing by ${product.maker}`}</p>
            <p className="detail-price">{formatPrice(product.price)}</p>
            <p className="detail-description">{product.description}</p>
            <p className="detail-note">{product.detail}</p>
            <a className="button button-dark detail-cta" href={product.externalUrl} target="_blank" rel="noreferrer">
              {liveProduct ? "Visit shop" : "Visit example link"} <ArrowUpRight size={16} aria-hidden="true" />
            </a>
            {!liveProduct && <p className="retailer-note">Demonstration link only. This is not a live retailer listing, and no purchase can be made.</p>}
            <Link className="back-link" href="/#discover"><ArrowLeft size={15} aria-hidden="true" /> Back to all finds</Link>
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