import type { Metadata } from "next";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { saveCategory } from "@/app/admin/(protected)/actions";

export const metadata: Metadata = { title: "Categories", robots: { index: false, follow: false } };

export default async function AdminCategoriesPage() {
  const supabase = await createSupabaseServerClient();
  const { data: categories, error } = await supabase
    .from("categories")
    .select("id,slug,name,description,image_url,is_active,sort_order")
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);

  return (
    <main className="admin-overview">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">CATALOGUE</p>
        <h1>Categories</h1>
        <p>Manage the sections available in the public discovery feed.</p>
      </header>
      <section className="admin-category-create" aria-labelledby="new-category-title">
        <h2 id="new-category-title">Add category</h2>
        <form className="admin-category-form" action={saveCategory}>
          <input type="hidden" name="category_id" value="" />
          <label>Name<input name="name" required /></label>
          <label>Slug<input name="slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" required /></label>
          <label>Description<input name="description" /></label>
          <label>Image URL<input name="image_url" type="url" /></label>
          <label>Sort order<input name="sort_order" type="number" defaultValue="0" required /></label>
          <label className="admin-checkbox-label"><input name="is_active" type="checkbox" /> Active</label>
          <button className="admin-primary-button" type="submit">Create category</button>
        </form>
      </section>
      <section className="admin-category-list" aria-label="Existing categories">
        {categories?.map((category) => (
          <form className="admin-category-row" action={saveCategory} key={category.id}>
            <input type="hidden" name="category_id" value={category.id} />
            <label>Name<input name="name" defaultValue={category.name} required /></label>
            <label>Slug<input name="slug" defaultValue={category.slug} pattern="[a-z0-9]+(-[a-z0-9]+)*" required /></label>
            <label>Description<input name="description" defaultValue={category.description ?? ""} /></label>
            <label>Image URL<input name="image_url" type="url" defaultValue={category.image_url ?? ""} /></label>
            <label>Sort<input name="sort_order" type="number" defaultValue={category.sort_order} required /></label>
            <label className="admin-checkbox-label"><input name="is_active" type="checkbox" defaultChecked={category.is_active} /> Active</label>
            <button className="admin-approve-button" type="submit">Save</button>
          </form>
        ))}
      </section>
    </main>
  );
}