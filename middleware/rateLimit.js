const buckets = new Map();

function clientKey(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

/**
 * In-memory IP limiter. Fine for a single Render instance.
 */
export function rateLimit({ windowMs = 60_000, max = 60, message = "Too many requests" } = {}) {
  return (req, res, next) => {
    const key = `${req.baseUrl || ""}${req.path}:${clientKey(req)}`;
    const now = Date.now();
    const recent = (buckets.get(key) || []).filter((ts) => now - ts < windowMs);
    if (recent.length >= max) {
      return res.status(429).json({ message });
    }
    recent.push(now);
    buckets.set(key, recent);
    if (buckets.size > 5000) {
      for (const [bucketKey, times] of buckets) {
        const kept = times.filter((ts) => now - ts < windowMs);
        if (kept.length) buckets.set(bucketKey, kept);
        else buckets.delete(bucketKey);
      }
    }
    next();
  };
}

export const analyticsTrackLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  message: "Too many analytics requests",
});
