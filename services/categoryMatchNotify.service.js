import Ad from "../models/ad.model.js";
import AdCategory from "../models/ad.category.model.js";
import User from "../models/user.model.js";
import { sendNewAdInCategoryNotification } from "./pushService.js";
import {
  asIdString,
  buildNewAdCategoryCopy,
  recordLastViewedAdIds,
  topCategoryFromViewedAds,
  topCategoryId,
} from "./viewHistory.logic.js";

const NOTIFY_BATCH = 25;
const NOTIFY_LIMIT = 500;

function uniqueAdIds(users) {
  const ids = new Set();
  for (const user of users) {
    for (const adId of recordLastViewedAdIds(user.lastViewedAds || [], null)) {
      ids.add(adId);
    }
  }
  return [...ids];
}

async function categoryByAdIdFor(users) {
  const adIds = uniqueAdIds(users);
  if (!adIds.length) return new Map();
  const ads = await Ad.find({ _id: { $in: adIds } }).select("category");
  return new Map(ads.map((ad) => [asIdString(ad._id), asIdString(ad.category)]));
}

export async function recordAdViewHistory(user, ad) {
  if (!user || !ad?._id || !ad.category) return user;

  const nextIds = recordLastViewedAdIds(user.lastViewedAds, ad._id);
  user.lastViewedAds = nextIds;

  const otherIds = nextIds.filter((id) => id !== asIdString(ad._id));
  const others = otherIds.length
    ? await Ad.find({ _id: { $in: otherIds } }).select("category")
    : [];
  const categoryByAdId = new Map(others.map((item) => [asIdString(item._id), asIdString(item.category)]));
  categoryByAdId.set(asIdString(ad._id), asIdString(ad.category));

  const categoryIds = nextIds
    .map((id) => categoryByAdId.get(id))
    .filter(Boolean);
  user.topViewedCategory = topCategoryId(categoryIds);
  await user.save();
  return user;
}

export async function notifyUsersOfNewAd(ad) {
  const categoryId = asIdString(ad?.category);
  const sellerId = asIdString(ad?.seller);
  if (!ad?._id || !categoryId) {
    return { considered: 0, sent: 0, skipped: "no_category" };
  }

  const category = await AdCategory.findById(categoryId).select("name");
  const copy = buildNewAdCategoryCopy({
    categoryName: category?.name,
    title: ad.title,
    location: ad.location,
    price: ad.price,
  });

  const users = await User.find({
    fcmToken: { $exists: true, $nin: [null, ""] },
    isBlocked: { $ne: true },
    isActive: { $ne: false },
    ...(sellerId ? { _id: { $ne: sellerId } } : {}),
    $or: [
      { topViewedCategory: categoryId },
      {
        $and: [
          { $or: [{ topViewedCategory: { $exists: false } }, { topViewedCategory: null }] },
          { "lastViewedAds.0": { $exists: true } },
        ],
      },
    ],
  })
    .select("fcmToken lastViewedAds topViewedCategory")
    .limit(NOTIFY_LIMIT);

  const needsCompute = users.filter((user) => !user.topViewedCategory);
  const categoryByAdId = needsCompute.length ? await categoryByAdIdFor(needsCompute) : new Map();

  const recipients = [];
  const persistOps = [];
  for (const user of users) {
    let top = asIdString(user.topViewedCategory);
    if (!top) {
      top = topCategoryFromViewedAds(user.lastViewedAds, categoryByAdId);
      if (top) {
        persistOps.push({
          updateOne: {
            filter: { _id: user._id },
            update: { $set: { topViewedCategory: top } },
          },
        });
      }
    }
    if (top && top === categoryId && user.fcmToken) {
      recipients.push(user);
    }
  }

  if (persistOps.length) {
    await User.bulkWrite(persistOps).catch((err) => {
      console.error("Failed to persist topViewedCategory:", err?.message || err);
    });
  }

  let sent = 0;
  for (let i = 0; i < recipients.length; i += NOTIFY_BATCH) {
    const batch = recipients.slice(i, i + NOTIFY_BATCH);
    const results = await Promise.all(batch.map((user) =>
      sendNewAdInCategoryNotification(user.fcmToken, {
        title: copy.title,
        body: copy.body,
        adId: asIdString(ad._id),
        categoryId,
        categoryName: category?.name || "",
      })
    ));
    sent += results.filter((result) => result?.sent).length;
  }

  const summary = {
    adId: asIdString(ad._id),
    categoryId,
    considered: users.length,
    matched: recipients.length,
    sent,
  };
  console.log("New-ad category notifications:", summary);
  return summary;
}
