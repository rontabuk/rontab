import type { NextConfig } from "next";

const supabaseStorageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
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
    agentUpgrade: "security",
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
