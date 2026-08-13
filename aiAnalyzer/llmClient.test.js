import assert from 'node:assert/strict';
import {
  extractGeminiText,
  extractJsonObject,
  getLlmConfig,
  isQuotaError,
  markGeminiQuotaCooldown,
  isGeminiOnCooldown,
  resetGeminiQuotaCooldown,
  resolveProviderName,
  stripReasoning,
  toGeminiParts,
  toGeminiPayload,
  unwrapAdAnalysisArgs,
} from './llmClient.js';

function withEnv(overrides, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

withEnv({
  AI_PROVIDER: '',
  GEMINI_API_KEY: '  gemini-test  ',
  GOOGLE_API_KEY: '',
  GROQ_API_KEY: 'gsk-test',
}, () => {
  assert.equal(resolveProviderName(), 'gemini');
  const config = getLlmConfig();
  assert.equal(config.provider, 'gemini');
  assert.equal(config.apiKey, 'gemini-test');
  assert.equal(config.textModel, 'gemini-2.5-flash');
  assert.equal(config.visionModel, 'gemini-2.5-flash');
});

withEnv({
  AI_PROVIDER: 'groq',
  GEMINI_API_KEY: 'gemini-test',
  GROQ_API_KEY: 'gsk-test',
}, () => {
  assert.equal(resolveProviderName(), 'groq');
  assert.equal(getLlmConfig().textModel, 'llama-3.3-70b-versatile');
});

withEnv({
  AI_PROVIDER: '',
  GEMINI_API_KEY: 'gemini-test',
  GROQ_API_KEY: 'gsk-test',
}, () => {
  const groq = getLlmConfig('groq');
  assert.equal(groq.provider, 'groq');
  assert.equal(groq.apiKey, 'gsk-test');
  assert.equal(groq.baseUrl, 'https://api.groq.com/openai/v1');
});

assert.equal(isQuotaError({ status: 429, message: 'Too Many Requests' }), true);
assert.equal(isQuotaError({ message: 'You exceeded your current quota' }), true);
assert.equal(isQuotaError({ message: 'RESOURCE_EXHAUSTED' }), true);
assert.equal(isQuotaError({ status: 400, message: 'bad request' }), false);

resetGeminiQuotaCooldown();
assert.equal(isGeminiOnCooldown(), false);
markGeminiQuotaCooldown(60_000);
assert.equal(isGeminiOnCooldown(), true);
resetGeminiQuotaCooldown();
assert.equal(isGeminiOnCooldown(), false);

withEnv({
  AI_PROVIDER: '',
  GEMINI_API_KEY: '',
  GOOGLE_API_KEY: '',
  GROQ_API_KEY: 'gsk-test',
}, () => {
  assert.equal(resolveProviderName(), 'groq');
});

withEnv({
  AI_PROVIDER: '',
  GEMINI_API_KEY: '',
  GOOGLE_API_KEY: '',
  GROQ_API_KEY: '',
}, () => {
  assert.throws(() => resolveProviderName(), /No AI provider configured/);
});

const payload = toGeminiPayload({
  messages: [
    { role: 'system', content: 'Return JSON only' },
    { role: 'user', content: 'Analyze this ad' },
  ],
  temperature: 0.1,
  maxTokens: 400,
  responseFormat: { type: 'json_object' },
});
assert.equal(payload.systemInstruction.parts[0].text, 'Return JSON only');
assert.equal(payload.contents[0].role, 'user');
assert.equal(payload.generationConfig.thinkingConfig.thinkingBudget, 0);
assert.equal(payload.generationConfig.responseMimeType, 'application/json');
assert.equal(payload.generationConfig.maxOutputTokens, 1024);

const imageParts = toGeminiParts([
  { type: 'text', text: 'What is this?' },
  { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,abc123' } },
]);
assert.deepEqual(imageParts[1], { inline_data: { mime_type: 'image/jpeg', data: 'abc123' } });

assert.equal(
  extractGeminiText({
    candidates: [{ content: { parts: [{ thought: true, text: 'ignore' }, { text: '{"ok":true}' }] } }],
  }),
  '{"ok":true}',
);

assert.throws(
  () => extractGeminiText({ promptFeedback: { blockReason: 'SAFETY' } }),
  /blocked/,
);

const unwrapped = unwrapAdAnalysisArgs({
  constructedMainAdData: { title: 'Phone' },
  constructedRelatedAdsData: [{ title: 'Other' }],
});
assert.equal(unwrapped.mainAdData.title, 'Phone');
assert.equal(unwrapped.relatedAdsData[0].title, 'Other');

const parsed = extractJsonObject(`<think>ignore me</think>
\`\`\`json
{"title":"iPhone 13","category":"Electronics"}
\`\`\``);
assert.deepEqual(parsed, { title: 'iPhone 13', category: 'Electronics' });
assert.equal(stripReasoning('<think>secret</think>{"ok":true}'), '{"ok":true}');

console.log('llmClient tests passed');
