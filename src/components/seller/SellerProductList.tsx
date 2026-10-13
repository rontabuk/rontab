"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { deleteSellerProduct } from "@/app/seller/(protected)/actions";
import { formatCompactNumber, formatDate, formatPrice } from "@/lib/format";
import type { Database } from "@/lib/supabase/database.types";

type SellerProduct = {
  id: string;
  name: string;
  slug: string;
  status: Database["public"]["Enums"]["product_status"];
  price: number | null;
  click_count: number;
  currency: string;
  created_at: string;
  category_id: string;
  categoryName: string;
  mediaTypes: ("image" | "video")[];
  previewUrl: string | null;
  previewMediaType: "image" | "video" | null;
};

type Filter = { id: string; label: string; kind: "all" | "category" | "image" | "video"; value?: string };

export function SellerProductList({ products, canDelete }: { products: SellerProduct[]; canDelete: boolean }) {
  const [activeFilter, setActiveFilter] = useState("all");
  const [pendingDelete, setPendingDelete] = useState<SellerProduct | null>(null);
  const displayedPendingDelete = pendingDelete && products.some((product) => product.id === pendingDelete.id)
    ? pendingDelete
    : null;
  const categories = [...new Set(products.map((product) => product.categoryName))];
  const filters: Filter[] = [
    { id: "all", label: "All products", kind: "all" },
    ...categories.map((category) => ({ id: `category:${category}`, label: category, kind: "category" as const, value: category })),
    { id: "image", label: "Photos", kind: "image" },
    { id: "video", label: "Reels", kind: "video" },
  ];
  const currentFilter = filters.find((filter) => filter.id === activeFilter) ?? filters[0];
  const filteredProducts = products.filter((product) => {
    if (currentFilter.kind === "category") return product.categoryName === currentFilter.value;
    if (currentFilter.kind === "image" || currentFilter.kind === "video") return product.mediaTypes.includes(currentFilter.kind);
    return true;
  });

  return (
    <section className="seller-products-section" aria-labelledby="seller-products-title">
      <div className="seller-products-heading">
        <h2 id="seller-products-title">Products</h2>
        <span>{filteredProducts.length} of {products.length}</span>
      </div>
      <div className="seller-product-filters" role="group" aria-label="Filter your products">
        {filters.map((filter) => (
          <button
            aria-pressed={activeFilter === filter.id}
            className={`seller-product-filter${activeFilter === filter.id ? " is-active" : ""}`}
            key={filter.id}
            onClick={() => setActiveFilter(filter.id)}
            type="button"
          >
            {filter.label}
          </button>
        ))}
      </div>
      {filteredProducts.length ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Product</th><th>Category</th><th>Media</th><th>Price</th><th className="seller-click-count">Shop clicks</th><th>Status</th><th>Submitted</th><th>Actions</th></tr></thead>
            <tbody>
              {filteredProducts.map((product) => (
                <tr key={product.id}>
                  <td>
                    <strong>{product.name}</strong>
                    <small>{product.slug}</small>
                    {product.previewUrl ? (
                      <div className={`seller-product-thumbnail${product.previewMediaType === "video" ? " seller-product-thumbnail-video" : ""}`}>
                        {product.previewMediaType === "video" ? (
                          <video src={product.previewUrl} aria-label={`Reel preview for ${product.name}`} autoPlay loop muted playsInline preload="metadata" />
                        ) : (
                          <Image src={product.previewUrl} alt={`Preview of ${product.name}`} fill unoptimized sizes="72px" />
                        )}
                      </div>
                    ) : (
                      <div className="seller-product-thumbnail seller-product-thumbnail-empty" aria-label="No product media">No media</div>
                    )}
                  </td>
                  <td>{product.categoryName}</td>
                  <td>{product.mediaTypes.map((type) => type === "video" ? "Reel" : "Photo").join(" · ") || "—"}</td>
                  <td>{formatPrice(product.price, product.currency)}</td>
                  <td className="seller-click-count">{formatCompactNumber(product.click_count)}</td>
                  <td><span className={`admin-status admin-status-${product.status}`}>{product.status}</span></td>
                  <td>{formatDate(product.created_at)}</td>
                  <td>
                    <div className="seller-product-row-actions">
                      <Link className="seller-product-edit-link" href={`/seller/products/${product.id}/edit`}>Edit</Link>
                      {canDelete && (
                        <button className="seller-product-delete-button" type="button" onClick={() => setPendingDelete(product)}>Delete</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="admin-empty-state">
          <h2>{products.length ? "No products in this filter" : "No products yet"}</h2>
          <p>{products.length ? "Choose another category or media type." : "Products you add for review will appear here."}</p>
        </div>
      )}
      {displayedPendingDelete && (
        <div className="seller-confirm-overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setPendingDelete(null);
        }}>
          <section className="seller-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-product-title" onKeyDown={(event) => {
            if (event.key === "Escape") setPendingDelete(null);
          }}>
            <p className="admin-eyebrow">DELETE PRODUCT</p>
            <h2 id="delete-product-title">Delete {displayedPendingDelete.name}?</h2>
            <p>This permanently removes the product and its photos or Reel from your shop.</p>
            <form className="seller-confirm-actions" action={deleteSellerProduct}>
              <input name="product_id" type="hidden" value={displayedPendingDelete.id} />
              <button className="seller-confirm-cancel" type="button" autoFocus onClick={() => setPendingDelete(null)}>Keep product</button>
              <button className="seller-confirm-delete" type="submit">Delete permanently</button>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
