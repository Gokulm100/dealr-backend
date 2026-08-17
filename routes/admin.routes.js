import express from "express";
import { requireAdmin } from "../middleware/auth.js";
import {
  getUsers,
  setUserActive,
  getReports,
  updateReport,
  getAdViewers,
  getVisitors,
  getActivityLog,
} from "../controllers/admin.controller.js";

const router = express.Router();

router.post("/getUsers", requireAdmin, getUsers);
router.post("/setUserActive", requireAdmin, setUserActive);
router.post("/getReports", requireAdmin, getReports);
router.post("/updateReport", requireAdmin, updateReport);
router.post("/getAdViewers", requireAdmin, getAdViewers);
router.post("/getVisitors", requireAdmin, getVisitors);
router.post("/getActivityLog", requireAdmin, getActivityLog);

export default router;
