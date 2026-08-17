import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import express from "express";
import User from "../models/user.model.js";
import Ad from "../models/ad.model.js";
import AdCategory from "../models/ad.category.model.js";
import AnalyticsEvent from "../models/analyticsEvent.model.js";
import AnalyticsVisitor from "../models/analyticsVisitor.model.js";
import Report from "../models/report.model.js";
import analyticsRoutes from "../routes/analytics.routes.js";
import adminRoutes from "../routes/admin.routes.js";
import { optionalAuth } from "../middleware/auth.js";
import { incrementAdViewCounter } from "./analytics.service.js";

process.env.JWT_SECRET = process.env.JWT_SECRET || "analytics-smoke-secret";

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
    console.error("Skipping analytics smoke tests (no MongoDB):", err?.message || err);
    return { mode: null, mem: null };
  }
}

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

async function json(base, path, { method = "POST", token, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: res.status, data };
}

function tokenFor(user) {
  return jwt.sign({ id: String(user._id), email: user.email, name: user.name }, process.env.JWT_SECRET, {
    expiresIn: "1d",
  });
}

function assertPagedList(data, listKey, { total, page, limit }) {
  assert.ok(Array.isArray(data[listKey]), `${listKey} should be an array`);
  assert.equal(data.page, page);
  assert.equal(data.limit, limit);
  assert.equal(data.total, total);
  assert.equal(data.totalPages, Math.ceil(total / limit) || 0);
  assert.equal(data.hasMore, page * limit < total);
  assert.ok(data[listKey].length <= limit);
}

function idsOf(rows, key) {
  return rows.map((row) => String(row[key] ?? row._id));
}

async function seedAdminListPages({ category, seller, priya }) {
  const extraUsers = await User.insertMany(
    Array.from({ length: 5 }, (_, index) => ({
      googleId: `extra-user-${index}`,
      name: `User ${index}`,
      email: `user${index}@dealr.test`,
    }))
  );

  const extraAds = await Ad.insertMany(
    Array.from({ length: 4 }, (_, index) => ({
      title: `Paged Ad ${index}`,
      price: 1000 + index,
      location: "Kazhakkoottam",
      category: category._id,
      description: `Paged listing ${index}`,
      images: [`https://example.com/ad-${index}.jpg`],
      seller: seller._id,
      views: index + 1,
    }))
  );

  const now = Date.now();
  await AnalyticsEvent.insertMany(
    extraAds.map((extraAd, index) => ({
      type: "ad_view",
      visitorId: `paged-viewer-${index}`,
      sessionId: `paged-sess-${index}`,
      adId: extraAd._id,
      adTitle: extraAd.title,
      page: "detail",
      path: `/ads/${extraAd._id}`,
      createdAt: new Date(now - index * 60_000),
    }))
  );

  await AnalyticsVisitor.insertMany(
    Array.from({ length: 4 }, (_, index) => ({
      visitorId: `paged-visitor-${index}`,
      firstSeenAt: new Date(now - (index + 1) * 120_000),
      lastSeenAt: new Date(now - index * 30_000),
      pageViews: index + 1,
      adViews: 0,
      lastPage: "home",
    }))
  );

  await Report.insertMany(
    extraUsers.slice(0, 5).map((user, index) => ({
      reporter: priya._id,
      reportedUser: user._id,
      status: index % 2 === 0 ? "pending" : "resolved",
      createdAt: new Date(now - index * 10_000),
    }))
  );
}

async function assertAdminPagination(base, adminToken) {
  const userTotal = await User.countDocuments();
  const reportTotal = await Report.countDocuments();
  const visitorTotal = await AnalyticsVisitor.countDocuments();
  const adViewTotal = (await AnalyticsEvent.distinct("adId", { type: "ad_view", adId: { $ne: null } })).length;
  const logTotal = await AnalyticsEvent.countDocuments();

  const usersPage1 = await json(base, "/api/admin/getUsers", {
    token: adminToken,
    body: { page: 1, limit: 3 },
  });
  assert.equal(usersPage1.status, 200);
  assertPagedList(usersPage1.data, "users", { total: userTotal, page: 1, limit: 3 });
  const usersPage2 = await json(base, "/api/admin/getUsers", {
    token: adminToken,
    body: { page: 2, limit: 3 },
  });
  assert.equal(usersPage2.status, 200);
  assertPagedList(usersPage2.data, "users", { total: userTotal, page: 2, limit: 3 });
  const userIds1 = new Set(idsOf(usersPage1.data.users, "_id"));
  for (const id of idsOf(usersPage2.data.users, "_id")) {
    assert.equal(userIds1.has(id), false);
  }

  const defaultUsers = await json(base, "/api/admin/getUsers", { token: adminToken, body: {} });
  assert.equal(defaultUsers.status, 200);
  assert.equal(defaultUsers.data.page, 1);
  assert.ok(defaultUsers.data.users.length <= defaultUsers.data.limit);

  const reportsPage1 = await json(base, "/api/admin/getReports", {
    token: adminToken,
    body: { page: 1, limit: 2 },
  });
  assert.equal(reportsPage1.status, 200);
  assertPagedList(reportsPage1.data, "reports", { total: reportTotal, page: 1, limit: 2 });
  const pendingReports = await json(base, "/api/admin/getReports", {
    token: adminToken,
    body: { status: "pending", page: 1, limit: 10 },
  });
  assert.equal(pendingReports.status, 200);
  assert.ok(pendingReports.data.reports.every((row) => row.status === "pending"));
  assert.equal(pendingReports.data.total, pendingReports.data.reports.length);

  const viewersPage1 = await json(base, "/api/admin/getAdViewers", {
    token: adminToken,
    body: { page: 1, limit: 2 },
  });
  assert.equal(viewersPage1.status, 200);
  assertPagedList(viewersPage1.data, "ads", { total: adViewTotal, page: 1, limit: 2 });
  const viewersPage2 = await json(base, "/api/admin/getAdViewers", {
    token: adminToken,
    body: { page: 2, limit: 2 },
  });
  assert.equal(viewersPage2.status, 200);
  assertPagedList(viewersPage2.data, "ads", { total: adViewTotal, page: 2, limit: 2 });
  const adIds1 = new Set(idsOf(viewersPage1.data.ads, "_id"));
  for (const id of idsOf(viewersPage2.data.ads, "_id")) {
    assert.equal(adIds1.has(id), false);
  }
  assert.equal(viewersPage1.data.stats.adsViewed, adViewTotal);

  const visitorsPage1 = await json(base, "/api/admin/getVisitors", {
    token: adminToken,
    body: { page: 1, limit: 2 },
  });
  assert.equal(visitorsPage1.status, 200);
  assertPagedList(visitorsPage1.data, "visitors", { total: visitorTotal, page: 1, limit: 2 });
  assert.equal(visitorsPage1.data.stats.total, visitorTotal);
  const visitorsPage2 = await json(base, "/api/admin/getVisitors", {
    token: adminToken,
    body: { page: 2, limit: 2 },
  });
  const visitorIds1 = new Set(idsOf(visitorsPage1.data.visitors, "visitorId"));
  for (const id of idsOf(visitorsPage2.data.visitors, "visitorId")) {
    assert.equal(visitorIds1.has(id), false);
  }

  const logsPage1 = await json(base, "/api/admin/getActivityLog", {
    token: adminToken,
    body: { page: 1, limit: 3 },
  });
  assert.equal(logsPage1.status, 200);
  assertPagedList(logsPage1.data, "logs", { total: logTotal, page: 1, limit: 3 });
}

async function main() {
  const { mode, mem } = await connectMongo();
  if (!mode) {
    console.log("analytics.smoke tests skipped");
    return;
  }

  await Promise.all([
    User.deleteMany({}),
    Ad.deleteMany({}),
    AdCategory.deleteMany({}),
    AnalyticsEvent.deleteMany({}),
    AnalyticsVisitor.deleteMany({}),
    Report.deleteMany({}),
  ]);

  const category = await AdCategory.create({ name: "Vehicles", subCategory: ["Scooters"] });
  const admin = await User.create({
    googleId: "admin-1",
    name: "Admin",
    email: "admin@dealr.test",
    isAdmin: true,
  });
  const seller = await User.create({
    googleId: "seller-1",
    name: "Seller",
    email: "seller@dealr.test",
  });
  const priya = await User.create({
    googleId: "priya-1",
    name: "Priya",
    email: "priya@dealr.test",
    profilePic: "https://example.com/priya.jpg",
  });
  const ad = await Ad.create({
    title: "Honda Activa",
    price: 45000,
    location: "Kazhakkoottam",
    category: category._id,
    description: "Well kept scooter",
    images: ["https://example.com/activa.jpg"],
    seller: seller._id,
    views: 0,
  });

  const app = express();
  app.use(express.json());
  app.use("/api/analytics", analyticsRoutes);
  app.use("/api/admin", adminRoutes);
  app.post("/api/ads/incrementViews", optionalAuth, async (req, res) => {
    const result = await incrementAdViewCounter({
      adId: req.body?.adId,
      visitorId: req.body?.visitorId,
      userId: req.user?.id || null,
      sessionId: req.body?.sessionId,
    });
    if (result.error) {
      return res.status(result.status || 400).json({ message: result.error });
    }
    return res.json({ message: "View count incremented", views: result.views });
  });
  const { server, base } = await listen(app);

  try {
    const visitorId = "11111111-1111-4111-8111-111111111111";
    const sessionId = "sess-anon";

    const anonTrack = await json(base, "/api/analytics/track", {
      body: {
        events: [
          {
            type: "visit",
            visitorId,
            sessionId,
            userId: String(priya._id),
            userName: "Guest",
            page: "home",
            path: "/",
            createdAt: new Date().toISOString(),
          },
          {
            type: "ad_view",
            visitorId,
            sessionId,
            userId: String(priya._id),
            adId: String(ad._id),
            adTitle: "Honda Activa",
            page: "detail",
            path: `/ads/${ad._id}`,
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });
    assert.equal(anonTrack.status, 204);

    const anonEvent = await AnalyticsEvent.findOne({ type: "visit", visitorId }).lean();
    assert.equal(anonEvent.userId, null);
    const visitor = await AnalyticsVisitor.findOne({ visitorId }).lean();
    assert.equal(visitor.userId, null);

    const loginTrack = await json(base, "/api/analytics/track", {
      token: tokenFor(priya),
      body: {
        events: [
          {
            type: "login",
            visitorId,
            sessionId: "sess-auth",
            userId: "64b000000000000000000099",
            page: "home",
            path: "/",
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });
    assert.equal(loginTrack.status, 204);
    const signedVisitor = await AnalyticsVisitor.findOne({ visitorId }).lean();
    assert.equal(String(signedVisitor.userId), String(priya._id));

    const signedAdView = await json(base, "/api/analytics/track", {
      token: tokenFor(priya),
      body: {
        events: [
          {
            type: "ad_view",
            visitorId: "55555555-5555-4555-8555-555555555555",
            sessionId: "sess-priya",
            adId: String(ad._id),
            adTitle: "Honda Activa",
            page: "detail",
            path: `/ads/${ad._id}`,
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });
    assert.equal(signedAdView.status, 204);

    const adminToken = tokenFor(admin);
    const viewers = await json(base, "/api/admin/getAdViewers", { token: adminToken, body: {} });
    assert.equal(viewers.status, 200);
    assert.equal(viewers.data.ads.length, 1);
    assert.equal(viewers.data.ads[0].title, "Honda Activa");
    const viewerRows = viewers.data.ads[0].viewers;
    assert.ok(viewerRows.some((row) => row.userId == null && row.visitorId === visitorId));
    assert.ok(viewerRows.some((row) => row.userId === String(priya._id) && row.name === "Priya"));

    const visitors = await json(base, "/api/admin/getVisitors", { token: adminToken, body: {} });
    assert.equal(visitors.status, 200);
    const priyaRow = visitors.data.visitors.find((row) => row.visitorId === visitorId);
    assert.equal(priyaRow.userId, String(priya._id));
    assert.equal(priyaRow.name, "Priya");
    assert.equal(visitors.data.stats.anonymous, visitors.data.stats.total - visitors.data.stats.signedIn);

    const secondVisitor = "22222222-2222-4222-8222-222222222222";
    await json(base, "/api/analytics/track", {
      body: {
        events: [
          {
            type: "visit",
            visitorId: secondVisitor,
            sessionId: "sess-2",
            page: "home",
            path: "/",
          },
        ],
      },
    });
    const visitorsAfter = await json(base, "/api/admin/getVisitors", { token: adminToken, body: {} });
    assert.equal(visitorsAfter.data.stats.anonymous >= 1, true);
    assert.ok(visitorsAfter.data.visitors.some((row) => row.visitorId === secondVisitor && row.userId == null));

    const log = await json(base, "/api/admin/getActivityLog", {
      token: adminToken,
      body: { page: 1, limit: 40, type: "ad_view" },
    });
    assert.equal(log.status, 200);
    assert.ok(log.data.logs.every((row) => row.type === "ad_view"));
    assert.equal(typeof log.data.hasMore, "boolean");
    assert.equal(log.data.hasMore, log.data.page * 40 < log.data.total);
    assert.ok(log.data.logs.every((row) => typeof row.detail === "string"));

    const before = (await Ad.findById(ad._id)).views;
    const inc = await json(base, "/api/ads/incrementViews", {
      body: { adId: String(ad._id), visitorId: "33333333-3333-4333-8333-333333333333" },
    });
    assert.equal(inc.status, 200);
    assert.equal(inc.data.views, before + 1);

    const ownerInc = await json(base, "/api/ads/incrementViews", {
      token: tokenFor(seller),
      body: { adId: String(ad._id), visitorId: "44444444-4444-4444-8444-444444444444" },
    });
    assert.equal(ownerInc.status, 200);
    assert.equal(ownerInc.data.views, before + 1);

    const forbidden = await json(base, "/api/admin/getAdViewers", {
      token: tokenFor(priya),
      body: {},
    });
    assert.equal(forbidden.status, 403);
    const unauthAdmin = await json(base, "/api/admin/getVisitors", { body: {} });
    assert.equal(unauthAdmin.status, 401);
    const unauthLog = await json(base, "/api/admin/getActivityLog", { body: { page: 1 } });
    assert.equal(unauthLog.status, 401);

    const mixedViewers = await json(base, "/api/admin/getAdViewers", { token: adminToken, body: {} });
    const names = mixedViewers.data.ads[0].viewers.map((row) => row.name);
    assert.ok(names.includes(null) || names.includes("Priya") || mixedViewers.data.ads[0].viewers.length >= 1);

    await seedAdminListPages({ category, seller, priya, ad });
    await assertAdminPagination(base, adminToken);

    console.log("analytics.smoke tests passed");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    if (mem) await mem.stop();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
