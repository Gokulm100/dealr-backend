import assert from 'node:assert/strict';
import {
  extractJsonObject,
  getLlmConfig,
  resolveProviderName,
  stripReasoning,
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
  GEMINI_API_KEY: 'gemini-test',
  GOOGLE_API_KEY: '',
  NVIDIA_API_KEY: 'nvapi-should-be-ignored',
  GROQ_API_KEY: 'gsk-test',
}, () => {
  assert.equal(resolveProviderName(), 'gemini');
  const config = getLlmConfig();
  assert.equal(config.provider, 'gemini');
  assert.equal(config.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
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
  GEMINI_API_KEY: '',
  GOOGLE_API_KEY: '',
  GROQ_API_KEY: 'gsk-test',
}, () => {
  assert.equal(resolveProviderName(), 'groq');
});

withEnv({
  AI_PROVIDER: '',
  GEMINI_API_KEY: '',
  GOOGLE_API_KEY: 'google-alias-key',
  GROQ_API_KEY: '',
}, () => {
  assert.equal(resolveProviderName(), 'gemini');
  assert.equal(getLlmConfig().apiKey, 'google-alias-key');
});

withEnv({
  AI_PROVIDER: '',
  GEMINI_API_KEY: '',
  GOOGLE_API_KEY: '',
  GROQ_API_KEY: '',
}, () => {
  assert.throws(() => resolveProviderName(), /No AI provider configured/);
});

const parsed = extractJsonObject(`<think>ignore me</think>
\`\`\`json
{"title":"iPhone 13","category":"Electronics"}
\`\`\``);
assert.deepEqual(parsed, { title: 'iPhone 13', category: 'Electronics' });
assert.equal(stripReasoning('<think>secret</think>{"ok":true}'), '{"ok":true}');

console.log('llmClient tests passed');
