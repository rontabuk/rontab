import type { Metadata } from "next";
import { Suspense } from "react";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { NotificationsCenter } from "@/components/NotificationsCenter";
import { getNotificationFeed } from "@/lib/notifications/feed";

export const metadata: Metadata = { title: "Notifications" };

async function Inbox() {
  const feed = await getNotificationFeed();
  return <NotificationsCenter {...feed} />;
}

export default function NotificationsPage() {
  return <><SiteHeader /><Suspense fallback={<main className="notifications-page page-shell" aria-busy="true">Loading notifications...</main>}><Inbox /></Suspense><SiteFooter /></>;
}