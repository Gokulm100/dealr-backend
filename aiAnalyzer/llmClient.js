/**
 * Groq chat client (OpenAI-compatible).
 *
 * Env:
 *   GROQ_API_KEY         required
 *   GROQ_API_BASE        default https://api.groq.com/openai/v1
 *   GROQ_TEXT_MODEL      default openai/gpt-oss-120b
 *   GROQ_VISION_MODEL    default qwen/qwen3.6-27b
 */

const GROQ_DEFAULTS = {
  provider: 'groq',
  baseUrl: 'https://api.groq.com/openai/v1',
  textModel: 'openai/gpt-oss-120b',
  visionModel: 'qwen/qwen3.6-27b',
};

function readEnv(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

export function getLlmConfig() {
  const apiKey = readEnv('GROQ_API_KEY');
  if (!apiKey) {
    throw new Error('GROQ_API_KEY not configured');
  }

  return {
    ...GROQ_DEFAULTS,
    apiKey,
    baseUrl: (readEnv('GROQ_API_BASE') || GROQ_DEFAULTS.baseUrl).replace(/\/$/, ''),
    textModel: readEnv('GROQ_TEXT_MODEL') || GROQ_DEFAULTS.textModel,
    visionModel: readEnv('GROQ_VISION_MODEL') || GROQ_DEFAULTS.visionModel,
  };
}

export async function chatCompletion({
  messages,
  temperature = 0.2,
  maxTokens = 1000,
  responseFormat,
  vision = false,
}) {
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
  } else if (String(body.model).startsWith('openai/gpt-oss')) {
    body.reasoning_format = 'hidden';
    body.reasoning_effort = 'low';
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
    const error = new Error(`Groq API error: ${message}`);
    error.status = response.status;
    error.provider = 'groq';
    error.failedGeneration = data.error?.failed_generation;
    error.responseBody = data;
    throw error;
  }

  const content = String(data.choices?.[0]?.message?.content || '').trim();
  return { content, raw: data, provider: 'groq', model: body.model };
}

export async function chatCompletionWithFallback({
  messages,
  temperature,
  maxTokens,
  attempts,
  acceptContent,
}) {
  const isAcceptable = typeof acceptContent === 'function'
    ? acceptContent
    : (content) => Boolean(content);
  let lastError = 'Unknown Groq vision error';

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
          provider: 'groq',
          recovered: true,
        };
      }
      console.warn(`🖼️ Vision attempt ${attempt.label} failed:`, lastError);
    }
  }

  throw new Error(`Groq vision error: ${lastError}`);
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
