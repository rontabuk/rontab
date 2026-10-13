import type { Metadata } from "next";
import { Suspense } from "react";
import { io } from "next/cache";
import { ProductBrowser } from "@/components/ProductBrowser";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { getPublicCatalog } from "@/lib/supabase/catalog";

export const metadata: Metadata = {
  title: "Discover products",
  description: "Search and filter approved home and kitchen finds from independent UK shops.",
};

type ProductsPageProps = { searchParams: Promise<{ q?: string; category?: string }> };

async function SearchableProductBrowser({ searchParams }: ProductsPageProps) {
  const parameters = await searchParams;
  await io();
  const { categories, products } = await getPublicCatalog();
  const initialCategory = categories.some((category) => category.id === parameters.category)
    ? parameters.category!
    : "all";

  return (
    <ProductBrowser
      initialQuery={parameters.q ?? ""}
      initialCategory={initialCategory}
      categories={categories}
      products={products}
    />
  );
}

export default function ProductsPage({ searchParams }: ProductsPageProps) {
  return (
    <>
      <SiteHeader />
      <Suspense fallback={<main className="product-browser page-shell" aria-busy="true" />}>
        <SearchableProductBrowser searchParams={searchParams} />
      </Suspense>
      <SiteFooter />
    </>
  );
}