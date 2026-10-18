import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteChrome";
import { NotificationsCenter } from "@/components/NotificationsCenter";
import { getNotificationFeed } from "@/lib/notifications/feed";
import { getViewer } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type NotificationRouteProps = { params: Promise<{ id: string }> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = { title: "Notification" };

async function NotificationContent({ params }: NotificationRouteProps) {
  await connection();
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();

  const supabase = await createSupabaseServerClient();
  const viewer = await getViewer();
  if (viewer.role !== "guest") {
    const saved = await supabase.from("notification_events")
      .select("title,body,link_url,created_at")
      .eq("notification_id", `announcement-${id}`)
      .maybeSingle();
    if (saved.error && saved.error.code !== "42P01" && saved.error.code !== "PGRST205") throw new Error("Your message is temporarily unavailable.");
    if (saved.data) {
      const feed = await getNotificationFeed();
      return <NotificationsCenter {...feed} message={{ ...saved.data, id }} />;
    }
  }
  const [result, feed] = await Promise.all([supabase
    .from("site_announcements")
    .select("id,title,body,link_url,created_at,audience")
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle(), getNotificationFeed()]);
  const announcement = result.data;
  if (!announcement) notFound();
  const canRead = viewer.role === "admin"
    || announcement.audience === "everyone"
    || (viewer.role === "visitor" && announcement.audience === "visitors")
    || (viewer.role === "seller" && announcement.audience === "sellers");
  if (!canRead) notFound();
  if (viewer.role !== "guest" && viewer.role !== "admin" && Date.parse(announcement.created_at) < Date.parse(viewer.createdAt)) notFound();
  return <NotificationsCenter {...feed} message={announcement} />;
}

export default function NotificationRoute({ params }: NotificationRouteProps) {
  return (
    <><SiteHeader /><Suspense fallback={<main className="notifications-page page-shell" aria-busy="true">Loading notification...</main>}>
      <NotificationContent params={params} />
    </Suspense></>
  );
}
