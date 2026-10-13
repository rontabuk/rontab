import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ron.Tab",
    short_name: "Ron.Tab",
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
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
