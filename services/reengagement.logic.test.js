import assert from "node:assert/strict";
import {
  REENGAGEMENT_CONFIG,
  candidateQuery,
  getHourInZone,
  isEligible,
  isQuietHour,
  lastActivityAt,
  pickCampaign,
} from "./reengagement.logic.js";

const FOUR_DAYS = 4 * 24 * 60 * 60 * 1000;
const EIGHT_DAYS = 8 * 24 * 60 * 60 * 1000;
const now = new Date("2026-08-15T05:00:00.000Z"); // 10:30 IST — not quiet hours

function eligibleUser(overrides = {}) {
  return {
    fcmToken: "token-abc",
    isActive: true,
    isBlocked: false,
    lastActiveAt: new Date(now.getTime() - FOUR_DAYS),
    ...overrides,
  };
}

// Quiet hours wrap overnight in Asia/Kolkata.
assert.equal(getHourInZone(new Date("2026-08-15T16:30:00.000Z"), "Asia/Kolkata"), 22);
assert.equal(isQuietHour(new Date("2026-08-15T16:30:00.000Z")), true);
assert.equal(isQuietHour(new Date("2026-08-15T02:00:00.000Z")), true); // 07:30 IST
assert.equal(isQuietHour(new Date("2026-08-15T05:00:00.000Z")), false); // 10:30 IST

assert.equal(lastActivityAt({ lastActiveAt: "a", lastLogin: "b", createdAt: "c" }), "a");
assert.equal(lastActivityAt({ lastLogin: "b", createdAt: "c" }), "b");
assert.equal(lastActivityAt({ createdAt: "c" }), "c");

assert.equal(isEligible({ ...eligibleUser(), fcmToken: null }, now).reason, "no_token");
assert.equal(isEligible(eligibleUser({ isBlocked: true }), now).reason, "inactive_or_blocked");
assert.equal(isEligible(eligibleUser({ isActive: false }), now).reason, "inactive_or_blocked");
assert.equal(isEligible(eligibleUser({ lastActiveAt: now }), now).reason, "still_active");
assert.equal(
  isEligible(eligibleUser({ lastActiveAt: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) }), now).reason,
  "dormant"
);
assert.equal(
  isEligible(eligibleUser({ lastReengagementAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000) }), now).reason,
  "cooldown"
);
assert.equal(isEligible(eligibleUser(), now).ok, true);
assert.equal(
  isEligible(eligibleUser(), new Date("2026-08-15T16:30:00.000Z")).reason,
  "quiet_hours"
);

const seller = pickCampaign({ unreadSellerChats: 2, newAds: [{ _id: "1", title: "Bike" }] });
assert.equal(seller.campaign, "seller_unread");
assert.match(seller.body, /2 unread chats/);
assert.equal(seller.data.screen, "chat");

const oneChat = pickCampaign({ unreadSellerChats: 1 });
assert.match(oneChat.body, /1 unread chat/);

const newAds = pickCampaign({
  unreadSellerChats: 0,
  newAds: [
    { _id: "a1", title: "Activa", category: { name: "Vehicles" }, location: "Kazhakkoottam" },
    { _id: "a2", title: "Splendor", category: { name: "Vehicles" }, location: "Kazhakkoottam" },
  ],
});
assert.equal(newAds.campaign, "new_in_interest");
assert.equal(newAds.title, "New listings you'd like");
assert.equal(newAds.body, "2 new Vehicles listings in Kazhakkoottam.");
assert.equal(newAds.data.adId, "a1");
assert.equal(newAds.data.screen, "ad");

const mixed = pickCampaign({
  newAds: [
    { _id: "p1", title: "Phone", category: { name: "Mobiles" }, location: "TVM" },
    { _id: "f1", title: "Sofa", category: { name: "Furniture" }, location: "Kollam" },
  ],
});
assert.equal(mixed.body, "2 new listings in categories you browsed.");

const savedTooSoon = pickCampaign({
  savedActiveAds: [{ _id: "s1", title: "iPhone 13" }],
  inactiveForMs: FOUR_DAYS,
});
assert.equal(savedTooSoon, null);

const saved = pickCampaign({
  savedActiveAds: [{ _id: "s1", title: "iPhone 13" }, { _id: "s2", title: "Scooter" }],
  inactiveForMs: EIGHT_DAYS,
});
assert.equal(saved.campaign, "saved_still_up");
assert.equal(saved.body, `"iPhone 13" and 1 more saved ads are still listed.`);
assert.equal(saved.data.adId, "s1");

assert.equal(pickCampaign({}), null);
assert.doesNotMatch(JSON.stringify(pickCampaign({ unreadSellerChats: 1 })), /come back|open the app|we miss you/i);

const query = candidateQuery(now);
assert.equal(query.fcmToken.$exists, true);
assert.ok(Array.isArray(query.$and));
assert.equal(query.isBlocked.$ne, true);

void REENGAGEMENT_CONFIG;
console.log("reengagement logic tests passed");
