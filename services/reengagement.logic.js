/**
 * Pure re-engagement rules. Keep "come back to the app" copy out of here —
 * a push only goes out when there is a concrete marketplace reason.
 */

export const REENGAGEMENT_CONFIG = {
  inactiveAfterMs: 3 * 24 * 60 * 60 * 1000,
  cooldownMs: 7 * 24 * 60 * 60 * 1000,
  maxDormantMs: 60 * 24 * 60 * 60 * 1000,
  lookbackMs: 7 * 24 * 60 * 60 * 1000,
  savedAdsMinInactiveMs: 7 * 24 * 60 * 60 * 1000,
  quietHours: { start: 22, end: 8, timeZone: "Asia/Kolkata" },
  batchLimit: 200,
};

export function getHourInZone(now, timeZone) {
  const hourPart = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hourCycle: "h23",
  })
    .formatToParts(now)
    .find((part) => part.type === "hour");
  return Number(hourPart?.value ?? 0);
}

export function isQuietHour(now = new Date(), quietHours = REENGAGEMENT_CONFIG.quietHours) {
  const { start = 22, end = 8, timeZone = "Asia/Kolkata" } = quietHours;
  const hour = getHourInZone(now, timeZone);
  if (start === end) return false;
  if (start > end) return hour >= start || hour < end;
  return hour >= start && hour < end;
}

export function lastActivityAt(user) {
  return user?.lastActiveAt || user?.lastLogin || user?.createdAt || null;
}

export function isEligible(user, now = new Date(), config = REENGAGEMENT_CONFIG) {
  if (!user?.fcmToken) return { ok: false, reason: "no_token" };
  if (user.isActive === false || user.isBlocked) return { ok: false, reason: "inactive_or_blocked" };
  if (isQuietHour(now, config.quietHours)) return { ok: false, reason: "quiet_hours" };

  const last = lastActivityAt(user);
  if (!last) return { ok: false, reason: "no_activity" };

  const lastMs = new Date(last).getTime();
  const inactiveFor = now.getTime() - lastMs;
  if (inactiveFor < config.inactiveAfterMs) return { ok: false, reason: "still_active" };
  if (inactiveFor > config.maxDormantMs) return { ok: false, reason: "dormant" };

  if (user.lastReengagementAt) {
    const sinceLastPush = now.getTime() - new Date(user.lastReengagementAt).getTime();
    if (sinceLastPush < config.cooldownMs) return { ok: false, reason: "cooldown" };
  }

  return { ok: true, inactiveFor };
}

function categoryNameOf(ad) {
  if (!ad) return "";
  if (typeof ad.category === "object" && ad.category?.name) return ad.category.name;
  return "";
}

function commonLocation(ads) {
  const locations = ads
    .map((ad) => (ad.location || "").trim())
    .filter(Boolean);
  if (!locations.length) return "";
  const first = locations[0];
  return locations.every((loc) => loc.toLowerCase() === first.toLowerCase()) ? first : "";
}

function buildNewAdsCampaign(newAds) {
  const count = newAds.length;
  const names = [...new Set(newAds.map(categoryNameOf).filter(Boolean))];
  const location = commonLocation(newAds);
  const first = newAds[0];

  let body;
  if (names.length === 1) {
    body = count === 1
      ? `A new ${names[0]} listing is up`
      : `${count} new ${names[0]} listings`;
  } else {
    body = count === 1
      ? "A new listing in a category you browsed"
      : `${count} new listings in categories you browsed`;
  }
  if (location) body += ` in ${location}`;
  body += ".";

  return {
    campaign: "new_in_interest",
    title: count === 1 ? "New listing you'd like" : "New listings you'd like",
    body,
    data: {
      campaign: "new_in_interest",
      adId: String(first._id),
      screen: "ad",
    },
  };
}

function buildSavedCampaign(savedActiveAds) {
  const first = savedActiveAds[0];
  const count = savedActiveAds.length;
  const titleText = first.title ? `"${first.title}"` : "A saved ad";
  return {
    campaign: "saved_still_up",
    title: "Still available",
    body: count === 1
      ? `${titleText} is still listed.`
      : `${titleText} and ${count - 1} more saved ads are still listed.`,
    data: {
      campaign: "saved_still_up",
      adId: String(first._id),
      screen: "ad",
    },
  };
}

/**
 * Pick at most one campaign. Priority:
 * 1. Seller with unanswered chats (high intent, time-sensitive)
 * 2. New ads in categories the user actually viewed or saved
 * 3. Saved ads still up, only after a longer absence
 * Return null when there is nothing specific to say.
 */
export function pickCampaign(
  { unreadSellerChats = 0, newAds = [], savedActiveAds = [], inactiveForMs = 0 } = {},
  config = REENGAGEMENT_CONFIG
) {
  const unread = Number(unreadSellerChats) || 0;
  if (unread > 0) {
    return {
      campaign: "seller_unread",
      title: "Someone is waiting on your listing",
      body: unread === 1
        ? "You have 1 unread chat on your ads."
        : `You have ${unread} unread chats on your ads.`,
      data: {
        campaign: "seller_unread",
        screen: "chat",
      },
    };
  }

  if (newAds.length) {
    return buildNewAdsCampaign(newAds.slice(0, 3));
  }

  if (savedActiveAds.length && inactiveForMs >= config.savedAdsMinInactiveMs) {
    return buildSavedCampaign(savedActiveAds);
  }

  return null;
}

function missingOrNull(field) {
  return [{ [field]: { $exists: false } }, { [field]: null }];
}

export function candidateQuery(now = new Date(), config = REENGAGEMENT_CONFIG) {
  const inactiveBefore = new Date(now.getTime() - config.inactiveAfterMs);
  const dormantAfter = new Date(now.getTime() - config.maxDormantMs);
  const cooldownBefore = new Date(now.getTime() - config.cooldownMs);
  const inWindow = { $lte: inactiveBefore, $gte: dormantAfter };

  return {
    fcmToken: { $exists: true, $nin: [null, ""] },
    isBlocked: { $ne: true },
    isActive: { $ne: false },
    $and: [
      {
        $or: [
          ...missingOrNull("lastReengagementAt"),
          { lastReengagementAt: { $lte: cooldownBefore } },
        ],
      },
      {
        $or: [
          { lastActiveAt: inWindow },
          {
            $and: [
              { $or: missingOrNull("lastActiveAt") },
              { lastLogin: inWindow },
            ],
          },
          {
            $and: [
              { $or: missingOrNull("lastActiveAt") },
              { $or: missingOrNull("lastLogin") },
              { createdAt: inWindow },
            ],
          },
        ],
      },
    ],
  };
}
