"use client";

import { useEffect, useState } from "react";
import { Columns2, LayoutGrid, Rows2, Search, Sparkles, X } from "lucide-react";
import { ProductCard } from "@/components/ProductCard";
import type { Product, ProductCategory } from "@/data/products";

type ProductBrowserProps = {
  initialQuery: string;
  initialCategory: string;
  categories: readonly ProductCategory[];
  products: readonly Product[];
  followedShopIds: readonly string[];
};

export function ProductBrowser({
  initialQuery,
  initialCategory,
  categories,
  products,
  followedShopIds,
}: ProductBrowserProps) {
  const [query, setQuery] = useState(initialQuery);
  const [activeCategory, setActiveCategory] = useState(initialCategory);
  const [currentTime, setCurrentTime] = useState(0);
  const [twoColumnMobileView, setTwoColumnMobileView] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 760px)");
    const updateViewport = () => setIsMobileViewport(mediaQuery.matches);
    updateViewport();
    mediaQuery.addEventListener("change", updateViewport);
    return () => mediaQuery.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    const updateCurrentTime = () => setCurrentTime(Date.now());
    updateCurrentTime();
    const interval = window.setInterval(updateCurrentTime, 60_000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let idleTimer: number | null = null;

    const openDescriptionAfterScroll = () => {
      if (idleTimer !== null) window.clearTimeout(idleTimer);

      idleTimer = window.setTimeout(() => {
        idleTimer = null;
        if (document.querySelector(".description-panel")) return;

        const visibleCards = Array.from(
          document.querySelectorAll<HTMLElement>("[data-product-card]"),
        )
          .map((card) => {
            const bounds = card.getBoundingClientRect();
            const visibleWidth = Math.max(
              0,
              Math.min(bounds.right, window.innerWidth) - Math.max(bounds.left, 0),
            );
            const visibleHeight = Math.max(
              0,
              Math.min(bounds.bottom, window.innerHeight) - Math.max(bounds.top, 0),
            );

            return {
              card,
              visibleRatio:
                (visibleWidth * visibleHeight) / (bounds.width * bounds.height),
            };
          })
          .filter(({ visibleRatio }) => visibleRatio >= 0.4)
          .sort((first, second) => second.visibleRatio - first.visibleRatio);

        const descriptionButton = visibleCards[0]?.card.querySelector<HTMLButtonElement>(
          ".product-description-preview",
        );

        if (descriptionButton?.getAttribute("aria-expanded") === "false") {
          descriptionButton.click();
        }
      }, 5_000);
    };

    window.addEventListener("scroll", openDescriptionAfterScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", openDescriptionAfterScroll);
      if (idleTimer !== null) window.clearTimeout(idleTimer);
    };
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  // Time windows are evaluated on the client only, after mount, to keep hydration stable.
  const isActiveUntil = (until?: string | null) => currentTime > 0 && Boolean(until) && Date.parse(until!) > currentTime;
  const filteredProducts = products.filter((product) => {
    const matchesCategory =
      activeCategory === "all" ||
      (activeCategory === "new" ? isActiveUntil(product.newUntil) : product.category === activeCategory);
    const matchesQuery = !normalizedQuery || `${product.name} ${product.categoryName} ${product.description} ${product.maker}`.toLowerCase().includes(normalizedQuery);
    return matchesCategory && matchesQuery;
  }).sort((first, second) => Number(isActiveUntil(second.featuredUntil)) - Number(isActiveUntil(first.featuredUntil)));
  const followedShops = new Set(followedShopIds);
  const clearFilters = () => { setQuery(""); setActiveCategory("all"); };

  return (
    <main className="product-browser page-shell" id="discover">
      <div className="browse-tools">
        <div className="filter-list" role="group" aria-label="Filter by category">
          <button className={`filter-button${activeCategory === "all" ? " is-active" : ""}`} type="button" aria-pressed={activeCategory === "all"} onClick={() => setActiveCategory("all")}><LayoutGrid size={15} aria-hidden="true" />All</button>
          <button className={`filter-button filter-button-new${activeCategory === "new" ? " is-active" : ""}`} type="button" aria-pressed={activeCategory === "new"} onClick={() => setActiveCategory("new")}><Sparkles size={15} aria-hidden="true" />New</button>
          {categories.map((category) => (
            <button className={`filter-button${activeCategory === category.id ? " is-active" : ""}`} type="button" aria-pressed={activeCategory === category.id} key={category.id} onClick={() => setActiveCategory(category.id)}>{category.name}</button>
          ))}
        </div>
        <div className="browser-search-row">
          <label className="browser-search" id="product-search">
            <Search size={16} aria-hidden="true" />
            <span className="visually-hidden">Search by product or category</span>
            <input id="product-search-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search for products, shops…" aria-controls="product-grid" />
            {query && <button className="clear-search" type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={15} aria-hidden="true" /></button>}
          </label>
          <button
            className="product-view-toggle"
            type="button"
            aria-label={twoColumnMobileView ? "Show one column" : "Show two columns"}
            aria-controls="product-grid"
            aria-pressed={twoColumnMobileView}
            title={twoColumnMobileView ? "Show one column" : "Show two columns"}
            onClick={() => setTwoColumnMobileView((current) => !current)}
          >
            {twoColumnMobileView ? <Rows2 size={19} aria-hidden="true" /> : <Columns2 size={19} aria-hidden="true" />}
          </button>
        </div>
      </div>
      <p className="visually-hidden" role="status" aria-live="polite">{filteredProducts.length} {filteredProducts.length === 1 ? "find" : "finds"}</p>
      {filteredProducts.length ? (
        <div className="product-grid" id="product-grid" data-mobile-columns={twoColumnMobileView ? "two" : "one"}>
          {filteredProducts.map((product, index) => (
            <ProductCard
              product={product}
              priority={index < 2}
              compact={isMobileViewport && twoColumnMobileView}
              isFeatured={isActiveUntil(product.featuredUntil)}
              isShopFollowed={product.sellerProfileId ? followedShops.has(product.sellerProfileId) : false}
              key={product.slug}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <p className="eyebrow">{products.length ? "Nothing here just yet" : "Product catalogue"}</p>
          <h3>{products.length ? "No finds match that search." : "No products are published yet."}</h3>
          <p>{products.length ? "Try another word or clear the category filter." : "Approved products will appear here when sellers publish their listings."}</p>
          {products.length > 0 && <button className="button button-outline" type="button" onClick={clearFilters}>Clear filters</button>}
        </div>
      )}
    </main>
  );
}