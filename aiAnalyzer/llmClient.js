/**
 * OpenAI-compatible chat client for Gemini (primary) and Groq (fallback).
 *
 * Env:
 *   AI_PROVIDER          gemini | groq   (default: gemini if GEMINI_API_KEY is set, else groq)
 *   GEMINI_API_KEY       from https://aistudio.google.com/apikey
 *   GEMINI_API_BASE      default https://generativelanguage.googleapis.com/v1beta/openai
 *   GEMINI_TEXT_MODEL    default gemini-2.5-flash
 *   GEMINI_VISION_MODEL  default gemini-2.5-flash (Flash is multimodal)
 *   GROQ_API_KEY         optional fallback
 *   GROQ_TEXT_MODEL      default llama-3.3-70b-versatile
 *   GROQ_VISION_MODEL    default qwen/qwen3.6-27b
 */

const GEMINI_DEFAULTS = {
  provider: 'gemini',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  keyEnv: 'GEMINI_API_KEY',
  textModel: 'gemini-2.5-flash',
  visionModel: 'gemini-2.5-flash',
};

const GROQ_DEFAULTS = {
  provider: 'groq',
  baseUrl: 'https://api.groq.com/openai/v1',
  keyEnv: 'GROQ_API_KEY',
  textModel: 'llama-3.3-70b-versatile',
  visionModel: 'qwen/qwen3.6-27b',
};

function geminiApiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
}

export function resolveProviderName() {
  const explicit = String(process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'gemini' || explicit === 'google') return 'gemini';
  if (explicit === 'groq') return 'groq';
  if (geminiApiKey()) return 'gemini';
  if (process.env.GROQ_API_KEY) return 'groq';
  throw new Error(
    'No AI provider configured. Set GEMINI_API_KEY (recommended) or GROQ_API_KEY.',
  );
}

export function getLlmConfig() {
  const provider = resolveProviderName();
  const defaults = provider === 'gemini' ? GEMINI_DEFAULTS : GROQ_DEFAULTS;
  const apiKey = provider === 'gemini' ? geminiApiKey() : process.env[defaults.keyEnv];

  if (!apiKey) {
    throw new Error(`${defaults.keyEnv} not configured`);
  }

  if (provider === 'gemini') {
    return {
      ...defaults,
      apiKey,
      baseUrl: (process.env.GEMINI_API_BASE || defaults.baseUrl).replace(/\/$/, ''),
      textModel: process.env.GEMINI_TEXT_MODEL || defaults.textModel,
      visionModel: process.env.GEMINI_VISION_MODEL || defaults.visionModel,
    };
  }

  return {
    ...defaults,
    apiKey,
    baseUrl: (process.env.GROQ_API_BASE || defaults.baseUrl).replace(/\/$/, ''),
    textModel: process.env.GROQ_TEXT_MODEL || defaults.textModel,
    visionModel: process.env.GROQ_VISION_MODEL || defaults.visionModel,
  };
}

function buildRequestBody({ config, messages, temperature, maxTokens, responseFormat, vision }) {
  const body = {
    model: vision ? config.visionModel : config.textModel,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  if (responseFormat) {
    body.response_format = responseFormat;
  }

  // Keep JSON extractors clean — Gemini 2.5+ thinks unless told not to.
  if (config.provider === 'gemini') {
    body.reasoning_effort = 'none';
  }

  if (config.provider === 'groq' && vision) {
    body.reasoning_format = 'hidden';
    body.reasoning_effort = 'none';
  }

  return body;
}

export async function chatCompletion({
  messages,
  temperature = 0.2,
  maxTokens = 1000,
  responseFormat,
  vision = false,
}) {
  const config = getLlmConfig();
  const body = buildRequestBody({
    config,
    messages,
    temperature,
    maxTokens,
    responseFormat,
    vision,
  });

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data.error?.message || response.statusText || 'Unknown error';
    const error = new Error(`AI API error (${config.provider}): ${message}`);
    error.status = response.status;
    error.provider = config.provider;
    error.failedGeneration = data.error?.failed_generation;
    error.responseBody = data;
    throw error;
  }

  const content = String(data.choices?.[0]?.message?.content || '').trim();
  return { content, raw: data, provider: config.provider, model: body.model };
}

export async function chatCompletionWithFallback({
  messages,
  temperature,
  maxTokens,
  attempts,
  acceptContent,
}) {
  const config = getLlmConfig();
  const isAcceptable = typeof acceptContent === 'function'
    ? acceptContent
    : (content) => Boolean(content);
  let lastError = `Unknown ${config.provider} vision error`;

  for (const attempt of attempts) {
    try {
      const result = await chatCompletion({
        messages,
        temperature: attempt.temperature ?? temperature,
        maxTokens: attempt.maxTokens ?? maxTokens,
        responseFormat: attempt.responseFormat,
        vision: true,
      });
      if (isAcceptable(result.content)) return result;
      lastError = result.content ? 'Vision returned non-JSON content' : 'Empty vision response';
      console.warn(`🖼️ Vision attempt ${attempt.label}:`, lastError);
    } catch (err) {
      lastError = err.message || String(err);
      if (typeof err.failedGeneration === 'string' && isAcceptable(err.failedGeneration)) {
        console.log(`🖼️ Vision recovered JSON from failed_generation (${attempt.label})`);
        return {
          content: err.failedGeneration.trim(),
          raw: err.responseBody || {},
          provider: config.provider,
          recovered: true,
        };
      }
      console.warn(`🖼️ Vision attempt ${attempt.label} failed:`, lastError);
    }
  }

  throw new Error(`Vision error (${config.provider}): ${lastError}`);
}

export function stripReasoning(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let text = raw.trim();
  text = text.replace(/```json\s*/gi, '').replace(/```/g, '');
  text = text.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '');
  text = text.replace(/<thinking>[\s\S]*?(<\/thinking>|$)/gi, '');
  text = text.replace(/<\/?think>/gi, '');
  return text.trim();
}

export function extractJsonObject(raw) {
  const text = stripReasoning(raw);
  if (!text) return null;

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // fall through to brace extraction
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  const candidate = text.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    try {
      return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return null;
    }
  }
}
