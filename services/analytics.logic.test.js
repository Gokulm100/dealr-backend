import assert from "node:assert/strict";
import {
  COLLAPSE_WINDOW_MS,
  EVENT_TYPES,
  asDetailString,
  capString,
  isAdminEmail,
  isNoisyRepeat,
  normalizeEventBatch,
  normalizeIncomingEvent,
  publicUserFields,
  resolveEventTime,
  toObjectIdString,
  userIsAdmin,
  viewerGroupKey,
} from "./analytics.logic.js";

assert.equal(EVENT_TYPES.includes("ad_view"), true);
assert.equal(capString("  abc  ", 2), "ab");
assert.equal(capString({ sneaky: true }, 10), null);
assert.equal(asDetailString({ q: "honda" }), null);
assert.equal(asDetailString("honda activa"), "honda activa");
assert.equal(toObjectIdString("64b000000000000000000001"), "64b000000000000000000001");
assert.equal(toObjectIdString("not-an-id"), null);
assert.equal(
  toObjectIdString({
    _bsontype: "ObjectId",
    toHexString: () => "64b000000000000000000001",
  }),
  "64b000000000000000000001"
);
assert.equal(toObjectIdString({ _id: "64b000000000000000000002" }), "64b000000000000000000002");

const now = new Date("2026-08-17T10:00:00.000Z");
assert.equal(resolveEventTime(null, now).toISOString(), now.toISOString());
assert.equal(resolveEventTime("not-a-date", now).toISOString(), now.toISOString());
assert.equal(
  resolveEventTime("2026-08-17T09:00:00.000Z", now).toISOString(),
  "2026-08-17T09:00:00.000Z"
);
assert.equal(
  resolveEventTime("2026-08-30T10:00:00.000Z", now).toISOString(),
  now.toISOString()
);

assert.equal(isAdminEmail("a@x.com", { ADMIN_EMAILS: "a@x.com, b@x.com" }), true);
assert.equal(isAdminEmail("c@x.com", { ADMIN_EMAILS: "a@x.com" }), false);
assert.equal(userIsAdmin({ isAdmin: true, email: "c@x.com" }, { ADMIN_EMAILS: "" }), true);
assert.equal(userIsAdmin({ isAdmin: false, email: "a@x.com" }, { ADMIN_EMAILS: "a@x.com" }), true);
assert.equal(userIsAdmin({ isAdmin: false, email: "c@x.com" }, { ADMIN_EMAILS: "a@x.com" }), false);

assert.equal(
  viewerGroupKey({ userId: "64b000000000000000000001", visitorId: "v1" }),
  "user:64b000000000000000000001"
);
assert.equal(viewerGroupKey({ userId: null, visitorId: "v1" }), "visitor:v1");

const dropped = normalizeIncomingEvent({ type: "hack", visitorId: "v1" });
assert.equal(dropped, null);

const spoofed = normalizeIncomingEvent(
  {
    type: "visit",
    visitorId: "visitor-1",
    sessionId: "sess-1",
    userId: "64b000000000000000000099",
    userName: "Guest",
    page: "home",
    path: "/",
  },
  { userId: null, now }
);
assert.equal(spoofed.userId, null);
assert.equal(spoofed.visitorId, "visitor-1");
assert.equal(Object.prototype.hasOwnProperty.call(spoofed, "userName"), false);

const authed = normalizeIncomingEvent(
  {
    type: "ad_view",
    visitorId: "visitor-1",
    sessionId: "sess-1",
    userId: "64b000000000000000000099",
    adId: "64b000000000000000000010",
    adTitle: "Honda Activa",
    page: "detail",
    path: "/ads/1",
  },
  { userId: "64b000000000000000000001", now }
);
assert.equal(authed.userId, "64b000000000000000000001");

const emptyBatch = normalizeEventBatch([], { now });
assert.equal(emptyBatch.error.includes("empty"), true);
const notArray = normalizeEventBatch(null, { now });
assert.equal(notArray.error.includes("array"), true);

const mixed = normalizeEventBatch(
  [
    { type: "nope", visitorId: "v1" },
    { type: "visit", visitorId: "v1", sessionId: "s", page: "home", path: "/" },
    { type: "visit", visitorId: "v1", sessionId: "s", page: "home", path: "/" },
    { type: "search", visitorId: "v1", sessionId: "s", detail: "activa", page: "home", path: "/" },
    { type: "search", visitorId: "v1", sessionId: "s", detail: "activa", page: "home", path: "/" },
  ],
  { now }
);
assert.equal(mixed.events.length, 3);
assert.deepEqual(
  mixed.events.map((event) => event.type),
  ["visit", "search", "search"]
);

const recent = [
  {
    type: "ad_view",
    visitorId: "v1",
    adId: "64b000000000000000000010",
    createdAt: now,
  },
];
assert.equal(
  isNoisyRepeat(
    {
      type: "ad_view",
      visitorId: "v1",
      adId: "64b000000000000000000010",
      createdAt: new Date(now.getTime() + 60_000),
    },
    recent,
    COLLAPSE_WINDOW_MS
  ),
  true
);
assert.equal(
  isNoisyRepeat(
    {
      type: "login",
      visitorId: "v1",
      createdAt: new Date(now.getTime() + 60_000),
    },
    recent,
    COLLAPSE_WINDOW_MS
  ),
  false
);

assert.deepEqual(publicUserFields(null), {
  userId: null,
  name: null,
  email: null,
  profilePic: null,
});
assert.equal(publicUserFields({ _id: "64b000000000000000000001", name: "Priya" }).name, "Priya");

const oversized = normalizeIncomingEvent({
  type: "search",
  visitorId: "v".repeat(200),
  sessionId: "s",
  detail: "q".repeat(500),
  path: "/".repeat(800),
  adTitle: "t".repeat(300),
});
assert.equal(oversized.visitorId.length, 80);
assert.equal(oversized.detail.length, 300);
assert.equal(oversized.path.length, 500);
assert.equal(oversized.adTitle.length, 200);

console.log("analytics.logic tests passed");
