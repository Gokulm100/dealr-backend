import assert from "node:assert/strict";
import {
  LAST_VIEWED_LIMIT,
  asIdString,
  buildNewAdCategoryCopy,
  formatInrShort,
  interestKey,
  interestsMatch,
  normalizeSubCategory,
  recordLastViewedAdIds,
  topCategoryId,
  topInterest,
  topInterestFromViewedAds,
} from "./viewHistory.logic.js";

assert.equal(asIdString({ _id: "abc" }), "abc");
assert.equal(LAST_VIEWED_LIMIT, 5);
assert.equal(normalizeSubCategory(" Scooters "), "scooters");
assert.equal(interestKey("cat1", "Scooters"), "cat1::scooters");

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

assert.deepEqual(
  topInterest([
    { categoryId: "vehicles", subCategory: "Scooters" },
    { categoryId: "vehicles", subCategory: "Scooters" },
    { categoryId: "vehicles", subCategory: "Cars" },
    { categoryId: "vehicles", subCategory: "Scooters" },
    { categoryId: "mobiles", subCategory: "Phones" },
  ]),
  { categoryId: "vehicles", subCategory: "scooters" }
);

assert.deepEqual(
  topInterest([
    { categoryId: "vehicles", subCategory: "Scooters" },
    { categoryId: "vehicles", subCategory: "Cars" },
    { categoryId: "vehicles", subCategory: "Scooters" },
    { categoryId: "vehicles", subCategory: "Cars" },
    { categoryId: "vehicles", subCategory: "Cars" },
  ]),
  { categoryId: "vehicles", subCategory: "cars" }
);

const interestByAdId = new Map([
  ["a1", { categoryId: "vehicles", subCategory: "Scooters" }],
  ["a2", { categoryId: "vehicles", subCategory: "Scooters" }],
  ["a3", { categoryId: "vehicles", subCategory: "Cars" }],
  ["a4", { categoryId: "vehicles", subCategory: "Scooters" }],
  ["a5", { categoryId: "furniture", subCategory: "Sofa" }],
  ["a6", { categoryId: "mobiles", subCategory: "Phones" }],
]);
assert.deepEqual(
  topInterestFromViewedAds(["a1", "a2", "a3", "a4", "a5"], interestByAdId),
  { categoryId: "vehicles", subCategory: "scooters" }
);

assert.equal(
  interestsMatch(
    { categoryId: "vehicles", subCategory: "scooters" },
    { categoryId: "vehicles", subCategory: "Scooters" }
  ),
  true
);
assert.equal(
  interestsMatch(
    { categoryId: "vehicles", subCategory: "scooters" },
    { categoryId: "vehicles", subCategory: "Cars" }
  ),
  false
);
assert.equal(
  interestsMatch(
    { categoryId: "vehicles", subCategory: "" },
    { categoryId: "vehicles", subCategory: "Scooters" }
  ),
  false
);
assert.equal(
  interestsMatch(
    { categoryId: "vehicles", subCategory: "" },
    { categoryId: "vehicles", subCategory: "" }
  ),
  true
);

assert.equal(formatInrShort(18500), "₹18,500");
const copy = buildNewAdCategoryCopy({
  categoryName: "Vehicles",
  subCategory: "Scooters",
  title: "Honda Activa",
  location: "Kazhakkoottam",
  price: 45000,
});
assert.equal(copy.title, "New Vehicles · Scooters listing");
assert.equal(copy.body, "Honda Activa in Kazhakkoottam · ₹45,000");

console.log("viewHistory logic tests passed");
