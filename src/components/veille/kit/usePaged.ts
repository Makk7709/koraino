import { useEffect, useState } from "react";

/**
 * Pagination locale. `focusIndex` place la page sur un élément ciblé (lien profond) ;
 * `resetKey` ramène à la première page quand les filtres changent.
 */
export function usePaged<T>(
  items: T[],
  pageSize: number,
  { focusIndex = -1, resetKey = "" }: { focusIndex?: number; resetKey?: string } = {},
) {
  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
  }, [resetKey]);
  useEffect(() => {
    if (focusIndex >= 0) setPage(Math.floor(focusIndex / pageSize));
  }, [focusIndex, pageSize]);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  return {
    page: current,
    pageCount,
    pageSize,
    total: items.length,
    setPage,
    slice: items.slice(current * pageSize, current * pageSize + pageSize),
  };
}
