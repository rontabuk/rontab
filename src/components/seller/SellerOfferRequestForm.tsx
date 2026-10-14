"use client";

import { useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { CityPicker, type LocationRegistrationCount, type SupportedCity, type SupportedCountry } from "@/components/CityPicker";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isCityId, isHttpsUrl, isUuid } from "@/lib/validation";

type BranchDraft = { id: string; city: SupportedCity | null; name: string; address: string };
type EditableRequest = {
  id: string;
  offer_kind: string;
  title: string;
  description: string;
  benefit_details: string;
  discount_percent: number | null;
  media_storage_path: string | null;
  media_url: string | null;
  media_preview_url: string | null;
  media_type: string | null;
  valid_from: string;
  valid_until: string;
  capacity_acknowledged: boolean;
  locations: { id: string; city_id: string; branch_name: string; branch_address: string | null; schedules: { weekday: number; starts_at: string; ends_at: string; requested_daily_capacity: number }[] }[];
};

const weekDays = [
  [0, "Sunday"], [1, "Monday"], [2, "Tuesday"], [3, "Wednesday"], [4, "Thursday"], [5, "Friday"], [6, "Saturday"],
] as const;
const offerMediaTypes: Record<string, { extension: string; kind: "image" | "video" }> = {
  "image/jpeg": { extension: "jpg", kind: "image" },
  "image/png": { extension: "png", kind: "image" },
  "image/webp": { extension: "webp", kind: "image" },
  "video/mp4": { extension: "mp4", kind: "video" },
  "video/webm": { extension: "webm", kind: "video" },
};
const MAX_OFFER_MEDIA_BYTES = 50 * 1024 * 1024;

export function SellerOfferRequestForm({
  requestId,
  sellerId,
  initialRequest,
  countries,
  cities,
  registrationCounts,
  tomorrow,
  endDate,
}: {
  requestId: string;
  sellerId: string;
  initialRequest: EditableRequest | null;
  countries: SupportedCountry[];
  cities: SupportedCity[];
  registrationCounts: LocationRegistrationCount[];
  tomorrow: string;
  endDate: string;
}) {
  const router = useRouter();
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const [branches, setBranches] = useState<BranchDraft[]>(() => initialRequest
    ? initialRequest.locations.map((location) => ({
      id: location.id,
      city: cities.find((city) => city.city_id === location.city_id) ?? null,
      name: location.branch_name,
      address: location.branch_address ?? "",
    }))
    : [{ id: "branch-0", city: null, name: "", address: "" }]);
  const firstSchedule = initialRequest?.locations[0]?.schedules ?? [];
  const [selectedDays, setSelectedDays] = useState<number[]>(() => initialRequest
    ? [...new Set(firstSchedule.map((schedule) => schedule.weekday))]
    : [0, 1, 2, 3, 4, 5, 6]);
  const [mediaUrl, setMediaUrl] = useState(initialRequest?.media_url ?? "");
  const [mediaStoragePath, setMediaStoragePath] = useState(initialRequest?.media_storage_path ?? "");
  const [mediaType, setMediaType] = useState(initialRequest?.media_type ?? "image");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const serializedBranches = JSON.stringify(branches.map((branch) => ({
    city_id: branch.city?.city_id ?? "",
    branch_name: branch.name,
    branch_address: branch.address,
  })));

  function updateBranch(id: string, values: Partial<Omit<BranchDraft, "id">>) {
    setBranches((current) => current.map((branch) => branch.id === id ? { ...branch, ...values } : branch));
  }

  function toggleDay(day: number, checked: boolean) {
    setSelectedDays((current) => checked
      ? [...current, day].sort((first, second) => first - second)
      : current.filter((selectedDay) => selectedDay !== day));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setMessage("");

    const formData = new FormData(event.currentTarget);
    const title = String(formData.get("title") ?? "").trim();
    const offerKind = String(formData.get("offer_kind") ?? "");
    const description = String(formData.get("description") ?? "").trim();
    const benefitDetails = String(formData.get("benefit_details") ?? "").trim();
    const discountValue = String(formData.get("discount_percent") ?? "").trim();
    const selectedMediaType = String(formData.get("media_type") ?? "");
    const validFrom = String(formData.get("valid_from") ?? "");
    const validUntil = String(formData.get("valid_until") ?? "");
    const startsAt = String(formData.get("starts_at") ?? "");
    const endsAt = String(formData.get("ends_at") ?? "");
    const dailyCapacity = Number(formData.get("daily_capacity"));
    const capacityAcknowledged = formData.get("capacity_acknowledged") === "on";
    const weekdays = [...new Set(formData.getAll("weekday").map(Number))];
    const fileValue = formData.get("media_file");
    const mediaFile = fileValue instanceof File && fileValue.size > 0 ? fileValue : null;
    const mediaFileType = mediaFile ? offerMediaTypes[mediaFile.type] : null;
    const discountPercent = discountValue ? Number(discountValue) : null;
    const requestLocations = branches.map((branch) => ({
      city_id: branch.city?.city_id ?? "",
      branch_name: branch.name.trim(),
      branch_address: branch.address.trim(),
      schedules: weekdays.map((weekday) => ({ weekday, starts_at: startsAt, ends_at: endsAt, daily_capacity: dailyCapacity })),
    }));
    const dateIsValid = (value: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const parsed = new Date(`${value}T00:00:00Z`);
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    };

    if (!isUuid(requestId) || !isUuid(sellerId)
      || !["discount", "meal", "free_item", "other"].includes(offerKind)
      || title.length < 3 || title.length > 120
      || description.length < 10 || description.length > 2000
      || benefitDetails.length < 3 || benefitDetails.length > 1000
      || (discountPercent !== null && (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 100))
      || (offerKind === "discount" && discountPercent === null)
      || (!mediaFile && !mediaUrl && !mediaStoragePath)
      || (!mediaFile && mediaUrl && (!isHttpsUrl(mediaUrl) || mediaUrl.length > 2048))
      || (!mediaFile && mediaUrl && mediaStoragePath)
      || (mediaFile && (!mediaFileType || mediaFile.size > MAX_OFFER_MEDIA_BYTES || mediaFileType.kind !== selectedMediaType))
      || (!mediaFile && !["image", "video"].includes(selectedMediaType))
      || !dateIsValid(validFrom) || !dateIsValid(validUntil) || validUntil < validFrom
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startsAt) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endsAt) || endsAt <= startsAt
      || !Number.isSafeInteger(dailyCapacity) || dailyCapacity < 1 || dailyCapacity > 1000
      || weekdays.length < 1 || weekdays.some((weekday) => !Number.isInteger(weekday) || weekday < 0 || weekday > 6)
      || !capacityAcknowledged
      || requestLocations.some((location) => !isCityId(location.city_id) || location.branch_name.length < 2 || location.branch_name.length > 100 || location.branch_address.length > 300)
      || new Set(requestLocations.map((location) => `${location.city_id}:${location.branch_name.toLowerCase()}`)).size !== requestLocations.length
    ) {
      setMessage(mediaFile && (!mediaFileType || mediaFile.size > MAX_OFFER_MEDIA_BYTES || mediaFileType.kind !== selectedMediaType)
        ? "Choose a matching image/video type and a file no larger than 50 MB."
        : "Check the offer details, media, locations, schedule, and daily capacity.");
      return;
    }

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setMessage("Offer submission is temporarily unavailable.");
      return;
    }

    setIsSubmitting(true);
    let submittedMediaPath = mediaStoragePath;
    const payload = {
      offer_kind: offerKind,
      title,
      description,
      benefit_details: benefitDetails,
      discount_percent: discountPercent,
      media_url: mediaUrl || null,
      media_storage_path: mediaStoragePath || null,
      media_type: mediaUrl || mediaStoragePath ? selectedMediaType : null,
      valid_from: validFrom,
      valid_until: validUntil,
      capacity_acknowledged: capacityAcknowledged,
      locations: requestLocations,
    };

    if (mediaFile && mediaFileType) {
      const { error: draftError } = await supabase.rpc("seller_save_offer_request", {
        p_request_id: requestId,
        p_payload: payload,
        p_submit: false,
      });
      if (draftError) {
        setMessage("Your draft could not be saved. Check the branch and schedule details, then try again.");
        setIsSubmitting(false);
        return;
      }

      const safeFileName = mediaFile.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const storagePath = `${sellerId}/${requestId}/${crypto.randomUUID()}-${safeFileName || `offer.${mediaFileType.extension}`}`;
      const { error: uploadError } = await supabase.storage.from("seller-offer-media").upload(storagePath, mediaFile, {
        cacheControl: "3600",
        contentType: mediaFile.type,
        upsert: false,
      });
      if (uploadError) {
        setMessage("The offer media could not be uploaded. Your request remains a draft; try another file.");
        setIsSubmitting(false);
        return;
      }
      const payloadWithMedia = { ...payload, media_url: null, media_storage_path: storagePath, media_type: mediaFileType.kind };
      const { error: mediaDraftError } = await supabase.rpc("seller_save_offer_request", {
        p_request_id: requestId,
        p_payload: payloadWithMedia,
        p_submit: false,
      });
      if (mediaDraftError) {
        await supabase.storage.from("seller-offer-media").remove([storagePath]);
        setMessage("The offer media could not be attached to this request. Try again.");
        setIsSubmitting(false);
        return;
      }
      const oldStoragePath = mediaStoragePath;
      if (oldStoragePath && oldStoragePath !== storagePath) {
        await supabase.storage.from("seller-offer-media").remove([oldStoragePath]);
      }
      setMediaUrl("");
      setMediaStoragePath(storagePath);
      submittedMediaPath = storagePath;
      setMediaType(mediaFileType.kind);
      if (mediaInputRef.current) mediaInputRef.current.value = "";
    }

    const { error } = await supabase.rpc("seller_save_offer_request", {
      p_request_id: requestId,
      p_payload: {
        ...payload,
        media_url: mediaFile ? null : mediaUrl || null,
        media_storage_path: submittedMediaPath || null,
        media_type: mediaFile ? mediaFileType?.kind ?? selectedMediaType : selectedMediaType,
      },
      p_submit: true,
    });
    if (error) {
      setMessage(error.code === "55000" || error.code === "22023"
        ? error.message
        : "The request could not be submitted. Your saved draft is still available to edit.");
      setIsSubmitting(false);
      return;
    }

    router.push("/seller/offers?submitted=1");
    router.refresh();
  }

  return (
    <form className="seller-product-form seller-offer-request-form" onSubmit={handleSubmit} aria-busy={isSubmitting}>
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="locations" value={serializedBranches} />
      <label>
        Offer title
        <input name="title" defaultValue={initialRequest?.title ?? ""} minLength={3} maxLength={120} required placeholder="Half-price lunch for the first five guests" />
      </label>
      <label>
        Offer type
        <select name="offer_kind" required defaultValue={initialRequest?.offer_kind ?? "discount"}>
          <option value="discount">Discount</option>
          <option value="meal">Meal or set menu</option>
          <option value="free_item">Free item</option>
          <option value="other">Other benefit</option>
        </select>
      </label>
      <label className="seller-product-description">
        What is included
        <textarea name="description" defaultValue={initialRequest?.description ?? ""} minLength={10} maxLength={2000} required rows={4} placeholder="Describe eligible products, meals, and any exclusions." />
      </label>
      <label className="seller-product-description">
        Customer benefit
        <textarea name="benefit_details" defaultValue={initialRequest?.benefit_details ?? ""} minLength={3} maxLength={1000} required rows={3} placeholder="State the exact discount or item the customer receives." />
      </label>
      <label>
        Discount percentage
        <input name="discount_percent" type="number" min="0.01" max="100" step="0.01" defaultValue={initialRequest?.discount_percent ?? ""} placeholder="50" />
        <small>Required for discount offers. Other offer types may leave this blank.</small>
      </label>
      <label>
        Offer media type
        <select name="media_type" required value={mediaType} onChange={(event) => setMediaType(event.target.value)}>
          <option value="image">Image</option>
          <option value="video">Video</option>
        </select>
      </label>
      <label className="seller-product-description">
        <input
          ref={mediaInputRef}
          name="media_file"
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
          onChange={(event) => {
            const selectedFile = event.target.files?.[0];
            const selectedMedia = selectedFile ? offerMediaTypes[selectedFile.type] : null;
            if (selectedMedia) {
              setMediaUrl("");
              setMediaType(selectedMedia.kind);
            }
          }}
        />
        <small>JPEG, PNG, WebP, MP4, or WebM. Maximum 50 MB.</small>
      </label>
      {initialRequest?.media_preview_url && <div className="seller-offer-media-preview">
        {initialRequest.media_type === "video"
          ? <video src={initialRequest.media_preview_url} controls preload="metadata" aria-label="Current offer video" />
          : <Image src={initialRequest.media_preview_url} alt="Current offer" width={260} height={180} unoptimized />}
        <span>Current offer media</span>
      </div>}
      <label className="seller-product-description">
        Or use an HTTPS media URL
        <input name="media_url" type="url" value={mediaUrl} onChange={(event) => setMediaUrl(event.target.value)} placeholder="https://…" />
      </label>
      <label>
        First offer date
        <input name="valid_from" type="date" min={tomorrow} defaultValue={initialRequest?.valid_from ?? tomorrow} required />
      </label>
      <label>
        Last offer date
        <input name="valid_until" type="date" min={tomorrow} defaultValue={initialRequest?.valid_until ?? endDate} required />
      </label>

      <section className="seller-offer-branches" aria-labelledby="seller-offer-branches-title">
        <div className="seller-profile-section-heading">
          <h2 id="seller-offer-branches-title">Branches</h2>
          <p>Add each participating branch. The proposed schedule and daily quota apply to every branch.</p>
        </div>
        {branches.map((branch, index) => (
          <fieldset className="seller-offer-branch" key={branch.id}>
            <legend>Branch {index + 1}</legend>
            <label>
              Branch name
              <input value={branch.name} onChange={(event) => updateBranch(branch.id, { name: event.target.value })} maxLength={100} required />
            </label>
            <label>
              Branch address
              <input value={branch.address} onChange={(event) => updateBranch(branch.id, { address: event.target.value })} maxLength={300} />
            </label>
            <CityPicker
              name={`branch-${branch.id}-city`}
              countries={countries}
              cities={cities}
              userCounts={registrationCounts}
              initialCity={null}
              initialCountryCode="GB"
              required
              onSelect={(city) => updateBranch(branch.id, { city })}
            />
            {branches.length > 1 && (
              <button className="seller-offer-remove-branch" type="button" onClick={() => setBranches((current) => current.filter((item) => item.id !== branch.id))}>
                <Trash2 size={15} aria-hidden="true" /> Remove branch
              </button>
            )}
          </fieldset>
        ))}
        <button className="admin-approve-button seller-offer-add-branch" type="button" onClick={() => setBranches((current) => current.length < 20 ? [...current, { id: crypto.randomUUID(), city: null, name: "", address: "" }] : current)} disabled={branches.length >= 20}>
          <Plus size={15} aria-hidden="true" /> Add branch
        </button>
      </section>

      <fieldset className="seller-offer-schedule">
        <legend>Weekly schedule and daily quota</legend>
        <div className="seller-offer-days" aria-label="Days the offer is available">
          {weekDays.map(([day, label]) => (
            <label key={day}>
              <input name="weekday" type="checkbox" value={day} checked={selectedDays.includes(day)} onChange={(event) => toggleDay(day, event.target.checked)} />
              {label}
            </label>
          ))}
        </div>
        <label>
          Starts at (UK local time)
          <input name="starts_at" type="time" defaultValue={firstSchedule[0]?.starts_at.slice(0, 5) ?? "12:00"} required />
        </label>
        <label>
          Ends at (UK local time)
          <input name="ends_at" type="time" defaultValue={firstSchedule[0]?.ends_at.slice(0, 5) ?? "15:00"} required />
        </label>
        <label>
          Proposed vouchers per day
          <input name="daily_capacity" type="number" min="1" max="1000" defaultValue={firstSchedule[0]?.requested_daily_capacity ?? 5} required />
        </label>
      </fieldset>
      <label className="seller-offer-capacity-acknowledgement">
        <input name="capacity_acknowledged" type="checkbox" defaultChecked={initialRequest?.capacity_acknowledged ?? false} required />
        I can supply the stated daily quantity and accept valid vouchers at every listed branch.
      </label>
      <p className="seller-offer-policy-note">This is a request, not a live promotion. Rontab reviews the final terms, points cost, schedule, and quota before publication.</p>
      {message && <p className="seller-form-message" role="alert">{message}</p>}
      <button className="admin-primary-button" type="submit" disabled={isSubmitting}>{isSubmitting ? "Submitting…" : initialRequest ? "Update and resubmit" : "Submit offer for review"}</button>
    </form>
  );
}
