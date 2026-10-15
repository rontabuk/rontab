"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function markNotificationItemsRead(notificationIds: string[], expectedUserId: string): Promise<{ error: string | null; readIds: string[] }> {
  const failure = { error: "We couldn't save notification read status. Please try again.", readIds: [] };
  const notificationIdPattern = /^(?:(announcement|product|offer|result|creator-request|creator-response|creator-event)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|support-(marketplace|reward|voucher)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9]{16})$/;
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
