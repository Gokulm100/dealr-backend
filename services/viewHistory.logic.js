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

export function normalizeSubCategory(value) {
  return String(value || "").trim().toLowerCase();
}

export function interestKey(categoryId, subCategory) {
  const category = asIdString(categoryId);
  if (!category) return "";
  return `${category}::${normalizeSubCategory(subCategory)}`;
}

export function parseInterestKey(key) {
  if (!key || !key.includes("::")) return null;
  const separator = key.indexOf("::");
  return {
    categoryId: key.slice(0, separator),
    subCategory: key.slice(separator + 2),
  };
}

/**
 * Most common value in recency order. Ties go to the most recent.
 */
export function topCategoryId(valuesInRecencyOrder = []) {
  const ids = (valuesInRecencyOrder || []).map(asIdString).filter(Boolean);
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

export function topInterest(interests = []) {
  const keys = (interests || [])
    .map((item) => interestKey(item?.categoryId ?? item?.category, item?.subCategory))
    .filter(Boolean);
  return parseInterestKey(topCategoryId(keys));
}

export function topInterestFromViewedAds(lastViewedAdIds, interestByAdId, limit = LAST_VIEWED_LIMIT) {
  const recent = recordLastViewedAdIds(lastViewedAdIds, null, limit);
  const interests = recent
    .map((adId) => interestByAdId.get(adId))
    .filter((item) => item && (item.categoryId || item.category));
  return topInterest(interests);
}

export function interestsMatch(userInterest, adInterest) {
  if (!userInterest?.categoryId || !adInterest?.categoryId) return false;
  if (asIdString(userInterest.categoryId) !== asIdString(adInterest.categoryId)) return false;
  return normalizeSubCategory(userInterest.subCategory) === normalizeSubCategory(adInterest.subCategory);
}

export function formatInrShort(price) {
  const amount = Number(price);
  if (!Number.isFinite(amount)) return "";
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

export function buildNewAdCategoryCopy({ categoryName, subCategory, title, location, price } = {}) {
  const category = (categoryName || "").trim();
  const sub = String(subCategory || "").trim();
  const label = [category, sub].filter(Boolean).join(" · ");
  const heading = label ? `New ${label} listing` : "New listing";
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
