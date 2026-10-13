import { getNotificationFeed } from "@/lib/notifications/feed";
import { NotificationBellMenu } from "@/components/NotificationBellMenu";

export async function NotificationBell() {
  const feed = await getNotificationFeed();
  return <NotificationBellMenu {...feed} />;
}
