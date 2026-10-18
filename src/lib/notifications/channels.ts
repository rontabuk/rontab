import type { SiteNotification } from "@/lib/notifications/feed";

export type NotificationChannel = "messages" | "ads";

const channels: Record<SiteNotification["kind"], NotificationChannel> = {
  announcement: "messages",
  "verify-email": "messages",
  "support-case": "messages",
  "collaboration-request": "messages",
  "creator-programme": "messages",
  "reward-result": "messages",
  "new-product": "ads",
  welcome: "messages",
  "loyalty-offer": "ads",
};

export function getNotificationChannel(item: Pick<SiteNotification, "kind">): NotificationChannel {
  return channels[item.kind];
}