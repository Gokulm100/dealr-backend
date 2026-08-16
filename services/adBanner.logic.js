/** Banner canvas used in place of a listing photo. */
export const BANNER_WIDTH = 1200;
export const BANNER_HEIGHT = 900;

export const BANNER_PALETTE = [
  { from: "#1B4F72", to: "#0E2F44" },
  { from: "#6C3483", to: "#3B1F4A" },
  { from: "#117A65", to: "#0B4F42" },
  { from: "#B9770E", to: "#7D5109" },
  { from: "#922B21", to: "#641E16" },
  { from: "#1A5276", to: "#0E334A" },
  { from: "#196F3D", to: "#0E4024" },
  { from: "#6E2C00", to: "#3E1900" },
  { from: "#4A235A", to: "#2C1536" },
  { from: "#0E6655", to: "#084034" },
  { from: "#1F618D", to: "#123A55" },
  { from: "#7B241C", to: "#4A1611" },
];

const TITLE_MAX_CHARS = 28;
const TITLE_MAX_LINES = 3;
const DESCRIPTION_MAX_CHARS = 42;
const DESCRIPTION_MAX_LINES = 6;

export function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function truncateText(text, maxChars) {
  const value = String(text ?? "").trim();
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export function wrapText(text, maxChars, maxLines) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!clean || maxChars < 1 || maxLines < 1) return [];

  const words = clean.split(" ");
  const lines = [];
  let current = "";

  const flushRemainder = (startWord, remainingWords) => {
    const rest = [startWord, ...remainingWords].join(" ").trim();
    lines.push(truncateText(rest, maxChars));
  };

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const next = current ? `${current} ${word}` : word;

    if (next.length <= maxChars) {
      current = next;
      continue;
    }

    if (current) lines.push(current);

    if (lines.length >= maxLines - 1) {
      flushRemainder(word, words.slice(i + 1));
      return lines.slice(0, maxLines);
    }

    current = word.length > maxChars ? truncateText(word, maxChars) : word;
  }

  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

export function bannerColorsForTitle(title) {
  const hash = [...String(title ?? "")].reduce(
    (acc, char) => (acc * 31 + char.charCodeAt(0)) >>> 0,
    0
  );
  return BANNER_PALETTE[hash % BANNER_PALETTE.length];
}

export function isGeneratedBannerUrl(url) {
  return /\/banners\//.test(String(url || ""));
}

export function collectUploadedImageUrls(files) {
  if (!Array.isArray(files)) return [];
  return files
    .map((file) => file?.path || file?.location || file?.url)
    .filter((url) => typeof url === "string" && url.trim());
}

/**
 * Decide whether a listing should get a generated banner instead of a photo.
 * User-uploaded files always win. Existing real photos are left alone.
 */
export function shouldGenerateAdBanner({
  uploadedUrls = [],
  existingImages = [],
  hasGeneratedBanner = false,
  titleChanged = false,
  descriptionChanged = false,
} = {}) {
  if (uploadedUrls.length > 0) return false;
  if (!existingImages.length) return true;
  if (hasGeneratedBanner && (titleChanged || descriptionChanged)) return true;
  if (existingImages.every(isGeneratedBannerUrl) && (titleChanged || descriptionChanged)) {
    return true;
  }
  return false;
}

function tspanLines(lines, x, startY, lineHeight) {
  return lines
    .map((line, index) => {
      const y = startY + index * lineHeight;
      return `<tspan x="${x}" y="${y}">${escapeXml(line)}</tspan>`;
    })
    .join("");
}

export function buildAdBannerSvg({ title, description } = {}) {
  const safeTitle = String(title ?? "").trim() || "Untitled ad";
  const safeDescription = String(description ?? "").replace(/\s+/g, " ").trim();
  const { from, to } = bannerColorsForTitle(safeTitle);
  const titleLines = wrapText(safeTitle, TITLE_MAX_CHARS, TITLE_MAX_LINES);
  const descriptionLines = wrapText(safeDescription, DESCRIPTION_MAX_CHARS, DESCRIPTION_MAX_LINES);

  const paddingX = 80;
  const titleStartY = 280;
  const titleLineHeight = 70;
  const dividerY = titleStartY + titleLines.length * titleLineHeight + 16;
  const descriptionStartY = dividerY + 62;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${BANNER_WIDTH}" height="${BANNER_HEIGHT}" viewBox="0 0 ${BANNER_WIDTH} ${BANNER_HEIGHT}" role="img" aria-label="${escapeXml(safeTitle)}">
  <defs>
    <linearGradient id="adBannerBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="${BANNER_WIDTH}" height="${BANNER_HEIGHT}" fill="url(#adBannerBg)"/>
  <circle cx="1080" cy="90" r="200" fill="#ffffff" fill-opacity="0.07"/>
  <circle cx="80" cy="820" r="230" fill="#ffffff" fill-opacity="0.05"/>
  <text x="${paddingX}" y="${titleStartY}" fill="#ffffff" font-family="Noto Sans Malayalam, Noto Sans, Arial, sans-serif" font-size="56" font-weight="700">${tspanLines(titleLines, paddingX, titleStartY, titleLineHeight)}</text>
  <rect x="${paddingX}" y="${dividerY}" width="72" height="5" rx="2" fill="#ffffff" fill-opacity="0.55"/>
  ${
    descriptionLines.length
      ? `<text x="${paddingX}" y="${descriptionStartY}" fill="#ffffff" fill-opacity="0.88" font-family="Noto Sans Malayalam, Noto Sans, Arial, sans-serif" font-size="30" font-weight="400">${tspanLines(descriptionLines, paddingX, descriptionStartY, 44)}</text>`
      : ""
  }
</svg>`;
}
