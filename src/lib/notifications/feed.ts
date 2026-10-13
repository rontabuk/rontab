import "server-only";

import { cache } from "react";
import { getViewer } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SiteNotification = {
  id: string;
  kind: "verify-email" | "announcement" | "new-product";
  title: string;
  body: string;
  href: string | null;
  createdAt: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const NEW_PRODUCT_WINDOW_MS = 14 * DAY_MS;
const ANNOUNCEMENT_WINDOW_MS = 60 * DAY_MS;

export const getNotificationFeed = cache(async () => {
  const viewer = await getViewer();
  const supabase = await createSupabaseServerClient();
  const now = Date.now();
  const signedIn = viewer.role !== "guest";

  const [announcements, products, reads] = await Promise.all([
    supabase
      .from("site_announcements")
      .select("id,title,body,link_url,created_at")
      .eq("is_active", true)
      .gte("created_at", new Date(now - ANNOUNCEMENT_WINDOW_MS).toISOString())
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("products")
      .select("id,slug,name,published_at")
      .eq("status", "approved")
      .gte("published_at", new Date(now - NEW_PRODUCT_WINDOW_MS).toISOString())
      .order("published_at", { ascending: false })
      .limit(8),
    signedIn
      ? supabase.from("notification_reads").select("last_seen_at").maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const items: SiteNotification[] = [
    ...(announcements.data ?? []).map((item) => ({
      id: `announcement-${item.id}`,
      kind: "announcement" as const,
      title: item.title,
      body: item.body,
      href: `/notifications/${item.id}`,
      createdAt: item.created_at,
    })),
    ...(products.data ?? []).filter((item) => item.published_at).map((item) => ({
      id: `product-${item.id}`,
      kind: "new-product" as const,
      title: "New on Rontab",
      body: item.name,
      href: `/products/${item.slug}`,
      createdAt: item.published_at!,
    })),
  ].sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt));

  if (viewer.role === "visitor" && !viewer.emailVerifiedAt) {
    // Re-surfaces as unread once every 24 hours until the email is confirmed.
    const signedUpAt = Date.parse(viewer.createdAt);
    const reminderAt = signedUpAt + Math.floor(Math.max(0, now - signedUpAt) / DAY_MS) * DAY_MS;
    items.unshift({
      id: `verify-email-${reminderAt}`,
      kind: "verify-email",
      title: "Confirm your email address",
      body: "Confirm your email to start collecting points and join reward offers. Check your inbox for the link we sent.",
      href: null,
      createdAt: new Date(reminderAt).toISOString(),
    });
  }

  const itemReads = signedIn && items.length
    ? await supabase.from("notification_item_reads").select("notification_id").in("notification_id", items.map((item) => item.id))
    : { data: null, error: null };
  if (itemReads.error) throw new Error("Notification read status is temporarily unavailable.");
  return { items, signedIn, userId: viewer.role === "guest" ? null : viewer.userId, readIds: (itemReads.data ?? []).map((item) => item.notification_id), lastSeenAt: reads.data?.last_seen_at ?? null };
});
