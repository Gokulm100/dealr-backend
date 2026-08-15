import User from "../models/user.model.js";
import Ad from "../models/ad.model.js";
import Chat from "../models/chat.model.js";
import { sendReengagementNotification } from "./pushService.js";
import {
  REENGAGEMENT_CONFIG,
  candidateQuery,
  isEligible,
  isQuietHour,
  pickCampaign,
} from "./reengagement.logic.js";

function asId(value) {
  return value?._id ? String(value._id) : String(value);
}

function uniqueIds(values) {
  return [...new Set(values.filter(Boolean).map(asId))];
}

async function gatherSignals(users, now, config = REENGAGEMENT_CONFIG) {
  const lookback = new Date(now.getTime() - config.lookbackMs);
  const userIds = users.map((user) => user._id);

  const sellerAds = await Ad.find({
    seller: { $in: userIds },
    isActive: true,
    isSold: false,
  }).select("_id seller");

  const sellerAdIds = sellerAds.map((ad) => ad._id);
  const unreadByUser = new Map();
  if (sellerAdIds.length) {
    const unread = await Chat.aggregate([
      {
        $match: {
          to: { $in: userIds },
          seenAt: null,
          adId: { $in: sellerAdIds },
          createdAt: { $gte: lookback },
        },
      },
      { $group: { _id: "$to", count: { $sum: 1 } } },
    ]);
    for (const row of unread) {
      unreadByUser.set(String(row._id), row.count);
    }
  }

  const engagedAdIds = uniqueIds(users.flatMap((user) => [
    ...(user.lastViewedAds || []),
    ...(user.favoriteAds || []),
  ]));

  const engagedAds = engagedAdIds.length
    ? await Ad.find({ _id: { $in: engagedAdIds } }).select("_id category location")
    : [];
  const engagedById = new Map(engagedAds.map((ad) => [String(ad._id), ad]));

  const categoryIds = uniqueIds(engagedAds.map((ad) => ad.category));
  const recentAds = categoryIds.length
    ? await Ad.find({
        category: { $in: categoryIds },
        isActive: true,
        isSold: false,
        createdAt: { $gte: lookback },
      })
        .select("title category location seller createdAt")
        .populate("category", "name")
        .sort({ createdAt: -1 })
        .limit(500)
        .lean()
    : [];

  const favoriteIds = uniqueIds(users.flatMap((user) => user.favoriteAds || []));
  const liveFavorites = favoriteIds.length
    ? await Ad.find({
        _id: { $in: favoriteIds },
        isActive: true,
        isSold: false,
      }).select("_id title")
    : [];
  const liveFavoriteById = new Map(liveFavorites.map((ad) => [String(ad._id), ad]));

  return users.map((user) => {
    const userId = String(user._id);
    const userCategoryIds = new Set(
      uniqueIds(
        [...(user.lastViewedAds || []), ...(user.favoriteAds || [])]
          .map((adId) => engagedById.get(asId(adId))?.category)
      )
    );

    const newAds = recentAds.filter((ad) => {
      if (asId(ad.seller) === userId) return false;
      return userCategoryIds.has(asId(ad.category));
    });

    const savedActiveAds = (user.favoriteAds || [])
      .map((adId) => liveFavoriteById.get(asId(adId)))
      .filter(Boolean);

    return {
      user,
      unreadSellerChats: unreadByUser.get(userId) || 0,
      newAds,
      savedActiveAds,
    };
  });
}

export async function runReengagementJob({
  now = new Date(),
  dryRun = false,
  config = REENGAGEMENT_CONFIG,
} = {}) {
  if (isQuietHour(now, config.quietHours)) {
    return {
      ranAt: now.toISOString(),
      dryRun,
      skipped: "quiet_hours",
      considered: 0,
      sent: 0,
      skippedNoReason: 0,
      failed: 0,
    };
  }

  const users = await User.find(candidateQuery(now, config))
    .select("name fcmToken isActive isBlocked lastActiveAt lastLogin createdAt lastReengagementAt lastViewedAds favoriteAds")
    .limit(config.batchLimit);

  const signals = await gatherSignals(users, now, config);
  const summary = {
    ranAt: now.toISOString(),
    dryRun,
    considered: users.length,
    sent: 0,
    skippedNoReason: 0,
    skippedIneligible: 0,
    failed: 0,
    campaigns: {},
  };

  for (const { user, unreadSellerChats, newAds, savedActiveAds } of signals) {
    const eligibility = isEligible(user, now, config);
    if (!eligibility.ok) {
      summary.skippedIneligible += 1;
      continue;
    }

    const campaign = pickCampaign({
      unreadSellerChats,
      newAds,
      savedActiveAds,
      inactiveForMs: eligibility.inactiveFor,
    }, config);

    if (!campaign) {
      summary.skippedNoReason += 1;
      continue;
    }

    summary.campaigns[campaign.campaign] = (summary.campaigns[campaign.campaign] || 0) + 1;

    if (dryRun) {
      summary.sent += 1;
      continue;
    }

    const result = await sendReengagementNotification(user.fcmToken, campaign);
    if (!result.sent) {
      summary.failed += 1;
      continue;
    }

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          lastReengagementAt: now,
          lastReengagementCampaign: campaign.campaign,
        },
      }
    );
    summary.sent += 1;
  }

  console.log("Re-engagement job finished:", summary);
  return summary;
}
