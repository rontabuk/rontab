"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ProductPreview, type SellerCategoryOption } from "@/components/seller/ProductPreview";
import { PHOTO_ACCEPT, REEL_ACCEPT, removeProductMedia, uploadProductMedia, validateProductMedia } from "@/components/seller/productMedia";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";
import { isHttpsUrl } from "@/lib/validation";
import { refreshSellerCatalog } from "@/app/seller/(protected)/actions";

type EditableProduct = Pick<
  Database["public"]["Tables"]["products"]["Row"],
  "id" | "name" | "slug" | "status" | "price" | "currency" | "category_id" | "description" | "audio_script" | "external_url"
>;
type ExistingMedia = {
  storagePath: string;
  mediaType: "image" | "video";
  url: string;
};

export function EditProductForm({
  sellerId,
  shopName,
  shopLogo,
  categories,
  product,
  currentMedia,
}: {
  sellerId: string;
  shopName: string;
  shopLogo: string | null;
  categories: SellerCategoryOption[];
  product: EditableProduct;
  currentMedia: ExistingMedia[];
}) {
  const router = useRouter();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [name, setName] = useState(product.name);
  const [categoryId, setCategoryId] = useState(product.category_id);
  const [price, setPrice] = useState(product.price === null ? "" : String(product.price));
  const [externalUrl, setExternalUrl] = useState(product.external_url);
  const [description, setDescription] = useState(product.description);
  const [audioScript, setAudioScript] = useState(product.audio_script);
  const [imagePreviewUrl, setImagePreviewUrl] = useState("");
  const [videoPreviewUrl, setVideoPreviewUrl] = useState("");
  const [removeCurrentMedia, setRemoveCurrentMedia] = useState(false);

  useEffect(() => {
    if (!imagePreviewUrl) return;
    return () => URL.revokeObjectURL(imagePreviewUrl);
  }, [imagePreviewUrl]);

  useEffect(() => {
    if (!videoPreviewUrl) return;
    return () => URL.revokeObjectURL(videoPreviewUrl);
  }, [videoPreviewUrl]);

  const selectedCategory = categories.find((category) => category.id === categoryId) ?? categories[0];
  const selectedMediaType = videoPreviewUrl
    ? "video"
    : imagePreviewUrl
      ? "image"
      : removeCurrentMedia
        ? undefined
        : currentMedia[0]?.mediaType;
  const selectedMediaUrl = videoPreviewUrl || imagePreviewUrl || (removeCurrentMedia ? "" : currentMedia[0]?.url) || "";

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    const file = files?.[0];
    if (files?.length) {
      if (videoInputRef.current) videoInputRef.current.value = "";
      setVideoPreviewUrl("");
      setRemoveCurrentMedia(true);
    }
    setImagePreviewUrl(file ? URL.createObjectURL(file) : "");
  }

  function handleVideoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      if (imageInputRef.current) imageInputRef.current.value = "";
      setImagePreviewUrl("");
      setRemoveCurrentMedia(true);
    }
    setVideoPreviewUrl(file ? URL.createObjectURL(file) : "");
  }

  function keepCurrentMedia() {
    if (imageInputRef.current) imageInputRef.current.value = "";
    if (videoInputRef.current) videoInputRef.current.value = "";
    setImagePreviewUrl("");
    setVideoPreviewUrl("");
    setRemoveCurrentMedia(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);

    const imageFiles = Array.from(imageInputRef.current?.files ?? []);
    const reelFile = videoInputRef.current?.files?.[0] ?? null;
    const replacingMedia = imageFiles.length > 0 || Boolean(reelFile) || removeCurrentMedia;
    const nextMediaCount = replacingMedia
      ? imageFiles.length + (reelFile ? 1 : 0)
      : currentMedia.length;

    if (nextMediaCount === 0) {
      setMessage("Keep existing media or add at least one photo or Reel before saving.");
      setIsSubmitting(false);
      return;
    }

    const mediaProblem = await validateProductMedia(imageFiles, reelFile);
    if (mediaProblem) {
      setMessage(mediaProblem);
      setIsSubmitting(false);
      return;
    }

    if (!isHttpsUrl(externalUrl.trim())) {
      setMessage("Enter a secure https:// shop URL.");
      setIsSubmitting(false);
      return;
    }

    if (description.trim().length > 1000 || audioScript.trim().length > 300) {
      setMessage("Use up to 1,000 characters for the full description and 300 for the audio summary.");
      setIsSubmitting(false);
      return;
    }

    const rawPrice = price.trim();
    const nextPrice = rawPrice ? Number(rawPrice) : null;
    if (nextPrice !== null && (!Number.isFinite(nextPrice) || nextPrice < 0)) {
      setMessage("Enter a valid non-negative price.");
      setIsSubmitting(false);
      return;
    }

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setMessage("Product editing is temporarily unavailable.");
      setIsSubmitting(false);
      return;
    }

    const { error: updateError } = await supabase
      .from("products")
      .update({
        name: name.trim(),
        category_id: categoryId,
        price: nextPrice,
        description: description.trim(),
        audio_script: audioScript.trim(),
        external_url: externalUrl.trim(),
        status: "pending",
      })
      .eq("id", product.id)
      .eq("seller_profile_id", sellerId);

    if (updateError) {
      setMessage("Product changes could not be saved. Confirm that your seller account is active.");
      setIsSubmitting(false);
      return;
    }

    await refreshSellerCatalog();
    if (replacingMedia) {
      const uploadedMedia = await uploadProductMedia(supabase, {
        sellerId,
        productId: product.id,
        altText: name.trim(),
        photos: imageFiles,
        reel: reelFile,
      });

      if (!uploadedMedia) {
        setMessage("A replacement file could not be uploaded. Existing media is unchanged and the product is awaiting review.");
        setIsSubmitting(false);
        return;
      }

      const { error: deleteRowsError } = await supabase.from("product_images").delete().eq("product_id", product.id);
      if (deleteRowsError) {
        await removeProductMedia(supabase, uploadedMedia.paths);
        setMessage("Product media could not be replaced. Existing files remain attached.");
        setIsSubmitting(false);
        return;
      }

      const { error: insertMediaError } = await supabase.from("product_images").insert(uploadedMedia.rows);
      if (insertMediaError) {
        await removeProductMedia(supabase, uploadedMedia.paths);
        setMessage("New media could not be attached. Add the files again and resubmit the product.");
        setIsSubmitting(false);
        return;
      }

      await removeProductMedia(supabase, currentMedia.map((media) => media.storagePath));
    }

    const { data: submittedStatus, error: submitError } = await supabase.rpc("seller_submit_product", {
      p_product_id: product.id,
    });

    await refreshSellerCatalog();
    if (submitError) {
      setMessage("Changes are saved, but resubmission failed. The product remains out of the public catalogue until it can be resubmitted.");
      setIsSubmitting(false);
      router.refresh();
      return;
    }

    router.replace(`/seller/products?updated=${submittedStatus === "approved" ? "approved" : "review"}`);
    router.refresh();
  }

  return (
    <div className="seller-product-workspace">
      <form className="seller-product-form" onSubmit={handleSubmit}>
        <aside className="seller-media-guide" aria-labelledby="edit-product-media-title">
          <h2 id="edit-product-media-title">Photo and Reel guidelines</h2>
          <p>Choose up to 5 photos or one vertical Reel. Selecting replacement media replaces all existing media.</p>
          <p>Photos: 4:5, ideally 1080 × 1350 px. Reel: 9:16, ideally 1080 × 1920 px, MP4 or WebM.</p>
          <p>Combined replacement media must not exceed 100 MB. If no new files are selected, current media is kept.</p>
        </aside>
        <label>Product name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /></label>
        <label>Category<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required><option value="" disabled>Select a category</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
        <label>Price in GBP<input value={price} onChange={(event) => setPrice(event.target.value)} type="number" min="0" step="0.01" /></label>
        <label>Shop URL<input value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} type="url" placeholder="https://" required /></label>
        <label className="seller-product-description"><span>Product description</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} maxLength={1000} required /><small>Up to 1,000 characters.</small></label>
        <label className="seller-product-audio-script"><span>Audio summary <small>(optional)</small></span><textarea value={audioScript} onChange={(event) => setAudioScript(event.target.value)} rows={3} maxLength={300} /><small>Up to 300 characters, around 30 seconds. Preview uses a voice on your device.</small></label>
        <label>Replace with product photos<input ref={imageInputRef} type="file" accept={PHOTO_ACCEPT} onChange={handleImageChange} multiple /></label>
        <label>Replace with Reel video<input ref={videoInputRef} type="file" accept={REEL_ACCEPT} onChange={handleVideoChange} /></label>
        {currentMedia.length > 0 && (
          <div className="seller-current-media">
            {removeCurrentMedia ? (
              <>
                <span>Current media will be replaced when you save.</span>
                <button className="seller-media-clear" type="button" onClick={keepCurrentMedia}>Keep current media</button>
              </>
            ) : (
              <>
                <span>Current media ({currentMedia.length})</span>
                <button className="seller-media-clear" type="button" onClick={() => setRemoveCurrentMedia(true)}>Replace current media</button>
              </>
            )}
          </div>
        )}
        {message && <p className="seller-form-message" role="status">{message}</p>}
        <div className="seller-edit-actions">
          <button className="seller-auth-submit" type="submit" disabled={isSubmitting || categories.length === 0}>
            {isSubmitting ? "Saving…" : "Save changes"}
          </button>
          <Link className="seller-edit-cancel" href="/seller/products">Cancel</Link>
        </div>
      </form>
      <ProductPreview
        slug={product.slug}
        name={name}
        category={selectedCategory}
        price={price}
        description={description}
        audioScript={audioScript}
        shopName={shopName}
        shopLogo={shopLogo}
        mediaUrl={selectedMediaUrl}
        mediaType={selectedMediaType}
      />
    </div>
  );
}
