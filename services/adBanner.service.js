import { v2 as cloudinary } from "cloudinary";
import { buildAdBannerSvg } from "./adBanner.logic.js";

function configureCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

function isCloudinaryConfigured() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );
}

/**
 * Build a colored title/price/location banner and upload it so listings without
 * photos still have a real image URL for cards, chat, and reviews.
 */
export async function createAdBannerImage({ title, price, location } = {}) {
  const svg = buildAdBannerSvg({ title, price, location });

  if (!isCloudinaryConfigured()) {
    console.warn("createAdBannerImage skipped: Cloudinary is not configured");
    return null;
  }

  configureCloudinary();

  const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const folder = `${process.env.CLOUDINARY_FOLDER || "dealr"}/banners`;

  try {
    const result = await cloudinary.uploader.upload(dataUri, {
      folder,
      resource_type: "image",
      format: "png",
      public_id: `ad-banner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      transformation: [
        {
          quality: "auto:eco",
          width: 1200,
          height: 900,
          crop: "limit",
        },
      ],
    });
    return result.secure_url || result.url || null;
  } catch (err) {
    console.error("createAdBannerImage failed:", err?.message || err);
    return null;
  }
}
