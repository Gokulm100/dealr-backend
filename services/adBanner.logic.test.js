import assert from "node:assert/strict";
import {
  BANNER_PALETTE,
  bannerColorsForTitle,
  buildAdBannerSvg,
  collectUploadedImageUrls,
  escapeXml,
  isGeneratedBannerUrl,
  shouldGenerateAdBanner,
  truncateText,
  wrapText,
} from "./adBanner.logic.js";

assert.equal(escapeXml(`<Honda & "Activa">`), "&lt;Honda &amp; &quot;Activa&quot;&gt;");
assert.equal(truncateText("Perfect condition scooter", 10), "Perfect c…");
assert.equal(truncateText("Short", 10), "Short");

assert.deepEqual(wrapText("Honda Activa 6G in excellent condition", 12, 3), [
  "Honda Activa",
  "6G in",
  "excellent c…",
]);
assert.deepEqual(wrapText("   one   two  ", 20, 2), ["one two"]);
assert.deepEqual(wrapText("", 20, 2), []);
assert.deepEqual(wrapText("supercalifragilistic", 8, 1), ["superca…"]);

const colorsA = bannerColorsForTitle("Honda Activa");
const colorsB = bannerColorsForTitle("Honda Activa");
const colorsC = bannerColorsForTitle("Wooden sofa set");
assert.deepEqual(colorsA, colorsB);
assert.equal(BANNER_PALETTE.includes(colorsA), true);
assert.notDeepEqual(colorsA, colorsC);

assert.equal(isGeneratedBannerUrl("https://res.cloudinary.com/demo/image/upload/dealr/banners/ad-banner-1.png"), true);
assert.equal(isGeneratedBannerUrl("https://res.cloudinary.com/demo/image/upload/dealr/ads/photo.jpg"), false);

assert.deepEqual(
  collectUploadedImageUrls([
    { path: "https://cdn.example/a.jpg" },
    { location: "https://cdn.example/b.jpg" },
    { url: "https://cdn.example/c.jpg" },
    { path: "" },
    {},
  ]),
  [
    "https://cdn.example/a.jpg",
    "https://cdn.example/b.jpg",
    "https://cdn.example/c.jpg",
  ]
);
assert.deepEqual(collectUploadedImageUrls(undefined), []);

assert.equal(
  shouldGenerateAdBanner({
    uploadedUrls: ["https://cdn.example/photo.jpg"],
    existingImages: [],
  }),
  false
);
assert.equal(
  shouldGenerateAdBanner({
    uploadedUrls: [],
    existingImages: [],
  }),
  true
);
assert.equal(
  shouldGenerateAdBanner({
    uploadedUrls: [],
    existingImages: ["https://cdn.example/photo.jpg"],
    hasGeneratedBanner: false,
    titleChanged: true,
  }),
  false
);
assert.equal(
  shouldGenerateAdBanner({
    uploadedUrls: [],
    existingImages: ["https://res.cloudinary.com/demo/image/upload/dealr/banners/old.png"],
    hasGeneratedBanner: true,
    titleChanged: true,
  }),
  true
);
assert.equal(
  shouldGenerateAdBanner({
    uploadedUrls: [],
    existingImages: ["https://res.cloudinary.com/demo/image/upload/dealr/banners/old.png"],
    hasGeneratedBanner: true,
    titleChanged: false,
    descriptionChanged: false,
  }),
  false
);

const escapedTitle = 'Honda <Activa> & "6G"';
const svg = buildAdBannerSvg({
  title: escapedTitle,
  description: "Well maintained scooter. Single owner. Insurance till next March.",
});
assert.match(svg, /<svg /);
assert.match(svg, /Honda &lt;Activa&gt; &amp; &quot;6G&quot;/);
assert.match(svg, /Well maintained scooter/);
assert.match(svg, new RegExp(`stop-color="${bannerColorsForTitle(escapedTitle).from}"`));
assert.doesNotMatch(svg, /<Honda/);

const untitled = buildAdBannerSvg({ title: "   ", description: "" });
assert.match(untitled, /Untitled ad/);

console.log("adBanner.logic tests passed");
