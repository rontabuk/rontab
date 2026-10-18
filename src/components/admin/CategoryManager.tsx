"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, LoaderCircle, Pencil, Plus, Save, Search, X } from "lucide-react";
import { saveCategoryDetails, setCategoryVisibility } from "@/app/admin/(protected)/actions";
import { getCategoryBranchIds, getCategoryPath } from "@/lib/categories";
import type { Database } from "@/lib/supabase/database.types";

export type ManagedCategory = Pick<Database["public"]["Tables"]["categories"]["Row"], "id" | "parent_id" | "slug" | "name" | "description" | "image_url" | "is_active" | "sort_order">;
type Editor = { category: ManagedCategory | null; parentId: string };

export function CategoryManager({ categories }: { categories: ManagedCategory[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(() => new Set(categories.filter((category) => !category.parent_id).map((category) => category.id)));
  const [editor, setEditor] = useState<Editor | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [pendingCategory, setPendingCategory] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (editor && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
  }, [editor]);

  const categoryOptions = categories.map((category) => ({ id: category.id, name: category.name, parentId: category.parent_id }));
  const labelFor = (categoryId: string) => getCategoryPath(categoryOptions, categoryId).map((category) => category.name).join(" / ");
  const childrenFor = (parentId: string | null) => categories.filter((category) => category.parent_id === parentId);
  const normalizedQuery = query.trim().toLowerCase();
  const matchingIds = new Set(categories.filter((category) => category.name.toLowerCase().includes(normalizedQuery) || category.slug.includes(normalizedQuery)).flatMap((category) => getCategoryPath(categoryOptions, category.id).map((ancestor) => ancestor.id)));

  function openEditor(category: ManagedCategory | null, parentId = "") {
    setFormError(null);
    setEditor({ category, parentId: category?.parent_id ?? parentId });
  }

  function toggleExpanded(categoryId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }

  function toggleVisibility(category: ManagedCategory) {
    setPendingCategory(category.id);
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await setCategoryVisibility(category.id, !category.is_active);
        if (result.error) setMessage({ error: true, text: result.error });
        else {
          setMessage({ error: false, text: `${category.name} ${category.is_active ? "hidden" : "shown"}.` });
          router.refresh();
        }
      } catch {
        setMessage({ error: true, text: "Could not update visibility. Please try again." });
      } finally {
        setPendingCategory(null);
      }
    });
  }

  function saveEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setFormError(null);
    startTransition(async () => {
      try {
        const result = await saveCategoryDetails(formData);
        if (result.error) setFormError(result.error);
        else {
          const parentId = String(formData.get("parent_id") ?? "");
          if (parentId) setExpanded((current) => new Set([...current, ...getCategoryPath(categoryOptions, parentId).map((category) => category.id)]));
          setEditor(null);
          setMessage({ error: false, text: "Category saved." });
          router.refresh();
        }
      } catch {
        setFormError("Could not save this category. Please try again.");
      }
    });
  }

  function renderCategory(category: ManagedCategory, ancestors: string[] = [], hiddenByParent = false): ReactNode {
    if (ancestors.includes(category.id) || (normalizedQuery && !matchingIds.has(category.id))) return null;
    const children = childrenFor(category.id);
    const isExpanded = normalizedQuery ? true : expanded.has(category.id);
    const label = labelFor(category.id);
    return (
      <li key={category.id}>
        <div className="category-tree-row" data-hidden={!category.is_active || hiddenByParent || undefined} style={{ paddingInlineStart: 12 + Math.min(ancestors.length, 5) * 20 }}>
          {children.length ? <button className="category-icon-button" type="button" aria-label={`${isExpanded ? "Collapse" : "Expand"} ${label}`} aria-expanded={isExpanded} aria-controls={`category-children-${category.id}`} onClick={() => toggleExpanded(category.id)} title={isExpanded ? "Collapse" : "Expand"}>{isExpanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}</button> : <span className="category-tree-spacer" />}
          <span className="category-tree-label"><strong>{category.name}</strong>{hiddenByParent ? <small>Hidden by parent</small> : children.length > 0 && <small>{children.length} sections</small>}</span>
          <label className="category-visibility"><input type="checkbox" checked={category.is_active} disabled={isPending} aria-label={`Show ${label}`} onChange={() => toggleVisibility(category)} /><span>Visible</span></label>
          {pendingCategory === category.id && <LoaderCircle className="category-saving-icon" size={16} aria-label="Saving" />}
          <button className="category-icon-button" type="button" disabled={isPending} onClick={() => openEditor(null, category.id)} aria-label={`Add subcategory to ${label}`} title="Add subcategory"><Plus size={17} /></button>
          <button className="category-icon-button" type="button" disabled={isPending} onClick={() => openEditor(category)} aria-label={`Edit ${label}`} title="Edit category"><Pencil size={16} /></button>
        </div>
        {children.length > 0 && <ul id={`category-children-${category.id}`} hidden={!isExpanded}>{children.map((child) => renderCategory(child, [...ancestors, category.id], hiddenByParent || !category.is_active))}</ul>}
      </li>
    );
  }

  const excludedParents = editor?.category ? getCategoryBranchIds(categoryOptions, editor.category.id) : new Set<string>();
  const nextSort = Math.max(0, ...childrenFor(editor?.parentId || null).map((category) => category.sort_order)) + 10;

  return (
    <section className="category-manager" aria-label="Category management">
      <div className="category-manager-toolbar">
        <label className="category-manager-search"><Search size={17} aria-hidden="true" /><span className="visually-hidden">Search categories</span><input type="search" placeholder="Search categories" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button className="category-icon-button" type="button" aria-label="Clear category search" title="Clear search" onClick={() => setQuery("")}><X size={16} /></button>}</label>
        <button className="admin-primary-button category-add-button" type="button" disabled={isPending} onClick={() => openEditor(null)}><Plus size={17} aria-hidden="true" />Add category</button>
      </div>
      {message && <p className={message.error ? "form-error" : "category-save-status"} role={message.error ? "alert" : "status"}>{message.text}</p>}
      <ul className="category-tree" aria-label="Categories">{childrenFor(null).map((category) => renderCategory(category))}</ul>
      {(!categories.length || (normalizedQuery && !matchingIds.size)) && <p className="admin-empty-note">{categories.length ? "No categories match your search." : "No categories yet."}</p>}
      {editor && (
        <dialog className="category-editor" ref={dialogRef} aria-labelledby="category-editor-title" onCancel={(event) => { event.preventDefault(); if (!isPending) setEditor(null); }}>
          <form onSubmit={saveEditor} aria-busy={isPending}>
            <header className="category-editor-heading"><h2 id="category-editor-title">{editor.category ? "Edit category" : "Add category"}</h2><button className="category-icon-button" type="button" disabled={isPending} onClick={() => setEditor(null)} aria-label="Close category editor" title="Close"><X size={20} /></button></header>
            <input type="hidden" name="category_id" value={editor.category?.id ?? ""} />
            <div className="category-editor-fields">
              <label>Name<input name="name" defaultValue={editor.category?.name ?? ""} required autoFocus /></label>
              <label>Parent category<select name="parent_id" defaultValue={editor.parentId}><option value="">Main section</option>{categoryOptions.filter((category) => !excludedParents.has(category.id)).map((category) => <option key={category.id} value={category.id}>{labelFor(category.id)}</option>)}</select></label>
              <label>Sort order<input name="sort_order" type="number" step="1" defaultValue={editor.category?.sort_order ?? nextSort} required /></label>
              <label className="admin-checkbox-label"><input name="is_active" type="checkbox" defaultChecked={editor.category?.is_active ?? true} />Visible</label>
            </div>
            <details className="category-editor-advanced"><summary>Advanced settings</summary><div className="category-editor-fields"><label>Slug<input name="slug" defaultValue={editor.category?.slug ?? ""} placeholder="Automatic" pattern="[a-z0-9]+(-[a-z0-9]+)*" required={!!editor.category} /></label><label>Description<textarea name="description" rows={3} defaultValue={editor.category?.description ?? ""} /></label><label>Image URL<input name="image_url" type="url" defaultValue={editor.category?.image_url ?? ""} /></label></div></details>
            {formError && <p className="form-error" role="alert">{formError}</p>}
            <footer className="category-editor-actions"><button className="admin-secondary-button" type="button" disabled={isPending} onClick={() => setEditor(null)}>Cancel</button><button className="admin-primary-button" type="submit" disabled={isPending}>{isPending ? <LoaderCircle className="category-saving-icon" size={17} aria-hidden="true" /> : <Save size={17} aria-hidden="true" />}{isPending ? "Saving..." : "Save category"}</button></footer>
          </form>
        </dialog>
      )}
    </section>
  );
}