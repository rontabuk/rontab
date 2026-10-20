"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { ArrowDownWideNarrow, ArrowUpRight, Film, ImageIcon, MoreHorizontal, MousePointer2, Package, Pencil, Search, Tag, Trash2, UsersRound, X } from "lucide-react";
import { DismissibleDetails } from "@/components/DismissibleDetails";
import { DeleteProductDialog } from "@/components/seller/DeleteProductDialog";
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

export function SellerProductList({ products, canDelete, canPromote }: { products: SellerProduct[]; canDelete: boolean; canPromote: boolean }) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [media, setMedia] = useState("all");
  const [sort, setSort] = useState("newest");
  const [pendingDelete, setPendingDelete] = useState<SellerProduct | null>(null);
  const displayedPendingDelete = pendingDelete && products.some((product) => product.id === pendingDelete.id)
    ? pendingDelete
    : null;
  const categories = [...new Map(products.map((product) => [product.category_id, product.categoryName])).entries()];
  const statuses = [...new Set(products.map((product) => product.status))];
  const query = search.trim().toLocaleLowerCase();
  const hasFilters = Boolean(query || category !== "all" || status !== "all" || media !== "all");
  const filteredProducts = products.filter((product) => {
    return (!query || `${product.name} ${product.categoryName}`.toLocaleLowerCase().includes(query))
      && (category === "all" || product.category_id === category)
      && (status === "all" || product.status === status)
      && (media === "all" || product.mediaTypes.includes(media as "image" | "video"));
  }).sort((first, second) => {
    if (sort === "clicks") return second.click_count - first.click_count;
    if (sort === "price-low" || sort === "price-high") {
      if (first.price === null) return second.price === null ? 0 : 1;
      if (second.price === null) return -1;
      return sort === "price-low" ? first.price - second.price : second.price - first.price;
    }
    return sort === "oldest" ? first.created_at.localeCompare(second.created_at) : second.created_at.localeCompare(first.created_at);
  });

  function clearFilters() {
    setSearch("");
    setCategory("all");
    setStatus("all");
    setMedia("all");
  }

  return (
    <section className="seller-catalog" aria-label="Product catalogue">
      <div className="seller-catalog-toolbar">
        <label className="seller-catalog-search"><Search size={18} aria-hidden="true" /><span className="visually-hidden">Search your products</span>
          <input type="search" placeholder="Search products..." value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <div className="seller-catalog-filters">
          <label><span className="visually-hidden">Category</span><select aria-label="Category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label>
          <label><span className="visually-hidden">Status</span><select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option>{statuses.map((value) => <option value={value} key={value}>{statusLabel(value)}</option>)}</select></label>
          <label><span className="visually-hidden">Media</span><select aria-label="Media" value={media} onChange={(event) => setMedia(event.target.value)}><option value="all">All media</option><option value="image">Photos</option><option value="video">Reels</option></select></label>
          <label className="seller-catalog-sort"><ArrowDownWideNarrow size={15} aria-hidden="true" /><span className="visually-hidden">Sort products</span><select aria-label="Sort products" value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="clicks">Most clicks</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option></select></label>
        </div>
      </div>
      <div className="seller-catalog-results">
        <p role="status">{hasFilters ? `${filteredProducts.length} of ${products.length} products` : `${products.length} ${products.length === 1 ? "product" : "products"}`}</p>
        {hasFilters && <button type="button" onClick={clearFilters}><X size={13} aria-hidden="true" />Clear filters</button>}
      </div>
      {filteredProducts.length ? (
        <div className="seller-catalog-list">
          <div className="seller-catalog-columns" aria-hidden="true"><span>Product</span><span>Price</span><span>Shop clicks</span><span>Added</span><span>Actions</span></div>
          <ul className="seller-catalog-items">
            {filteredProducts.map((product, index) => (
              <li className="seller-catalog-row" key={product.id}>
                <div className="seller-catalog-product">
                  <div className="seller-catalog-media-stack">
                    <Link href={`/seller/products/${product.id}/edit`} className="seller-catalog-media" aria-label={`Edit ${product.name}`}>
                      {product.previewUrl ? product.previewMediaType === "video"
                        ? <><video src={product.previewUrl} aria-label={`Reel preview for ${product.name}`} muted playsInline preload="metadata" /><span className="seller-catalog-reel"><Film size={12} aria-hidden="true" /></span></>
                        : <Image src={product.previewUrl} alt={product.name} fill unoptimized sizes="88px" loading={index < 2 ? "eager" : "lazy"} />
                        : <ImageIcon size={24} aria-label="No product image" />}
                    </Link>
                    <span className={`seller-catalog-status is-${product.status}`}>{statusLabel(product.status)}</span>
                  </div>
                  <div className="seller-catalog-identity"><Link href={`/seller/products/${product.id}/edit`}>{product.name}</Link><span>{product.categoryName}</span><small>{product.mediaTypes.includes("video") ? <><Film size={12} aria-hidden="true" />Reel</> : <><ImageIcon size={12} aria-hidden="true" />{product.mediaTypes.length ? "Photo" : "No media"}</>}</small></div>
                </div>
                <div className="seller-catalog-value seller-catalog-price"><span className="seller-catalog-mobile-label">Price</span><strong>{formatPrice(product.price, product.currency)}</strong></div>
                <div className="seller-catalog-value seller-catalog-clicks"><span className="seller-catalog-mobile-label">Shop clicks</span><strong><MousePointer2 size={13} aria-hidden="true" />{formatCompactNumber(product.click_count)}</strong></div>
                <div className="seller-catalog-value seller-catalog-date"><span className="seller-catalog-mobile-label">Added</span><time dateTime={product.created_at}>{formatDate(product.created_at)}</time></div>
                <div className="seller-catalog-actions" aria-label={`Actions for ${product.name}`}>
                  <Link className="seller-catalog-action" href={`/seller/products/${product.id}/edit`} aria-label={`Edit ${product.name}`} data-tooltip="Edit product"><Pencil size={16} aria-hidden="true" /><span>Edit</span></Link>
                  {canPromote && product.status === "approved" && <>
                    <Link className="seller-catalog-action" href={`/seller/products/${product.id}/creator-opportunity`} aria-label={`Find creators for ${product.name}`} data-tooltip="Find creators"><UsersRound size={17} aria-hidden="true" /><span>Creators</span></Link>
                    <Link className="seller-catalog-action seller-catalog-offer" href={`/seller/products/${product.id}/offer`} aria-label={`Create a public offer for ${product.name}`} data-tooltip="Offer to the public"><Tag size={16} aria-hidden="true" /><span>Offer</span></Link>
                  </>}
                  {(canDelete || product.status === "approved") && <DismissibleDetails className="seller-catalog-more">
                    <summary className="seller-catalog-action" aria-label={`More actions for ${product.name}`} data-tooltip="More actions"><MoreHorizontal size={18} aria-hidden="true" /></summary>
                    <div className="seller-catalog-menu">
                      {product.status === "approved" && <Link href={`/products/${product.slug}`} target="_blank" rel="noopener noreferrer"><ArrowUpRight size={15} aria-hidden="true" />View product</Link>}
                      {canDelete && <button type="button" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); setPendingDelete(product); }}><Trash2 size={15} aria-hidden="true" />Delete product</button>}
                    </div>
                  </DismissibleDetails>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="seller-catalog-empty">
          <Package size={32} aria-hidden="true" /><h2>{products.length ? "No matching products" : "Your catalogue starts here"}</h2>
          <p>{products.length ? "Try another search or change your filters." : "Add your first product to your shop."}</p>
          {products.length ? <button type="button" onClick={clearFilters}>Clear filters</button> : <Link href="/seller">Add product</Link>}
        </div>
      )}
      {displayedPendingDelete && <DeleteProductDialog product={displayedPendingDelete} onCancel={() => setPendingDelete(null)} />}
    </section>
  );
}

function statusLabel(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (first) => first.toUpperCase());
}
