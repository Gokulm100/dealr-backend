import mongoose from "mongoose";

const analyticsVisitorSchema = new mongoose.Schema(
  {
    visitorId: {
      type: String,
      required: true,
      unique: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    firstSeenAt: {
      type: Date,
      required: true,
    },
    lastSeenAt: {
      type: Date,
      required: true,
    },
    pageViews: {
      type: Number,
      default: 0,
    },
    adViews: {
      type: Number,
      default: 0,
    },
    lastPage: {
      type: String,
      default: null,
    },
    lastAdId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ad",
      default: null,
    },
  },
  { timestamps: false, versionKey: false }
);

analyticsVisitorSchema.index({ lastSeenAt: -1 });
analyticsVisitorSchema.index({ userId: 1 });

export default mongoose.model("AnalyticsVisitor", analyticsVisitorSchema);
