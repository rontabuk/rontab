"use client";

import { useState } from "react";
import { CreditCard, Save, Search } from "lucide-react";
import { saveSellerAdAllocations } from "@/app/seller/(protected)/actions";
import { ProductCard } from "@/components/ProductCard";
import type { Product } from "@/data/products";
import { formatNumber } from "@/lib/format";

export type AdvertisingProduct = Product & { id: string; clicksPreviously: number };
type Allocation = { remaining: number; limit: number };
type ProductFilter = "all" | "shared" | "dedicated" | "exhausted";

export function SellerAdvertisingManager({
  balance,
  clickPricePencePer1000,
  welcomeClicks,
  adminClicks,
  paidClicks,
  products,
  initialAllocations,
  canManage,
}: {
  balance: number;
  clickPricePencePer1000: number;
  welcomeClicks: number;
  adminClicks: number;
  paidClicks: number;
  products: AdvertisingProduct[];
  initialAllocations: Record<string, Allocation>;
  canManage: boolean;
}) {
  const [topUpClicks, setTopUpClicks] = useState(1_000);
  const [allocations, setAllocations] = useState(initialAllocations);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [productFilter, setProductFilter] = useState<ProductFilter>("all");
  const totalAllocated = Object.values(allocations).reduce((total, allocation) => total + allocation.remaining, 0);
  const sharedClicks = balance - totalAllocated;
  const categories = [...new Map(products.map((product) => [product.category, product.categoryName])).entries()];
  const normalizedQuery = query.trim().toLowerCase();
  const visibleProducts = products.filter((product) => {
    const allocation = allocations[product.id];
    const isExhausted = allocation ? allocation.remaining === 0 : sharedClicks <= 0;
    const matchesAllocation = productFilter === "all"
      || (productFilter === "shared" && !allocation)
      || (productFilter === "dedicated" && Boolean(allocation))
      || (productFilter === "exhausted" && isExhausted);
    const matchesCategory = categoryFilter === "all" || product.category === categoryFilter;
    const matchesQuery = !normalizedQuery || `${product.name} ${product.categoryName}`.toLowerCase().includes(normalizedQuery);
    return matchesAllocation && matchesCategory && matchesQuery;
  });

  function updateAllocation(productId: string, requestedClicks: number) {
    const allocatedElsewhere = totalAllocated - (allocations[productId]?.remaining ?? 0);
    const availableForProduct = Math.max(0, balance - allocatedElsewhere);
    const remaining = Math.min(requestedClicks, availableForProduct);
    setAllocations((current) => ({ ...current, [productId]: { remaining, limit: remaining } }));
  }

  function setSharedAllocation(productId: string, useShared: boolean) {
    if (useShared) {
      setAllocations((current) => {
        const next = { ...current };
        delete next[productId];
        return next;
      });
      return;
    }
    setAllocations((current) => ({ ...current, [productId]: current[productId] ?? { remaining: 0, limit: 0 } }));
  }

  return (
    <div className="seller-advertising-manager">
      <section className="seller-ad-balance" aria-labelledby="seller-ad-balance-title">
        <div>
          <p className="admin-eyebrow">CLICK BALANCE</p>
          <h2 id="seller-ad-balance-title">{formatNumber(balance)} clicks</h2>
          <p>Remaining balance · {formatGbp(balance, clickPricePencePer1000)} equivalent</p>
        </div>
        <div className="seller-ad-balance-rule">
          <strong>1,000 clicks</strong>
          <span>equals</span>
          <strong>{formatGbp(1_000, clickPricePencePer1000)}</strong>
        </div>
      </section>

      <section className="seller-ad-topup" aria-labelledby="seller-ad-topup-title">
        <div className="seller-ad-section-heading">
          <div>
            <h2 id="seller-ad-topup-title">Add click credits</h2>
            <p>Choose an amount to see its price. Online payments are not active yet.</p>
          </div>
          <CreditCard size={19} aria-hidden="true" />
        </div>
        <label className="seller-ad-slider-label" htmlFor="seller-ad-topup-slider">
          <span>Requested clicks</span>
          <output>{formatNumber(topUpClicks)} clicks · {formatGbp(topUpClicks, clickPricePencePer1000)}</output>
        </label>
        <input
          id="seller-ad-topup-slider"
          className="seller-ad-slider"
          type="range"
          min="1000"
          max="1000000"
          step="1000"
          value={topUpClicks}
          onChange={(event) => setTopUpClicks(Number(event.target.value))}
          aria-label="Choose the number of click credits to purchase"
        />
        <div className="seller-ad-slider-scale"><span>{formatGbp(1_000, clickPricePencePer1000)}</span><span>{formatGbp(1_000_000, clickPricePencePer1000)}</span></div>
        <button className="seller-ad-topup-button" type="button" disabled>
          <CreditCard size={15} aria-hidden="true" /> Payments unavailable
        </button>
        <div className="seller-ad-credit-balances" aria-label="Credit balance breakdown">
          <div><span>Welcome gift</span><strong>{formatNumber(welcomeClicks)} clicks</strong><small>Free once on registration</small></div>
          <div><span>Admin gifts</span><strong>{formatNumber(adminClicks)} clicks</strong><small>Used before the welcome gift</small></div>
          <div><span>Paid balance</span><strong>{formatNumber(paidClicks)} clicks</strong><small>Used after free credits</small></div>
        </div>
        <p className="seller-ad-credit-order">Click use order: administration gift, welcome gift, then paid credits.</p>
      </section>

      <section className="seller-ad-allocation" aria-labelledby="seller-ad-allocation-title">
        <div className="seller-ad-section-heading">
          <div>
            <h2 id="seller-ad-allocation-title">Product allocation</h2>
            <p>Unallocated clicks are shared automatically across all your public products.</p>
          </div>
          <span className="seller-ad-pool-total">Shared pool: {formatNumber(sharedClicks)}</span>
        </div>

        {products.length ? (
          <>
            <div className="seller-ad-filters">
              <label className="seller-ad-search">
                <Search size={15} aria-hidden="true" />
                <span className="visually-hidden">Search products</span>
                <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products" />
              </label>
              <label className="seller-ad-category-filter">
                <span className="visually-hidden">Filter by category</span>
                <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                  <option value="all">All categories</option>
                  {categories.map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}
                </select>
              </label>
              <div className="seller-ad-filter-tabs" role="group" aria-label="Filter by allocation status">
                {([
                  ["all", "All products"],
                  ["shared", "Shared pool"],
                  ["dedicated", "Reserved"],
                  ["exhausted", "Exhausted"],
                ] as const).map(([filter, label]) => (
                  <button
                    className={productFilter === filter ? "is-active" : undefined}
                    type="button"
                    aria-pressed={productFilter === filter}
                    key={filter}
                    onClick={() => setProductFilter(filter)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="seller-ad-filter-count">{visibleProducts.length} of {products.length}</span>
            </div>

            <form action={saveSellerAdAllocations}>
              {products.filter((product) => !visibleProducts.some((visibleProduct) => visibleProduct.id === product.id)).map((product) => {
                const allocation = allocations[product.id];
                return (
                  <span key={product.id} hidden>
                    <input type="hidden" name={`allocation_${product.id}`} value={allocation ? String(allocation.remaining) : "shared"} />
                    {allocation && <input type="hidden" name={`allocation_limit_${product.id}`} value={allocation.limit} />}
                  </span>
                );
              })}
              <div className="seller-ad-product-grid">
                {visibleProducts.map((product) => {
                  const allocation = allocations[product.id];
                  const remaining = allocation?.remaining ?? 0;
                  const availableForProduct = Math.max(0, balance - totalAllocated + remaining);
                  const isExhausted = allocation ? remaining === 0 : sharedClicks <= 0;
                  return (
                    <article className="seller-ad-product-card" key={product.id}>
                      <ProductCard product={product} previewOnly />
                      <div className="seller-ad-card-controls">
                        <div className="seller-ad-click-history">
                          <span>Previous <strong>{formatNumber(product.clicksPreviously)}</strong></span>
                          <span>This balance <strong>{formatNumber(product.clicksSinceTopUp ?? 0)}</strong></span>
                        </div>
                        <label className="seller-ad-shared-toggle" htmlFor={`shared-${product.id}`}>
                          <input
                            id={`shared-${product.id}`}
                            type="checkbox"
                            checked={!allocation}
                            disabled={!canManage}
                            onChange={(event) => setSharedAllocation(product.id, event.target.checked)}
                          />
                          <span>Use shared balance</span>
                        </label>
                        <div className="seller-ad-allocation-summary">
                          <span>{allocation ? (isExhausted ? "Allocation exhausted" : "Reserved for this product") : "Shared with all products"}</span>
                          <output>{allocation ? `${formatNumber(remaining)} left · ${formatGbp(remaining, clickPricePencePer1000)}` : "0 allocated"}</output>
                        </div>
                        <input type="hidden" name={`allocation_${product.id}`} value={allocation ? String(remaining) : "shared"} />
                        {allocation && <input type="hidden" name={`allocation_limit_${product.id}`} value={allocation.limit} />}
                        <label className="visually-hidden" htmlFor={`allocation-slider-${product.id}`}>
                          Clicks reserved for {product.name}
                        </label>
                        <input
                          id={`allocation-slider-${product.id}`}
                          className="seller-ad-slider"
                          type="range"
                          min="0"
                          max={availableForProduct}
                          step="1"
                          value={remaining}
                          disabled={!allocation || !canManage || balance === 0}
                          onChange={(event) => updateAllocation(product.id, Number(event.target.value))}
                        />
                        <div className="seller-ad-slider-scale"><span>0 · shared</span><span>{formatNumber(availableForProduct)} max</span></div>
                        {isExhausted && (
                          <span className="seller-ad-paused-note">
                            {allocation
                              ? "Hidden from shoppers: this product's allocated click credits are exhausted. Add credits or switch it to the shared balance."
                              : "Hidden from shoppers until shared click credits are available."}
                          </span>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
              <div className="seller-ad-save-row">
                <p>Products with exhausted dedicated or shared click credits are hidden from all shoppers. Restore credits to show them again.</p>
                <button className="admin-primary-button" type="submit" disabled={!canManage || products.length === 0}>
                  <Save size={15} aria-hidden="true" /> Save allocation
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="admin-empty-state">
            <h2>No approved products to promote</h2>
            <p>Approved products will appear here for optional click allocation.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function formatGbp(clicks: number, clickPricePencePer1000: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(clicks * clickPricePencePer1000 / 100_000);
}