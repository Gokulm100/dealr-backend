import assert from "node:assert/strict";
import mongoose from "mongoose";
import Ad from "../models/ad.model.js";
import Chat from "../models/chat.model.js";
import Review from "../models/review.model.js";
import User from "../models/user.model.js";
import AdCategory from "../models/ad.category.model.js";
import AnalyticsEvent from "../models/analyticsEvent.model.js";
import {
  SEEDED_MARKER,
  isDemoListing,
  demoListingFilter,
  removeDemoListings,
} from "./demoListings.cleanup.js";

assert.equal(isDemoListing({ description: `Honda Activa\n\n${SEEDED_MARKER}` }), true);
assert.equal(isDemoListing({ description: "Honda Activa [dealr-seeded]" }), true);
assert.equal(isDemoListing({ description: "Nice scooter [Demo]" }), true);
assert.equal(isDemoListing({ title: "Honda Activa [Demo]" }), true);
assert.equal(isDemoListing({ title: "Honda Activa", description: "Well maintained" }), false);
assert.equal(isDemoListing({}), false);

const filter = demoListingFilter();
assert.equal(filter.$or.length, 3);

async function connectMongo() {
  if (process.env.ANALYTICS_SMOKE_MONGO_URI) {
    await mongoose.connect(process.env.ANALYTICS_SMOKE_MONGO_URI);
    return { mode: "uri", mem: null };
  }
  try {
    const { MongoMemoryServer } = await import("mongodb-memory-server");
    const mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
    return { mode: "memory", mem };
  } catch (err) {
    console.error("Skipping demo listing cleanup DB tests (no MongoDB):", err?.message || err);
    return { mode: null, mem: null };
  }
}

const { mode, mem } = await connectMongo();
if (!mode) {
  console.log("demo listing matcher tests passed");
  process.exit(0);
}

try {
  const seller = await User.create({
    googleId: "demo-seller",
    name: "Demo Seller",
    email: "demo-seller@dealr.test",
  });
  const buyer = await User.create({
    googleId: "demo-buyer",
    name: "Demo Buyer",
    email: "demo-buyer@dealr.test",
  });
  const category = await AdCategory.create({ name: `Vehicles-${Date.now()}` });

  const demoAd = await Ad.create({
    title: "Honda Activa [Demo]",
    price: 45000,
    location: "Kazhakkoottam",
    category: category._id,
    images: ["https://example.com/activa.jpg"],
    description: `Well maintained scooter.\n\n${SEEDED_MARKER}`,
    seller: seller._id,
  });
  const realAd = await Ad.create({
    title: "Royal Enfield Classic 350",
    price: 150000,
    location: "Pattom",
    category: category._id,
    images: ["https://example.com/re.jpg"],
    description: "Single owner, genuine papers.",
    seller: seller._id,
  });

  await Chat.create({
    adId: demoAd._id,
    message: "Is this still available?",
    from: buyer._id,
    to: seller._id,
  });
  await Chat.create({
    adId: realAd._id,
    message: "Can you do 1.4L?",
    from: buyer._id,
    to: seller._id,
  });
  await Review.create({
    ad: demoAd._id,
    reviewer: buyer._id,
    reviewee: seller._id,
    role: "buyer",
    rating: 5,
  });
  await AnalyticsEvent.create({
    type: "ad_view",
    visitorId: "visitor-1",
    adId: demoAd._id,
    adTitle: demoAd.title,
  });
  await AnalyticsEvent.create({
    type: "ad_view",
    visitorId: "visitor-1",
    adId: realAd._id,
    adTitle: realAd.title,
  });

  buyer.favoriteAds = [demoAd._id, realAd._id];
  buyer.lastViewedAds = [demoAd._id, realAd._id];
  await buyer.save();

  const preview = await removeDemoListings({ apply: false });
  assert.equal(preview.dryRun, true);
  assert.equal(preview.deleted, false);
  assert.equal(preview.ads, 1);
  assert.equal(preview.related.chats, 1);
  assert.equal(preview.related.reviews, 1);
  assert.equal(preview.related.analyticsEvents, 1);
  assert.equal(await Ad.countDocuments({ _id: demoAd._id }), 1);

  const result = await removeDemoListings({ apply: true });
  assert.equal(result.dryRun, false);
  assert.equal(result.deleted, true);
  assert.equal(result.ads, 1);
  assert.equal(result.related.chats, 1);
  assert.equal(result.related.reviews, 1);
  assert.equal(result.related.analyticsEvents, 1);
  assert.equal(result.related.usersUpdated, 1);

  assert.equal(await Ad.countDocuments({ _id: demoAd._id }), 0);
  assert.equal(await Ad.countDocuments({ _id: realAd._id }), 1);
  assert.equal(await Chat.countDocuments({ adId: demoAd._id }), 0);
  assert.equal(await Chat.countDocuments({ adId: realAd._id }), 1);
  assert.equal(await Review.countDocuments({ ad: demoAd._id }), 0);
  assert.equal(await AnalyticsEvent.countDocuments({ adId: demoAd._id }), 0);
  assert.equal(await AnalyticsEvent.countDocuments({ adId: realAd._id }), 1);

  const refreshedBuyer = await User.findById(buyer._id);
  assert.deepEqual(refreshedBuyer.favoriteAds.map(String), [String(realAd._id)]);
  assert.deepEqual(refreshedBuyer.lastViewedAds.map(String), [String(realAd._id)]);

  const empty = await removeDemoListings({ apply: true });
  assert.equal(empty.ads, 0);
  assert.equal(empty.deleted, false);
} finally {
  await mongoose.disconnect().catch(() => {});
  if (mem) await mem.stop().catch(() => {});
}

console.log("demo listing cleanup tests passed");
