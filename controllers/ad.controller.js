import Chat from "../models/chat.model.js";
import Ad from "../models/ad.model.js";
import User from "../models/user.model.js";
import AdCategory from "../models/ad.category.model.js";
import ReportReason from "../models/reportReason.model.js";
import {analyzeDescription,aiSearchAds,analyzeChatForFraud,generateDescription,extractAdFromImages} from "../aiAnalyzer/aiAnalyzer.js";
import { sendChatNotification, sendReviewPromptNotification } from "../services/pushService.js";
import { notifyUsersOfNewAd, recordAdViewHistory } from "../services/categoryMatchNotify.service.js";
import { PUBLIC_TRUST_SELECT, recalculateUserTrust, formatTrustProfile } from "../services/trustScore.service.js";
import { ensureLocationExists } from "../services/location.service.js";
import { createAdBannerImage } from "../services/adBanner.service.js";
import { incrementAdViewCounter } from "../services/analytics.service.js";
import {
  collectUploadedImageUrls,
  shouldGenerateAdBanner,
} from "../services/adBanner.logic.js";
import { getSocket } from "../socket.js";
import mongoose from "mongoose";

function toIdStr(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  if (value._id) return value._id.toString();
  return value.toString();
}

// Build the AI key-value summary for an ad. Best-effort: returns null on any failure
// so it never blocks ad creation/editing.
async function buildAdSummary(ad) {
  try {
    if (!ad?.description || ad.description.length < 20) return null;

    let categoryName = "";
    if (ad.category) {
      if (typeof ad.category === "object" && ad.category.name) {
        categoryName = ad.category.name;
      } else {
        const cat = await AdCategory.findById(ad.category).select("name");
        categoryName = cat?.name || "";
      }
    }

    return await analyzeDescription({
      adTitle: ad.title,
      category: categoryName,
      subCategory: ad.subCategory,
      description: ad.description,
    });
  } catch (err) {
    console.error("AI summary generation failed:", err?.message);
    return null;
  }
}

// Generate and persist an ad's AI summary in the background (fire-and-forget).
function refreshAdSummary(adId) {
  Ad.findById(adId)
    .then(async (ad) => {
      if (!ad) return;
      const summary = await buildAdSummary(ad);
      if (summary) {
        await Ad.findByIdAndUpdate(adId, { aiSummary: summary });
      }
    })
    .catch((err) => console.error("refreshAdSummary failed:", err?.message));
}

function formatDate(date) {
  if (!date) return "";
  const toISTDate = (value) =>
    new Date(new Date(value).toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));

  const d = toISTDate(date);
  const now = toISTDate(new Date());
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  let hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours ? hours : 12;
  const timeStr = `${hours}:${minutes} ${ampm}`;

  if (isToday) return `Today ${timeStr}`;
  if (isYesterday) return `Yesterday ${timeStr}`;

  const day = d.getDate().toString().padStart(2, "0");
  const month = d.toLocaleString("en-US", { month: "short" }).toUpperCase();
  const year = d.getFullYear();
  return `${day} ${month} ${year} ${timeStr}`;
}

function resolveChatParticipants({ adSellerId, currentUserId, buyerId, sellerId }) {
  const adSellerStr = toIdStr(adSellerId);
  const currentUserStr = toIdStr(currentUserId);
  const resolvedSellerId = new mongoose.Types.ObjectId(adSellerStr);

  if (currentUserStr === adSellerStr) {
    const buyerStr = [buyerId, sellerId]
      .map(toIdStr)
      .find((id) => id && id !== adSellerStr);
    return {
      buyerId: new mongoose.Types.ObjectId(buyerStr || toIdStr(buyerId)),
      sellerId: resolvedSellerId,
    };
  }

  return {
    buyerId: new mongoose.Types.ObjectId(currentUserStr),
    sellerId: resolvedSellerId,
  };
}

function counterpartyUnreadExpr(currentUserId) {
  return {
    $max: {
      $cond: [
        {
          $and: [
            { $ne: ["$from", currentUserId] },
            { $eq: ["$seenAt", null] },
          ],
        },
        1,
        0,
      ],
    },
  };
}

export const getLatestMessages = async (req, res) => {
  try {
    const currentUserId = new mongoose.Types.ObjectId(req.user?.id);
    if (!currentUserId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const { userId, adId } = req.body;
    if (!userId || !adId) {
      return res.status(400).json({ message: "userId and adId are required" });
    }
    // Aggregate latest messages for a specific ad, grouped by users other than current user
    const latestMessages = await Chat.aggregate([
      {
        $match: {
          adId: typeof adId === "string" ? new mongoose.Types.ObjectId(adId) : adId,
          from: { $ne: currentUserId } 
        }
      },
      {
        $sort: { createdAt: -1 }
      },
      {
        $group: {
          _id: { user: { $cond: [ { $eq: ["$from", userId] }, "$to", "$from" ] } },
          message: { $first: "$message" },
          createdAt: { $first: "$createdAt" },
          from: { $first: "$from" },
          to: { $first: "$to" }
        }
      },
      {
        $project: {
          user: "$_id.user",
          message: 1,
          createdAt: 1,
          from: 1,
          to: 1,
          _id: 0
        }
      }
    ]);

    // Populate from and to user names
    const populated = await Chat.populate(latestMessages, [
      { path: "from", select: "name email" },
      { path: "to", select: "name email" }
    ]);

    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
export const getUserMessages = async (req, res) => {
  try {
    const currentUserId = new mongoose.Types.ObjectId(req.user?.id);
    if (!currentUserId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Aggregate to get the latest unseen message from each sender to the current user
    const latestMessages = await Chat.aggregate([
      {
        $match: {
          to: currentUserId,
          seenAt: null
        }
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$from",
          message: { $first: "$message" },
          createdAt: { $first: "$createdAt" },
          from: { $first: "$from" },
          to: { $first: "$to" },
          adId: { $first: "$adId" },
          seenAt: { $first: "$seenAt" }
        }
      },
      {
        $project: {
          _id: 0,
          from: 1,
          to: 1,
          adId: 1,
          message: 1,
          createdAt: 1,
          seenAt: 1
        }
      }
    ]);

    // Populate user info
    const populated = await Chat.populate(latestMessages, [
      { path: "from", select: "name email" },
      { path: "to", select: "name email" }
    ]);

    res.json({ messages: populated, count: populated.length });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
export const getChats = async (req, res) => {
  try {
    const currentUserId = req.user?.id;
    const { adId, buyerId, sellerId } = req.query;
    if (!adId || !buyerId || !sellerId) {
      return res.status(400).json({ message: "adId, buyerId, and sellerId are required" });
    }

    let adObjectId;
    try {
      adObjectId = new mongoose.Types.ObjectId(adId);
    } catch (e) {
      return res.status(400).json({ message: "Invalid adId or userId format" });
    }

    const ad = await Ad.findById(adObjectId).select("seller");
    if (!ad) {
      return res.status(404).json({ message: "Ad not found" });
    }

    const { buyerId: resolvedBuyerId, sellerId: resolvedSellerId } = resolveChatParticipants({
      adSellerId: ad.seller,
      currentUserId,
      buyerId,
      sellerId,
    });

    const chats = await Chat.find({
      adId: adObjectId,
      $or: [
        { from: resolvedBuyerId, to: resolvedSellerId },
        { from: resolvedSellerId, to: resolvedBuyerId },
      ],
    })
      .populate([
        { path: "from", select: "name email" },
        { path: "to", select: "name email" },
      ])
      .sort({ createdAt: 1 });

    const fraudCheck = await analyzeChatForFraud(
      chats.filter((chat) => toIdStr(chat.from?._id || chat.from) !== currentUserId)
    );

    const counterpartyId =
      currentUserId === toIdStr(resolvedBuyerId) ? resolvedSellerId : resolvedBuyerId;
    const counterpartyUser = await User.findById(counterpartyId).select(
      `${PUBLIC_TRUST_SELECT} reportCounter isBlocked`
    );
    const counterparty = formatTrustProfile(counterpartyUser);

    res.json({ chats, fraudCheck, counterparty });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
export const getSellingMessages = async (req, res) => {
  try {
    const currentUserId = new mongoose.Types.ObjectId(req.user?.id);
    if (!currentUserId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    // Find messages sent by the current user
    // Aggregate latest message per person for each ad and user
    // Aggregate latest messages for ads where current user is the seller,
    // and group by buyer (i.e., messages between seller and buyers for each ad)
    // Get all ad IDs where current user is the seller
    const adIds = await Ad.find({ seller: currentUserId }).distinct('_id');

    const messages = await Chat.aggregate([
      {
      $match: {
        adId: { $in: adIds }
      }
      },
      {
      $sort: { createdAt: -1, _id: -1 } // Ensure deterministic sort
      },
      {
      $group: {
        _id: { adId: "$adId", buyer: { $cond: [ { $eq: ["$from", currentUserId] }, "$to", "$from" ] } },
        latestMessageId: { $first: "$_id" },
        message: { $first: "$message" },
        createdAt: { $first: "$createdAt" },
        seenAt: { $first: "$seenAt" },
        from: { $first: "$from" },
        to: { $first: "$to" },
        adId: { $first: "$adId" },
        hasUnread: counterpartyUnreadExpr(currentUserId),
      }
      },
      {
      $project: {
        adId: 1,
        buyer: "$_id.buyer",
        latestMessageId: 1,
        message: 1,
        createdAt: 1,
        seenAt: 1,
        from: 1,
        to: 1,
        hasUnread: 1,
        _id: 0
      }
      },
      {
      $sort: { latestMessageId: -1, createdAt: -1, adId: 1, buyer: 1 } // Final sort for consistent order
      }
    ]);
    // console.log(messages)
    // res.json({ messages, count: messages.length });

    // Populate user and ad info
    const populatedMessages = await Chat.populate(messages, [
      { path: "from", select: "name email" },
      { path: "to", select: "name email" },
      { path: "buyer", model: "User", select: "name email profilePic" },
      { path: "adId", model: "Ad", match: { seller: currentUserId }, select: "title seller" }
    ]);
    // Filter out messages where adId is null (i.e., ad seller is not current user)
    const sellerIdStr = currentUserId.toString();
    const filteredMessages = populatedMessages
      .filter(msg => msg.adId)
      .map((msg) => {
      const buyerIdStr = toIdStr(msg.buyer)
        || (toIdStr(msg.to) === sellerIdStr ? toIdStr(msg.from) : toIdStr(msg.to));
      const buyerRef = msg.buyer?.name ? msg.buyer : (
        toIdStr(msg.from) === buyerIdStr ? msg.from : msg.to
      );
      const lastFromId = toIdStr(msg.from);
      const isSeen = !msg.hasUnread;

      return {
        id: msg.latestMessageId?.toString() || `${toIdStr(msg.adId?._id || msg.adId)}:${buyerIdStr}`,
        latestMessageId: msg.latestMessageId?.toString() || '',
        adId: toIdStr(msg.adId?._id || msg.adId),
        buyerId: buyerIdStr,
        sellerId: sellerIdStr,
        buyerName: buyerRef?.name || '',
        buyerPic: buyerRef?.profilePic || null,
        item: msg.adId?.title || '',
        lastMessage: msg.message,
        isSeen,
        lastMessageFrom: lastFromId,
        createdAt: msg.createdAt || null,
        seenAt: msg.seenAt ? formatDate(msg.seenAt) : '',
        time: msg.createdAt ? formatDate(msg.createdAt) : '',
        avatar: buyerRef?.profilePic || 'https://randomuser.me/api/portraits/men/1.jpg'
      };
      })
      .sort((a, b) => (b.latestMessageId || "").localeCompare(a.latestMessageId || ""));
    const count = filteredMessages.length;
    res.json({ filteredMessages, count });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// API to fetch buying messages (messages on ads posted by others where current user initiated a conversation)
export const getBuyingMessages = async (req, res) => {
  try {
    const currentUserId = new mongoose.Types.ObjectId(req.user?.id);
    if (!currentUserId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    // Aggregate latest messages on ads the current user does not own
    const messages = await Chat.aggregate([
      {
        $match: {
          $or: [
            { from: currentUserId },
            { to: currentUserId },
          ],
        },
      },
      {
        $lookup: {
          from: "ads",
          localField: "adId",
          foreignField: "_id",
          as: "adDoc",
        },
      },
      { $unwind: "$adDoc" },
      {
        $match: {
          "adDoc.seller": { $ne: currentUserId },
        },
      },
      {
        $sort: { createdAt: -1, _id: -1 },
      },
      {
      $group: {
        _id: {
        adId: "$adId",
        seller: {
          $cond: [
          { $eq: ["$from", currentUserId] },
          "$to",
          "$from"
          ]
        }
        },
        latestMessageId: { $first: "$_id" },
        message: { $first: "$message" },
        createdAt: { $first: "$createdAt" },
        seenAt: { $first: "$seenAt" },
        from: { $first: "$from" },
        to: { $first: "$to" },
        adId: { $first: "$adId" },
        hasUnread: counterpartyUnreadExpr(currentUserId),
      }
      },
      {
      $project: {
        adId: 1,
        seller: "$_id.seller",
        latestMessageId: 1,
        message: 1,
        createdAt: 1,
        seenAt: 1,
        from: 1,
        to: 1,
        hasUnread: 1,
        _id: 0
      }
      },
      {
      $sort: { latestMessageId: -1, createdAt: -1, adId: 1, seller: 1 }
      }
    ]);
    // Populate user and ad info
    const populatedMessages = await Chat.populate(messages, [
      { path: "from", select: "name email" },
      { path: "to", select: "name email" },
      { path: "seller", model: "User", select: PUBLIC_TRUST_SELECT },
      {
        path: "adId",
        model: "Ad",
        select: "title seller images",
        populate: { path: "seller", select: PUBLIC_TRUST_SELECT },
      },
    ]);

    // Filter out messages where adId is null (shouldn't happen, but for safety)
    const buyerIdStr = currentUserId.toString();
    const filteredMessages = populatedMessages
      .filter(msg => msg.adId)
      .map((msg) => {
        const sellerRef = msg.adId?.seller?.name ? msg.adId.seller : msg.seller;
        const sellerIdStr = toIdStr(msg.adId?.seller) || toIdStr(msg.seller);
        const lastFromId = toIdStr(msg.from);
        const isSeen = !msg.hasUnread;

        return {
          id: msg.latestMessageId?.toString() || `${toIdStr(msg.adId?._id || msg.adId)}:${sellerIdStr}`,
          latestMessageId: msg.latestMessageId?.toString() || '',
          adId: toIdStr(msg.adId?._id || msg.adId),
          sellerName: sellerRef?.name || '',
          lastMessageFrom: lastFromId,
          buyerName: msg.from?.name === sellerRef?.name ? (msg.to?.name || '') : (msg.from?.name || ''),
          buyerId: buyerIdStr,
          sellerId: sellerIdStr,
          sellerPic: sellerRef?.profilePic || null,
          sellerRatingAvg: sellerRef?.ratingAvg || 0,
          sellerReviewCount: sellerRef?.reviewCount || 0,
          sellerTrustScore: sellerRef?.trustScore ?? 50,
          sellerBadges: sellerRef?.badges || [],
          item: msg.adId?.title || '',
          adImages: msg.adId?.images || [],
          lastMessage: msg.message,
          isSeen,
          createdAt: msg.createdAt || null,
          seenAt: msg.seenAt ? formatDate(msg.seenAt) : '',
          time: msg.createdAt ? formatDate(msg.createdAt) : '',
          avatar: sellerRef?.profilePic || 'https://randomuser.me/api/portraits/men/2.jpg'
        };
      })
      .sort((a, b) => (b.latestMessageId || "").localeCompare(a.latestMessageId || ""));
    const count = filteredMessages.length;
    res.json({ filteredMessages, count });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const createChat = async (req, res) => {
  try {
    const { adId, message, to, from } = req.body;
    // An uploaded image (multer + cloudinary) arrives on req.file.
    const imageUrl = req.file?.path || req.file?.location || req.file?.url || null;

    if (!adId || !to || !from) {
      return res.status(400).json({ message: "Missing required fields" });
    }
    // A message must contain text and/or an image.
    if (!message?.trim() && !imageUrl) {
      return res.status(400).json({ message: "Message cannot be empty" });
    }

    // Create and populate chat message for API and socket payload.
    const chat = await Chat.create({ adId, message: message || "", to, from, imageUrl });
    const populatedChat = await Chat.findById(chat._id).populate([
      { path: "from", select: "name email avatar" },
      { path: "to", select: "name email avatar" },
      { path: "adId", select: "title seller images" }
    ]);

    // Add sender to usersInterested if not the seller
    const ad = await Ad.findById(adId).select("seller usersInterested");
    if (ad && ad.seller.toString() !== from.toString()) {
      if (!ad.usersInterested.includes(from)) {
        ad.usersInterested.push(from);
        await ad.save();
      }
    }

    // Resolve conversation participants so the notification can deep-link to the chat.
    const sellerId = (ad?.seller || populatedChat?.adId?.seller)?.toString();
    const fromStr = from.toString();
    const toStr = to.toString();
    // Buyer is always the non-seller participant.
    const buyerId = sellerId && fromStr === sellerId ? toStr : fromStr;
    const recipientIsSeller = sellerId ? toStr === sellerId : false;
    const adTitle = populatedChat?.adId?.title || "";

    // Send push notification to recipient if possible
    User.findById(to).select("fcmToken").then(receiver => {
      if (receiver?.fcmToken) {
        console.log(req.user)
        const fromName = req.user?.name || "Someone";
        const notifText = message?.trim() ? message : (imageUrl ? "📷 Photo" : "");
        sendChatNotification(receiver.fcmToken, notifText, fromName, {
          adId: adId,
          buyerId,
          sellerId,
          adTitle,
          otherName: fromName,
          isSeller: recipientIsSeller,
          senderId: fromStr,
        }).catch(console.error);
      }
    }).catch(console.error);

    const io = getSocket();
    if (io) {
      const eventPayload = {
        chat: populatedChat || chat,
      };
      io.to(`user:${to}`).emit("chat:new-message", eventPayload);
      io.to(`user:${from}`).emit("chat:new-message", eventPayload);
    }

    res.status(201).json(populatedChat || chat);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
export const editAd = async (req, res) => {
  const requestStart = req.uploadRequestStartAt || Date.now();
  const controllerStart = Date.now();
  try {
    // console.log("[PUT] /api/ads/edit/:id - Body:", req.body);
    const adId = req.params.id;
    const existingAd = await Ad.findById(adId);
    if (!existingAd) return res.status(404).json({ message: "Ad not found" });

    // Collect update data
    const updateData = { ...req.body };
    // Prevent changing the seller, _id, or client-supplied banner flag
    delete updateData.seller;
    delete updateData._id;
    delete updateData.hasGeneratedBanner;
    // If new images are uploaded, handle them
    console.log("Updating ad with files:", adId, "with data:", req.files);
    const uploadedUrls = collectUploadedImageUrls(req.files);
    if (uploadedUrls.length > 0) {
      updateData.images = uploadedUrls;
      updateData.hasGeneratedBanner = false;
    } else {
      const nextTitle = updateData.title ?? existingAd.title;
      const nextPrice = updateData.price ?? existingAd.price;
      const nextLocation = updateData.location ?? existingAd.location;
      const titleChanged =
        updateData.title != null && String(updateData.title) !== String(existingAd.title);
      const priceChanged =
        updateData.price != null && Number(updateData.price) !== Number(existingAd.price);
      const locationChanged =
        updateData.location != null &&
        String(updateData.location) !== String(existingAd.location);

      if (
        shouldGenerateAdBanner({
          uploadedUrls,
          existingImages: existingAd.images || [],
          hasGeneratedBanner: existingAd.hasGeneratedBanner,
          titleChanged,
          priceChanged,
          locationChanged,
        })
      ) {
        const bannerUrl = await createAdBannerImage({
          title: nextTitle,
          price: nextPrice,
          location: nextLocation,
        });
        if (bannerUrl) {
          updateData.images = [bannerUrl];
          updateData.hasGeneratedBanner = true;
        }
      }
    }
    // Update the ad
    const updatedAd = await Ad.findByIdAndUpdate(adId, updateData, { new: true });
    if (!updatedAd) return res.status(404).json({ message: "Ad not found" });

    // Capture a newly entered location on edit as well.
    if (updateData.location) ensureLocationExists(updateData.location);

    // Regenerate the stored AI summary if any field it depends on changed.
    if (updateData.description || updateData.title || updateData.category || updateData.subCategory) {
      refreshAdSummary(updatedAd._id);
    }

    const controllerMs = Date.now() - controllerStart;
    const totalMs = Date.now() - requestStart;
    console.log(`[PUT] /api/ads/edit/${adId} - files=${req.files?.length || 0} controllerMs=${controllerMs} totalMs=${totalMs}`);
    res.json(updatedAd);
  } catch (err) {
    const controllerMs = Date.now() - controllerStart;
    const totalMs = Date.now() - requestStart;
    console.error(`[PUT] /api/ads/edit/${req.params.id} - failed controllerMs=${controllerMs} totalMs=${totalMs}`, err);
    res.status(500).json({ message: err.message });
  }
};
export const createAd = async (req, res) => {
  const requestStart = req.uploadRequestStartAt || Date.now();
  const controllerStart = Date.now();
  try {
    console.log("[POST] /api/ads/postAdd - Body:", req.body);
    console.log("[POST] /api/ads/postAdd - Files:", req.files);
    // Handle image upload. Ads posted without a photo get a colored
    // title/price/location banner so cards and chat still have an image.
    const imageUrls = collectUploadedImageUrls(req.files);
    let hasGeneratedBanner = false;

    // Remove 'id' field if present in req.body to avoid duplicate key error
    const { id, ...adData } = req.body;
    delete adData.hasGeneratedBanner;

    if (!imageUrls.length) {
      const bannerUrl = await createAdBannerImage({
        title: adData.title,
        price: adData.price,
        location: adData.location,
      });
      if (bannerUrl) {
        imageUrls.push(bannerUrl);
        hasGeneratedBanner = true;
      }
    }

    const ad = await Ad.create({
      ...adData,
      images: imageUrls,
      hasGeneratedBanner,
      seller: req.user?.id,
      posted: new Date()
    });

    // Self-growing location list: capture any new location the user entered.
    if (ad.location) ensureLocationExists(ad.location);

    // Pre-compute and store the AI summary so ad detail loads can read it from
    // the DB instead of regenerating it on every view.
    refreshAdSummary(ad._id);
    notifyUsersOfNewAd(ad).catch((err) => {
      console.error("New-ad category notify failed:", err?.message || err);
    });

    const controllerMs = Date.now() - controllerStart;
    const totalMs = Date.now() - requestStart;
    console.log(`[POST] /api/ads/postAdd - files=${req.files?.length || 0} controllerMs=${controllerMs} totalMs=${totalMs}`);
    res.status(201).json(ad);
  } catch (err) {
    const controllerMs = Date.now() - controllerStart;
    const totalMs = Date.now() - requestStart;
    console.error(`[POST] /api/ads/postAdd - failed controllerMs=${controllerMs} totalMs=${totalMs}`, err);
    console.error("[POST] /api/ads/postAdd - Error:", err);
    res.status(500).json({ message: err.message });
  }
};

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildLocationFilter = (locationText) => {
  const searchString = locationText?.trim();
  if (!searchString) {
    return {};
  }
  return { location: { $regex: escapeRegex(searchString), $options: "i" } };
};

const AD_SORTS = {
  newest: { createdAt: -1, _id: -1 },
  oldest: { createdAt: 1, _id: 1 },
  price_low: { price: 1, createdAt: -1, _id: -1 },
  price_high: { price: -1, createdAt: -1, _id: -1 },
  most_viewed: { views: -1, createdAt: -1, _id: -1 },
};

export const getAllAds = async (req, res) => {
  try {
    // Pagination params
    const page = parseInt(req.body.page, 10) || 1;
    const limit = parseInt(req.body.limit, 10) || 10;
    const skip = (page - 1) * limit;
    const searchQuery = req.body.search || '';
    const categoryId = req.body.category || null;
    const subCategory = req.body.subCategory || null;
    const userId = req.body?.userId || null;
    const aiSearch = req.body?.aiSearch || false;
    const locationText = req.body.location || null;
    const priceMin = req.body.priceMin != null ? Number(req.body.priceMin) : null;
    const priceMax = req.body.priceMax != null ? Number(req.body.priceMax) : null;
    const sortKey = Object.prototype.hasOwnProperty.call(AD_SORTS, req.body.sort)
      ? req.body.sort
      : "newest";
    const sort = AD_SORTS[sortKey];
    console.log(userId)
    let filter = {};
    // Resolve category name to ObjectId if provided
    if(!aiSearch){
        // Build filter
        filter = {
          title: { $regex: searchQuery, $options: 'i' }
        };
    }

    if (categoryId) {
      filter.category = categoryId;
    }
    if (subCategory) {
      filter.subCategory = subCategory;
    }
    // Add seller filter if user is authenticated
    if (userId) {
      filter.seller = { $ne: userId };
    }

    const locationFilter = buildLocationFilter(locationText);
    if (locationFilter.location) {
      filter.location = locationFilter.location;
    }

    if (priceMin != null && !Number.isNaN(priceMin) || priceMax != null && !Number.isNaN(priceMax)) {
      filter.price = {};
      if (priceMin != null && !Number.isNaN(priceMin)) {
        filter.price.$gte = priceMin;
      }
      if (priceMax != null && !Number.isNaN(priceMax)) {
        filter.price.$lte = priceMax;
      }
    }

    filter.isSold = false;
    filter.isActive = true;
    // Total count with same filter
    const total = await Ad.countDocuments(filter);

    // Fetch paginated ads with same filter
    let ads;
    if (aiSearch) {
      ads = await Ad.find(filter)
      .populate([
        { path: "seller", select: PUBLIC_TRUST_SELECT },
        { path: "category", select: "name description" }
      ])
      .sort(sort);
    } else {
      ads = await Ad.find(filter)
      .populate([
        { path: "seller", select: PUBLIC_TRUST_SELECT },
        { path: "category", select: "name description" }
      ])
      .sort(sort)
      .skip(skip)
      .limit(limit);
    }
      console.log("Ads fetched:", ads.length);
    if (aiSearch && searchQuery) {
      let aiOptimizedResult = []
       aiOptimizedResult = ads.map(ad => ({
        _id: ad._id,
        title: ad.title,
        description: ad.description,
        price: ad.price,
        location: ad.location,
        category: ad.category,
        subCategory: ad.subCategory,
        images: ad.images,
        views: ad.views,
        createdAt: ad.createdAt

        }))
        console.log("AI Optimized Result:", aiOptimizedResult);

      const aiResult = await aiSearchAds({
        aiOptimizedResult,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }, searchQuery);
      aiResult.limit = limit;
      aiResult.page = page;
      aiResult.totalPages = Math.ceil(aiResult.total / limit);
      res.json(aiResult);
    } else {
      const totalPages = Math.ceil(total / limit);
      res.json({
        ads,
        page,
        limit,
        total,
        totalPages,
        hasMore: page < totalPages,
      });
    }

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
export const getUserAds = async (req, res) => {
  try {
    const userId = req.body.id;
    const page = parseInt(req.body.page, 10) || 1;
    const limit = parseInt(req.body.limit, 10) || 10;
    const skip = (page - 1) * limit;

    // Total count for pagination
    const total = await Ad.countDocuments({ seller: userId });

    // Fetch paginated ads for user
    const ads = await Ad.find({ seller: userId })
      .populate([
        { path: "seller", select: PUBLIC_TRUST_SELECT },
        { path: "category", select: "name description" }
      ])
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      ads,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getAllAdCategories = async (req, res) => {
  try {
    console.log("Fetching all ad categories");
    const categories = await AdCategory.find().sort({ createdAt: -1 });
    res.json(categories);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
export const getAdById = async (req, res) => {
  try {
    const ad = await Ad.findById(req.params.id).populate([
      { path: "seller", select: PUBLIC_TRUST_SELECT },
      { path: "category", select: "name" },
    ]);
    if (!ad) return res.status(404).json({ message: "Ad not found" });
    res.json(ad);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const deleteAd = async (req, res) => {
  try {
    const ad = await Ad.findById(req.params.id);
    if (!ad) return res.status(404).json({ message: "Ad not found" });

    if (ad.userId.toString() !== req.user.id)
      return res.status(403).json({ message: "Not authorized" });

    await ad.deleteOne();
    res.json({ message: "Ad deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
export const summarizeAdUsingAi = async (req, res) => {
  try {
    const { adId, adTitle, category, subCategory, description } = req.body;

    // Preferred path: look the ad up by id and serve its stored summary.
    // If one isn't stored yet (legacy ad or creation still in flight), generate
    // it once and persist it so future loads are instant.
    if (adId) {
      const ad = await Ad.findById(adId).populate({ path: "category", select: "name" });
      if (ad) {
        if (ad.aiSummary && Object.keys(ad.aiSummary).length > 0) {
          return res.json({ success: true, data: ad.aiSummary, cached: true });
        }

        console.log('🤖 Generating + caching AI summary for ad', adId);
        const generated = await buildAdSummary(ad);
        if (generated) {
          ad.aiSummary = generated;
          await ad.save();
        }
        return res.json({ success: true, data: generated || {} });
      }
    }

    // Validation
    if (!description || !category) {
      return res.status(400).json({
        success: false,
        error: 'Description and category are required'
      });
    }

    if (description.length < 20) {
      return res.status(400).json({
        success: false,
        error: 'Description is too short for analysis'
      });
    }

    // Generate AI summary
    console.log('🤖 Analyzing description...');

    const aiSummary = await analyzeDescription({
      adTitle,
      category,
      subCategory,
      description
    });

    console.log('✅ AI summary generated successfully');

    return res.json({
      success: true,
      data: aiSummary
    });

  } catch (error) {
    console.error('❌ Error:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Failed to generate AI summary',
      message: error.message
    });
  }
};
export const generateDescriptionUsingAI = async (req, res) => {
  try {
    const { title, category, subCategory, description,location,price } = req.body;

    // Validation
    if (!title || !category ) {
      return res.status(400).json({
        success: false,
        error: 'Ad title, category, and description are required'
      });
    }

    // Generate AI description
    console.log('🤖 Generating description...');
    const aiDescription = await generateDescription({
      title,
      category,
      subCategory,
      description,
      location,
      price
    });

    console.log('✅ AI description generated successfully');

    return res.json({
      success: true,
      data: aiDescription
    });

  } catch (error) {
    console.error('❌ Error:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Failed to generate AI description',
      message: error.message
    });
  }
};

export const extractAdFromImagesUsingAI = async (req, res) => {
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) {
      return res.status(400).json({
        success: false,
        error: 'At least one image is required',
      });
    }

    let categories = [];
    if (typeof req.body?.categories === 'string' && req.body.categories.trim()) {
      try {
        categories = JSON.parse(req.body.categories);
      } catch {
        return res.status(400).json({
          success: false,
          error: 'Invalid categories payload',
        });
      }
    } else if (Array.isArray(req.body?.categories)) {
      categories = req.body.categories;
    }

    if (!categories.length) {
      const dbCats = await AdCategory.find({}).select('name subCategory').lean();
      categories = dbCats.map((c) => ({
        name: c.name,
        subCategories: c.subCategory || [],
      }));
    }

    const images = files.map((file) => ({
      mimeType: file.mimetype || 'image/jpeg',
      base64: file.buffer.toString('base64'),
    }));

    console.log(`🖼️ Extracting ad draft from ${images.length} image(s)...`);
    const draft = await extractAdFromImages({ images, categories });

    if (draft.blocked) {
      console.warn('🚫 Image analysis blocked for prohibited content');
      return res.status(400).json({
        success: false,
        blocked: true,
        error: 'This image is not allowed.',
        warning: draft.warning,
        data: draft,
      });
    }

    // Polish description with existing text model when we have enough context
    if (draft.title && draft.category && draft.description) {
      try {
        const polished = await generateDescription({
          title: draft.title,
          category: draft.category,
          subCategory: draft.subCategory || 'General',
          description: draft.description,
          location: draft.location || '',
          price: draft.priceDisplay || draft.price || '',
        });
        const originalLen = draft.description.length;
        if (
          polished
          && polished.length >= Math.min(150, originalLen)
          && polished.length >= Math.floor(originalLen * 0.75)
        ) {
          draft.description = polished;
          draft.descriptionPolished = true;
        } else {
          draft.descriptionPolished = false;
        }
      } catch (polishErr) {
        console.warn('Description polish skipped:', polishErr.message);
        draft.descriptionPolished = false;
      }
    }

    const filledFields = [
      'title',
      'category',
      'subCategory',
      'description',
      'price',
      'location',
    ].filter((key) => draft[key] != null && draft[key] !== '');

    console.log(`✅ Vision draft ready (${filledFields.join(', ') || 'no high-confidence fields'})`);

    return res.json({
      success: true,
      data: {
        ...draft,
        filledFields,
      },
    });
  } catch (error) {
    console.error('❌ Vision extract error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to analyze images',
      message: error.message,
    });
  }
};
export const markMessagesAsSeen = async (req, res) => {
  try {
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { adId, reader, sender, buyerId, sellerId } = req.body;
    if (!adId) {
      return res.status(400).json({ message: "adId is required" });
    }

    const readerId = toIdStr(reader || currentUserId);
    const currentUserStr = toIdStr(currentUserId);
    if (readerId !== currentUserStr) {
      return res.status(403).json({ message: "Cannot mark messages seen for another user" });
    }

    const adObjectId = new mongoose.Types.ObjectId(adId);
    const ad = await Ad.findById(adObjectId).select("seller");
    if (!ad) {
      return res.status(404).json({ message: "Ad not found" });
    }

    let counterpartyId = toIdStr(sender);
    if (!counterpartyId && buyerId && sellerId) {
      const resolved = resolveChatParticipants({
        adSellerId: ad.seller,
        currentUserId,
        buyerId,
        sellerId,
      });
      counterpartyId = currentUserStr === toIdStr(resolved.buyerId)
        ? toIdStr(resolved.sellerId)
        : toIdStr(resolved.buyerId);
    }

    if (!counterpartyId) {
      return res.status(400).json({ message: "sender or buyerId/sellerId is required" });
    }
    if (counterpartyId === currentUserStr) {
      return res.status(400).json({ message: "Reader and sender cannot be the same" });
    }

    const result = await Chat.updateMany(
      {
        adId: adObjectId,
        from: new mongoose.Types.ObjectId(counterpartyId),
        to: new mongoose.Types.ObjectId(currentUserStr),
        seenAt: null,
      },
      { $set: { seenAt: new Date() } }
    );

    return res.json({
      message: "Messages marked as seen",
      modifiedCount: result.modifiedCount,
      matchedCount: result.matchedCount,
    });
  } catch (error) {
    console.error("Error marking messages as seen:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
export const incrementViews = async (req, res) => {
  try {
    const { adId, visitorId, sessionId } = req.body;
    const userId = req.user?.id || null;
    const result = await incrementAdViewCounter({ adId, visitorId, userId, sessionId });
    if (result.error) {
      return res.status(result.status || 400).json({ message: result.error });
    }

    if (userId && !result.skippedOwner) {
      const ad = await Ad.findById(adId);
      if (ad && String(ad.seller) !== String(userId)) {
        const user = await User.findById(userId);
        if (user) {
          await recordAdViewHistory(user, ad);
        }
      }
    }

    return res.json({ message: "View count incremented", views: result.views });
  } catch (error) {
    console.error("Error counting views:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
export const getUsersInterestedInAd = async (req, res) => {
  try {
    const { adId } = req.body;
    if (!adId) {
      return res.status(400).json({ message: "adId is required" });
    }

    const ad = await Ad.findById(adId).populate([{ path: "usersInterested", select: "name email" }]);
    const users = ad ? ad.usersInterested : [];

    res.json({ users });
  } catch (err) {
    console.error("Error fetching interested users:", err);
    res.status(500).json({ message: "Server error" });
  }
};
export const markAdAsSold = async (req, res) => {
  try {
    const { adId, buyerId } = req.body;
    if (!adId) {
      return res.status(400).json({ message: "adId is required" });
    }

    const ad = await Ad.findById(adId).populate("seller", "name fcmToken");
    if (!ad) {
      return res.status(404).json({ message: "Ad not found" });
    }

    if (ad.seller._id.toString() !== req.user.id) {
      return res.status(403).json({ message: "Only the seller can mark this ad as sold" });
    }

    if (ad.isSold) {
      return res.status(400).json({ message: "Ad is already marked as sold" });
    }

    let buyer = null;
    if (buyerId) {
      buyer = await User.findById(buyerId).select("name fcmToken");
      if (!buyer) {
        return res.status(400).json({ message: "Selected buyer was not found" });
      }
      ad.soldTo = buyerId;
    } else {
      ad.soldTo = null;
    }

    ad.isSold = true;
    ad.soldAt = new Date();
    await ad.save();

    if (buyer) {
      await User.findByIdAndUpdate(ad.seller._id, { $inc: { completedSales: 1 } });
      recalculateUserTrust(ad.seller._id).catch((err) => {
        console.error("Error recalculating trust after sale:", err);
      });
      const reviewPayload = {
        adId: ad._id,
        adTitle: ad.title,
      };
      if (buyer.fcmToken) {
        sendReviewPromptNotification(buyer.fcmToken, {
          ...reviewPayload,
          revieweeName: ad.seller.name,
        }).catch(() => {});
      }
      if (ad.seller.fcmToken) {
        sendReviewPromptNotification(ad.seller.fcmToken, {
          ...reviewPayload,
          revieweeName: buyer.name,
        }).catch(() => {});
      }
    }

    return res.json({
      message: "Success",
      adId: ad._id,
      reviewPrompt: !!buyerId,
      buyerName: buyer?.name || null,
    });
  } catch (error) {
    console.error("Error marking ad as sold:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
export const disableAd = async (req, res) => {
  try {
    const { adId } = req.body;
    if (!adId ) {
      return res.status(400).json({ message: "adId is required" });
    }

    const ad = await Ad.findById(adId);
    if (!ad) {
      return res.status(404).json({ message: "Ad not found" });
    }

    ad.isActive = false;
    await ad.save();

    return res.json({ message: "Ad disabled successfully" });
  } catch (error) {
    console.error("Error disabling ad:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
export const enableAd = async (req, res) => {
  try {
    const { adId } = req.body;
    if (!adId ) {
      return res.status(400).json({ message: "adId is required" });
    }

    const ad = await Ad.findById(adId);
    if (!ad) {
      return res.status(404).json({ message: "Ad not found" });
    }

    ad.isActive = true;
    await ad.save();

    return res.json({ message: "Ad enabled successfully" });
  } catch (error) {
    console.error("Error enabling ad:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
export const reportAd = async (req, res) => {
  try {
    const { adId, reasonId } = req.body;
    if (!adId || !reasonId) {
      return res.status(400).json({ message: "adId and reasonId are required" });
    }

    const reason = await ReportReason.findById(reasonId);
    if (!reason) {
      return res.status(404).json({ message: "Report reason not found" });
    }

    const ad = await Ad.findById(adId);
    if (!ad) {
      return res.status(404).json({ message: "Ad not found" });
    }

    // Increment the count for this reason, or add it if it's the first time.
    const existingReason = ad.reportReasons.find(
      (entry) => entry.reasonId.toString() === String(reasonId)
    );
    if (existingReason) {
      existingReason.count += 1;
    } else {
      ad.reportReasons.push({ reasonId, count: 1 });
    }

    ad.reportCounter = (ad.reportCounter || 0) + 1;

    // Auto-deactivate the ad once it has been reported enough times.
    if (ad.reportCounter >= 10) {
      ad.isActive = false;
    }

    await ad.save();

    return res.json({
      message: "Ad reported successfully",
      reportCounter: ad.reportCounter,
      reportReasons: ad.reportReasons,
      isActive: ad.isActive,
    });
  } catch (error) {
    console.error("Error reporting ad:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
export const getReportReasons = async (req, res) => {
  try {
    const reasons = await ReportReason.find({ isActive: true }).sort({ createdAt: -1 });
    return res.json(reasons);
  } catch (error) {
    console.error("Error fetching report reasons:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
export const createReportReason = async (req, res) => {
  try {
    const { reason, description } = req.body;
    if (!reason) {
      return res.status(400).json({ message: "reason is required" });
    }

    const reportReason = await ReportReason.create({ reason, description });
    return res.status(201).json(reportReason);
  } catch (error) {
    console.error("Error creating report reason:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}