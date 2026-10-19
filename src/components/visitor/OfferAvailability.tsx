"use client";

import { createContext, startTransition, useContext, useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

type Availability = { offer_id: string; remaining_claims: number };
type Snapshot = { availability: Availability[]; version: string };
const AvailabilityContext = createContext<{ remaining: Map<string, number>; londonNow: string }>({ remaining: new Map(), londonNow: "" });

export function OfferAvailabilityProvider({ offerIds, initialAvailability, version, renderedAt, refreshAt, children }: {
  offerIds: string[];
  initialAvailability: Availability[];
  version: string;
  renderedAt: number;
  refreshAt?: number;
  children: ReactNode;
}) {
  const router = useRouter();
  const [live, setLive] = useState<{ snapshot: Snapshot; updatedAt: number } | null>(null);
  const ids = offerIds.join(",");
  const receive = useEffectEvent((snapshot: Snapshot) => {
    setLive({ snapshot, updatedAt: Date.now() });
    if (snapshot.version !== version || (refreshAt !== undefined && Date.now() >= refreshAt)) startTransition(() => router.refresh());
  });
  useEffect(() => {
    if (!ids) return;
    const controller = new AbortController();
    let busy = false;
    async function refresh() {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const response = await fetch(`/api/seller-offer-availability?ids=${encodeURIComponent(ids)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok || controller.signal.aborted) return;
        const payload: unknown = await response.json();
        if (!payload || typeof payload !== "object" || !("version" in payload) || typeof payload.version !== "string"
          || !("availability" in payload) || !Array.isArray(payload.availability)
          || !payload.availability.every((entry: unknown) => entry !== null && typeof entry === "object" && "offer_id" in entry && typeof entry.offer_id === "string"
            && "remaining_claims" in entry && typeof entry.remaining_claims === "number" && Number.isSafeInteger(entry.remaining_claims) && entry.remaining_claims >= 0)) return;
        receive(payload as Snapshot);
      } catch {
        return;
      } finally {
        busy = false;
      }
    }
    const interval = window.setInterval(() => void refresh(), 10_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    void refresh();
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [ids]);
  const snapshot = live && live.updatedAt > renderedAt ? live.snapshot.availability : initialAvailability;
  const now = Math.max(renderedAt, live?.updatedAt ?? 0);
  const londonDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  const londonTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(now));
  return <AvailabilityContext.Provider value={{ remaining: new Map(snapshot.map((entry) => [entry.offer_id, entry.remaining_claims])), londonNow: `${londonDate}T${londonTime}` }}>{children}</AvailabilityContext.Provider>;
}

export function OfferCapacity({ offerId, maximum, remaining: initialRemaining, closesAt, children }: {
  offerId: string;
  maximum: number | null;
  remaining: number | null;
  closesAt: string;
  children: ReactNode;
}) {
  const context = useContext(AvailabilityContext);
  const remaining = context.remaining.get(offerId) ?? initialRemaining;
  const expired = Boolean(context.londonNow && context.londonNow >= closesAt);
  const full = maximum !== null && remaining === 0;
  const unavailable = maximum !== null && remaining === null;
  const used = maximum !== null && remaining !== null ? Math.max(0, Math.min(maximum, maximum - remaining)) : 0;
  return <div className="seller-offer-capacity">
    {maximum !== null && <div className="seller-offer-capacity-summary" role="status">
      <div><strong>{used} of {maximum} reserved</strong><span>{expired ? "Offer ended" : full ? "Fully reserved" : remaining === null ? "Availability unavailable" : `${remaining} remaining`}</span></div>
      <progress max={maximum} value={used} aria-label={`${used} of ${maximum} vouchers reserved`} />
    </div>}
    <fieldset className="seller-offer-capacity-booking" disabled={expired || full || unavailable} aria-label="Offer reservations">{children}</fieldset>
  </div>;
}