import express from "express";
import { getLatestMessages,createAd, getAllAds, getAdById, deleteAd,getAllAdCategories,getUserAds,editAd,createChat,getChats,getUserMessages,getBuyingMessages,getSellingMessages,summarizeAdUsingAi ,markMessagesAsSeen,incrementViews,getUsersInterestedInAd,markAdAsSold,disableAd,enableAd,generateDescriptionUsingAI,extractAdFromImagesUsingAI,reportAd,getReportReasons,createReportReason} from "../controllers/ad.controller.js";
import authMiddleware from "../middleware/auth.js";
import fileUpload, { memoryUpload } from "../middleware/fileUpload.js";

const router = express.Router();
const trackUploadRequestStart = (req, res, next) => {
  req.uploadRequestStartAt = Date.now();
  next();
};

router.get("/listCategories", getAllAdCategories);
router.post("/listUserAds", getUserAds);
router.post("/", getAllAds);
router.post("/postAdd", trackUploadRequestStart, authMiddleware, fileUpload.array('images', 5), createAd);
router.get("/chat",authMiddleware, getChats);
router.get("/reportReasons", getReportReasons);
router.post("/summarizeAdUsingAi", summarizeAdUsingAi);
router.post("/generateDescriptionUsingAI", generateDescriptionUsingAI);
router.post(
  "/extractAdFromImages",
  authMiddleware,
  memoryUpload.array('images', 5),
  extractAdFromImagesUsingAI,
);
router.get("/:id", getAdById);
router.delete("/:id", authMiddleware, deleteAd);
router.put("/edit/:id", trackUploadRequestStart, authMiddleware, fileUpload.array('images', 5), editAd);
router.post("/chat",authMiddleware, fileUpload.single('image'), createChat);
router.post("/latestMessages", authMiddleware, getLatestMessages);
router.post("/getUserMessages", authMiddleware, getUserMessages);
router.post("/getSellingMessages", authMiddleware, getSellingMessages);
router.post("/getBuyingMessages", authMiddleware, getBuyingMessages);
router.post("/markMessagesAsSeen", authMiddleware, markMessagesAsSeen);
router.post("/incrementViews", authMiddleware, incrementViews);
router.post("/getUsersInterestedInAd", getUsersInterestedInAd);
router.post("/markAdAsSold", authMiddleware, markAdAsSold);
router.post("/disableAd", authMiddleware, disableAd);
router.post("/enableAd", authMiddleware, enableAd);
router.post("/reportAd", authMiddleware, reportAd);
router.post("/reportReasons", authMiddleware, createReportReason);




export default router;
