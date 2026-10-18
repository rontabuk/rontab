"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Video } from "lucide-react";
import { BrowserSpeechPlayer } from "@/components/BrowserSpeechPlayer";
import { ProductPreview, type SellerCategoryOption } from "@/components/seller/ProductPreview";
import { ProductCategoryPicker } from "@/components/seller/ProductCategoryPicker";
import { PHOTO_ACCEPT, REEL_ACCEPT, removeProductMedia, uploadProductMedia, validateProductMedia } from "@/components/seller/productMedia";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isHttpsUrl } from "@/lib/validation";
import { refreshSellerCatalog } from "@/app/seller/(protected)/actions";

type PreviewValues = {
  name: string;
  categoryId: string;
  price: string;
  description: string;
  audioScript: string;
};

const initialPreviewValues: PreviewValues = {
  name: "",
  categoryId: "",
  price: "",
  description: "",
  audioScript: "",
};

export function AddProductForm({
  sellerId,
  shopName,
  shopLogo,
  categories,
}: {
  sellerId: string;
  shopName: string;
  shopLogo: string | null;
  categories: SellerCategoryOption[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previewValues, setPreviewValues] = useState(initialPreviewValues);
  const [imagePreviewUrl, setImagePreviewUrl] = useState("");
  const [videoPreviewUrl, setVideoPreviewUrl] = useState("");
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!imagePreviewUrl) return;
    return () => URL.revokeObjectURL(imagePreviewUrl);
  }, [imagePreviewUrl]);

  useEffect(() => {
    if (!videoPreviewUrl) return;
    return () => URL.revokeObjectURL(videoPreviewUrl);
  }, [videoPreviewUrl]);

  const selectedCategory = categories.find((category) => category.id === previewValues.categoryId) ?? categories[0];

  function handleImagePreviewChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    const file = files?.[0];
    if (files?.length) {
      if (videoInputRef.current) videoInputRef.current.value = "";
      setVideoPreviewUrl("");
    }
    setImagePreviewUrl(file ? URL.createObjectURL(file) : "");
  }

  function handleVideoPreviewChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      if (imageInputRef.current) imageInputRef.current.value = "";
      setImagePreviewUrl("");
    }
    setVideoPreviewUrl(file ? URL.createObjectURL(file) : "");
  }

  function clearSelectedImages() {
    if (imageInputRef.current) imageInputRef.current.value = "";
    setImagePreviewUrl("");
  }

  function clearSelectedVideo() {
    if (videoInputRef.current) videoInputRef.current.value = "";
    setVideoPreviewUrl("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const imageFiles = formData.getAll("images").filter(
      (file): file is File => file instanceof File && file.size > 0,
    );
    const reelValue = formData.get("reel");
    const reelFile = reelValue instanceof File && reelValue.size > 0 ? reelValue : null;

    if (imageFiles.length === 0 && !reelFile) {
      setMessage("Add at least one product photo or a vertical Reel video.");
      setIsSubmitting(false);
      return;
    }

    const mediaProblem = await validateProductMedia(imageFiles, reelFile);
    if (mediaProblem) {
      setMessage(mediaProblem);
      setIsSubmitting(false);
      return;
    }

    const externalUrl = String(formData.get("external_url") ?? "").trim();
    if (!isHttpsUrl(externalUrl)) {
      setMessage("Enter a secure https:// shop URL.");
      setIsSubmitting(false);
      return;
    }

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setMessage("Product submission is temporarily unavailable.");
      setIsSubmitting(false);
      return;
    }

    const productId = crypto.randomUUID();
    const productName = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const audioScript = String(formData.get("audio_script") ?? "").trim();
    if (description.length > 1000 || audioScript.length > 300) {
      setMessage("Use up to 1,000 characters for the full description and 300 for the audio summary.");
      setIsSubmitting(false);
      return;
    }
    const nameSlug = productName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const productSlug = `${nameSlug || "product"}-${productId.slice(0, 8)}`;
    const rawPrice = String(formData.get("price") ?? "").trim();
    const price = rawPrice ? Number(rawPrice) : null;

    const { error: productError } = await supabase.from("products").insert({
      id: productId,
      seller_profile_id: sellerId,
      category_id: String(formData.get("category_id") ?? ""),
      slug: productSlug,
      name: productName,
      description,
      audio_script: audioScript,
      price,
      currency: "GBP",
      external_url: externalUrl,
      status: "draft",
    });

    if (productError) {
      setMessage("Product could not be saved. Confirm your shop is approved and try again.");
      setIsSubmitting(false);
      return;
    }

    const uploadedMedia = await uploadProductMedia(supabase, {
      sellerId,
      productId,
      altText: productName,
      photos: imageFiles,
      reel: reelFile,
    });

    if (!uploadedMedia) {
      await supabase.from("products").delete().eq("id", productId);
      setMessage("A product media file could not be uploaded. Check the files and try again.");
      setIsSubmitting(false);
      return;
    }

    const { error: mediaError } = await supabase.from("product_images").insert(uploadedMedia.rows);

    if (mediaError) {
      await removeProductMedia(supabase, uploadedMedia.paths);
      await supabase.from("products").delete().eq("id", productId);
      setMessage("Product media could not be attached. Please try again.");
      setIsSubmitting(false);
      return;
    }

    const { data: submittedStatus, error: submitError } = await supabase.rpc("seller_submit_product", {
      p_product_id: productId,
    });

    await refreshSellerCatalog();
    if (submitError) {
      setMessage("Your draft and media were saved, but submission failed. Edit it from Your products to resubmit.");
      setIsSubmitting(false);
      router.refresh();
      return;
    }

    form.reset();
    setPreviewValues(initialPreviewValues);
    setImagePreviewUrl("");
    setVideoPreviewUrl("");
    setMessage(submittedStatus === "approved"
      ? "Product approved automatically and is now in the catalogue."
      : "Product submitted for admin review.");
    setIsSubmitting(false);
    router.refresh();
  }

  return (
    <div className="seller-product-workspace seller-add-product-workspace">
      <form className="seller-product-form" onSubmit={handleSubmit}>
        <section className="seller-product-feature" aria-label="Product preview and media">
          <aside className="seller-media-guide" aria-labelledby="seller-media-guide-title">
            <h2 id="seller-media-guide-title">Photo and Reel tips</h2>
            <p><strong>Photos:</strong> 4:5 (1080 × 1350), JPEG/WebP. <strong>Reels:</strong> 9:16 (1080 × 1920), MP4/WebM.</p>
            <p>Choose 1 photo or 1 Reel, max 100 MB. Choosing one replaces the other; Reels play muted and loop.</p>
          </aside>
          {(imagePreviewUrl || videoPreviewUrl) && (
            <>
              <p className="seller-product-feature-intro">Preview your listing as shoppers will see it.</p>
              <ProductPreview
                slug="seller-product-preview"
                name={previewValues.name}
                category={selectedCategory}
                price={previewValues.price}
                description={previewValues.description}
                audioScript={previewValues.audioScript}
                shopName={shopName}
                shopLogo={shopLogo}
                mediaUrl={videoPreviewUrl || imagePreviewUrl}
                mediaType={videoPreviewUrl ? "video" : "image"}
                showAudioPreview={false}
              />
            </>
          )}
        </section>
        <section className="seller-product-media-section" aria-label="Product photos and video">
          <label className="seller-media-upload seller-media-upload-reel" title="Add a Reel video">
            <input className="seller-media-file-input" ref={videoInputRef} name="reel" type="file" accept={REEL_ACCEPT} onChange={handleVideoPreviewChange} aria-label="Add a Reel video" />
            <span className="seller-media-upload-content"><Video size={24} aria-hidden="true" /></span>
          </label>
          <label className="seller-media-upload seller-media-upload-photos" title="Add a product photo">
            <input className="seller-media-file-input" ref={imageInputRef} name="images" type="file" accept={PHOTO_ACCEPT} onChange={handleImagePreviewChange} aria-label="Add a product photo" />
            <span className="seller-media-upload-content"><ImagePlus size={24} aria-hidden="true" /></span>
          </label>
          {videoPreviewUrl && <button className="seller-media-clear" type="button" onClick={clearSelectedVideo}>Remove selected video</button>}
          {imagePreviewUrl && <button className="seller-media-clear" type="button" onClick={clearSelectedImages}>Remove selected photo</button>}
        </section>
        <section className="seller-product-form-section">
          <h2>Item details</h2>
          <ProductCategoryPicker categories={categories} value={previewValues.categoryId} onChange={(categoryId) => setPreviewValues({ ...previewValues, categoryId })} />
        </section>
        <section className="seller-product-form-section">
          <h2>About your item</h2>
          <label><span>Title</span><input name="name" maxLength={120} value={previewValues.name} onChange={(event) => setPreviewValues({ ...previewValues, name: event.target.value })} required /></label>
          <label className="seller-product-description"><span>Description</span><textarea name="description" rows={4} maxLength={1000} value={previewValues.description} onChange={(event) => setPreviewValues({ ...previewValues, description: event.target.value })} required /><small>Up to 1,000 characters.</small></label>
        </section>
        <section className="seller-product-form-section">
          <h2>Pricing</h2>
          <label><span>Price in GBP</span><input name="price" type="number" min="0" step="0.01" value={previewValues.price} onChange={(event) => setPreviewValues({ ...previewValues, price: event.target.value })} /></label>
          <label><span>Shop URL</span><input name="external_url" type="url" placeholder="https://" required /></label>
        </section>
        <section className="seller-product-form-section seller-product-extra-section">
          <h2>Audio summary</h2>
          <label className="seller-product-audio-script"><span>Script <small>(optional)</small></span><textarea name="audio_script" rows={3} maxLength={300} value={previewValues.audioScript} onChange={(event) => setPreviewValues({ ...previewValues, audioScript: event.target.value })} /><small>Up to 300 characters, around 30 seconds.</small></label>
          <section className="seller-product-audio-preview" aria-label="Audio summary preview">
            <h3>Listen to your summary</h3>
            <BrowserSpeechPlayer text={previewValues.audioScript} preview />
          </section>
        </section>
        {message && <p className="seller-form-message" role="status">{message}</p>}
        <button className="seller-auth-submit" type="submit" disabled={isSubmitting || categories.length === 0}>
          {isSubmitting ? "Submitting…" : "Submit for review"}
        </button>
      </form>
    </div>
  );
}