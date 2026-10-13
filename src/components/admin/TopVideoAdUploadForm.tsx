"use client";

import { useActionState, useEffect, useRef, useState, startTransition } from "react";
import { createTopVideoAd } from "@/app/admin/(protected)/actions";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const MEDIA_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

export function TopVideoAdUploadForm() {
  const [state, formAction, isSaving] = useActionState(createTopVideoAd, { error: null });
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const submittedRef = useRef(false);
  const isBusy = isUploading || isSaving;

  useEffect(() => {
    if (!submittedRef.current || isSaving) return;
    submittedRef.current = false;
    if (!state.error) formRef.current?.reset();
  }, [isSaving, state]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setUploadError(null);
    const formData = new FormData(event.currentTarget);
    const file = formData.get("media");
    if (!(file instanceof File) || !file.size) return setUploadError("Choose a video or image to upload.");
    const extension = MEDIA_TYPES[file.type];
    if (!extension) return setUploadError("Use an MP4/WebM video or a JPEG/PNG/WebP image.");
    if (file.size > MAX_MEDIA_BYTES) return setUploadError("The file must be 50 MB or smaller.");

    const supabase = createSupabaseBrowserClient();
    if (!supabase) return setUploadError("Uploads are not available right now.");

    setIsUploading(true);
    const storagePath = `${crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage.from("top-video-ads").upload(storagePath, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false,
    });
    setIsUploading(false);
    if (error) return setUploadError("The file could not be uploaded. Please try again.");

    formData.delete("media");
    formData.set("storage_path", storagePath);
    submittedRef.current = true;
    startTransition(() => formAction(formData));
  };

  const message = uploadError ?? state.error;

  return (
    <form ref={formRef} className="admin-category-form" aria-busy={isBusy} onSubmit={handleSubmit}>
      <label>Title<input name="title" maxLength={120} required /></label>
      <label>Link (optional)<input name="target_url" type="url" pattern="https://.*" placeholder="https://" /></label>
      <label>Order<input name="sort_order" type="number" step="1" defaultValue="0" required /></label>
      <label>Image display time (seconds)<input name="display_seconds" type="number" min="3" max="60" step="1" defaultValue="8" required /></label>
      <label>Video or image (up to 50 MB)<input name="media" type="file" accept={Object.keys(MEDIA_TYPES).join(",")} required /></label>
      <label className="admin-checkbox-label"><input name="is_active" type="checkbox" defaultChecked /> Show on the catalogue</label>
      <button className="admin-primary-button" type="submit" disabled={isBusy}>
        {isUploading ? "Uploading…" : isSaving ? "Saving…" : "Add to banner"}
      </button>
      {message && <p className="form-error" role="alert">{message}</p>}
    </form>
  );
}
