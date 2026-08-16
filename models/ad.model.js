import mongoose from "mongoose";

const adSchema = new mongoose.Schema(
    {
        title: { type: String, required: true },
        price: { type: Number, required: true },
        location: { type: String, required: true },
        category: { type: mongoose.Schema.Types.ObjectId, ref: "AdCategory", required: true },
        subCategory: { type: String, required: false },
        images: [{ type: String, required: true }],
        // True when images[0] is a generated title/price/location banner, not a user photo.
        hasGeneratedBanner: { type: Boolean, default: false },
        description: { type: String, required: true },
        aiSummary: { type: mongoose.Schema.Types.Mixed, default: null },
        seller: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        posted: { type: Date, required: true, default: Date.now },
        usersInterested: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
        views: { type: Number, default: 0 },
        isActive: { type: Boolean, default: true },
        isSold: { type: Boolean, default: false },
        soldTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        soldAt: { type: Date, default: null },
        reportCounter: { type: Number, default: 0 },
        reportReasons: [
            {
                _id: false,
                reasonId: { type: mongoose.Schema.Types.ObjectId, ref: "ReportReason", required: true },
                count: { type: Number, default: 1 },
            },
        ],
    },
    { timestamps: true }
);

export default mongoose.model("Ad", adSchema);
