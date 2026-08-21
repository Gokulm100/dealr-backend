import Ad from "../models/ad.model.js";
import Chat from "../models/chat.model.js";
import Review from "../models/review.model.js";
import User from "../models/user.model.js";
import AnalyticsEvent from "../models/analyticsEvent.model.js";

/** Marker appended to seeded ad descriptions so clients can flag demo data. */
export const SEEDED_MARKER = "[dealr-seeded]";

export function isDemoListing({ description, title } = {}) {
  const desc = String(description || "");
  const heading = String(title || "");
  return /\[dealr-seeded\]/i.test(desc) || /\[Demo\]\s*$/i.test(desc) || /\[Demo\]\s*$/i.test(heading);
}

export function demoListingFilter() {
  return {
    $or: [
      { description: /\[dealr-seeded\]/i },
      { description: /\[Demo\]\s*$/i },
      { title: /\[Demo\]\s*$/i },
    ],
  };
}

function summarizeAds(ads) {
  return ads.map((ad) => ({
    id: String(ad._id),
    title: ad.title,
    seller: ad.seller ? String(ad.seller) : null,
  }));
}

export async function findDemoListings() {
  const ads = await Ad.find(demoListingFilter()).select("_id title description seller").lean();
  return ads;
}

export async function removeDemoListings({ apply = false } = {}) {
  const ads = await findDemoListings();
  const ids = ads.map((ad) => ad._id);

  const related = {
    chats: ids.length ? await Chat.countDocuments({ adId: { $in: ids } }) : 0,
    reviews: ids.length ? await Review.countDocuments({ ad: { $in: ids } }) : 0,
    analyticsEvents: ids.length ? await AnalyticsEvent.countDocuments({ adId: { $in: ids } }) : 0,
    usersWithFavorites: ids.length ? await User.countDocuments({ favoriteAds: { $in: ids } }) : 0,
    usersWithLastViewed: ids.length ? await User.countDocuments({ lastViewedAds: { $in: ids } }) : 0,
  };

  if (!apply || ids.length === 0) {
    return {
      dryRun: !apply,
      deleted: false,
      ads: ads.length,
      listings: summarizeAds(ads),
      related,
    };
  }

  const [chats, reviews, analyticsEvents, users, adsDeleted] = await Promise.all([
    Chat.deleteMany({ adId: { $in: ids } }),
    Review.deleteMany({ ad: { $in: ids } }),
    AnalyticsEvent.deleteMany({ adId: { $in: ids } }),
    User.updateMany(
      { $or: [{ favoriteAds: { $in: ids } }, { lastViewedAds: { $in: ids } }] },
      { $pullAll: { favoriteAds: ids, lastViewedAds: ids } }
    ),
    Ad.deleteMany({ _id: { $in: ids } }),
  ]);

  return {
    dryRun: false,
    deleted: true,
    ads: adsDeleted.deletedCount ?? ads.length,
    listings: summarizeAds(ads),
    related: {
      chats: chats.deletedCount ?? 0,
      reviews: reviews.deletedCount ?? 0,
      analyticsEvents: analyticsEvents.deletedCount ?? 0,
      usersUpdated: users.modifiedCount ?? 0,
    },
  };
}
