import express from "express";
import { cleanupDemoListings, runReengagement } from "../controllers/job.controller.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = express.Router();

const demoCleanupLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  message: "Too many demo cleanup requests",
});

router.post("/reengagement", runReengagement);
// TEMPORARY: remove after demo listings are deleted from production.
router.post("/cleanup-demo-listings", demoCleanupLimiter, cleanupDemoListings);

export default router;
