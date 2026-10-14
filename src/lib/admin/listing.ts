export const ADMIN_LIST_PAGE_SIZE = 25;

export function parseAdminListPage(value?: string) {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? Math.min(page, 40_000) : 1;
}

export function normalizeAdminSearch(value?: string) {
  return (value ?? "").trim().replace(/[%_\\]/g, "").slice(0, 100);
}

export function buildAdminListHref(
  path: string,
  filters: Record<string, string | undefined>,
  page: number,
  pageParam = "page",
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  params.set(pageParam, String(page));
  return `${path}?${params.toString()}`;
}