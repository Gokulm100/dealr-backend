import { ingestAnalyticsEvents } from "../services/analytics.service.js";

export const trackEvents = async (req, res) => {
  try {
    const events = req.body?.events;
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ message: "events must be a non-empty array" });
    }

    const result = await ingestAnalyticsEvents(events, { userId: req.user?.id || null });
    if (result.error) {
      return res.status(400).json({ message: result.error });
    }
    return res.status(204).send();
  } catch (err) {
    console.error("analytics track failed:", err);
    return res.status(500).json({ message: err.message });
  }
};
