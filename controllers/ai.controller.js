import Chat from "../models/chat.model.js";
import Ad from "../models/ad.model.js";
import {analyzeDescription,analyzeAd,analyzeAiPriceInsights} from "../aiAnalyzer/aiAnalyzer.js";

import mongoose from "mongoose";

export const summarizeAdUsingAi = async (req, res) => {
  try {
    const { adTitle, category, subCategory, description } = req.body;

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
export async function provideAiAnalytics(req, res) {
  try {
    const adId  = new mongoose.Types.ObjectId(req.body.adId);
    // const userId = req.user._id;
    const category = new mongoose.Types.ObjectId(req.body.category);
    const subCategory = req.body.subCategory || 'General';
    // Fetch ad details with category and seller populated
    const adData = await Ad.findById(adId).populate('category').populate('seller');

    // Fetch all chats related to this ad
    const chatData = await Chat.find({ adId: adId }).populate('from').populate('to');
    // Fetch all ads with the provided category and subcategory
    const relatedAds = await Ad.find({
        category: category,
        subCategory: subCategory
    });
    const relatedAdChats = await Chat.find({ adId: { $in: relatedAds.map(ad => ad._id) } }).populate('from').populate('to');
    let constructedMainAdData = constructMainAdData(adData,chatData);
    let constructedRelatedAdsData = constructRelatedAdsData(relatedAds,relatedAdChats);
    console.log('🤖 Analyzing ad and related data...',constructedMainAdData);
    console.log('🤖 Analyzing ad and related data...',constructedRelatedAdsData);

    const aiAnalysis = await analyzeAd(constructedMainAdData, constructedRelatedAdsData);

    console.log('✅ AI summary generated successfully');

    return res.json({
      success: true,
      data: aiAnalysis||{}
    });


  } catch (error) {
    console.error('Error fetching AI analytics:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate AI analytics',
      message: error.message,
    });
  }
}
export async function provideAiPriceInsights(req, res) {
  try {
    const adId  = new mongoose.Types.ObjectId(req.body.adId);
    // const userId = req.user._id;
    const category = new mongoose.Types.ObjectId(req.body.category);
    const subCategory = req.body.subCategory || 'General';
    // Fetch ad details with category and seller populated
    const adData = await Ad.findById(adId).populate('category').populate('seller');

    // Fetch all chats related to this ad
    const chatData = await Chat.find({ adId: adId }).populate('from').populate('to');
    // Fetch all ads with the provided category and subcategory
    const relatedAds = await Ad.find({
        category: category,
        subCategory: subCategory
    });
    const relatedAdChats = await Chat.find({ adId: { $in: relatedAds.map(ad => ad._id) } }).populate('from').populate('to');
    let constructedMainAdData = constructMainAdData(adData,chatData);
    let constructedRelatedAdsData = constructRelatedAdsData(relatedAds,relatedAdChats);
    // console.log('🤖 Analyzing ad and related data...',constructedMainAdData);
    // console.log('🤖 Analyzing ad and related data...',constructedRelatedAdsData);

    const aiAnalysis = await analyzeAiPriceInsights(constructedMainAdData, constructedRelatedAdsData);

    console.log('✅ AI summary generated successfully');

    return res.json({
      success: true,
      data: aiAnalysis||{}
    });


  } catch (error) {
    console.error('Error fetching AI price insights:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate AI price insights',
      message: error.message,
    });
  }
}

function constructMainAdData(adData,chatData) {
  return {
    title: adData.title,
    category: adData.category.name,
    subCategory: adData.subCategory || 'General',
    description: adData.description,
    price: adData.price,
    location: adData.location,
    sellerName: adData.seller.name,
    sellerProfilePic: adData.seller.profilePic,
    postedDate: adData.posted,
    images: adData.images,
    views: adData.views,
    sellerLocation: adData.seller.location,
    chatData: chatData.map(chat => ({
      message: chat.message,
      from: chat.from.name,
      fromLocation: chat.from.location,
      toLocation: chat.to.location,
      to: chat.to.name,
      timestamp: chat.createdAt
    }))
  };
}
function constructRelatedAdsData(relatedAds,relatedAdChats) {
  return relatedAds.map(ad => {
    const adChats = relatedAdChats.filter(chat => chat.adId.toString() === ad._id.toString());
    return {
      title: ad.title,
      category: ad.category,
      subCategory: ad.subCategory || 'General',
      description: ad.description,
      price: ad.price,
      location: ad.location,
      postedDate: ad.posted,
      images: ad.images,
      views: ad.views,
      chatData: adChats.map(chat => ({
        message: chat.message,
        from: chat.from.name,
        fromLocation: chat.from.location,
        toLocation: chat.to.location,
        to: chat.to.name,
        timestamp: chat.createdAt
      }))
    };
  });
}