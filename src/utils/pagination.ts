export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pages: number;
}

/** Lee page/limit del query con topes, para que nadie pida 10 000 filas. */
export function parsePagination(
  query: { page?: unknown; limit?: unknown },
  defaultLimit: number,
  maxLimit: number,
): { page: number; limit: number; skip: number } {
  const page = Math.max(1, Math.floor(Number(query.page)) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Math.floor(Number(query.limit)) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

export function paginated<T>(items: T[], total: number, page: number, limit: number): Paginated<T> {
  return { items, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
}
