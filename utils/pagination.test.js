import assert from "node:assert/strict";
import {
  ADMIN_LIST_DEFAULT_LIMIT,
  ADMIN_LIST_MAX_LIMIT,
  ACTIVITY_LOG_DEFAULT_LIMIT,
  parsePagination,
  paginationMeta,
} from "./pagination.js";

const defaults = parsePagination({});
assert.equal(defaults.page, 1);
assert.equal(defaults.limit, ADMIN_LIST_DEFAULT_LIMIT);
assert.equal(defaults.skip, 0);

const pageTwo = parsePagination({ page: 2, limit: 10 });
assert.equal(pageTwo.page, 2);
assert.equal(pageTwo.limit, 10);
assert.equal(pageTwo.skip, 10);

assert.equal(parsePagination({ page: 0, limit: 0 }).page, 1);
assert.equal(parsePagination({ page: -3 }).page, 1);
assert.equal(parsePagination({ limit: 9999 }).limit, ADMIN_LIST_MAX_LIMIT);
assert.equal(parsePagination({ page: "3", limit: "5" }).skip, 10);
assert.equal(parsePagination({ page: "nope", limit: "nope" }).limit, ADMIN_LIST_DEFAULT_LIMIT);

const activity = parsePagination({ limit: undefined }, { defaultLimit: ACTIVITY_LOG_DEFAULT_LIMIT });
assert.equal(activity.limit, ACTIVITY_LOG_DEFAULT_LIMIT);

const empty = paginationMeta({ page: 1, limit: 20, total: 0 });
assert.deepEqual(empty, { page: 1, limit: 20, total: 0, totalPages: 0, hasMore: false });

const mid = paginationMeta({ page: 2, limit: 20, total: 45 });
assert.equal(mid.totalPages, 3);
assert.equal(mid.hasMore, true);

const last = paginationMeta({ page: 3, limit: 20, total: 45 });
assert.equal(last.hasMore, false);
assert.equal(last.totalPages, 3);

console.log("pagination tests passed");
