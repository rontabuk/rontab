import Link from "next/link";
import { formatNumber } from "@/lib/format";
import { buildAdminListHref } from "@/lib/admin/listing";

type AdminListPaginationProps = {
  path: string;
  filters: Record<string, string | undefined>;
  page: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  label: string;
  pageParam?: string;
};

export function AdminListPagination({
  path,
  filters,
  page,
  totalPages,
  totalCount,
  pageSize,
  label,
  pageParam,
}: AdminListPaginationProps) {
  const firstResult = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastResult = Math.min(page * pageSize, totalCount);

  return (
    <nav className="admin-list-pagination" aria-label={`${label} pages`}>
      <span>
        {formatNumber(firstResult)}–{formatNumber(lastResult)} of {formatNumber(totalCount)} · Page {formatNumber(page)} of {formatNumber(totalPages)}
      </span>
      <div>
        {page > 1
          ? <Link href={buildAdminListHref(path, filters, page - 1, pageParam)}>Previous</Link>
          : <span aria-disabled="true">Previous</span>}
        {page < totalPages
          ? <Link href={buildAdminListHref(path, filters, page + 1, pageParam)}>Next</Link>
          : <span aria-disabled="true">Next</span>}
      </div>
    </nav>
  );
}