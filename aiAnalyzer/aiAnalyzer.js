import {
  chatCompletion,
  chatCompletionWithFallback,
  extractJsonObject,
} from './llmClient.js';

const EXTRACT_CONFIDENCE_FLOOR = 0.6;

async function completeJson({
  messages,
  temperature,
  maxTokens,
  responseFormat,
  errorLabel,
}) {
  try {
    const { content } = await chatCompletion({
      messages,
      temperature,
      maxTokens,
      responseFormat,
    });
    const parsed = extractJsonObject(content);
    if (!parsed) {
      throw new Error('No valid JSON in AI response');
    }
    return parsed;
  } catch (error) {
    console.error(`${errorLabel}:`, error);
    throw error;
  }
}

export async function analyzeDescription({ adTitle, category, subCategory, description }) {
  const prompt = buildDynamicPrompt(adTitle, category, subCategory, description);

  const parsedData = await completeJson({
    errorLabel: 'AI description analysis error',
    temperature: 0.2,
    maxTokens: 1000,
    messages: [
      {
        role: 'system',
        content: `You are an expert at extracting and organizing information from classified ads. 
You analyze the content and return ONLY relevant key-value pairs as JSON. 
Never include fields with "Not specified" or empty values.
Always respond with valid JSON only, no explanation or additional text.`,
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const cleanedData = {};
  for (const [key, value] of Object.entries(parsedData)) {
    if (
      value &&
      value !== 'Not specified' &&
      value !== 'N/A' &&
      value !== 'Not mentioned' &&
      String(value).trim() !== ''
    ) {
      cleanedData[key] = value;
    }
  }

  return cleanedData;
}

function buildDynamicPrompt(adTitle, category, subCategory, description) {
  return `Analyze this classified ad and extract ALL relevant information as key-value pairs.

Ad Title: ${adTitle || 'Not provided'}
Category: ${category}
Sub-category: ${subCategory || 'General'}

Description:
"${description}"

Instructions:
1. Extract ONLY information that is EXPLICITLY mentioned in the description
2. Create clear, descriptive key names (e.g., "Property Type", "Number of Bedrooms", "Monthly Rent")
3. Keep values concise but complete
4. Use proper formatting (e.g., "₹15,000/month", "3 BHK", "1200 sq ft")
5. DO NOT include fields where information is missing or unclear
6. DO NOT add "Not specified" or similar placeholder values
7. Organize information logically for a ${category} listing
8. Include pricing, location, features, and specifications when mentioned
9. Return ONLY the JSON object, nothing else

Example output structure:
{
  "Property Type": "Independent House",
  "Bedrooms": "3 BHK",
  "Bathrooms": "3",
  "Furnishing": "Fully Furnished",
  "Furniture Included": "Beds, Wardrobes, Sofa, TV, Dining Table",
  "Kitchen Appliances": "Refrigerator, Stove, Utensils",
  "Parking": "Covered parking for 1 car",
  "Amenities": "24-hour water supply, Inverter backup",
  "Suitable For": "Families, Working professionals",
  "Nearby Facilities": "Schools, Supermarkets, Hospitals, Public transport",
  "Condition": "Well-maintained, Ready for occupancy",
  "Negotiable": "Yes"
}

Now analyze the description above and return ONLY the JSON:`;
}

export async function analyzeAd(mainAdData, relatedAdsData) {
  const systemPrompt = `You are a classified ads performance analyst. Analyze a seller's ad against related listings and return ONLY a strictly valid JSON object — no markdown, no explanation, no extra text.

ANALYSIS ITEMS (include only those supported by the data):
- Inquiries         → count of unique buyers who contacted the seller
- Location Insights → buyer locations extracted from chat data
- Price Comparison  → how the ad's price compares to similar ads nearby
- Competitor Analysis → notable sold/active similar ads and their prices
- Ad Visibility     → views/engagement relative to similar listings
- Open Offers       → count of active, unresolved buyer offers

RECOMMENDATIONS (always include if data supports it):
- Recommended Price → a single suggested price based on comparable listings
- Optimal Price Range → price band for a faster sale based on market trends

STRICT RULES:
- Only include items explicitly supported by the provided data — never fabricate
- value field: short, factual (e.g. "3", "Delhi", "Higher than similar ads") — no ₹ symbol in value
- description field: 1–2 sentences, second person ("Your ad...", "You have...")
- Omit any analysis item if the data does not support it
- recommendations array may be empty [] if data is insufficient`;

  const userPrompt = `Analyze this ad against the related ads data below.

MAIN AD:
${JSON.stringify(mainAdData, null, 2)}

RELATED ADS:
${JSON.stringify(relatedAdsData, null, 2)}

Return ONLY this JSON structure:
{
  "analysis": [
    {
      "title": "<item title>",
      "value": "<short factual value>",
      "description": "<1–2 sentences, second person>"
    }
  ],
  "recommendations": [
    {
      "title": "<Recommended Price | Optimal Price Range>",
      "description": "<concise actionable insight with ₹ amounts>"
    }
  ]
}`;

  const parsed = await completeJson({
    errorLabel: 'AI ad analysis error',
    temperature: 0.1,
    maxTokens: 800,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  return {
    analysis: Array.isArray(parsed.analysis) ? parsed.analysis : [],
    recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
  };
}

export async function aiSearchAds(ads, searchCriteria) {
  const criteriaString = typeof searchCriteria === 'string'
    ? searchCriteria
    : JSON.stringify(searchCriteria, null, 2);

  const prompt = `You are a classified ads search engine. The user wants to find ads matching their criteria.

USER SEARCH QUERY: "${criteriaString}"

ADS DATABASE:
${JSON.stringify(ads, null, 2)}

TASK:
1. First, understand what the user is looking for:
   - What product/category? (phones, laptops, furniture, etc.)
   - What price range? (above X, below X, between X and Y)
   - What location?
   - Any other specific requirements?

2. Filter the ads strictly based on these criteria:
   - For PRICE: Use exact numerical comparison
     * "above 8000" means price > 8000
     * "below 50000" means price < 50000
     * "between 5000 and 10000" means price >= 5000 AND price <= 10000
   
   - For CATEGORY: Match against category.name, subCategory, title, or description
     * "phones" matches: Electronics/Mobiles, or any ad with "phone" in title/description
   
   - For LOCATION: Match against the location field
   
   - For TEXT: Match against title and description semantically

3. Return ONLY the ads that meet ALL the criteria.

4. Output format - respond with ONLY this JSON structure, no other text:
{
    "ads": [
        {
            "_id": "69134a72aac1e1c788512ea3",
            "title": "Brand new iphone 17 pro for sale",
            "price": 180000,
            "location": "Kollam",
            "category": {
                "_id": "68f25ba4c11caea88a6c169e",
                "name": "Electronics",
                "description": "Devices and gadgets"
            },
            "subCategory": "Mobiles",
            "images": [],
            "description": "Brand new i phone 17 pro for sale ,16 gb 256 gb ,minor scratches ,6 months old 4 yrs warenty remaining ,full box available,charger available,black color,screen protector pre installed",
            "seller": {
                "_id": "69022878d5574642fc74e9a5",
                "name": "Akshaya A J",
                "email": "akshayaaj96@gmail.com"
            },
            "posted": "2025-11-11T14:38:42.159Z",
            "usersInterested": [
                "68f254e965a74d068dc12350",
                "68f3a30397a898814b9dabf4"
            ],
            "views": 87,
            "isActive": true,
            "isSold": false,
            "soldTo": null,
            "createdAt": "2025-11-11T14:38:42.161Z",
            "updatedAt": "2025-11-27T01:42:32.813Z",
            "__v": 0
        }
    ],
    "total": 1,
    "totalPages": 1
}

If no ads match, return:
{
  "ads": [],
  "total": 0,
  "totalPages": 0
}

CRITICAL: Return ONLY valid JSON. Do not include any explanation, markdown formatting, or additional text.`;

  const validJSON = await completeJson({
    errorLabel: 'AI search error',
    temperature: 0.1,
    maxTokens: 8000,
    responseFormat: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a precise search algorithm for classified ads. 

RULES:
1. Apply filters STRICTLY and LITERALLY
2. For numerical comparisons (price), use exact math: > means greater than, < means less than
3. Include an ad ONLY if it matches ALL specified criteria
4. When filtering by price:
   - "above 8000" → include only ads where price > 8000
   - "below 50000" → include only ads where price < 50000
   - Be precise with numbers
5. Always output valid JSON only - no markdown, no explanation
6. Double-check your price filtering before responding`,
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  if (!validJSON.ads || !Array.isArray(validJSON.ads)) {
    throw new Error('Invalid response structure - missing ads array');
  }

  console.log(`AI returned ${validJSON.total} matching ads`);
  return validJSON;
}

export async function analyzeChatForFraud(chats) {
  const systemPrompt = `You are a fraud detection analyst for a classified ads platform. Analyze chat conversations and return ONLY a strictly valid JSON object — no markdown, no explanation, no extra text.

FRAUD INDICATORS TO DETECT:
- Off-platform payment requests (wire transfer, crypto, gift cards, UPI outside app)
- Requests for personal/financial/account information
- Suspicious urgency or pressure to transact quickly
- Offers that are unrealistically good
- Inconsistent, evasive, or scripted responses
- Repeated payment method changes
- Refusal to meet in person for local deals
- Suspicious links or attachments
- Offensive, threatening, or aggressive language
- Sexual content or propositions

CLASSIFICATION TYPES (use the most applicable):
PAYMENT_FRAUD | IDENTITY_THEFT | PHISHING | SCAM_OFFER | HARASSMENT | SEXUAL_CONTENT | SAFE

STRICT RULES:
- Only report indicators explicitly present in the chat — never fabricate
- Do NOT classify as fraud unless there are clear, explicit signals
- If no fraud found: return type "SAFE", empty fraudIndicators array, and omit recommendations entirely
- fraudIndicators must be short, factual observations (not opinions)
- recommendations must be one concise actionable sentence`;

  const userPrompt = `Analyze these chat conversations for fraud:

${JSON.stringify(chats, null, 2)}

Return ONLY this JSON structure:
{
  "type": "<CLASSIFICATION_TYPE>",
  "fraudIndicators": ["<observed signal>", ...],
  "recommendations": "<one concise actionable sentence — omit this field entirely if type is SAFE>"
}`;

  let parsed = {};
  try {
    parsed = await completeJson({
      errorLabel: 'AI fraud analysis error',
      temperature: 0.1,
      maxTokens: 400,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
  } catch (error) {
    if (error.message?.includes('No valid JSON')) {
      console.error('Failed to parse AI response JSON:', error);
      return {};
    }
    throw error;
  }

  return {
    type: parsed.type ?? 'SAFE',
    fraudIndicators: Array.isArray(parsed.fraudIndicators) ? parsed.fraudIndicators : [],
    ...(parsed.recommendations ? { recommendations: parsed.recommendations } : {}),
  };
}

export async function analyzeAiPriceInsights(mainAdData, relatedAdsData) {
  const systemPrompt = `You are a classified ads analyst. Your ONLY job is to extract buyer offers from chat data and return a strict JSON object.

OFFER EXTRACTION RULES (non-negotiable):
- A valid offer = a buyer explicitly states a numeric price they will pay (e.g. "I'll pay ₹30,000", "will you take 25k?")
- NOT valid: seller's listed price, price questions, general price talk, implied/inferred prices
- If zero valid offers exist → both values MUST be "null"
- HIGHEST OFFER = the maximum valid offer found
- BEST OFFER = most favorable offer (weighing price + buyer seriousness + urgency) — can differ from highest
- INVARIANT: Highest Offer value >= Best Offer value. If violated, you have an error — fix before returning.

RED FLAG PRIORITY: If any buyer shows suspicious behavior (lowball patterns, ghosting after price reveal, requesting account/personal info, fake urgency, scam signals) — this MUST be highlighted in the description regardless of offer size.

OUTPUT: Return ONLY this JSON, nothing else:
{
  "summary": [
    {
      "title": "Highest Offer",
      "value": "<numeric string or null>",
      "description": "<1–2 sentences, second person, highlights red flags if any>"
    },
    {
      "title": "Best Offer",
      "value": "<numeric string or null>",
      "description": "<1–2 sentences, second person, highlights red flags if any>"
    }
  ]
}

Rules: value = raw number only (e.g. "40000"), no ₹ symbol, no commas, no markdown, no extra text.`;

  const userPrompt = `Analyze the main ad and its chat data against the related ads below.

MAIN AD:
${JSON.stringify(mainAdData, null, 2)}

RELATED ADS:
${JSON.stringify(relatedAdsData, null, 2)}

Steps:
1. Scan ALL chat messages. Extract only explicit buyer price offers.
2. Identify Highest Offer (max value) and Best Offer (best overall considering seriousness + urgency).
3. Verify: Highest Offer >= Best Offer. If not, re-analyze.
4. Check for red flags in buyer behavior — flag in description if found.
5. Return ONLY the JSON. No explanation, no markdown.`;

  const parsed = await completeJson({
    errorLabel: 'AI price insights error',
    temperature: 0.1,
    maxTokens: 600,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const summary = parsed?.summary ?? [];
  const highest = summary.find((s) => s.title === 'Highest Offer');
  const best = summary.find((s) => s.title === 'Best Offer');

  if (highest && best && highest.value !== 'null' && best.value !== 'null') {
    if (Number(best.value) > Number(highest.value)) {
      [highest.value, best.value] = [best.value, highest.value];
    }
  }

  return parsed;
}

export async function generateDescription({ title, category, subCategory, description, location, price }) {
  const prompt = `Clean up and lightly improve this classified ad description. Fix grammar and flow, but keep it sounding like a real person wrote it — not a marketing pitch.

Title: ${title}
Category: ${category}
Sub-category: ${subCategory}
Original description: ${description}
Location: ${location}
Price: ${price}
Rules:
- Keep the same meaning and facts from the original
- Price should be mentioned in the description if available
- Location should be mentioned in the description if available
- Sound natural and human, like someone casually selling their item
- 2-3 sentences max
- No exaggerated claims, buzzwords, or salesy language
- If the original is already decent, make only minimal changes
- Output ONLY the final description text. No notes, explanations, labels, or extra commentary of any kind.`;

  try {
    const { content } = await chatCompletion({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      maxTokens: 150,
    });
    return content;
  } catch (error) {
    console.error('AI description generation error:', error);
    throw error;
  }
}

/**
 * Analyze listing photos and draft ad fields (title, category, subcategory, description).
 * Never invents price or location — those stay manual on the client.
 *
 * @param {{ images: Array<{ mimeType: string, base64: string }>, categories: Array<{ name: string, subCategories?: string[] }> }} params
 */
export async function extractAdFromImages({ images, categories }) {
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error('At least one image is required');
  }

  const categoryCatalog = (categories || []).map((c) => {
    const subs = (c.subCategories || c.subCategory || [])
      .map((s) => (typeof s === 'string' ? s : s?.name))
      .filter(Boolean);
    return { name: c.name, subCategories: subs };
  });

  const catalogText = categoryCatalog.length
    ? categoryCatalog
        .map((c) => {
          const subs = (c.subCategories || []).slice(0, 20).join('|');
          return subs ? `${c.name}[${subs}]` : c.name;
        })
        .join('; ')
    : '(none)';

  const systemPrompt = `You are a marketplace listing assistant for Dealr (India classifieds).
Analyze product photos and reply with a single JSON object only.
No markdown fences, no commentary, no thinking tags.

Rules:
- Use ONLY what is visible or clearly readable in the images.
- Never invent brand/model/year/condition you cannot see.
- Never set price or location (omit them).
- category must match an allowed category name exactly, or null.
- subCategory must match an allowed subcategory under that category, or null.
- title: short, specific, max 80 chars, no emoji, no price.
- description: natural seller voice, 150-280 chars, visible facts only.
- confidence values are numbers from 0 to 1.
- If unsure, use null and confidence below 0.6.`;

  const userText = `Allowed categories: ${catalogText}

Return JSON with this shape:
{"title":null,"category":null,"subCategory":null,"description":null,"visibleAttributes":{},"confidence":{"title":0,"category":0,"subCategory":0,"description":0},"notes":""}`;

  const content = [
    { type: 'text', text: userText },
    ...images.slice(0, 5).map((img) => ({
      type: 'image_url',
      image_url: {
        url: `data:${img.mimeType || 'image/jpeg'};base64,${img.base64}`,
      },
    })),
  ];

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content },
  ];

  const { content: raw } = await chatCompletionWithFallback({
    messages,
    temperature: 0.1,
    maxTokens: 1600,
    acceptContent: (content) => Boolean(extractJsonObject(content)),
    attempts: [
      { label: 'plain', maxTokens: 1600 },
      { label: 'json', maxTokens: 1200, responseFormat: { type: 'json_object' } },
      { label: 'plain-long', maxTokens: 2000 },
    ],
  });

  const parsed = extractJsonObject(raw);
  if (!parsed) {
    throw new Error('No valid JSON in vision response');
  }

  const confidence = {
    title: clampConfidence(parsed?.confidence?.title),
    category: clampConfidence(parsed?.confidence?.category),
    subCategory: clampConfidence(parsed?.confidence?.subCategory),
    description: clampConfidence(parsed?.confidence?.description),
  };

  const matchedCategory = matchCategoryName(parsed?.category, categoryCatalog);
  const matchedSub = matchSubCategory(
    parsed?.subCategory,
    matchedCategory,
    categoryCatalog,
  );

  const title = cleanText(parsed?.title, 90);
  const description = cleanText(parsed?.description, 600);

  const draft = {
    title: confidence.title >= EXTRACT_CONFIDENCE_FLOOR ? title : null,
    category: confidence.category >= EXTRACT_CONFIDENCE_FLOOR ? matchedCategory : null,
    subCategory:
      confidence.subCategory >= EXTRACT_CONFIDENCE_FLOOR ? matchedSub : null,
    description:
      confidence.description >= EXTRACT_CONFIDENCE_FLOOR ? description : null,
    visibleAttributes: sanitizeAttributes(parsed?.visibleAttributes),
    confidence,
    notes: cleanText(parsed?.notes, 200) || '',
    confidenceFloor: EXTRACT_CONFIDENCE_FLOOR,
  };

  if (parsed?.category && !matchedCategory) {
    draft.category = null;
    confidence.category = Math.min(confidence.category, 0.4);
  }

  return draft;
}

function clampConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function cleanText(value, maxLen) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text || /^null$/i.test(text)) return null;
  return text.slice(0, maxLen);
}

function sanitizeAttributes(attrs) {
  if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return {};
  const out = {};
  for (const [key, value] of Object.entries(attrs)) {
    const k = String(key || '').trim().slice(0, 40);
    const v = cleanText(value, 80);
    if (k && v) out[k] = v;
  }
  return out;
}

function matchCategoryName(raw, catalog) {
  const name = cleanText(raw, 80);
  if (!name || !catalog.length) return null;
  const lower = name.toLowerCase();
  const exact = catalog.find((c) => c.name.toLowerCase() === lower);
  if (exact) return exact.name;
  const partial = catalog.find(
    (c) =>
      c.name.toLowerCase().includes(lower) || lower.includes(c.name.toLowerCase()),
  );
  return partial?.name || null;
}

function matchSubCategory(raw, categoryName, catalog) {
  const name = cleanText(raw, 80);
  if (!name || !categoryName) return null;
  const cat = catalog.find((c) => c.name === categoryName);
  if (!cat?.subCategories?.length) return null;
  const lower = name.toLowerCase();
  const exact = cat.subCategories.find((s) => s.toLowerCase() === lower);
  if (exact) return exact;
  const partial = cat.subCategories.find(
    (s) => s.toLowerCase().includes(lower) || lower.includes(s.toLowerCase()),
  );
  return partial || null;
}
