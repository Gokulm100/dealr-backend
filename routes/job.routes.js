import express from "express";
import { runReengagement } from "../controllers/job.controller.js";

const router = express.Router();

router.post("/reengagement", runReengagement);

export default router;
