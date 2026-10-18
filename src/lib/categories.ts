import type { ProductCategory } from "@/data/products";

type CategoryRow = { id: string; parent_id?: string | null; is_active?: boolean };

export function getVisibleCategoryRows<Category extends CategoryRow>(categories: readonly Category[]): Category[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  return categories.filter((category) => {
    const visited = new Set<string>();
    let current: Category | undefined = category;
    while (current) {
      if (current.is_active === false || visited.has(current.id)) return false;
      visited.add(current.id);
      if (!current.parent_id) return true;
      current = byId.get(current.parent_id);
    }
    return false;
  });
}

export function getCategoryBranchIds(categories: readonly ProductCategory[], categoryId: string): Set<string> {
  const branch = new Set([categoryId]);
  const pending = [categoryId];
  while (pending.length) {
    const parentId = pending.pop();
    for (const category of categories) {
      if (category.parentId === parentId && !branch.has(category.id)) {
        branch.add(category.id);
        pending.push(category.id);
      }
    }
  }
  return branch;
}

export function getCategoryPath(categories: readonly ProductCategory[], categoryId: string): ProductCategory[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const visited = new Set<string>();
  const path: ProductCategory[] = [];
  let current = byId.get(categoryId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}