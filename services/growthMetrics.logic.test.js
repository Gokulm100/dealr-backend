import assert from "node:assert/strict";
import {
  DAY_MS,
  activeCounts,
  buildActorActivity,
  funnelFromActivity,
  liquidity,
  liquidityByDimension,
  newVsReturning,
  notificationOpenRate,
  retentionCohorts,
} from "./growthMetrics.logic.js";

const NOW = new Date("2026-01-31T12:00:00.000Z");
const daysAgo = (n) => new Date(NOW.getTime() - n * DAY_MS);

// --- buildActorActivity ---
const records = [
  { actorKey: "user:a", type: "visit", at: daysAgo(0) },
  { actorKey: "user:a", type: "ad_view", at: daysAgo(0) },
  { actorKey: "user:a", type: "post_ad", at: daysAgo(0) },
  { actorKey: "visitor:b", type: "visit", at: daysAgo(3) },
  { actorKey: "visitor:b", type: "ad_view", at: daysAgo(2) },
  { actorKey: "user:c", type: "visit", at: daysAgo(20) },
];
const activity = buildActorActivity(records);
assert.equal(activity.size, 3);
assert.equal(activity.get("user:a").isUser, true);
assert.equal(activity.get("visitor:b").isUser, false);
assert.equal(activity.get("visitor:b").days.size, 2);
assert.ok(activity.get("user:a").types.has("post_ad"));

// --- activeCounts (trailing windows by lastAt) ---
const ac = activeCounts(activity, NOW);
assert.equal(ac.dau, 1); // only user:a active today
assert.equal(ac.wau, 2); // user:a + visitor:b
assert.equal(ac.mau, 3); // all three within 30 days

// --- newVsReturning ---
// Give user:c an older first-seen so they count as returning within 30d window.
const nvrRecords = [
  { actorKey: "user:a", type: "visit", at: daysAgo(0) }, // new (first seen today)
  { actorKey: "user:c", type: "visit", at: daysAgo(45) }, // first seen outside window
  { actorKey: "user:c", type: "visit", at: daysAgo(5) }, // active in window => returning
];
const nvr = newVsReturning(buildActorActivity(nvrRecords), NOW, 30);
assert.equal(nvr.active, 2);
assert.equal(nvr.new, 1);
assert.equal(nvr.returning, 1);

// --- retentionCohorts ---
// user:ret first seen 10 days ago, returned 3 days later -> retained at d7 (and d1? returned day+3 not day+1)
const retRecords = [
  { actorKey: "user:ret", type: "visit", at: daysAgo(10) },
  { actorKey: "user:ret", type: "visit", at: daysAgo(7) }, // +3 days
  { actorKey: "user:once", type: "visit", at: daysAgo(10) }, // never returned
];
const ret = retentionCohorts(buildActorActivity(retRecords), NOW, [1, 7, 30]);
assert.equal(ret.d1.eligible, 2); // both cohorts old enough for a 1-day window
assert.equal(ret.d1.retained, 0); // neither returned on day+1
assert.equal(ret.d7.eligible, 2);
assert.equal(ret.d7.retained, 1); // user:ret returned within 7 days
assert.equal(ret.d30.eligible, 0); // firstDay+30 is in the future -> censored, excluded
assert.equal(ret.d7.rate, 0.5);

// --- funnelFromActivity ---
const funnel = funnelFromActivity(activity);
const byKey = Object.fromEntries(funnel.map((r) => [r.key, r]));
assert.equal(byKey.visit.count, 3); // all visited
assert.equal(byKey.browse.count, 2); // user:a + visitor:b viewed a listing
assert.equal(byKey.supply.count, 1); // only user:a posted
assert.equal(byKey.browse.stepConversion, Number((2 / 3).toFixed(4)));
assert.equal(byKey.visit.overallConversion, 1);

// --- liquidity ---
const listings = [
  { adId: "1", sellerId: "s1", category: "Electronics", location: "TVM" },
  { adId: "2", sellerId: "s1", category: "Electronics", location: "TVM" },
  { adId: "3", sellerId: "s2", category: "Vehicles", location: "Kollam" },
];
const inquiries = [
  { adId: "1", buyerKey: "user:x" },
  { adId: "1", buyerKey: "user:x" }, // duplicate buyer -> counts once
  { adId: "1", buyerKey: "user:y" },
  { adId: "3", buyerKey: "user:z" },
];
const liq = liquidity(listings, inquiries);
assert.equal(liq.activeListings, 3);
assert.equal(liq.activeSellers, 2);
assert.equal(liq.listingsPerActiveSeller, 1.5);
assert.equal(liq.totalInquiries, 3); // ad1: 2 distinct buyers, ad3: 1
assert.equal(liq.inquiriesPerListing, Number((3 / 3).toFixed(2)));
assert.equal(liq.listingToInquiryConversion, Number((2 / 3).toFixed(4))); // ads 1 and 3 have inquiries

// --- liquidityByDimension ---
const demand = new Map([
  ["Vehicles", 10],
  ["Electronics", 4],
]);
const dim = liquidityByDimension(listings, demand, "category", 10);
// Vehicles: supply 1, demand 10 -> demandPerListing 10 (most underserved) ranks first
assert.equal(dim[0].key, "Vehicles");
assert.equal(dim[0].demandPerListing, 10);
assert.equal(dim[1].key, "Electronics");
assert.equal(dim[1].demandPerListing, 2); // 4 demand / 2 listings

// --- notificationOpenRate ---
assert.deepEqual(notificationOpenRate(100, 25), { received: 100, opened: 25, openRate: 0.25 });
assert.equal(notificationOpenRate(0, 0).openRate, null);

console.log("growthMetrics.logic tests passed");
