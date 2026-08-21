/**
 * Remove seeded demo listings (and related chats/reviews/analytics/favorites).
 *
 * Demo ads are identified the same way the web and mobile clients flag them:
 * a `[dealr-seeded]` marker in the description, or a trailing `[Demo]` tag.
 *
 * Usage (from dealr-backend):
 *   node scripts/removeDemoListings.js          # dry run (default)
 *   node scripts/removeDemoListings.js --apply  # delete matching ads
 *
 * Requires MONGO_URI in the environment (.env is loaded automatically).
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import { removeDemoListings } from "../services/demoListings.cleanup.js";

dotenv.config();

async function run() {
  if (!process.env.MONGO_URI) {
    console.error("❌ MONGO_URI is not set. Add it to your .env file.");
    process.exit(1);
  }

  const apply = process.argv.includes("--apply");
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ Connected to MongoDB");

  const summary = await removeDemoListings({ apply });
  console.log(JSON.stringify(summary, null, 2));

  if (summary.dryRun) {
    console.log(`🔎 Dry run: ${summary.ads} demo listing(s) would be removed. Re-run with --apply to delete.`);
  } else if (summary.deleted) {
    console.log(`🗑️  Removed ${summary.ads} demo listing(s).`);
  } else {
    console.log("✨ No demo listings found.");
  }

  await mongoose.disconnect();
  console.log("👋 Disconnected");
}

run().catch(async (err) => {
  console.error("❌ Demo listing cleanup failed:", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
