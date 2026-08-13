/**
 * Chat client for Gemini (primary) and Groq (fallback).
 *
 * Gemini uses the native generateContent API. The OpenAI-compat layer
 * leaves thinking ON by default, which eats max_tokens and returns empty JSON.
 *
 * Env:
 *   AI_PROVIDER          gemini | groq
 *   GEMINI_API_KEY       from https://aistudio.google.com/apikey
 *   GEMINI_TEXT_MODEL    default gemini-2.5-flash
 *   GEMINI_VISION_MODEL  default gemini-2.5-flash
 *   GROQ_API_KEY         optional fallback
 */

const GEMINI_DEFAULTS = {
  provider: 'gemini',
  keyEnv: 'GEMINI_API_KEY',
  textModel: 'gemini-2.5-flash',
  visionModel: 'gemini-2.5-flash',
  fallbackModels: ['gemini-2.0-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite'],
};

const GROQ_DEFAULTS = {
  provider: 'groq',
  baseUrl: 'https://api.groq.com/openai/v1',
  keyEnv: 'GROQ_API_KEY',
  textModel: 'llama-3.3-70b-versatile',
  visionModel: 'qwen/qwen3.6-27b',
};

function readEnv(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function geminiApiKey() {
  return readEnv('GEMINI_API_KEY') || readEnv('GOOGLE_API_KEY');
}

export function resolveProviderName() {
  const explicit = readEnv('AI_PROVIDER').toLowerCase();
  if (explicit === 'gemini' || explicit === 'google') return 'gemini';
  if (explicit === 'groq') return 'groq';
  if (geminiApiKey()) return 'gemini';
  if (readEnv('GROQ_API_KEY')) return 'groq';
  throw new Error(
    'No AI provider configured. Set GEMINI_API_KEY (recommended) or GROQ_API_KEY.',
  );
}

export function getLlmConfig() {
  const provider = resolveProviderName();

  if (provider === 'gemini') {
    const apiKey = geminiApiKey();
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
    return {
      ...GEMINI_DEFAULTS,
      apiKey,
      textModel: readEnv('GEMINI_TEXT_MODEL') || GEMINI_DEFAULTS.textModel,
      visionModel: readEnv('GEMINI_VISION_MODEL') || GEMINI_DEFAULTS.visionModel,
    };
  }

  const apiKey = readEnv('GROQ_API_KEY');
  if (!apiKey) throw new Error('GROQ_API_KEY not configured');
  return {
    ...GROQ_DEFAULTS,
    apiKey,
    baseUrl: (readEnv('GROQ_API_BASE') || GROQ_DEFAULTS.baseUrl).replace(/\/$/, ''),
    textModel: readEnv('GROQ_TEXT_MODEL') || GROQ_DEFAULTS.textModel,
    visionModel: readEnv('GROQ_VISION_MODEL') || GROQ_DEFAULTS.visionModel,
  };
}

export function toGeminiParts(content) {
  if (typeof content === 'string') return [{ text: content }];
  if (!Array.isArray(content)) return [{ text: String(content ?? '') }];

  return content.map((part) => {
    if (!part || typeof part === 'string') return { text: String(part || '') };
    if (part.type === 'text') return { text: part.text || '' };
    if (part.type === 'image_url') {
      const url = part.image_url?.url || '';
      const match = String(url).match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        return { inline_data: { mime_type: match[1], data: match[2] } };
      }
      return { file_data: { file_uri: url } };
    }
    return { text: JSON.stringify(part) };
  });
}

export function toGeminiPayload({ messages, temperature, maxTokens, responseFormat }) {
  const system = messages.find((message) => message.role === 'system');
  const contents = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: toGeminiParts(message.content),
    }));

  const payload = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: Math.max(maxTokens || 0, 1024),
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  if (system) {
    payload.systemInstruction = { parts: toGeminiParts(system.content) };
  }

  if (responseFormat?.type === 'json_object') {
    payload.generationConfig.responseMimeType = 'application/json';
  }

  return payload;
}

export function extractGeminiText(data) {
  const blockReason = data?.promptFeedback?.blockReason;
  if (blockReason) {
    throw new Error(`Gemini blocked the request (${blockReason})`);
  }

  const candidate = data?.candidates?.[0];
  if (!candidate) {
    const message = data?.error?.message || 'Empty Gemini response';
    throw new Error(message);
  }

  const parts = candidate.content?.parts || [];
  const text = parts
    .filter((part) => part?.text && !part.thought)
    .map((part) => part.text)
    .join('\n')
    .trim();

  if (!text) {
    const finish = candidate.finishReason || 'unknown';
    throw new Error(`Gemini returned no text (finishReason=${finish})`);
  }

  return text;
}

function geminiErrorMessage(data, statusText) {
  return data?.error?.message || data?.error?.status || statusText || 'Unknown Gemini error';
}

async function geminiGenerateContent({
  apiKey,
  model,
  messages,
  temperature,
  maxTokens,
  responseFormat,
  disableThinking = true,
}) {
  const payload = toGeminiPayload({ messages, temperature, maxTokens, responseFormat });
  if (!disableThinking) {
    delete payload.generationConfig.thinkingConfig;
    payload.generationConfig.maxOutputTokens = Math.max(maxTokens || 0, 4096);
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(payload),
    },
  );

  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function chatCompletionGemini({ messages, temperature, maxTokens, responseFormat, vision }) {
  const config = getLlmConfig();
  const preferred = vision ? config.visionModel : config.textModel;
  const models = [...new Set([preferred, ...GEMINI_DEFAULTS.fallbackModels])];

  let lastError = 'Unknown Gemini error';

  for (const model of models) {
    for (const disableThinking of [true, false]) {
      const { response, data } = await geminiGenerateContent({
        apiKey: config.apiKey,
        model,
        messages,
        temperature,
        maxTokens,
        responseFormat,
        disableThinking,
      });

      if (response.ok) {
        const content = extractGeminiText(data);
        return { content, raw: data, provider: 'gemini', model };
      }

      lastError = geminiErrorMessage(data, response.statusText);
      const notFound = response.status === 404 || /not found|not supported/i.test(lastError);
      const thinkingRejected = /thinking|invalid argument|unknown name/i.test(lastError);

      console.warn(
        `🤖 Gemini ${model} failed (${response.status}, thinkingOff=${disableThinking}): ${lastError}`,
      );

      if (response.status === 404 || (notFound && disableThinking === false)) break;
      if (!thinkingRejected && response.status !== 400) {
        throw Object.assign(new Error(`AI API error (gemini): ${lastError}`), {
          status: response.status,
          provider: 'gemini',
          responseBody: data,
        });
      }
    }
  }

  throw Object.assign(new Error(`AI API error (gemini): ${lastError}`), {
    provider: 'gemini',
  });
}

async function chatCompletionGroq({ messages, temperature, maxTokens, responseFormat, vision }) {
  const config = getLlmConfig();
  const body = {
    model: vision ? config.visionModel : config.textModel,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  if (responseFormat) body.response_format = responseFormat;
  if (vision) {
    body.reasoning_format = 'hidden';
    body.reasoning_effort = 'none';
  }

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
    const error = new Error(`AI API error (groq): ${message}`);
    error.status = response.status;
    error.provider = 'groq';
    error.failedGeneration = data.error?.failed_generation;
    error.responseBody = data;
    throw error;
  }

  const content = String(data.choices?.[0]?.message?.content || '').trim();
  return { content, raw: data, provider: 'groq', model: body.model };
}

export async function chatCompletion({
  messages,
  temperature = 0.2,
  maxTokens = 1000,
  responseFormat,
  vision = false,
}) {
  const config = getLlmConfig();
  if (config.provider === 'gemini') {
    return chatCompletionGemini({
      messages,
      temperature,
      maxTokens,
      responseFormat,
      vision,
    });
  }
  return chatCompletionGroq({
    messages,
    temperature,
    maxTokens,
    responseFormat,
    vision,
  });
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

/** Accept both positional args and the controller's accidental object wrapper. */
export function unwrapAdAnalysisArgs(mainAdData, relatedAdsData) {
  if (
    relatedAdsData == null
    && mainAdData
    && typeof mainAdData === 'object'
    && (mainAdData.constructedMainAdData || mainAdData.mainAdData)
  ) {
    return {
      mainAdData: mainAdData.constructedMainAdData ?? mainAdData.mainAdData,
      relatedAdsData: mainAdData.constructedRelatedAdsData ?? mainAdData.relatedAdsData,
    };
  }
  return { mainAdData, relatedAdsData };
}
