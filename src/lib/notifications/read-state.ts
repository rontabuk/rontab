"use client";

import { useEffect, useEffectEvent, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { markNotificationItemsRead } from "@/lib/notifications/actions";
import type { SiteNotification } from "@/lib/notifications/feed";

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

export function useNotificationReads({ userId, readIds, lastSeenAt, autoReadId }: {
  userId: string | null;
  readIds: string[];
  lastSeenAt: string | null;
  autoReadId?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const storageKey = `rontab:notification-reads:v1:${userId ?? "guest"}`;
  const snapshot = useSyncExternalStore(subscribe, () => {
    try {
      return JSON.stringify([localStorage.getItem(storageKey) ?? "[]", userId ? null : localStorage.getItem(legacyGuestKey)]);
    } catch {
      return emptySnapshot;
    }
  }, () => emptySnapshot);
  const [rawIds, guestLastSeenAt] = JSON.parse(snapshot) as [string, string | null];
  const savedIds = new Set([...readIds, ...parseIds(rawIds)]);
  const baseline = userId ? lastSeenAt : guestLastSeenAt;
  const isUnread = (item: SiteNotification) => (item.kind === "verify-email" && !item.completed) || (
    !savedIds.has(item.id) && (!baseline || Date.parse(item.createdAt) > Date.parse(baseline))
  );

  async function markRead(ids: string[]) {
    const requestedIds = [...new Set(ids)].filter((id) => !id.startsWith("verify-email-") && !savedIds.has(id));
    if (!requestedIds.length) return true;
    setSaving(true);
    setError(null);
    try {
      const result = userId ? await markNotificationItemsRead(requestedIds, userId) : { error: null, readIds: requestedIds };
      if (result.error) {
        setError(result.error);
        return false;
      }
      try {
        const current = parseIds(localStorage.getItem(storageKey) ?? "[]");
        localStorage.setItem(storageKey, JSON.stringify([...new Set([...current, ...result.readIds])].slice(-1000)));
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

  return { isUnread, markRead, error, saving };
}