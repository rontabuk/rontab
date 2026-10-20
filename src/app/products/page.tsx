import type { Metadata } from "next";
import { Suspense } from "react";
import { io } from "next/cache";
import { ProductBrowser } from "@/components/ProductBrowser";
import { SiteHeader } from "@/components/SiteChrome";
import { TopVideoBanner } from "@/components/TopVideoBanner";
import { getPublicCatalog, getTopVideoAds } from "@/lib/supabase/catalog";
import "./catalog.css";

export const metadata: Metadata = {
  title: "Discover products",
  description: "Search and filter approved home and kitchen finds from independent UK shops.",
};

type ProductsPageProps = { searchParams: Promise<{ q?: string; category?: string; emailVerified?: string; verificationEmail?: string }> };

async function SearchableProductBrowser({ searchParams }: ProductsPageProps) {
  const parameters = await searchParams;
  await io();
  const { categories, products } = await getPublicCatalog();
  const initialCategory = categories.some((category) => category.id === parameters.category)
    ? parameters.category!
    : "all";

  return (
    <>
      {parameters.verificationEmail && (
        <p className="catalog-notice page-shell" data-tone={parameters.verificationEmail === "sent" ? "ok" : "error"} role="status">
          {parameters.verificationEmail === "sent"
            ? "We sent a confirmation link to your email. Open it on any phone or computer to confirm your address."
            : "Your account is ready, but we couldn't send the confirmation email. Open Notifications to try again."}
        </p>
      )}
      {parameters.emailVerified && (
        <p className="catalog-notice page-shell" data-tone={parameters.emailVerified === "1" ? "ok" : "error"} role="status">
          {parameters.emailVerified === "1"
            ? "Your email is confirmed. You're now collecting reward points."
            : "That confirmation link has expired or was already used. Open the bell to send a new one."}
        </p>
      )}
      <ProductBrowser
        initialQuery={parameters.q ?? ""}
        initialCategory={initialCategory}
        categories={categories}
        products={products}
      />
    </>
  );
}

async function TopVideoAdSlot() {
  await io();
  const ads = await getTopVideoAds();
  return <TopVideoBanner ads={ads} />;
}

export default function ProductsPage({ searchParams }: ProductsPageProps) {
  return (
    <div className="catalog-theme catalog-storefront">
      <Suspense fallback={null}>
        <TopVideoAdSlot />
      </Suspense>
      <SiteHeader showSiteName />
      <Suspense fallback={<main className="product-browser page-shell" aria-busy="true" />}>
        <SearchableProductBrowser searchParams={searchParams} />
      </Suspense>
    </div>
  );
}