import "server-only";

import { cache } from "react";
import { getViewer, type Viewer } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import type { NotificationChannel } from "@/lib/notifications/channels";

export type SiteNotification = {
  id: string;
  kind: "welcome" | "verify-email" | "announcement" | "new-product" | "loyalty-offer" | "reward-result" | "support-case" | "creator-programme";
  title: string;
  body: string;
  href: string | null;
  createdAt: string;
  completed?: boolean;
};

type NotificationFeed = {
  items: SiteNotification[];
  signedIn: boolean;
  userId: string | null;
  readIds: string[];
  lastSeenAt: string | null;
  hasMore?: Record<NotificationChannel, boolean>;
  unreadCounts?: Record<NotificationChannel, number>;
};

export type NotificationCursor = { createdAt: string; id: string };
export type NotificationPage = { items: SiteNotification[]; readIds: string[]; hasMore: boolean };
type InboxRow = Database["public"]["Functions"]["get_notification_inbox"]["Returns"][number];

export function notificationPage(rows: InboxRow[]): NotificationPage {
  const page = rows.slice(0, 20);
  return {
    items: page.map((row) => ({ id: row.notification_id, kind: row.kind, title: row.title, body: row.body, href: row.href, createdAt: row.created_at })),
    readIds: page.filter((row) => row.is_read).map((row) => row.notification_id),
    hasMore: rows.length > 20,
  };
}

function addEmailReminder(items: SiteNotification[], viewer: Viewer, now: number) {
  if (viewer.role !== "visitor") return;
  const signedUpAt = Date.parse(viewer.createdAt);
  const reminderAt = signedUpAt + Math.floor(Math.max(0, now - signedUpAt) / DAY_MS) * DAY_MS;
  items.unshift({
    id: `verify-email-${reminderAt}`,
    kind: "verify-email",
    title: viewer.emailVerifiedAt ? "Email confirmed" : "Confirm your email address",
    body: viewer.emailVerifiedAt
      ? "Your email address is confirmed. You're now collecting reward points."
      : "Confirm your email to start collecting points and join reward offers. Check your inbox for the link we sent.",
    href: null,
    createdAt: new Date(reminderAt).toISOString(),
    completed: Boolean(viewer.emailVerifiedAt),
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;
const NEW_PRODUCT_WINDOW_MS = 14 * DAY_MS;
const ANNOUNCEMENT_WINDOW_MS = 60 * DAY_MS;

export const getNotificationFeed = cache(async (): Promise<NotificationFeed> => {
  const viewer = await getViewer();
  if (viewer.role === "guest") {
    return { items: [], signedIn: false, userId: null, readIds: [], lastSeenAt: null };
  }

  const supabase = await createSupabaseServerClient();
  const now = Date.now();
  const signedUpAt = Date.parse(viewer.createdAt);

  const [savedMessages, savedAds, savedCounts] = await Promise.all([
    supabase.rpc("get_notification_inbox", { p_channel: "messages", p_limit: 21 }),
    supabase.rpc("get_notification_inbox", { p_channel: "ads", p_limit: 21 }),
    supabase.rpc("get_notification_inbox_counts"),
  ]);
  const archiveMissing = [savedMessages, savedAds, savedCounts].some((result) => result.error?.code === "PGRST202");
  if (!archiveMissing) {
    if (savedMessages.error || savedAds.error || savedCounts.error) throw new Error("Your inbox is temporarily unavailable.");
    const messages = notificationPage(savedMessages.data ?? []);
    const ads = notificationPage(savedAds.data ?? []);
    const items = [...messages.items, ...ads.items];
    addEmailReminder(items, viewer, now);
    return {
      items, signedIn: true, userId: viewer.userId,
      readIds: [...messages.readIds, ...ads.readIds], lastSeenAt: null,
      hasMore: { messages: messages.hasMore, ads: ads.hasMore },
      unreadCounts: {
        messages: Number(savedCounts.data?.find((row) => row.channel === "messages")?.unread_count ?? 0),
        ads: Number(savedCounts.data?.find((row) => row.channel === "ads")?.unread_count ?? 0),
      },
    };
  }

  const [announcements, products, reads, offers, rewardResults, supportUpdates, creatorCollaborationUpdates] = await Promise.all([
    supabase
      .from("site_announcements")
      .select("id,title,body,link_url,audience,created_at")
      .eq("is_active", true)
      .gte("created_at", new Date(Math.max(signedUpAt, now - ANNOUNCEMENT_WINDOW_MS)).toISOString())
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("products")
      .select("id,slug,name,published_at")
      .eq("status", "approved")
      .gte("published_at", new Date(Math.max(signedUpAt, now - NEW_PRODUCT_WINDOW_MS)).toISOString())
      .order("published_at", { ascending: false })
      .limit(8),
    supabase.from("notification_reads").select("last_seen_at").maybeSingle(),
    viewer.role === "visitor" && viewer.emailVerifiedAt
      ? supabase.rpc("get_visitor_loyalty_offers")
      : Promise.resolve({ data: null, error: null }),
    viewer.role === "visitor" && viewer.emailVerifiedAt
      ? supabase.rpc("get_visitor_loyalty_result_notifications")
      : Promise.resolve({ data: null, error: null }),
    viewer.role === "visitor" && viewer.emailVerifiedAt
      ? supabase.rpc("get_visitor_marketplace_support_notifications")
      : Promise.resolve({ data: null, error: null }),
    (viewer.role === "creator" || viewer.role === "seller")
      ? supabase.rpc("get_creator_collaboration_notifications")
      : Promise.resolve({ data: null, error: null }),
  ]);

  const announcementAudience = viewer.role === "admin" ? null
    : viewer.role === "seller" ? "sellers"
      : viewer.role === "visitor" ? "visitors"
        : "everyone";
  const visibleAnnouncements = (announcements.data ?? []).filter((item) =>
    viewer.role === "admin" || item.audience === "everyone" || item.audience === announcementAudience
  );

  const items: SiteNotification[] = [
    ...visibleAnnouncements.map((item) => ({
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
      title: "New products",
      body: item.name,
      href: `/products/${item.slug}`,
      createdAt: item.published_at!,
    })),
    ...(offers?.data ?? []).filter((offer) => Date.parse(offer.starts_at) >= signedUpAt).slice(0, 50).map((offer) => ({
      id: `offer-${offer.id}`,
      kind: "loyalty-offer" as const,
      title: "New reward offer",
      body: offer.title,
      href: `/visitor/rewards#offer-${offer.id}`,
      createdAt: offer.starts_at,
    })),
    ...(rewardResults?.data ?? []).map((result) => ({
      id: `result-${result.claim_id}`,
      kind: "reward-result" as const,
      title: result.claim_status === "won" ? "You were selected" : result.claim_status === "lost" ? "Draw result" : "Reward claimed",
      body: result.claim_status === "won"
        ? result.offer_title
        : result.claim_status === "lost"
          ? `The draw for ${result.offer_title} is complete.`
          : `${result.offer_title} was successfully redeemed.`,
      href: "/visitor/rewards?history=offers",
      createdAt: result.result_at ?? new Date(now).toISOString(),
    })),
    ...(supportUpdates?.data ?? []).map((update) => ({
      id: update.notification_id,
      kind: "support-case" as const,
      title: update.status === "resolved" ? "Your report was resolved" : "Your report is being reviewed",
      body: update.resolution_note
        ? `${update.target_name}: ${update.resolution_note}`
        : `${update.target_name}: ${update.status.replaceAll("_", " ")}.`,
      href: "/visitor/support",
      createdAt: update.updated_at,
    })),
    ...(creatorCollaborationUpdates?.data ?? []).map((update) => ({
      id: update.notification_id,
      kind: "creator-programme" as const,
      title: update.title,
      body: update.body,
      href: update.href,
      createdAt: update.created_at,
    })),
  ].sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt));

  addEmailReminder(items, viewer, now);

  const itemReads = items.length
    ? await supabase.from("notification_item_reads").select("notification_id").in("notification_id", items.map((item) => item.id))
    : { data: null, error: null };
  if (itemReads.error) throw new Error("Notification read status is temporarily unavailable.");
  if (offers?.error) throw new Error("Offer notifications are temporarily unavailable.");
  if (rewardResults?.error) throw new Error("Reward result notifications are temporarily unavailable.");
  if (supportUpdates?.error && supportUpdates.error.code !== "PGRST202") throw new Error("Support case notifications are temporarily unavailable.");
  if (creatorCollaborationUpdates?.error) throw new Error("Collaboration notifications are temporarily unavailable.");
  return { items, signedIn: true, userId: viewer.userId, readIds: (itemReads.data ?? []).map((item) => item.notification_id), lastSeenAt: reads.data?.last_seen_at ?? null };
});
