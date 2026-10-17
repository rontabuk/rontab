import { renderBrandImage } from "@/lib/brand-image";

export const alt = "RonTab marketplace";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return renderBrandImage("og-image-1200x630.svg", size.width, size.height);
}