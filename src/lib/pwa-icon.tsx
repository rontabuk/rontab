import { renderBrandImage } from "@/lib/brand-image";

export function renderAppIcon(size: number) {
  return renderBrandImage("app-icon-rounded-1024.svg", size, size);
}
