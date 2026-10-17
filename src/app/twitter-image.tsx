import { renderBrandImage } from "@/lib/brand-image";

export const alt = "RonTab marketplace";
export const size = { width: 1200, height: 600 };
export const contentType = "image/png";

export default function TwitterImage() {
  return renderBrandImage("twitter-card-1200x600.svg", size.width, size.height);
}