import mongoose from "mongoose";
import Ad from "../models/ad.model.js";
import User from "../models/user.model.js";
import AnalyticsEvent from "../models/analyticsEvent.model.js";
import AnalyticsVisitor from "../models/analyticsVisitor.model.js";
import {
  COLLAPSE_TYPES,
  COLLAPSE_WINDOW_MS,
  EVENT_TYPE_SET,
  isNoisyRepeat,
  normalizeEventBatch,
  publicUserFields,
  toObjectIdString,
  viewerGroupKey,
} from "./analytics.logic.js";
import {
  ACTIVITY_LOG_DEFAULT_LIMIT,
  paginationMeta,
  parsePagination,
} from "../utils/pagination.js";

function asObjectId(value) {
  const id = toObjectIdString(value);
  return id ? new mongoose.Types.ObjectId(id) : null;
}

async function findRecentNoisyEvents(candidates) {
  const noisy = candidates.filter((event) => COLLAPSE_TYPES.has(event.type));
  if (!noisy.length) return [];

  const visitorIds = [...new Set(noisy.map((event) => event.visitorId))];
  const oldest = noisy.reduce((min, event) => {
    const ts = event.createdAt.getTime();
    return ts < min ? ts : min;
  }, Date.now());

  return AnalyticsEvent.find({
    visitorId: { $in: visitorIds },
    type: { $in: [...COLLAPSE_TYPES] },
    createdAt: { $gte: new Date(oldest - COLLAPSE_WINDOW_MS) },
  })
    .select("type visitorId adId page createdAt")
    .lean();
}

async function resolveAdTitles(events) {
  const missing = [
    ...new Set(
      events
        .filter((event) => event.adId && !event.adTitle)
        .map((event) => event.adId)
    ),
  ];
  if (!missing.length) return events;

  const ads = await Ad.find({ _id: { $in: missing } }).select("title").lean();
  const titles = new Map(ads.map((ad) => [String(ad._id), ad.title]));
  return events.map((event) => {
    if (event.adId && !event.adTitle && titles.has(event.adId)) {
      return { ...event, adTitle: titles.get(event.adId) };
    }
    return event;
  });
}

async function incrementAdViews(events, userId) {
  const adViewIds = [
    ...new Set(events.filter((event) => event.type === "ad_view" && event.adId).map((event) => event.adId)),
  ];
  if (!adViewIds.length) return;

  const ads = await Ad.find({ _id: { $in: adViewIds } }).select("seller").lean();
  const ownerByAd = new Map(ads.map((ad) => [String(ad._id), String(ad.seller)]));
  const viewerId = toObjectIdString(userId);

  const counts = new Map();
  for (const event of events) {
    if (event.type !== "ad_view" || !event.adId) continue;
    if (!ownerByAd.has(event.adId)) continue;
    if (viewerId && ownerByAd.get(event.adId) === viewerId) continue;
    counts.set(event.adId, (counts.get(event.adId) || 0) + 1);
  }

  await Promise.all(
    [...counts.entries()].map(([adId, amount]) =>
      Ad.updateOne({ _id: adId }, { $inc: { views: amount } })
    )
  );
}

async function upsertVisitors(events) {
  const byVisitor = new Map();
  for (const event of events) {
    const current = byVisitor.get(event.visitorId) || {
      visitorId: event.visitorId,
      userId: null,
      firstSeenAt: event.createdAt,
      lastSeenAt: event.createdAt,
      pageViews: 0,
      adViews: 0,
      lastPage: null,
      lastAdId: null,
    };
    if (event.createdAt < current.firstSeenAt) current.firstSeenAt = event.createdAt;
    if (event.createdAt >= current.lastSeenAt) {
      current.lastSeenAt = event.createdAt;
      if (event.page) current.lastPage = event.page;
      if (event.adId) current.lastAdId = event.adId;
    }
    if (event.userId) current.userId = event.userId;
    if (event.type === "page_view" || event.type === "visit") current.pageViews += 1;
    if (event.type === "ad_view") current.adViews += 1;
    byVisitor.set(event.visitorId, current);
  }

  await Promise.all(
    [...byVisitor.values()].map(async (visitor) => {
      const setOnInsert = {
        visitorId: visitor.visitorId,
        firstSeenAt: visitor.firstSeenAt,
      };
      const set = { lastSeenAt: visitor.lastSeenAt };
      if (visitor.userId) set.userId = asObjectId(visitor.userId);
      if (visitor.lastPage) set.lastPage = visitor.lastPage;
      if (visitor.lastAdId) set.lastAdId = asObjectId(visitor.lastAdId);
      const inc = {};
      if (visitor.pageViews) inc.pageViews = visitor.pageViews;
      if (visitor.adViews) inc.adViews = visitor.adViews;

      const update = { $setOnInsert: setOnInsert, $set: set };
      if (Object.keys(inc).length) update.$inc = inc;
      try {
        await AnalyticsVisitor.updateOne({ visitorId: visitor.visitorId }, update, { upsert: true });
      } catch (err) {
        if (err?.code !== 11000) throw err;
        const retry = { $set: set };
        if (Object.keys(inc).length) retry.$inc = inc;
        await AnalyticsVisitor.updateOne({ visitorId: visitor.visitorId }, retry);
      }
    })
  );
}

function toStoredEvent(event) {
  return {
    type: event.type,
    visitorId: event.visitorId,
    sessionId: event.sessionId,
    userId: asObjectId(event.userId),
    page: event.page,
    adId: asObjectId(event.adId),
    adTitle: event.adTitle,
    detail: event.detail,
    path: event.path,
    createdAt: event.createdAt,
  };
}

export async function ingestAnalyticsEvents(rawEvents, { userId = null, now = new Date() } = {}) {
  const parsed = normalizeEventBatch(rawEvents, { userId, now });
  if (parsed.error) return parsed;

  let events = parsed.events;
  if (!events.length) return { stored: 0 };

  const recent = await findRecentNoisyEvents(events);
  events = events.filter((event) => !isNoisyRepeat(event, recent));
  if (!events.length) return { stored: 0 };

  events = await resolveAdTitles(events);
  await AnalyticsEvent.insertMany(events.map(toStoredEvent), { ordered: false });
  await Promise.all([incrementAdViews(events, userId), upsertVisitors(events)]);
  return { stored: events.length };
}

export async function incrementAdViewCounter({ adId, visitorId, userId = null, sessionId = "" } = {}) {
  const id = toObjectIdString(adId);
  if (!id) return { error: "adId is required", status: 400 };

  const ad = await Ad.findById(id).select("seller views title");
  if (!ad) return { error: "Ad not found", status: 404 };

  const viewerId = toObjectIdString(userId);
  const isOwner = Boolean(viewerId && String(ad.seller) === viewerId);
  if (isOwner) {
    return { views: ad.views || 0, skippedOwner: true };
  }

  if (visitorId) {
    await ingestAnalyticsEvents(
      [
        {
          type: "ad_view",
          visitorId,
          sessionId,
          adId: id,
          adTitle: ad.title,
          page: "detail",
          path: `/ads/${id}`,
          createdAt: new Date().toISOString(),
        },
      ],
      { userId: viewerId }
    );
    const fresh = await Ad.findById(id).select("views");
    return { views: fresh?.views || ad.views || 0 };
  }

  ad.views = (ad.views || 0) + 1;
  await ad.save();
  return { views: ad.views };
}

function formatViewer(group, usersById) {
  const user = group.userId ? usersById.get(String(group.userId)) : null;
  const profile = publicUserFields(user);
  const row = {
    visitorId: group.visitorId,
    viewCount: group.viewCount,
    lastViewedAt: group.lastViewedAt,
  };
  if (profile.userId) {
    row.userId = profile.userId;
    row.name = profile.name;
    row.email = profile.email;
    row.profilePic = profile.profilePic;
  } else {
    row.userId = null;
    row.name = null;
    row.email = null;
    row.profilePic = null;
  }
  return row;
}

const VIEWERS_PER_AD = 50;

function viewerIdentityExpr() {
  return {
    $cond: [
      { $ne: ["$userId", null] },
      { $concat: ["user:", { $toString: "$userId" }] },
      { $concat: ["visitor:", { $ifNull: ["$visitorId", ""] }] },
    ],
  };
}

function groupViewersByAd(events) {
  const adsMap = new Map();

  for (const event of events) {
    const adId = String(event.adId);
    const key = viewerGroupKey(event);
    if (!adsMap.has(adId)) {
      adsMap.set(adId, {
        _id: adId,
        title: event.adTitle || "",
        lastViewedAt: event.createdAt,
        eventViews: 0,
        viewers: new Map(),
      });
    }
    const ad = adsMap.get(adId);
    ad.eventViews += 1;
    if (event.createdAt > ad.lastViewedAt) ad.lastViewedAt = event.createdAt;
    if (event.adTitle && !ad.title) ad.title = event.adTitle;

    if (!ad.viewers.has(key)) {
      ad.viewers.set(key, {
        userId: toObjectIdString(event.userId),
        visitorId: event.visitorId,
        viewCount: 0,
        lastViewedAt: event.createdAt,
      });
    }
    const viewer = ad.viewers.get(key);
    viewer.viewCount += 1;
    if (event.createdAt > viewer.lastViewedAt) viewer.lastViewedAt = event.createdAt;
    if (!viewer.userId && event.userId) viewer.userId = toObjectIdString(event.userId);
  }

  return adsMap;
}

export async function getAdViewersDashboard({ page, limit } = {}) {
  const paging = parsePagination({ page, limit });
  const match = { type: "ad_view", adId: { $ne: null } };

  const [facet] = await AnalyticsEvent.aggregate([
    { $match: match },
    {
      $facet: {
        ads: [
          {
            $group: {
              _id: "$adId",
              title: { $first: "$adTitle" },
              lastViewedAt: { $max: "$createdAt" },
              eventViews: { $sum: 1 },
            },
          },
          { $sort: { lastViewedAt: -1, eventViews: -1, _id: -1 } },
          { $skip: paging.skip },
          { $limit: paging.limit },
        ],
        totalAds: [{ $group: { _id: "$adId" } }, { $count: "count" }],
        totalViews: [{ $count: "count" }],
        uniqueViewers: [{ $group: { _id: viewerIdentityExpr() } }, { $count: "count" }],
      },
    },
  ]);

  const pageRows = facet?.ads || [];
  const total = facet?.totalAds?.[0]?.count || 0;
  const totalViews = facet?.totalViews?.[0]?.count || 0;
  const uniqueViewers = facet?.uniqueViewers?.[0]?.count || 0;
  const meta = paginationMeta({ ...paging, total });
  const stats = {
    totalViews,
    uniqueViewers,
    adsViewed: total,
  };

  if (!pageRows.length) {
    return { ads: [], stats, ...meta };
  }

  const adIds = pageRows.map((row) => row._id);
  const events = await AnalyticsEvent.find({ type: "ad_view", adId: { $in: adIds } })
    .select("adId adTitle visitorId userId createdAt")
    .sort({ createdAt: -1 })
    .lean();

  const adsMap = groupViewersByAd(events);
  const adDocs = await Ad.find({ _id: { $in: adIds } })
    .select("title images views")
    .lean();
  const adById = new Map(adDocs.map((ad) => [String(ad._id), ad]));

  const userIds = [
    ...new Set(
      [...adsMap.values()].flatMap((ad) =>
        [...ad.viewers.values()].map((viewer) => viewer.userId).filter(Boolean)
      )
    ),
  ];
  const users = await User.find({ _id: { $in: userIds } })
    .select("name email profilePic")
    .lean();
  const usersById = new Map(users.map((user) => [String(user._id), user]));

  const ads = pageRows.map((row) => {
    const adId = String(row._id);
    const grouped = adsMap.get(adId);
    const doc = adById.get(adId);
    const eventViews = grouped?.eventViews ?? row.eventViews ?? 0;
    const viewers = grouped
      ? [...grouped.viewers.values()]
          .sort((a, b) => new Date(b.lastViewedAt) - new Date(a.lastViewedAt))
          .slice(0, VIEWERS_PER_AD)
          .map((viewer) => formatViewer(viewer, usersById))
      : [];
    return {
      _id: adId,
      title: doc?.title || grouped?.title || row.title || "",
      images: doc?.images || [],
      views: typeof doc?.views === "number" ? Math.max(doc.views, eventViews) : eventViews,
      uniqueViewers: grouped?.viewers.size ?? 0,
      lastViewedAt: grouped?.lastViewedAt || row.lastViewedAt,
      viewers,
    };
  });

  return { ads, stats, ...meta };
}

export async function getVisitorsDashboard({ page, limit } = {}) {
  const paging = parsePagination({ page, limit });
  const [visitors, total, signedIn] = await Promise.all([
    AnalyticsVisitor.find()
      .sort({ lastSeenAt: -1 })
      .skip(paging.skip)
      .limit(paging.limit)
      .populate({ path: "userId", select: "name email profilePic" })
      .lean(),
    AnalyticsVisitor.countDocuments(),
    AnalyticsVisitor.countDocuments({ userId: { $ne: null } }),
  ]);

  return {
    visitors: visitors.map((visitor) => {
      const user = visitor.userId && typeof visitor.userId === "object" ? visitor.userId : null;
      const profile = publicUserFields(user);
      return {
        visitorId: visitor.visitorId,
        userId: profile.userId,
        name: profile.userId ? profile.name : null,
        email: profile.userId ? profile.email : null,
        profilePic: profile.userId ? profile.profilePic : null,
        firstSeenAt: visitor.firstSeenAt,
        lastSeenAt: visitor.lastSeenAt,
        pageViews: visitor.pageViews || 0,
        adViews: visitor.adViews || 0,
        lastPage: visitor.lastPage || null,
      };
    }),
    stats: {
      total,
      signedIn,
      anonymous: Math.max(0, total - signedIn),
    },
    ...paginationMeta({ ...paging, total }),
  };
}

export async function getActivityLogPage({ page, limit, type } = {}) {
  const paging = parsePagination({ page, limit }, { defaultLimit: ACTIVITY_LOG_DEFAULT_LIMIT });
  const filter = {};
  if (type && type !== "all") {
    if (EVENT_TYPE_SET.has(type)) filter.type = type;
    else filter.type = type;
  }

  const [logs, total] = await Promise.all([
    AnalyticsEvent.find(filter)
      .sort({ createdAt: -1 })
      .skip(paging.skip)
      .limit(paging.limit)
      .populate({ path: "userId", select: "name email profilePic" })
      .lean(),
    AnalyticsEvent.countDocuments(filter),
  ]);

  return {
    logs: logs.map((event) => {
      const user = event.userId && typeof event.userId === "object" ? event.userId : null;
      const profile = publicUserFields(user);
      return {
        _id: String(event._id),
        type: event.type,
        userId: profile.userId,
        visitorId: event.visitorId,
        name: profile.userId ? profile.name : null,
        email: profile.userId ? profile.email : null,
        profilePic: profile.userId ? profile.profilePic : null,
        page: event.page || null,
        adId: event.adId ? String(event.adId) : null,
        adTitle: event.adTitle || null,
        detail: typeof event.detail === "string" ? event.detail : "",
        message: "",
        createdAt: event.createdAt,
      };
    }),
    ...paginationMeta({ ...paging, total }),
  };
}
