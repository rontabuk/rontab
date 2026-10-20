"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The confirmation link may be opened on another device, so re-check while this page stays open.
export function EmailConfirmationWatcher() {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const interval = window.setInterval(refresh, 15_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);
  return null;
}
