import { runReengagementJob } from "../services/reengagement.service.js";

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
