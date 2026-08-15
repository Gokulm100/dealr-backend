import assert from "node:assert/strict";
import {
  LAST_VIEWED_LIMIT,
  asIdString,
  buildNewAdCategoryCopy,
  formatInrShort,
  recordLastViewedAdIds,
  topCategoryFromViewedAds,
  topCategoryId,
} from "./viewHistory.logic.js";

assert.equal(asIdString({ _id: "abc" }), "abc");
assert.equal(LAST_VIEWED_LIMIT, 5);

assert.deepEqual(recordLastViewedAdIds(["1", "2", "3", "4", "5"], "6"), ["2", "3", "4", "5", "6"]);
assert.deepEqual(recordLastViewedAdIds(["1", "2", "3"], "2"), ["1", "3", "2"]);
assert.deepEqual(recordLastViewedAdIds(["1", "2"], "1"), ["2", "1"]);
assert.deepEqual(recordLastViewedAdIds([], "9"), ["9"]);
assert.deepEqual(
  recordLastViewedAdIds([{ _id: "a" }, { _id: "b" }, "c", "d", "e", "f"], "g"),
  ["c", "d", "e", "f", "g"]
);

assert.equal(topCategoryId(["v", "v", "v", "m", "m"]), "v");
assert.equal(topCategoryId(["v", "m", "v", "m", "f"]), "m");
assert.equal(topCategoryId(["v"]), "v");
assert.equal(topCategoryId([]), null);
assert.equal(topCategoryId(["v", "m", "f", "m", "v"]), "v");

const categoryByAdId = new Map([
  ["a1", "vehicles"],
  ["a2", "vehicles"],
  ["a3", "mobiles"],
  ["a4", "vehicles"],
  ["a5", "furniture"],
  ["a6", "mobiles"],
]);
assert.equal(
  topCategoryFromViewedAds(["a1", "a2", "a3", "a4", "a5"], categoryByAdId),
  "vehicles"
);
assert.equal(
  topCategoryFromViewedAds(["old1", "old2", "a1", "a3", "a6", "a5"], categoryByAdId),
  "mobiles"
);

assert.equal(formatInrShort(18500), "₹18,500");
const copy = buildNewAdCategoryCopy({
  categoryName: "Vehicles",
  title: "Honda Activa",
  location: "Kazhakkoottam",
  price: 45000,
});
assert.equal(copy.title, "New Vehicles listing");
assert.equal(copy.body, "Honda Activa in Kazhakkoottam · ₹45,000");

console.log("viewHistory logic tests passed");
