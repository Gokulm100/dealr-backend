import Ad from "../models/ad.model.js";
import AdCategory from "../models/ad.category.model.js";
import User from "../models/user.model.js";
import { sendNewAdInCategoryNotification } from "./pushService.js";
import {
  asIdString,
  buildNewAdCategoryCopy,
  interestsMatch,
  normalizeSubCategory,
  recordLastViewedAdIds,
  topInterest,
  topInterestFromViewedAds,
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

function toInterest(ad) {
  return {
    categoryId: asIdString(ad?.category),
    subCategory: normalizeSubCategory(ad?.subCategory),
  };
}

async function interestByAdIdFor(users) {
  const adIds = uniqueAdIds(users);
  if (!adIds.length) return new Map();
  const ads = await Ad.find({ _id: { $in: adIds } }).select("category subCategory");
  return new Map(ads.map((ad) => [asIdString(ad._id), toInterest(ad)]));
}

function storedInterest(user) {
  const categoryId = asIdString(user.topViewedCategory);
  if (!categoryId) return null;
  return {
    categoryId,
    subCategory: normalizeSubCategory(user.topViewedSubCategory),
  };
}

export async function recordAdViewHistory(user, ad) {
  if (!user || !ad?._id || !ad.category) return user;

  const nextIds = recordLastViewedAdIds(user.lastViewedAds, ad._id);
  user.lastViewedAds = nextIds;

  const otherIds = nextIds.filter((id) => id !== asIdString(ad._id));
  const others = otherIds.length
    ? await Ad.find({ _id: { $in: otherIds } }).select("category subCategory")
    : [];
  const interestByAdId = new Map(others.map((item) => [asIdString(item._id), toInterest(item)]));
  interestByAdId.set(asIdString(ad._id), toInterest(ad));

  const interests = nextIds.map((id) => interestByAdId.get(id)).filter(Boolean);
  const top = topInterest(interests);
  user.topViewedCategory = top?.categoryId || null;
  user.topViewedSubCategory = top ? top.subCategory : null;
  await user.save();
  return user;
}

function matchingUserQuery(sellerId, adInterest) {
  const query = {
    fcmToken: { $exists: true, $nin: [null, ""] },
    isBlocked: { $ne: true },
    isActive: { $ne: false },
    ...(sellerId ? { _id: { $ne: sellerId } } : {}),
  };

  const storedMatch = adInterest.subCategory
    ? {
        topViewedCategory: adInterest.categoryId,
        topViewedSubCategory: adInterest.subCategory,
      }
    : {
        topViewedCategory: adInterest.categoryId,
        $or: [
          { topViewedSubCategory: { $exists: false } },
          { topViewedSubCategory: null },
          { topViewedSubCategory: "" },
        ],
      };

  query.$or = [
    storedMatch,
    {
      $and: [
        { $or: [{ topViewedCategory: { $exists: false } }, { topViewedCategory: null }] },
        { "lastViewedAds.0": { $exists: true } },
      ],
    },
  ];
  return query;
}

export async function notifyUsersOfNewAd(ad) {
  const adInterest = toInterest(ad);
  const sellerId = asIdString(ad?.seller);
  if (!ad?._id || !adInterest.categoryId) {
    return { considered: 0, sent: 0, skipped: "no_category" };
  }

  const category = await AdCategory.findById(adInterest.categoryId).select("name");
  const copy = buildNewAdCategoryCopy({
    categoryName: category?.name,
    subCategory: ad.subCategory,
    title: ad.title,
    location: ad.location,
    price: ad.price,
  });

  const users = await User.find(matchingUserQuery(sellerId, adInterest))
    .select("fcmToken lastViewedAds topViewedCategory topViewedSubCategory")
    .limit(NOTIFY_LIMIT);

  const needsCompute = users.filter((user) => !user.topViewedCategory);
  const interestByAdId = needsCompute.length ? await interestByAdIdFor(needsCompute) : new Map();

  const recipients = [];
  const persistOps = [];
  for (const user of users) {
    let interest = storedInterest(user);
    if (!interest) {
      interest = topInterestFromViewedAds(user.lastViewedAds, interestByAdId);
      if (interest) {
        persistOps.push({
          updateOne: {
            filter: { _id: user._id },
            update: {
              $set: {
                topViewedCategory: interest.categoryId,
                topViewedSubCategory: interest.subCategory,
              },
            },
          },
        });
      }
    }
    if (interestsMatch(interest, adInterest) && user.fcmToken) {
      recipients.push(user);
    }
  }

  if (persistOps.length) {
    await User.bulkWrite(persistOps).catch((err) => {
      console.error("Failed to persist top viewed interest:", err?.message || err);
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
        categoryId: adInterest.categoryId,
        categoryName: category?.name || "",
        subCategory: ad.subCategory || "",
      })
    ));
    sent += results.filter((result) => result?.sent).length;
  }

  const summary = {
    adId: asIdString(ad._id),
    categoryId: adInterest.categoryId,
    subCategory: adInterest.subCategory,
    considered: users.length,
    matched: recipients.length,
    sent,
  };
  console.log("New-ad category notifications:", summary);
  return summary;
}
