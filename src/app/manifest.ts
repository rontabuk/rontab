import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RonTab",
    short_name: "RonTab",
    description: "The marketplace where independent shops and shoppers meet.",
    id: "/",
    start_url: "/products",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f5f2eb",
    theme_color: "#2f5a3f",
    categories: ["shopping"],
    icons: [
      { src: "/brand/android-chrome-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
      { src: "/brand/android-chrome-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any" },
      { src: "/brand/maskable-icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
