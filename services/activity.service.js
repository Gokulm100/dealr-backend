import User from "../models/user.model.js";

const lastTouchMs = new Map();
const THROTTLE_MS = 30 * 60 * 1000;

/**
 * Record that a user opened or used the app. Throttled so browsing does not
 * write the user document on every request.
 */
export function touchLastActive(userId) {
  if (!userId) return;
  const id = String(userId);
  const now = Date.now();
  const previous = lastTouchMs.get(id);
  if (previous && now - previous < THROTTLE_MS) return;

  lastTouchMs.set(id, now);
  User.updateOne({ _id: id }, { $set: { lastActiveAt: new Date(now) } }).catch((err) => {
    lastTouchMs.delete(id);
    console.error("touchLastActive failed:", err?.message || err);
  });
}
