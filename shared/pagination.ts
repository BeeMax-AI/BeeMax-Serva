/** Clamp paging after filtering or deletion, including an empty result. */
export function pageWindow(total: number, requested: number, size: number) {
  const count = Math.max(0, Math.floor(total));
  const pageSize = size === 30 ? 30 : 20;
  const pages = Math.max(1, Math.ceil(count / pageSize));
  const page = Math.max(
    1,
    Math.min(pages, Number.isFinite(requested) ? Math.floor(requested) : 1),
  );
  const start = (page - 1) * pageSize;
  return {
    page,
    pages,
    start,
    end: Math.min(count, start + pageSize),
    count,
    size: pageSize,
  };
}
