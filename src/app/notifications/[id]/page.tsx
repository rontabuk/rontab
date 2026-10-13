import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { NotificationsCenter } from "@/components/NotificationsCenter";
import { getNotificationFeed } from "@/lib/notifications/feed";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type NotificationRouteProps = { params: Promise<{ id: string }> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = { title: "Notification" };

async function NotificationContent({ params }: NotificationRouteProps) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();

  const supabase = await createSupabaseServerClient();
  const [result, feed] = await Promise.all([supabase
    .from("site_announcements")
    .select("id,title,body,link_url,created_at")
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle(), getNotificationFeed()]);
  const announcement = result.data;
  if (!announcement) notFound();
  return <NotificationsCenter {...feed} message={announcement} />;
}

export default function NotificationRoute({ params }: NotificationRouteProps) {
  return (
    <><SiteHeader /><Suspense fallback={<main className="notifications-page page-shell" aria-busy="true">Loading notification...</main>}>
      <NotificationContent params={params} />
    </Suspense><SiteFooter /></>
  );
}
