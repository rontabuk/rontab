import { Suspense } from "react";
import { io } from "next/cache";
import { ProductBrowser } from "@/components/ProductBrowser";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { getDevelopmentSampleCatalog, getPublicCatalog } from "@/lib/supabase/catalog";

type HomePageProps = {
  searchParams: Promise<{ q?: string; category?: string }>;
};

async function SearchableProductBrowser({ searchParams }: HomePageProps) {
  const parameters = await searchParams;
  await io();
  const liveCatalog = await getPublicCatalog();

  const showDevelopmentSamples =
    process.env.NODE_ENV === "development" && liveCatalog.products.length === 0;
  const developmentSamples = showDevelopmentSamples
    ? getDevelopmentSampleCatalog()
    : null;
  const categories = liveCatalog.categories.length
    ? liveCatalog.categories
    : developmentSamples?.categories ?? [];
  const products = developmentSamples?.products ?? liveCatalog.products;
  const initialCategory = categories.some(
    (category) => category.id === parameters.category,
  )
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

export default function Home({ searchParams }: HomePageProps) {
  const developmentSamples =
    process.env.NODE_ENV === "development" ? getDevelopmentSampleCatalog() : null;

  return (
    <>
      <SiteHeader />
      <>
        <Suspense fallback={<ProductBrowser initialQuery="" initialCategory="all" categories={developmentSamples?.categories ?? []} products={developmentSamples?.products ?? []} />}>
          <SearchableProductBrowser searchParams={searchParams} />
        </Suspense>
      </>
      <SiteFooter />
    </>
  );
}
