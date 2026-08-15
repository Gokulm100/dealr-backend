export const LAST_VIEWED_LIMIT = 5;

export function asIdString(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  if (value._id) return String(value._id);
  return String(value);
}

/**
 * Keep the last N viewed ads in recency order (oldest → newest).
 * Re-viewing an ad moves it to the end instead of storing a duplicate.
 */
export function recordLastViewedAdIds(existingIds = [], adId, limit = LAST_VIEWED_LIMIT) {
  const nextId = asIdString(adId);
  const next = [];
  for (const id of existingIds || []) {
    const asString = asIdString(id);
    if (asString && asString !== nextId) next.push(asString);
  }
  if (nextId) next.push(nextId);
  return next.slice(-limit);
}

/**
 * Category the user visited most among the given ids (recency order).
 * Ties go to the category they viewed most recently.
 */
export function topCategoryId(categoryIdsInRecencyOrder = []) {
  const ids = (categoryIdsInRecencyOrder || []).map(asIdString).filter(Boolean);
  if (!ids.length) return null;

  const counts = new Map();
  const lastIndex = new Map();
  ids.forEach((id, index) => {
    counts.set(id, (counts.get(id) || 0) + 1);
    lastIndex.set(id, index);
  });

  let best = ids[0];
  for (const id of counts.keys()) {
    const count = counts.get(id);
    const bestCount = counts.get(best);
    if (count > bestCount) {
      best = id;
    } else if (count === bestCount && lastIndex.get(id) > lastIndex.get(best)) {
      best = id;
    }
  }
  return best;
}

export function topCategoryFromViewedAds(lastViewedAdIds, categoryByAdId, limit = LAST_VIEWED_LIMIT) {
  const recent = recordLastViewedAdIds(lastViewedAdIds, null, limit);
  const categoryIds = recent
    .map((adId) => asIdString(categoryByAdId.get(adId)))
    .filter(Boolean);
  return topCategoryId(categoryIds);
}

export function formatInrShort(price) {
  const amount = Number(price);
  if (!Number.isFinite(amount)) return "";
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

export function buildNewAdCategoryCopy({ categoryName, title, location, price } = {}) {
  const category = (categoryName || "").trim();
  const heading = category ? `New ${category} listing` : "New listing";
  const parts = [];
  if (title) parts.push(title);
  if (location) parts.push(`in ${location}`);
  const priceText = formatInrShort(price);
  if (priceText) parts.push(`· ${priceText}`);
  return {
    title: heading,
    body: parts.join(" ") || "A new listing is up in a category you browse.",
  };
}
