import { createSupabasePublicClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";
import { getOfferAvailabilityVersion } from "@/lib/seller/offer-policy";

export async function GET(request: Request) {
  const value = new URL(request.url).searchParams.get("ids") ?? "";
  const ids = [...new Set(value.split(","))];
  const headers = { "Cache-Control": "no-store" };
  if (value.length > 2220 || ids.length < 1 || ids.length > 60 || ids.some((id) => !isUuid(id))) {
    return Response.json({ error: "Invalid offer IDs." }, { status: 400, headers });
  }
  const supabase = createSupabasePublicClient();
  const [totals, daily] = await Promise.all([
    supabase.rpc("get_public_seller_offer_availability", { p_offer_ids: ids }),
    supabase.rpc("get_public_seller_offer_daily_availability", { p_offer_ids: ids }),
  ]);
  if (totals.error || daily.error) return Response.json({ error: "Availability unavailable." }, { status: 503, headers });
  return Response.json({ availability: totals.data ?? [], version: getOfferAvailabilityVersion(totals.data ?? [], daily.data ?? []) }, { headers });
}