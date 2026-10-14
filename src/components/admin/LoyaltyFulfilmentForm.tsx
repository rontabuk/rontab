"use client";

import { useState, useTransition } from "react";
import { markLoyaltyClaimFulfilled } from "@/app/admin/(protected)/actions";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const EVIDENCE_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

export function LoyaltyFulfilmentForm({
  claimId,
  offerId,
  queuePage,
}: {
  claimId: string;
  offerId: string;
  queuePage?: number;
}) {
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploadError(null);
    const formData = new FormData(event.currentTarget);
    const evidenceValue = formData.get("fulfillment_evidence");
    const evidenceFile = evidenceValue instanceof File && evidenceValue.size > 0 ? evidenceValue : null;
    if (evidenceFile) {
      const extension = EVIDENCE_EXTENSIONS[evidenceFile.type];
      if (!extension || evidenceFile.size > MAX_EVIDENCE_BYTES) {
        setUploadError("Choose a PDF, JPEG, PNG, or WebP file no larger than 10 MB.");
        return;
      }
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        setUploadError("Evidence upload is unavailable in this environment.");
        return;
      }

      setIsUploading(true);
      const evidencePath = `${claimId}/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage.from("loyalty-fulfilment-evidence").upload(evidencePath, evidenceFile, {
        cacheControl: "3600",
        contentType: evidenceFile.type,
        upsert: false,
      });
      setIsUploading(false);
      if (error) {
        setUploadError("The evidence could not be uploaded. Check the file and try again.");
        return;
      }
      formData.delete("fulfillment_evidence");
      formData.set("fulfillment_evidence_path", evidencePath);
    }

    startTransition(() => {
      void markLoyaltyClaimFulfilled(formData);
    });
  }

  return (
    <form onSubmit={handleSubmit} aria-busy={isUploading || isPending}>
      <input type="hidden" name="claim_id" value={claimId} />
      <input type="hidden" name="offer_id" value={offerId} />
      {queuePage !== undefined && <>
        <input type="hidden" name="from_queue" value="true" />
        <input type="hidden" name="fulfillment_page" value={queuePage} />
      </>}
      <label>Delivery note<textarea name="fulfillment_note" minLength={5} maxLength={1000} rows={2} placeholder="How was the reward delivered?" required /></label>
      <label>Reference (optional)<input name="fulfillment_reference" maxLength={500} placeholder="Receipt, shipment, or case reference" /></label>
      <label>Evidence (optional, PDF/JPEG/PNG/WebP, up to 10 MB)<input name="fulfillment_evidence" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" /></label>
      <button className="admin-approve-button" type="submit" disabled={isUploading || isPending}>
        {isUploading ? "Uploading evidence…" : isPending ? "Saving delivery…" : "Confirm delivery"}
      </button>
      {uploadError && <p className="form-error" role="alert">{uploadError}</p>}
    </form>
  );
}