import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    googleId: {
      type: String,
      required: true,
      unique: true,
    },
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    profilePic: {
      type: String, // URL to Google profile image
    },
    // Optional fields for future use
    createdAt: {
      type: Date,
      default: Date.now,
    },
    lastLogin: {
      type: Date,
    },
    lastActiveAt: {
      type: Date,
    },
    lastReengagementAt: {
      type: Date,
    },
    lastReengagementCampaign: {
      type: String,
    },
    fcmToken: {
      type: String,
    },
    isConsented: {
      type: Boolean,
      default: false,
    },
    reportCounter: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isBlocked: {
      type: Boolean,
      default: false,
    },
    ratingAvg: {
      type: Number,
      default: 0,
    },
    reviewCount: {
      type: Number,
      default: 0,
    },
    completedSales: {
      type: Number,
      default: 0,
    },
    trustScore: {
      type: Number,
      default: 50,
    },
    responseRate: {
      type: Number,
      default: null,
    },
    badges: [
      {
        _id: false,
        id: { type: String, required: true },
        label: { type: String, required: true },
        level: { type: String, required: true },
      },
    ],
    lastViewedAds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Ad",
      },
    ],
    topViewedCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdCategory",
    },
    favoriteAds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Ad",
      },
    ],
  },
  { versionKey: false }
);

userSchema.index({ lastActiveAt: 1 });
userSchema.index({ lastReengagementAt: 1 });
userSchema.index({ topViewedCategory: 1 });

export default mongoose.model("User", userSchema);
