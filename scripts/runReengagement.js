import 'dotenv/config';
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import { runReengagementJob } from "../services/reengagement.service.js";

const dryRun = process.argv.includes("--dry-run");

try {
  await connectDB();
  const summary = await runReengagementJob({ dryRun });
  console.log(JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
  process.exit(summary.failed ? 1 : 0);
} catch (err) {
  console.error("Re-engagement job failed:", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
}
