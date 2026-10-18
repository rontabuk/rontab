"use client";

import type { SellerCategoryOption } from "@/components/seller/ProductPreview";
import { getCategoryPath, getVisibleCategoryRows } from "@/lib/categories";

export function ProductCategoryPicker({
  categories,
  value,
  onChange,
}: {
  categories: SellerCategoryOption[];
  value: string;
  onChange: (categoryId: string) => void;
}) {
  const visibleCategories = getVisibleCategoryRows(categories);
  const path = getCategoryPath(visibleCategories.map((category) => ({
    id: category.id,
    name: category.name,
    parentId: category.parent_id ?? undefined,
  })), value);
  const levels = [
    visibleCategories.filter((category) => !category.parent_id),
    ...path.map((parent) => visibleCategories.filter((category) => category.parent_id === parent.id))
      .filter((children) => children.length > 0),
  ];

  return (
    <div className="seller-category-picker">
      <input type="hidden" name="category_id" value={path.at(-1)?.id ?? ""} />
      {levels.map((options, index) => (
        <label key={index === 0 ? "root" : path[index - 1].id}>
          <span>{index === 0 ? "Main category" : index === 1 ? "Subcategory" : "Further subcategory"}</span>
          <select
            value={path[index]?.id ?? ""}
            onChange={(event) => onChange(event.target.value || path[index - 1]?.id || "")}
            required={index === 0}
          >
            <option value="" disabled={index === 0}>
              {index === 0 ? "Select a main category" : "Select a subcategory (optional)"}
            </option>
            {options.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
          </select>
        </label>
      ))}
    </div>
  );
}