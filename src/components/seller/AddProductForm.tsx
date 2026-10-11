"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/database.types";

type CategoryOption = { id: string; name: string };

export function AddProductForm({ sellerId, categories }: { sellerId: string; categories: CategoryOption[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const imageFile = formData.get("image");

    if (!(imageFile instanceof File) || imageFile.size === 0) {
      setMessage("Choose a product image to continue.");
      setIsSubmitting(false);
      return;
    }

    if (![/^image\/(jpeg|png|webp)$/].some((pattern) => pattern.test(imageFile.type)) || imageFile.size > 5 * 1024 * 1024) {
      setMessage("Use a JPEG, PNG, or WebP image up to 5 MB.");
      setIsSubmitting(false);
      return;
    }

    const externalUrl = String(formData.get("external_url") ?? "").trim();
    if (!externalUrl.startsWith("https://")) {
      setMessage("Enter a secure https:// shop URL.");
      setIsSubmitting(false);
      return;
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      setMessage("Seller product submission is not configured yet.");
      setIsSubmitting(false);
      return;
    }

    const supabase = createBrowserClient<Database>(supabaseUrl, supabaseKey);
    const productId = crypto.randomUUID();
    const productName = String(formData.get("name") ?? "").trim();
    const productSlug = `${productName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${productId.slice(0, 8)}`;
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

    const safeFileName = imageFile.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const storagePath = `${sellerId}/${productId}/${safeFileName}`;
    const { error: uploadError } = await supabase.storage.from("product-images").upload(storagePath, imageFile, {
      cacheControl: "3600",
      contentType: imageFile.type,
      upsert: false,
    });

    if (uploadError) {
      await supabase.from("products").delete().eq("id", productId);
      setMessage("The image could not be uploaded. Check the file and try again.");
      setIsSubmitting(false);
      return;
    }

    const { error: imageError } = await supabase.from("product_images").insert({
      product_id: productId,
      storage_path: storagePath,
      alt_text: productName,
    });

    if (imageError) {
      await supabase.storage.from("product-images").remove([storagePath]);
      await supabase.from("products").delete().eq("id", productId);
      setMessage("The product image could not be attached. Please try again.");
      setIsSubmitting(false);
      return;
    }

    const { error: submitError } = await supabase
      .from("products")
      .update({ status: "pending" })
      .eq("id", productId);

    if (submitError) {
      setMessage("Your draft and image were saved, but submission failed. Contact admin to review it.");
      setIsSubmitting(false);
      router.refresh();
      return;
    }

    form.reset();
    setMessage("Product submitted for admin review.");
    setIsSubmitting(false);
    router.refresh();
  }

  return (
    <form className="seller-product-form" onSubmit={handleSubmit}>
      <label>Product name<input name="name" maxLength={120} required /></label>
      <label>Category<select name="category_id" required defaultValue=""><option value="" disabled>Select a category</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
      <label>Price in GBP<input name="price" type="number" min="0" step="0.01" /></label>
      <label>Shop URL<input name="external_url" type="url" placeholder="https://" required /></label>
      <label className="seller-product-description">Description<textarea name="description" rows={3} maxLength={500} required /></label>
      <label>Product image<input name="image" type="file" accept="image/jpeg,image/png,image/webp" required /></label>
      {message && <p className="seller-form-message" role="status">{message}</p>}
      <button className="seller-auth-submit" type="submit" disabled={isSubmitting || categories.length === 0}>
        {isSubmitting ? "Submitting…" : "Submit for review"}
      </button>
    </form>
  );
}