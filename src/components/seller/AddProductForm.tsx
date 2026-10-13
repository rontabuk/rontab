"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ProductPreview, type SellerCategoryOption } from "@/components/seller/ProductPreview";
import { PHOTO_ACCEPT, REEL_ACCEPT, removeProductMedia, uploadProductMedia, validateProductMedia } from "@/components/seller/productMedia";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isHttpsUrl } from "@/lib/validation";

type PreviewValues = {
  name: string;
  categoryId: string;
  price: string;
  description: string;
};

const initialPreviewValues: PreviewValues = {
  name: "",
  categoryId: "",
  price: "",
  description: "",
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
      description: String(formData.get("description") ?? "").trim(),
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
    <div className="seller-product-workspace">
      <form className="seller-product-form" onSubmit={handleSubmit}>
        <aside className="seller-media-guide" aria-labelledby="seller-media-guide-title">
          <h2 id="seller-media-guide-title">Photo and Reel guidelines</h2>
          <p><strong>Photos:</strong> portrait 4:5, ideally 1080 × 1350 px; JPEG or WebP keeps cards sharp and fast.</p>
          <p><strong>Reels:</strong> vertical 9:16, ideally 1080 × 1920 px; MP4 or WebM. Cards play muted and loop.</p>
          <p>Choose up to 5 photos or one Reel video. Selecting one type replaces the other. Media size limit: 100 MB.</p>
        </aside>
        <label>Product name<input name="name" maxLength={120} value={previewValues.name} onChange={(event) => setPreviewValues({ ...previewValues, name: event.target.value })} required /></label>
        <label>Category<select name="category_id" value={previewValues.categoryId} onChange={(event) => setPreviewValues({ ...previewValues, categoryId: event.target.value })} required><option value="" disabled>Select a category</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
        <label>Price in GBP<input name="price" type="number" min="0" step="0.01" value={previewValues.price} onChange={(event) => setPreviewValues({ ...previewValues, price: event.target.value })} /></label>
        <label>Shop URL<input name="external_url" type="url" placeholder="https://" required /></label>
        <label className="seller-product-description">Description<textarea name="description" rows={3} maxLength={500} value={previewValues.description} onChange={(event) => setPreviewValues({ ...previewValues, description: event.target.value })} required /></label>
        <label>Product photos<input ref={imageInputRef} name="images" type="file" accept={PHOTO_ACCEPT} onChange={handleImagePreviewChange} multiple /></label>
        {imagePreviewUrl && <button className="seller-media-clear" type="button" onClick={clearSelectedImages}>Remove selected photos</button>}
        <label>Reel video<input ref={videoInputRef} name="reel" type="file" accept={REEL_ACCEPT} onChange={handleVideoPreviewChange} /></label>
        {videoPreviewUrl && <button className="seller-media-clear" type="button" onClick={clearSelectedVideo}>Remove selected video</button>}
        {message && <p className="seller-form-message" role="status">{message}</p>}
        <button className="seller-auth-submit" type="submit" disabled={isSubmitting || categories.length === 0}>
          {isSubmitting ? "Submitting…" : "Submit for review"}
        </button>
      </form>
      <ProductPreview
        slug="seller-product-preview"
        name={previewValues.name}
        category={selectedCategory}
        price={previewValues.price}
        description={previewValues.description}
        shopName={shopName}
        shopLogo={shopLogo}
        mediaUrl={videoPreviewUrl || imagePreviewUrl}
        mediaType={videoPreviewUrl ? "video" : "image"}
      />
    </div>
  );
}