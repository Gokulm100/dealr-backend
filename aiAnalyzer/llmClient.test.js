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

withEnv({ AI_PROVIDER: '', NVIDIA_API_KEY: 'nvapi-test', GROQ_API_KEY: 'gsk-test' }, () => {
  assert.equal(resolveProviderName(), 'nvidia');
  const config = getLlmConfig();
  assert.equal(config.provider, 'nvidia');
  assert.equal(config.baseUrl, 'https://integrate.api.nvidia.com/v1');
  assert.equal(config.textModel, 'nvidia/llama-3.3-nemotron-super-49b-v1.5');
  assert.equal(config.visionModel, 'nvidia/nemotron-nano-12b-v2-vl');
});

withEnv({ AI_PROVIDER: 'groq', NVIDIA_API_KEY: 'nvapi-test', GROQ_API_KEY: 'gsk-test' }, () => {
  assert.equal(resolveProviderName(), 'groq');
  assert.equal(getLlmConfig().textModel, 'llama-3.3-70b-versatile');
});

withEnv({ AI_PROVIDER: '', NVIDIA_API_KEY: '', GROQ_API_KEY: 'gsk-test' }, () => {
  assert.equal(resolveProviderName(), 'groq');
});

withEnv({ AI_PROVIDER: '', NVIDIA_API_KEY: '', GROQ_API_KEY: '' }, () => {
  assert.throws(() => resolveProviderName(), /No AI provider configured/);
});

const parsed = extractJsonObject(`<think>ignore me</think>
\`\`\`json
{"title":"iPhone 13","category":"Electronics"}
\`\`\``);
assert.deepEqual(parsed, { title: 'iPhone 13', category: 'Electronics' });
assert.equal(stripReasoning('<think>secret</think>{"ok":true}'), '{"ok":true}');

console.log('llmClient tests passed');
