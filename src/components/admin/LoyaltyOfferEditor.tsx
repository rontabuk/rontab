"use client";

import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { saveLoyaltyOffer } from "@/app/admin/(protected)/actions";
import { CityPicker, type SupportedCity, type SupportedCountry } from "@/components/CityPicker";
import { formatNumber } from "@/lib/format";
import type { Database } from "@/lib/supabase/database.types";

type Offer = Database["public"]["Tables"]["loyalty_offers"]["Row"];
type CityQuota = { city_id: string; city: string; admin_name: string; country_code: string; capacity: number };

export function LoyaltyOfferEditor({ offer, countries, cities }: { offer: (Offer & { cityQuotas: CityQuota[] }) | null; countries: SupportedCountry[]; cities: SupportedCity[] }) {
  const [offerType, setOfferType] = useState<"participation" | "redemption">(offer?.offer_type ?? "redemption");
  const [selectionMethod, setSelectionMethod] = useState<"random" | "first_come">(offer?.selection_method ?? "random");
  const [cityQuotas, setCityQuotas] = useState<CityQuota[]>(() => offer?.cityQuotas ?? []);
  const [globalCapacity, setGlobalCapacity] = useState(offer?.capacity ?? 5);
  const [startsAt, setStartsAt] = useState(() => offer ? toLocalInput(offer.starts_at) : "");
  const [endsAt, setEndsAt] = useState(() => offer ? toLocalInput(offer.ends_at) : "");
  const assignedCapacity = cityQuotas.reduce((total, quota) => total + quota.capacity, 0);

  async function submitOffer(formData: FormData) {
    formData.set("global_capacity", String(globalCapacity));
    formData.set("city_quotas", JSON.stringify(cityQuotas));
    formData.set("starts_at", startsAt);
    formData.set("starts_at_offset", String(new Date(startsAt).getTimezoneOffset()));
    formData.set("ends_at", endsAt);
    formData.set("ends_at_offset", String(new Date(endsAt).getTimezoneOffset()));
    await saveLoyaltyOffer(formData);
  }

  return (
    <form className="admin-loyalty-offer-form" action={submitOffer}>
      {offer && <input type="hidden" name="offer_id" value={offer.id} />}
      <div className="admin-loyalty-offer-form-heading">
        <div><p className="admin-eyebrow">{offer ? "EDIT DRAFT" : "NEW DRAFT"}</p><h2>{offer ? "Update offer details" : "Create a rewards offer"}</h2></div>
        {offer && <Link href="/admin/rewards">Create another offer</Link>}
      </div>
      <div className="admin-loyalty-form-grid">
        <label className="is-wide">Offer title<input name="title" defaultValue={offer?.title ?? ""} maxLength={120} required /></label>
        <label className="is-wide">Short description<input name="summary" defaultValue={offer?.summary ?? ""} maxLength={240} required /></label>
        <label className="is-wide">Offer details<textarea name="description" defaultValue={offer?.description ?? ""} maxLength={2000} rows={3} /></label>
        <label className="is-wide">Image URL (HTTPS)<input name="image_url" type="url" defaultValue={offer?.image_url ?? ""} placeholder="https://" required /></label>
        <label>Offer type
          <select name="offer_type" value={offerType} onChange={(event) => {
            const nextType = event.target.value as "participation" | "redemption";
            setOfferType(nextType);
            if (nextType === "redemption") setSelectionMethod("first_come");
            else if (selectionMethod === "first_come") setSelectionMethod("random");
          }}>
            <option value="redemption">Guaranteed redemption</option>
            <option value="participation">Limited participation</option>
          </select>
        </label>
        <label>Selection method
          <select name="selection_method" value={offerType === "redemption" ? "first_come" : selectionMethod} onChange={(event) => setSelectionMethod(event.target.value as "random" | "first_come")} disabled={offerType === "redemption"}>
            <option value="random">Random selection</option>
            <option value="first_come">First eligible claims</option>
          </select>
        </label>
        {offerType === "redemption" && <input type="hidden" name="selection_method" value="first_come" />}
        <label>Minimum points for eligibility<input name="minimum_points" type="number" min="0" max="1000000" step="1" defaultValue={offer?.minimum_points ?? 1000} required /></label>
        <label>Points spent to enter or redeem<input name="points_cost" type="number" min="1" max="1000000" step="1" defaultValue={offer?.points_cost ?? 1000} required /></label>
        <label>Starts in your local time<input name="starts_at_local" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required /></label>
        <label>Ends in your local time<input name="ends_at_local" type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required /></label>
        <label className="is-wide">Terms and fulfilment details<textarea name="terms" defaultValue={offer?.terms ?? ""} maxLength={5000} rows={4} required /></label>
      </div>
      <section className="admin-city-quotas" aria-labelledby="city-quotas-title">
        <div className="admin-city-quotas-heading">
          <div><h3 id="city-quotas-title">City allocations</h3><p>Set a separate gift or winner quota for each city. The offer total is the sum of these sliders.</p></div>
          <span>Total: {formatNumber(cityQuotas.length ? assignedCapacity : globalCapacity)}</span>
        </div>
        {cityQuotas.length === 0 ? (
          <label className="admin-global-capacity">
            <span>All locations</span>
            <input type="range" min="1" max="100000" step="1" value={globalCapacity} onChange={(event) => setGlobalCapacity(Number(event.target.value))} aria-label="Capacity for all locations" />
            <output>{formatNumber(globalCapacity)} gifts or winners</output>
          </label>
        ) : (
          <div className="admin-city-quota-list">
            {cityQuotas.map((quota, index) => (
              <div className="admin-city-quota-row" key={`${index}-${quota.city_id}`}>
                <div className="admin-city-quota-fields">
                  <CityPicker
                    name={`city_id_${index}`}
                    countries={countries}
                    cities={cities}
                    initialCity={quota.city_id ? {
                      city_id: quota.city_id,
                      city_name: quota.city,
                      city_ascii: quota.city,
                      admin_name: quota.admin_name,
                      country_code: quota.country_code,
                    } satisfies SupportedCity : null}
                    initialCountryCode={quota.country_code || countries[0]?.country_code || null}
                    required
                    onSelect={(city) => setCityQuotas((current) => current.map((item, itemIndex) => itemIndex === index ? {
                      ...item,
                      city_id: city?.city_id ?? "",
                      city: city?.city_name ?? "",
                      admin_name: city?.admin_name ?? "",
                      country_code: city?.country_code ?? "GB",
                    } : item))}
                  />
                  <button className="admin-city-quota-remove" type="button" aria-label={`Remove ${quota.city || "city"} allocation`} onClick={() => setCityQuotas((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} aria-hidden="true" /></button>
                </div>
                <label className="admin-city-quota-slider">
                  <span>{quota.city || "City"} allocation</span>
                  <input type="range" min="1" max="100000" step="1" value={quota.capacity} onChange={(event) => setCityQuotas((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, capacity: Number(event.target.value) } : item))} aria-label={`${quota.city || "City"} gifts or winners`} />
                  <output>{formatNumber(quota.capacity)}</output>
                </label>
              </div>
            ))}
          </div>
        )}
        <button className="admin-city-quota-add" type="button" disabled={cityQuotas.length >= 50} onClick={() => setCityQuotas((current) => [...current, { city_id: "", city: "", admin_name: "", country_code: countries[0]?.country_code ?? "GB", capacity: 1 }])}>
          <Plus size={14} aria-hidden="true" /> Add a city allocation
        </button>
        <p className="admin-loyalty-location-note">Leave cities empty for one shared capacity available everywhere. City-specific capacity is ring-fenced for that city.</p>
      </section>
      {offerType === "participation" && (
        <p className="admin-loyalty-draw-note">Entries spend their stated points whether selected or not. Random offers stay hidden until random draws are enabled and the offer is published.</p>
      )}
      {offerType === "redemption" && (
        <p className="admin-loyalty-draw-note">Redemption is guaranteed while capacity remains. Points are spent only when the visitor confirms a successful claim.</p>
      )}
      <button className="admin-primary-button" type="submit"><SaveOfferLabel label={offer ? "Save draft" : "Create draft"} /></button>
    </form>
  );
}

function SaveOfferLabel({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return pending ? "Saving…" : label;
}

function toLocalInput(value: string) {
  const date = new Date(value);
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}