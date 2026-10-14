export type ProductOverlayTone = "ceramic" | "linen" | "glass" | "coffee" | "woven" | "lamp" | "oak";

export type ProductCategory = {
  id: string;
  name: string;
};

export type Product = {
  id?: string;
  sellerProfileId?: string;
  slug: string;
  name: string;
  category: string;
  categoryName: string;
  price: number | null;
  featuredUntil?: string | null;
  newUntil?: string | null;
  mediaType?: "image" | "video";
  clickCount?: number;
  clicksSinceTopUp?: number;
  description: string;
  audioScript?: string;
  image: string;
  imageAlt: string;
  maker: string;
  shopUrl?: string | null;
  makerImage: string;
  overlayTone: ProductOverlayTone;
};

const overlayToneByCategory: Record<string, ProductOverlayTone> = {
  kitchen: "coffee",
  tableware: "ceramic",
  textiles: "linen",
  storage: "woven",
  living: "lamp",
};

export function getOverlayTone(categorySlug: string | null | undefined): ProductOverlayTone {
  return overlayToneByCategory[categorySlug ?? ""] ?? "ceramic";
}