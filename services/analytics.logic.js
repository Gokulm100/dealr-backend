export const EVENT_TYPES = [
  "visit",
  "page_view",
  "ad_view",
  "login",
  "logout",
  "post_ad",
  "edit_ad",
  "search",
  "chat",
  "report",
];

export const EVENT_TYPE_SET = new Set(EVENT_TYPES);
export const COLLAPSE_TYPES = new Set(["visit", "page_view", "ad_view"]);
export const COLLAPSE_WINDOW_MS = 10 * 60 * 1000;
export const MAX_EVENTS_PER_REQUEST = 100;
export const MAX_CREATED_AT_FUTURE_MS = 7 * 24 * 60 * 60 * 1000;

export const FIELD_LIMITS = {
  visitorId: 80,
  sessionId: 80,
  page: 80,
  detail: 300,
  path: 500,
  adTitle: 200,
};

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

export function capString(value, max) {
  if (value == null) return null;
  if (typeof value === "object") return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, max);
}

export function asDetailString(value) {
  if (value == null) return null;
  if (typeof value === "string") return capString(value, FIELD_LIMITS.detail);
  if (typeof value === "number" || typeof value === "boolean") {
    return capString(String(value), FIELD_LIMITS.detail);
  }
  return null;
}

export function isObjectIdString(value) {
  return typeof value === "string" && OBJECT_ID_RE.test(value);
}

export function toObjectIdString(value) {
  if (value == null || value === "") return null;
  if (typeof value === "object") {
    if (value._bsontype === "ObjectId" || typeof value.toHexString === "function") {
      const hex = typeof value.toHexString === "function" ? value.toHexString() : String(value);
      return isObjectIdString(hex) ? hex : null;
    }
    if (value._id && value._id !== value) return toObjectIdString(value._id);
    return null;
  }
  const text = String(value);
  return isObjectIdString(text) ? text : null;
}

export function resolveEventTime(createdAt, now = new Date()) {
  const fallback = now instanceof Date ? now : new Date(now);
  if (createdAt == null || createdAt === "") return fallback;
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) return fallback;
  if (parsed.getTime() > fallback.getTime() + MAX_CREATED_AT_FUTURE_MS) return fallback;
  return parsed;
}

export function isAdminEmail(email, env = process.env) {
  const raw = env.ADMIN_EMAILS || env.ADMIN_EMAIL || "";
  const allowed = String(raw)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (!email || allowed.length === 0) return false;
  return allowed.includes(String(email).trim().toLowerCase());
}

export function userIsAdmin(user, env = process.env) {
  if (!user) return false;
  if (user.isAdmin === true) return true;
  return isAdminEmail(user.email, env);
}

export function isNoisyRepeat(event, recentEvents = [], windowMs = COLLAPSE_WINDOW_MS) {
  if (!event || !COLLAPSE_TYPES.has(event.type) || !event.visitorId) return false;
  const createdAt = event.createdAt instanceof Date ? event.createdAt.getTime() : new Date(event.createdAt).getTime();
  if (!Number.isFinite(createdAt)) return false;

  return recentEvents.some((other) => {
    if (!other || other.visitorId !== event.visitorId || other.type !== event.type) return false;
    const otherAt = other.createdAt instanceof Date ? other.createdAt.getTime() : new Date(other.createdAt).getTime();
    if (!Number.isFinite(otherAt) || Math.abs(createdAt - otherAt) > windowMs) return false;
    if (event.type === "ad_view") {
      return String(other.adId || "") === String(event.adId || "");
    }
    return String(other.page || "") === String(event.page || "");
  });
}

export function viewerGroupKey({ userId, visitorId } = {}) {
  const user = toObjectIdString(userId);
  if (user) return `user:${user}`;
  return `visitor:${String(visitorId || "").trim()}`;
}

export function normalizeIncomingEvent(raw, { userId = null, now = new Date() } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!EVENT_TYPE_SET.has(raw.type)) return null;

  const visitorId = capString(raw.visitorId, FIELD_LIMITS.visitorId);
  if (!visitorId) return null;

  const tokenUserId = toObjectIdString(userId);
  return {
    type: raw.type,
    visitorId,
    sessionId: capString(raw.sessionId, FIELD_LIMITS.sessionId) || "",
    userId: tokenUserId,
    page: capString(raw.page, FIELD_LIMITS.page),
    adId: toObjectIdString(raw.adId),
    adTitle: capString(raw.adTitle, FIELD_LIMITS.adTitle),
    detail: asDetailString(raw.detail),
    path: capString(raw.path, FIELD_LIMITS.path),
    createdAt: resolveEventTime(raw.createdAt, now),
  };
}

export function normalizeEventBatch(events, { userId = null, now = new Date() } = {}) {
  if (!Array.isArray(events)) return { error: "events must be an array" };
  if (events.length === 0) return { error: "events must not be empty" };
  const batch = events.slice(0, MAX_EVENTS_PER_REQUEST);
  const normalized = [];
  for (const raw of batch) {
    const event = normalizeIncomingEvent(raw, { userId, now });
    if (!event) continue;
    if (isNoisyRepeat(event, normalized)) continue;
    normalized.push(event);
  }
  return { events: normalized };
}

export function publicUserFields(user) {
  if (!user) {
    return {
      userId: null,
      name: null,
      email: null,
      profilePic: null,
    };
  }
  return {
    userId: toObjectIdString(user._id || user.id) || null,
    name: user.name || null,
    email: user.email || null,
    profilePic: user.profilePic || null,
  };
}
