import express from "express";
import { optionalAuth } from "../middleware/auth.js";
import { analyticsTrackLimiter } from "../middleware/rateLimit.js";
import { trackEvents } from "../controllers/analytics.controller.js";

const router = express.Router();

router.post("/track", analyticsTrackLimiter, optionalAuth, trackEvents);

export default router;
