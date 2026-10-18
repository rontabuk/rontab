import type { Metadata } from "next";
import { connection } from "next/server";
import { requireAdmin } from "@/lib/admin/access";
import { CategoryManager } from "@/components/admin/CategoryManager";

export const metadata: Metadata = { title: "Categories", robots: { index: false, follow: false } };
export const instant = false;

export default async function AdminCategoriesPage() {
  await connection();
  const { supabase } = await requireAdmin();
  const { data: categories, error } = await supabase
    .from("categories")
    .select("id,slug,name,description,image_url,is_active,sort_order,parent_id")
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);

  return (
    <main className="admin-overview">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">CATALOGUE</p>
        <h1>Categories</h1>
        <p>Manage the sections available in the public discovery feed.</p>
      </header>
      <CategoryManager categories={categories ?? []} />
    </main>
  );
}