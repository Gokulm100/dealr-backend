import mongoose from "mongoose";
import { EVENT_TYPES } from "../services/analytics.logic.js";

const analyticsEventSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: EVENT_TYPES,
    },
    visitorId: {
      type: String,
      required: true,
    },
    sessionId: {
      type: String,
      default: "",
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    page: {
      type: String,
      default: null,
    },
    adId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ad",
      default: null,
    },
    adTitle: {
      type: String,
      default: null,
    },
    detail: {
      type: String,
      default: null,
    },
    path: {
      type: String,
      default: null,
    },
    createdAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  { timestamps: false, versionKey: false }
);

analyticsEventSchema.index({ createdAt: -1 });
analyticsEventSchema.index({ type: 1, createdAt: -1 });
analyticsEventSchema.index({ visitorId: 1, createdAt: -1 });
analyticsEventSchema.index({ adId: 1, createdAt: -1 });
analyticsEventSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model("AnalyticsEvent", analyticsEventSchema);
