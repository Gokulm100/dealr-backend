import { runReengagementJob } from "../services/reengagement.service.js";
import { removeDemoListings } from "../services/demoListings.cleanup.js";

/** One-shot confirm phrase so this temporary route is not a bare GET. Remove after use. */
export const DEMO_CLEANUP_CONFIRM = "delete-demo-listings";

export const runReengagement = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const provided = req.header("x-cron-secret");
  if (!secret || provided !== secret) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const dryRun = req.query.dryRun === "true" || req.body?.dryRun === true;
    const summary = await runReengagementJob({ dryRun });
    return res.json(summary);
  } catch (err) {
    console.error("Re-engagement job failed:", err);
    return res.status(500).json({ message: err.message || "Re-engagement job failed" });
  }
};

export const cleanupDemoListings = async (req, res) => {
  const confirm = req.body?.confirm ?? req.query?.confirm;
  if (confirm !== DEMO_CLEANUP_CONFIRM) {
    return res.status(400).json({
      message: `Temporary demo cleanup requires confirm=${DEMO_CLEANUP_CONFIRM}`,
    });
  }

  const apply = req.query?.apply === "true" || req.body?.apply === true;
  try {
    const summary = await removeDemoListings({ apply });
    return res.json(summary);
  } catch (err) {
    console.error("Demo listing cleanup failed:", err);
    return res.status(500).json({ message: err.message || "Demo listing cleanup failed" });
  }
};
