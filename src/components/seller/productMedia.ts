import type { SupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

type ProductMediaInsert = Database["public"]["Tables"]["product_images"]["Insert"];

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const REEL_TYPES = ["video/mp4", "video/webm"];
const MAX_PHOTOS = 5;
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

export const PHOTO_ACCEPT = PHOTO_TYPES.join(",");
export const REEL_ACCEPT = REEL_TYPES.join(",");

function isVerticalReel(file: File) {
  return new Promise<boolean>((resolve) => {
    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);
    const finish = (isVertical: boolean) => {
      URL.revokeObjectURL(objectUrl);
      resolve(isVertical);
    };
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const ratio = video.videoWidth / video.videoHeight;
      finish(ratio >= 0.5 && ratio <= 0.65);
    };
    video.onerror = () => finish(false);
    video.src = objectUrl;
  });
}

// Returns a message for the seller, or null when the selection can be uploaded.
export async function validateProductMedia(photos: File[], reel: File | null) {
  if (photos.length > MAX_PHOTOS) return "You can add up to 5 product photos.";
  if (photos.some((file) => !PHOTO_TYPES.includes(file.type))) return "Product photos must be JPEG, PNG, or WebP.";
  if (reel && !REEL_TYPES.includes(reel.type)) return "Reel videos must be MP4 or WebM.";

  const totalBytes = [...photos, ...(reel ? [reel] : [])].reduce((total, file) => total + file.size, 0);
  if (totalBytes > MAX_MEDIA_BYTES) return "All product photos and video together must be 100 MB or less.";
  if (reel && !(await isVerticalReel(reel))) return "Reel video must be vertical (9:16) and playable in MP4 or WebM format.";
  return null;
}

// Uploads the Reel first, then photos; on any failure, already uploaded files are removed.
export async function uploadProductMedia(
  supabase: SupabaseBrowserClient,
  { sellerId, productId, altText, photos, reel }: { sellerId: string; productId: string; altText: string; photos: File[]; reel: File | null },
) {
  const media = [
    ...(reel ? [{ file: reel, mediaType: "video" as const }] : []),
    ...photos.map((file) => ({ file, mediaType: "image" as const })),
  ];
  const paths: string[] = [];
  const rows: ProductMediaInsert[] = [];

  for (const [sortOrder, { file, mediaType }] of media.entries()) {
    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const storagePath = `${sellerId}/${productId}/${crypto.randomUUID()}-${safeFileName}`;
    const { error } = await supabase.storage.from("product-images").upload(storagePath, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false,
    });

    if (error) {
      await removeProductMedia(supabase, paths);
      return null;
    }

    paths.push(storagePath);
    rows.push({ product_id: productId, storage_path: storagePath, alt_text: altText, media_type: mediaType, sort_order: sortOrder });
  }

  return { paths, rows };
}

export async function removeProductMedia(supabase: SupabaseBrowserClient, paths: string[]) {
  if (paths.length) await supabase.storage.from("product-images").remove(paths);
}
