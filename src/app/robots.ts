import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/seller$", "/seller/", "/creator$", "/creator/", "/visitor", "/account", "/auth", "/api", "/notifications", "/visit/", "/members/"],
    },
    sitemap: new URL("/sitemap.xml", siteUrl).href,
  };
}
