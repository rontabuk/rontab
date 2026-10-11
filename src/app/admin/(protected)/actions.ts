"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, getAdminUser } from "@/lib/supabase/server";

async function requireAdminClient() {
  const admin = await getAdminUser();
  if (!admin) redirect("/admin/login");
  return createSupabaseServerClient();
}

export async function signOutAdmin() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}

export async function reviewProduct(formData: FormData) {
  const productId = String(formData.get("product_id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!productId || (status !== "approved" && status !== "rejected")) {
    throw new Error("Invalid product review request.");
  }

  const supabase = await requireAdminClient();
  const { error } = await supabase.rpc("admin_review_product", {
    p_product_id: productId,
    p_next_status: status,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin/products");
  revalidatePath("/");
}

export async function setSellerStatus(formData: FormData) {
  const sellerId = String(formData.get("seller_id") ?? "");
  const status = String(formData.get("status") ?? "");
  const isPublic = formData.get("is_public") === "on";
  if (!sellerId || !["pending", "active", "suspended"].includes(status)) {
    throw new Error("Invalid seller update request.");
  }

  const supabase = await requireAdminClient();
  const { error } = await supabase.rpc("admin_set_seller_status", {
    p_seller_id: sellerId,
    p_next_status: status as "pending" | "active" | "suspended",
    p_is_public: isPublic,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin/sellers");
}

export async function saveCategory(formData: FormData) {
  const categoryId = String(formData.get("category_id") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const imageUrl = String(formData.get("image_url") ?? "").trim();
  const sortOrder = Number(formData.get("sort_order") ?? 0);
  const isActive = formData.get("is_active") === "on";

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !name || !Number.isInteger(sortOrder)) {
    throw new Error("Enter a valid category name, slug, and sort order.");
  }

  const supabase = await requireAdminClient();
  const { error } = await supabase.rpc("admin_save_category", {
    p_category_id: categoryId || null,
    p_slug: slug,
    p_name: name,
    p_description: description || null,
    p_image_url: imageUrl || null,
    p_is_active: isActive,
    p_sort_order: sortOrder,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin/categories");
  revalidatePath("/");
}