import assert from 'node:assert/strict';
import {
  extractJsonObject,
  getLlmConfig,
  stripReasoning,
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
  GROQ_API_KEY: '  gsk-test  ',
  GEMINI_API_KEY: 'gemini-should-be-ignored',
  AI_PROVIDER: 'gemini',
}, () => {
  const config = getLlmConfig();
  assert.equal(config.provider, 'groq');
  assert.equal(config.apiKey, 'gsk-test');
  assert.equal(config.baseUrl, 'https://api.groq.com/openai/v1');
  assert.equal(config.textModel, 'llama-3.3-70b-versatile');
  assert.equal(config.visionModel, 'qwen/qwen3.6-27b');
});

withEnv({ GROQ_API_KEY: '' }, () => {
  assert.throws(() => getLlmConfig(), /GROQ_API_KEY not configured/);
});

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
