"use client";

import { useEffect, useEffectEvent, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { markNotificationItemsRead } from "@/lib/notifications/actions";
import type { SiteNotification } from "@/lib/notifications/feed";
import { getNotificationChannel, type NotificationChannel } from "@/lib/notifications/channels";

const readEvent = "rontab:notification-reads-changed";
const legacyGuestKey = "rontab:notifications-seen-at";
const emptySnapshot = '["[]",null]';

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(readEvent, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(readEvent, onChange);
  };
}

function parseIds(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function useNotificationReads({ userId, readIds, lastSeenAt, autoReadId, items = [], unreadCounts }: {
  userId: string | null;
  readIds: string[];
  lastSeenAt: string | null;
  autoReadId?: string;
  items?: SiteNotification[];
  unreadCounts?: Record<NotificationChannel, number>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState<{ userId: string | null; ids: string[] }>({ userId, ids: [] });
  const storageKey = `rontab:notification-reads:v1:${userId ?? "guest"}`;
  const snapshot = useSyncExternalStore(subscribe, () => {
    try {
      return JSON.stringify([localStorage.getItem(storageKey) ?? "[]", userId ? null : localStorage.getItem(legacyGuestKey)]);
    } catch {
      return emptySnapshot;
    }
  }, () => emptySnapshot);
  const [rawIds, guestLastSeenAt] = JSON.parse(snapshot) as [string, string | null];
  const savedIds = new Set([...readIds, ...parseIds(rawIds), ...(confirmed.userId === userId ? confirmed.ids : [])]);
  const baseline = userId ? lastSeenAt : guestLastSeenAt;
  const isUnread = (item: SiteNotification) => (item.kind === "verify-email" && !item.completed) || (
    !savedIds.has(item.id) && (!baseline || Date.parse(item.createdAt) > Date.parse(baseline))
  );

  const getUnreadCount = (channel: NotificationChannel) => {
    const channelItems = items.filter((item) => getNotificationChannel(item) === channel);
    if (!unreadCounts) return channelItems.filter(isUnread).length;
    const localReads = channelItems.filter((item) => item.kind !== "verify-email" && !readIds.includes(item.id) && savedIds.has(item.id)).length;
    const reminders = channelItems.filter((item) => item.kind === "verify-email" && isUnread(item)).length;
    return Math.max(0, unreadCounts[channel] - localReads) + reminders;
  };

  async function markRead(ids: string[]) {
    const requestedIds = [...new Set(ids)].filter((id) => !id.startsWith("verify-email-") && !savedIds.has(id));
    if (!requestedIds.length) return true;
    setSaving(true);
    setError(null);
    try {
      const confirmedIds: string[] = [];
      for (let offset = 0; offset < requestedIds.length; offset += 100) {
        const batch = requestedIds.slice(offset, offset + 100);
        const result = userId ? await markNotificationItemsRead(batch, userId) : { error: null, readIds: batch };
        if (result.error) {
          setError(result.error);
          if (userId) router.refresh();
          return false;
        }
        confirmedIds.push(...result.readIds);
      }
      setConfirmed((current) => ({ userId, ids: [...new Set([...(current.userId === userId ? current.ids : []), ...confirmedIds])] }));
      try {
        const current = parseIds(localStorage.getItem(storageKey) ?? "[]");
        localStorage.setItem(storageKey, JSON.stringify([...new Set([...current, ...confirmedIds])].slice(-1000)));
        window.dispatchEvent(new Event(readEvent));
      } catch {
        if (!userId) {
          setError("Your browser couldn't save notification read status. Allow browser storage and try again.");
          return false;
        }
      }
      if (userId) router.refresh();
      return true;
    } catch {
      setError("We couldn't save notification read status. Please try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  const readSelected = useEffectEvent(() => {
    if (autoReadId) void markRead([autoReadId]);
  });
  useEffect(() => {
    let active = true;
    if (autoReadId) queueMicrotask(() => {
      if (active) readSelected();
    });
    return () => { active = false; };
  }, [autoReadId]);

  return { isUnread, getUnreadCount, markRead, error, saving };
}