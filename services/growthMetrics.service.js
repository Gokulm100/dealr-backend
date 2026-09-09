/**
 * EXP-1 growth metrics service (DB layer).
 * Pulls a bounded slice of analytics + marketplace data and runs the pure
 * functions in growthMetrics.logic.js. Read-only; safe to call on demand.
 *
 * Caveats (v1):
 * - Actor first-seen is derived from AnalyticsEvent within `lookbackDays`, so
 *   new/returning and retention are relative to that lookback window.
 * - Mobile currently emits no events; until the mobile analytics client ships,
 *   engagement/funnel/retention reflect web activity only.
 */
import AnalyticsEvent from "../models/analyticsEvent.model.js";
import User from "../models/user.model.js";
import Ad from "../models/ad.model.js";
import Chat from "../models/chat.model.js";
import {
  activeCounts,
  buildActorActivity,
  funnelFromActivity,
  liquidity,
  liquidityByDimension,
  newVsReturning,
  notificationOpenRate,
  retentionCohorts,
} from "./growthMetrics.logic.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function actorKeyOf(event) {
  if (event.userId) return `user:${String(event.userId)}`;
  return `visitor:${String(event.visitorId || "")}`;
}

function median(values) {
  const nums = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

async function computeTimeToFirst(now, lookbackStart) {
  // Median time from account creation to first listing / first inquiry sent,
  // for users created within the lookback window.
  const newUsers = await User.find({ createdAt: { $gte: lookbackStart } })
    .select("_id createdAt")
    .lean();
  if (!newUsers.length) {
    return { timeToFirstListingHours: null, timeToFirstInquiryHours: null, sampledUsers: 0 };
  }
  const ids = newUsers.map((u) => u._id);

  const [firstAds, firstChats] = await Promise.all([
    Ad.aggregate([
      { $match: { seller: { $in: ids } } },
      { $group: { _id: "$seller", firstAt: { $min: "$createdAt" } } },
    ]),
    Chat.aggregate([
      { $match: { from: { $in: ids } } },
      { $group: { _id: "$from", firstAt: { $min: "$createdAt" } } },
    ]),
  ]);
  const firstAdBy = new Map(firstAds.map((r) => [String(r._id), r.firstAt]));
  const firstChatBy = new Map(firstChats.map((r) => [String(r._id), r.firstAt]));

  const listingDeltas = [];
  const inquiryDeltas = [];
  for (const u of newUsers) {
    const created = new Date(u.createdAt).getTime();
    const ad = firstAdBy.get(String(u._id));
    if (ad) {
      const d = new Date(ad).getTime() - created;
      if (d >= 0) listingDeltas.push(d / (60 * 60 * 1000));
    }
    const chat = firstChatBy.get(String(u._id));
    if (chat) {
      const d = new Date(chat).getTime() - created;
      if (d >= 0) inquiryDeltas.push(d / (60 * 60 * 1000));
    }
  }
  const round1 = (n) => (n == null ? null : Number(n.toFixed(1)));
  return {
    timeToFirstListingHours: round1(median(listingDeltas)),
    timeToFirstInquiryHours: round1(median(inquiryDeltas)),
    sampledUsers: newUsers.length,
    usersWhoListed: listingDeltas.length,
    usersWhoInquired: inquiryDeltas.length,
  };
}

export async function getGrowthReport({ windowDays = 30, lookbackDays = 90 } = {}) {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowDays * DAY_MS);
  const lookbackStart = new Date(now.getTime() - lookbackDays * DAY_MS);

  // 1. Engagement / retention / funnel from analytics events.
  const events = await AnalyticsEvent.find({ createdAt: { $gte: lookbackStart } })
    .select("type userId visitorId adId createdAt")
    .lean();
  const activity = buildActorActivity(
    events.map((e) => ({ actorKey: actorKeyOf(e), type: e.type, at: e.createdAt }))
  );

  const engagement = activeCounts(activity, now);
  const newReturning = newVsReturning(activity, now, windowDays);
  const retention = retentionCohorts(activity, now, [1, 7, 30]);
  const funnel = funnelFromActivity(activity);

  // 2. Supply overview.
  const [totalUsers, newUsers, activeListingDocs, newListings] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ createdAt: { $gte: windowStart } }),
    Ad.find({ isActive: true, isSold: false })
      .select("_id seller category location")
      .populate("category", "name")
      .lean(),
    Ad.countDocuments({ createdAt: { $gte: windowStart } }),
  ]);

  const activeListings = activeListingDocs.map((ad) => ({
    adId: String(ad._id),
    sellerId: ad.seller ? String(ad.seller) : null,
    category: ad.category?.name || "(uncategorized)",
    location: ad.location || "(unknown)",
  }));
  const activeAdIds = new Set(activeListings.map((l) => l.adId));

  // 3. Inquiries (distinct buyer per ad) from chats, restricted to active listings.
  const inquiryAgg = await Chat.aggregate([
    { $group: { _id: { adId: "$adId", from: "$from" } } },
  ]);
  const inquiries = inquiryAgg
    .map((r) => ({ adId: String(r._id.adId), buyerKey: String(r._id.from) }))
    .filter((r) => activeAdIds.has(r.adId));

  const liq = liquidity(activeListings, inquiries);

  // 4. Demand by category/location from ad_view events (mapped via listing dims).
  const adViewAgg = await AnalyticsEvent.aggregate([
    { $match: { type: "ad_view", adId: { $ne: null }, createdAt: { $gte: lookbackStart } } },
    { $group: { _id: "$adId", views: { $sum: 1 } } },
  ]);
  const dimByAd = new Map(activeListings.map((l) => [l.adId, l]));
  const demandByCategory = new Map();
  const demandByLocation = new Map();
  for (const row of adViewAgg) {
    const dims = dimByAd.get(String(row._id));
    if (!dims) continue;
    demandByCategory.set(dims.category, (demandByCategory.get(dims.category) || 0) + row.views);
    demandByLocation.set(dims.location, (demandByLocation.get(dims.location) || 0) + row.views);
  }

  // 5. Notifications open rate (populated once mobile emits notification events).
  const [notifReceived, notifOpened] = await Promise.all([
    AnalyticsEvent.countDocuments({ type: "notification_received", createdAt: { $gte: windowStart } }),
    AnalyticsEvent.countDocuments({ type: "notification_opened", createdAt: { $gte: windowStart } }),
  ]);

  // 6. Time-to-first (best effort).
  let timing = { timeToFirstListingHours: null, timeToFirstInquiryHours: null, sampledUsers: 0 };
  try {
    timing = await computeTimeToFirst(now, lookbackStart);
  } catch (err) {
    console.error("growth timing computation failed:", err?.message || err);
  }

  return {
    generatedAt: now.toISOString(),
    window: { windowDays, lookbackDays },
    note:
      "v1 report. Engagement/funnel/retention reflect analytics events only; mobile emits none until the mobile analytics client ships. First-seen is bounded to lookbackDays.",
    overview: {
      totalUsers,
      newUsers,
      totalActiveListings: liq.activeListings,
      newListings,
      totalAnalyticsEvents: events.length,
    },
    engagement: { ...engagement, ...newReturning },
    retention,
    funnel,
    liquidity: {
      ...liq,
      timing,
      underservedCategories: liquidityByDimension(activeListings, demandByCategory, "category", 15),
      underservedLocations: liquidityByDimension(activeListings, demandByLocation, "location", 15),
    },
    notifications: notificationOpenRate(notifReceived, notifOpened),
  };
}
