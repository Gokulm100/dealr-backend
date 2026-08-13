/**
 * OpenAI-compatible chat client for NVIDIA Nemotron (NIM) and Groq.
 *
 * Env:
 *   AI_PROVIDER          nvidia | groq   (default: nvidia if NVIDIA_API_KEY is set, else groq)
 *   NVIDIA_API_KEY       nvapi-... from https://build.nvidia.com/settings/api-keys
 *   NVIDIA_API_BASE      default https://integrate.api.nvidia.com/v1
 *   NVIDIA_TEXT_MODEL    default nvidia/llama-3.3-nemotron-super-49b-v1.5
 *   NVIDIA_VISION_MODEL  default nvidia/nemotron-nano-12b-v2-vl
 *   GROQ_API_KEY         kept as optional fallback
 *   GROQ_TEXT_MODEL      default llama-3.3-70b-versatile
 *   GROQ_VISION_MODEL    default qwen/qwen3.6-27b
 */

const NVIDIA_DEFAULTS = {
  provider: 'nvidia',
  baseUrl: 'https://integrate.api.nvidia.com/v1',
  keyEnv: 'NVIDIA_API_KEY',
  textModel: 'nvidia/llama-3.3-nemotron-super-49b-v1.5',
  visionModel: 'nvidia/nemotron-nano-12b-v2-vl',
};

const GROQ_DEFAULTS = {
  provider: 'groq',
  baseUrl: 'https://api.groq.com/openai/v1',
  keyEnv: 'GROQ_API_KEY',
  textModel: 'llama-3.3-70b-versatile',
  visionModel: 'qwen/qwen3.6-27b',
};

export function resolveProviderName() {
  const explicit = String(process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'nvidia' || explicit === 'groq') return explicit;
  if (process.env.NVIDIA_API_KEY) return 'nvidia';
  if (process.env.GROQ_API_KEY) return 'groq';
  throw new Error(
    'No AI provider configured. Set NVIDIA_API_KEY (recommended) or GROQ_API_KEY.',
  );
}

export function getLlmConfig() {
  const provider = resolveProviderName();
  const defaults = provider === 'nvidia' ? NVIDIA_DEFAULTS : GROQ_DEFAULTS;

  const apiKey = process.env[defaults.keyEnv];
  if (!apiKey) {
    throw new Error(`${defaults.keyEnv} not configured`);
  }

  if (provider === 'nvidia') {
    return {
      ...defaults,
      apiKey,
      baseUrl: (process.env.NVIDIA_API_BASE || defaults.baseUrl).replace(/\/$/, ''),
      textModel: process.env.NVIDIA_TEXT_MODEL || defaults.textModel,
      visionModel: process.env.NVIDIA_VISION_MODEL || defaults.visionModel,
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

function applyNoThink(messages) {
  return messages.map((message, index) => {
    if (index !== 0 || message.role !== 'system') return message;
    const content = message.content;
    if (typeof content !== 'string') return message;
    if (content.includes('/no_think')) return message;
    return { ...message, content: `/no_think\n${content}` };
  });
}

function buildRequestBody({ config, messages, temperature, maxTokens, responseFormat, vision }) {
  const body = {
    model: vision ? config.visionModel : config.textModel,
    messages: config.provider === 'nvidia' ? applyNoThink(messages) : messages,
    temperature,
    max_tokens: maxTokens,
  };

  if (responseFormat) {
    body.response_format = responseFormat;
  }

  // Nemotron reasoning models default to thinking ON, which breaks JSON parsers.
  if (config.provider === 'nvidia') {
    body.chat_template_kwargs = { enable_thinking: false };
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
