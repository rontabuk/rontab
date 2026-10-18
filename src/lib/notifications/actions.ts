"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/auth/viewer";
import { notificationPage, type NotificationCursor, type NotificationPage } from "@/lib/notifications/feed";
import type { NotificationChannel } from "@/lib/notifications/channels";

export async function loadMoreNotifications(channel: NotificationChannel, cursor: NotificationCursor, expectedUserId: string): Promise<{ error: string | null; page: NotificationPage | null }> {
  const failure = { error: "We couldn't load more notifications. Please try again.", page: null };
  if (!["messages", "ads"].includes(channel) || !cursor || typeof cursor.createdAt !== "string" || !Number.isFinite(Date.parse(cursor.createdAt)) || typeof cursor.id !== "string" || !cursor.id || cursor.id.length > 200) return failure;
  try {
    const viewer = await getViewer();
    if (viewer.role === "guest" || viewer.userId !== expectedUserId) return failure;
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_notification_inbox", { p_channel: channel, p_before_time: cursor.createdAt, p_before_id: cursor.id, p_limit: 21 });
    if (error) return failure;
    return { error: null, page: notificationPage(data ?? []) };
  } catch {
    return failure;
  }
}

export async function markNotificationItemsRead(notificationIds: string[], expectedUserId: string): Promise<{ error: string | null; readIds: string[] }> {
  const failure = { error: "We couldn't save notification read status. Please try again.", readIds: [] };
  const notificationIdPattern = /^(?:(welcome|announcement|product|offer|result|creator-request|creator-response|creator-event)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|support-(marketplace|reward|voucher)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9]{16})$/;
  if (!Array.isArray(notificationIds) || notificationIds.length < 1 || notificationIds.length > 100 || notificationIds.some((id) => typeof id !== "string" || !notificationIdPattern.test(id))) return failure;
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user || user.id !== expectedUserId) return failure;
    const { data, error } = await supabase.rpc("mark_notification_items_read", { p_notification_ids: [...new Set(notificationIds)] });
    if (error || !data) return failure;
    return { error: null, readIds: data };
  } catch {
    return failure;
  }
}
