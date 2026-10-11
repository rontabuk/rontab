"use client";

import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { ProductCard } from "@/components/ProductCard";
import type { Product, ProductCategory } from "@/data/products";

type ProductBrowserProps = {
  initialQuery: string;
  initialCategory: string;
  categories: readonly ProductCategory[];
  products: readonly Product[];
};

export function ProductBrowser({
  initialQuery,
  initialCategory,
  categories,
  products,
}: ProductBrowserProps) {
  const [query, setQuery] = useState(initialQuery);
  const [activeCategory, setActiveCategory] = useState(initialCategory);
  const [currentTime, setCurrentTime] = useState(0);

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
  const filteredProducts = products.filter((product) => {
    const matchesCategory =
      activeCategory === "all" ||
      (activeCategory === "new"
        ? currentTime > 0 &&
          currentTime >= new Date(product.addedAt).getTime() &&
          currentTime - new Date(product.addedAt).getTime() <= 72 * 60 * 60 * 1000
        : product.category === activeCategory);
    const matchesQuery = !normalizedQuery || `${product.name} ${product.category} ${product.description} ${product.maker}`.toLowerCase().includes(normalizedQuery);
    return matchesCategory && matchesQuery;
  });
  const clearFilters = () => { setQuery(""); setActiveCategory("all"); };

  return (
    <main className="product-browser page-shell" id="discover">
      <div className="browse-tools">
        <label className="browser-search">
          <Search size={16} aria-hidden="true" />
          <span className="visually-hidden">Search by product or category</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find something…" aria-controls="product-grid" />
          {query && <button className="clear-search" type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={15} aria-hidden="true" /></button>}
        </label>
        <div className="filter-list" role="group" aria-label="Filter by category">
          <button className={`filter-button filter-button-new${activeCategory === "new" ? " is-active" : ""}`} type="button" aria-pressed={activeCategory === "new"} onClick={() => setActiveCategory("new")}>New</button>
          <button className={`filter-button${activeCategory === "all" ? " is-active" : ""}`} type="button" aria-pressed={activeCategory === "all"} onClick={() => setActiveCategory("all")}>All finds</button>
          {categories.map((category) => (
            <button className={`filter-button${activeCategory === category.id ? " is-active" : ""}`} type="button" aria-pressed={activeCategory === category.id} key={category.id} onClick={() => setActiveCategory(category.id)}>{category.name}</button>
          ))}
        </div>
      </div>
      <p className="visually-hidden" role="status" aria-live="polite">{filteredProducts.length} {filteredProducts.length === 1 ? "find" : "finds"}</p>
      {filteredProducts.length ? (
        <div className="product-grid" id="product-grid">
          {filteredProducts.map((product) => <ProductCard product={product} key={product.slug} />)}
        </div>
      ) : (
        <div className="empty-state">
          <p className="eyebrow">Nothing here just yet</p>
          <h3>No finds match that search.</h3>
          <p>Try another word or clear the category filter.</p>
          <button className="button button-outline" type="button" onClick={clearFilters}>Clear filters</button>
        </div>
      )}
    </main>
  );
}