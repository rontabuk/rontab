export const sellerSocialPlatforms = [
  { field: "facebook_url", kind: "facebook", label: "Facebook", hosts: ["facebook.com", "fb.com"], placeholder: "https://www.facebook.com/your-shop" },
  { field: "twitter_url", kind: "x", label: "X (Twitter)", hosts: ["x.com", "twitter.com"], placeholder: "https://x.com/your-shop" },
  { field: "youtube_url", kind: "youtube", label: "YouTube", hosts: ["youtube.com", "youtu.be"], placeholder: "https://www.youtube.com/@your-shop" },
  { field: "tiktok_url", kind: "tiktok", label: "TikTok", hosts: ["tiktok.com"], placeholder: "https://www.tiktok.com/@your-shop" },
] as const;

export function normalizeSellerSocialUrl(value: string, hosts: readonly string[]): string | null {
  if (!value.trim()) return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port
      || !hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
    return url.href.length <= 500 ? url.href : null;
  } catch {
    return null;
  }
}