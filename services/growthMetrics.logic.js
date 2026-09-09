/**
 * EXP-1 growth metrics: pure, side-effect-free computation over normalized
 * activity records. The DB/query layer lives in growthMetrics.service.js and
 * feeds these functions simple arrays so the math stays unit-testable.
 *
 * An "activity record" is: { actorKey, type, at: Date, adId?, category?, location?, sellerId? }
 * where actorKey identifies a person as "user:<id>" (preferred) or "visitor:<vid>".
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

// Stages of the marketplace funnel, in order. Each stage lists the event types
// that count as "reached this stage".
export const FUNNEL_STAGES = [
  { key: "visit", label: "Visited", types: ["visit", "page_view"] },
  { key: "browse", label: "Viewed a listing", types: ["ad_view"] },
  { key: "auth", label: "Signed in", types: ["login", "user_registered"] },
  { key: "inquiry", label: "Contacted a seller", types: ["contact_seller", "chat", "offer_made"] },
  { key: "supply", label: "Posted a listing", types: ["post_ad"] },
];

export function toDate(value) {
  if (value instanceof Date) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function dayKey(value) {
  const d = toDate(value);
  if (!d) return null;
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

export function withinDays(at, now, days) {
  const a = toDate(at);
  const n = toDate(now);
  if (!a || !n) return false;
  const diff = n.getTime() - a.getTime();
  return diff >= 0 && diff <= days * DAY_MS;
}

/**
 * Collapse raw activity records into per-actor summaries.
 * Returns Map<actorKey, { actorKey, isUser, firstAt, lastAt, days:Set<string>, types:Set<string> }>.
 */
export function buildActorActivity(records = []) {
  const byActor = new Map();
  for (const rec of records) {
    if (!rec || !rec.actorKey) continue;
    const at = toDate(rec.at);
    if (!at) continue;
    let entry = byActor.get(rec.actorKey);
    if (!entry) {
      entry = {
        actorKey: rec.actorKey,
        isUser: rec.actorKey.startsWith("user:"),
        firstAt: at,
        lastAt: at,
        days: new Set(),
        types: new Set(),
      };
      byActor.set(rec.actorKey, entry);
    }
    if (at < entry.firstAt) entry.firstAt = at;
    if (at > entry.lastAt) entry.lastAt = at;
    entry.days.add(dayKey(at));
    if (rec.type) entry.types.add(rec.type);
  }
  return byActor;
}

/** Distinct active actors in the trailing 1 / 7 / 30 day windows. */
export function activeCounts(actorActivity, now = new Date()) {
  let dau = 0;
  let wau = 0;
  let mau = 0;
  for (const entry of actorActivity.values()) {
    if (withinDays(entry.lastAt, now, 1)) dau += 1;
    if (withinDays(entry.lastAt, now, 7)) wau += 1;
    if (withinDays(entry.lastAt, now, 30)) mau += 1;
  }
  return { dau, wau, mau };
}

/**
 * New vs returning among actors active in the trailing `windowDays`.
 * "New" = first ever activity also falls within the window.
 */
export function newVsReturning(actorActivity, now = new Date(), windowDays = 30) {
  let active = 0;
  let isNew = 0;
  for (const entry of actorActivity.values()) {
    if (!withinDays(entry.lastAt, now, windowDays)) continue;
    active += 1;
    if (withinDays(entry.firstAt, now, windowDays)) isNew += 1;
  }
  return { active, new: isNew, returning: active - isNew };
}

/**
 * "Returned within N days" retention, cohorted by first-seen day.
 * A cohort member is retained at DN if they have any activity on a calendar day
 * in (firstDay, firstDay + N days]. Only cohorts old enough to have a full
 * N-day window (firstDay + N <= now) are counted, to avoid censoring.
 */
export function retentionCohorts(actorActivity, now = new Date(), windows = [1, 7, 30]) {
  const n = toDate(now) || new Date();
  const result = {};
  for (const w of windows) {
    let eligible = 0;
    let retained = 0;
    for (const entry of actorActivity.values()) {
      const first = entry.firstAt;
      const windowEnd = first.getTime() + w * DAY_MS;
      if (windowEnd > n.getTime()) continue; // not enough elapsed time
      eligible += 1;
      const firstDay = dayKey(first);
      const returned = [...entry.days].some((d) => {
        if (d === firstDay) return false;
        const dt = toDate(`${d}T00:00:00.000Z`);
        return dt && dt.getTime() > first.getTime() && dt.getTime() <= windowEnd;
      });
      if (returned) retained += 1;
    }
    result[`d${w}`] = {
      eligible,
      retained,
      rate: eligible ? Number((retained / eligible).toFixed(4)) : null,
    };
  }
  return result;
}

/** Distinct actors reaching each funnel stage, with step conversion rates. */
export function funnelFromActivity(actorActivity, stages = FUNNEL_STAGES) {
  const counts = stages.map((stage) => {
    let n = 0;
    for (const entry of actorActivity.values()) {
      if (stage.types.some((t) => entry.types.has(t))) n += 1;
    }
    return { key: stage.key, label: stage.label, count: n };
  });
  return counts.map((row, i) => {
    const prev = i === 0 ? row.count : counts[i - 1].count;
    const first = counts[0].count;
    return {
      ...row,
      stepConversion: prev ? Number((row.count / prev).toFixed(4)) : null,
      overallConversion: first ? Number((row.count / first).toFixed(4)) : null,
    };
  });
}

/**
 * Marketplace liquidity from active listings and inquiry records.
 * @param {Array} activeListings - [{ adId, sellerId, category, location }]
 * @param {Array} inquiries      - [{ adId, buyerKey }] (one per distinct buyer↔ad)
 */
export function liquidity(activeListings = [], inquiries = []) {
  const listings = activeListings.length;
  const sellers = new Set(activeListings.map((l) => String(l.sellerId)).filter(Boolean));
  const activeSellers = sellers.size;

  const inquiriesByAd = new Map();
  for (const inq of inquiries) {
    const key = String(inq.adId);
    if (!key || key === "undefined") continue;
    if (!inquiriesByAd.has(key)) inquiriesByAd.set(key, new Set());
    inquiriesByAd.get(key).add(String(inq.buyerKey || ""));
  }
  const totalInquiries = [...inquiriesByAd.values()].reduce((sum, s) => sum + s.size, 0);
  const listingsWithInquiry = activeListings.filter((l) => inquiriesByAd.has(String(l.adId))).length;

  return {
    activeListings: listings,
    activeSellers,
    listingsPerActiveSeller: activeSellers ? Number((listings / activeSellers).toFixed(2)) : null,
    totalInquiries,
    inquiriesPerListing: listings ? Number((totalInquiries / listings).toFixed(2)) : null,
    listingToInquiryConversion: listings ? Number((listingsWithInquiry / listings).toFixed(4)) : null,
  };
}

/**
 * Supply/demand by dimension (category or location). demandByKey usually comes
 * from ad_view / contact_seller counts mapped to the listing's dimension.
 * Returns rows sorted by an underservedness score (demand high, supply low).
 */
export function liquidityByDimension(activeListings = [], demandByKey = new Map(), dimension = "category", limit = 20) {
  const supply = new Map();
  for (const l of activeListings) {
    const key = l[dimension] || "(unknown)";
    supply.set(key, (supply.get(key) || 0) + 1);
  }
  const keys = new Set([...supply.keys(), ...demandByKey.keys()]);
  const rows = [...keys].map((key) => {
    const s = supply.get(key) || 0;
    const d = demandByKey.get(key) || 0;
    return {
      key,
      supply: s,
      demand: d,
      // Higher = more demand relative to supply (underserved / needs more sellers).
      demandPerListing: s ? Number((d / s).toFixed(2)) : (d > 0 ? Infinity : 0),
    };
  });
  rows.sort((a, b) => {
    const av = a.demandPerListing === Infinity ? Number.MAX_SAFE_INTEGER : a.demandPerListing;
    const bv = b.demandPerListing === Infinity ? Number.MAX_SAFE_INTEGER : b.demandPerListing;
    if (bv !== av) return bv - av;
    return b.demand - a.demand;
  });
  return rows.slice(0, limit).map((r) => ({
    ...r,
    demandPerListing: r.demandPerListing === Infinity ? null : r.demandPerListing,
  }));
}

/** Notification open rate from received/opened counts. */
export function notificationOpenRate(received = 0, opened = 0) {
  const r = Number(received) || 0;
  const o = Number(opened) || 0;
  return {
    received: r,
    opened: o,
    openRate: r ? Number((o / r).toFixed(4)) : null,
  };
}
