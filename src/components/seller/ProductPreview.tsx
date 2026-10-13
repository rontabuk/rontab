"use client";

import { ProductCard } from "@/components/ProductCard";
import { getOverlayTone, type Product } from "@/data/products";

export type SellerCategoryOption = { id: string; slug: string; name: string };

export function ProductPreview({
  slug,
  name,
  category,
  price,
  description,
  shopName,
  shopLogo,
  mediaUrl,
  mediaType,
}: {
  slug: string;
  name: string;
  category: SellerCategoryOption | undefined;
  price: string;
  description: string;
  shopName: string;
  shopLogo: string | null;
  mediaUrl: string;
  mediaType: "image" | "video" | undefined;
}) {
  const parsedPrice = Number(price);
  const product: Product = {
    slug,
    name: name.trim() || "Product name",
    category: category?.slug ?? "home",
    categoryName: category?.name ?? "",
    price: price.trim() && Number.isFinite(parsedPrice) ? parsedPrice : null,
    description: description.trim() || "Your product description will appear here.",
    image: mediaUrl,
    imageAlt: name.trim() || "Product preview",
    mediaType,
    maker: shopName,
    makerImage: shopLogo?.startsWith("https://") ? shopLogo : "",
    overlayTone: getOverlayTone(category?.slug),
  };

  return (
    <aside className="seller-product-preview" aria-label="Live product preview">
      <h2>Preview</h2>
      <div className="seller-product-preview-card">
        <ProductCard product={product} previewOnly showUploadPlaceholder={!mediaUrl} />
      </div>
    </aside>
  );
}
