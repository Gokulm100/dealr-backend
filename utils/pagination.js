export const ADMIN_LIST_DEFAULT_LIMIT = 20;
export const ADMIN_LIST_MAX_LIMIT = 100;
export const ACTIVITY_LOG_DEFAULT_LIMIT = 40;

export function parsePagination(
  input = {},
  { defaultLimit = ADMIN_LIST_DEFAULT_LIMIT, maxLimit = ADMIN_LIST_MAX_LIMIT } = {}
) {
  const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(input.limit, 10) || defaultLimit));
  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
}

export function paginationMeta({ page, limit, total }) {
  const safeTotal = Math.max(0, Number(total) || 0);
  const totalPages = safeTotal === 0 ? 0 : Math.ceil(safeTotal / limit);
  return {
    page,
    limit,
    total: safeTotal,
    totalPages,
    hasMore: page * limit < safeTotal,
  };
}
