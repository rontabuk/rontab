import type { NextConfig } from "next";

const supabaseStorageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    minimumCacheTTL: 60,
    remotePatterns: supabaseStorageUrl ? [{
      protocol: new URL(supabaseStorageUrl).protocol === "http:" ? "http" : "https",
      hostname: new URL(supabaseStorageUrl).hostname,
      port: new URL(supabaseStorageUrl).port,
      pathname: "/storage/v1/object/sign/product-images/**",
    }] : [],
  },
  experimental: {
    // Visitor avatars and seller logos (up to 5 MB) are uploaded through Server Actions.
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
