"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { markNotificationItemsRead } from "@/lib/notifications/actions";

export function OfferNotificationReadMarker({ userId, notificationIds }: { userId: string; notificationIds: string[] }) {
  const router = useRouter();

  useEffect(() => {
    let active = true;
    void markNotificationItemsRead(notificationIds, userId).then((result) => {
      if (active && !result.error) router.refresh();
    });
    return () => { active = false; };
  }, [notificationIds, router, userId]);

  return null;
}