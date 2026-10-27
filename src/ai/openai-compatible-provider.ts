import {
  AIProviderError,
  type AIProvider,
  type AIProviderCallOptions,
  type AIProviderRequest,
  type AIProviderResponse,
  type AIProviderUsage,
} from './provider';

export interface OpenAICompatibleProviderOptions {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly maxResponseBytes?: number;
  readonly fetchImplementation?: typeof fetch;
}

const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000;

export class OpenAICompatibleProvider implements AIProvider {
  readonly id = 'openai-compatible';
  readonly #endpoint: URL;
  readonly #apiKey: string;
  readonly #maxResponseBytes: number;
  readonly #fetch: typeof fetch;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.#endpoint = validateEndpoint(options.endpoint);
    if (!options.apiKey) {
      throw new AIProviderError('request-invalid', 'AI API key is required', false, this.id);
    }
    const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
      throw new AIProviderError(
        'request-invalid',
        'maxResponseBytes must be a positive safe integer',
        false,
        this.id,
      );
    }
    this.#apiKey = options.apiKey;
    this.#maxResponseBytes = maxResponseBytes;
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  async review(
    request: AIProviderRequest,
    options: AIProviderCallOptions,
  ): Promise<AIProviderResponse> {
    const body = JSON.stringify({
      model: request.modelId,
      messages: [
        { role: 'system', content: request.trustedInstructions },
        {
          role: 'user',
          content: JSON.stringify({
            trust: 'untrusted-source-context',
            context: request.context,
          }),
        },
      ],
      max_tokens: request.limits.reservedOutputTokens,
      response_format: { type: 'json_object' },
    });
    const outgoingCharacters = body.length;
    const outgoingEstimatedTokens = Math.ceil(
      outgoingCharacters / request.limits.estimatedCharactersPerToken,
    );
    if (outgoingCharacters > request.limits.maxInputCharacters
      || outgoingEstimatedTokens > request.limits.estimatedInputTokens) {
      throw new AIProviderError(
        'request-invalid',
        'Serialized provider payload exceeds configured request limits',
        false,
        this.id,
      );
    }
    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          'content-type': 'application/json',
        },
        body,
        signal: options.signal,
        redirect: 'error',
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new AIProviderError(
        'provider-unavailable',
        'AI provider request failed',
        true,
        this.id,
      );
    }

    if (!response.ok) {
      await discardResponse(response, this.#maxResponseBytes);
      throw new AIProviderError(
        response.status === 429 ? 'rate-limited' : 'provider-unavailable',
        `AI provider returned HTTP ${response.status}`,
        response.status === 429 || response.status >= 500,
        this.id,
      );
    }

    const bytes = await readBoundedResponse(response, this.#maxResponseBytes, this.id);
    let envelope: unknown;
    try {
      envelope = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      throw new AIProviderError('response-invalid', 'AI provider returned invalid JSON', false, this.id);
    }
    const parsed = parseEnvelope(envelope, this.id);
    return {
      providerId: this.id,
      modelId: request.modelId,
      rawResult: parsed.rawResult,
      ...(parsed.usage ? { usage: parsed.usage } : {}),
    };
  }
}

function validateEndpoint(value: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new AIProviderError('request-invalid', 'AI endpoint must be a valid URL', false);
  }
  if (endpoint.username || endpoint.password) {
    throw new AIProviderError('request-invalid', 'AI endpoint must not contain credentials', false);
  }
  const local = endpoint.hostname === 'localhost'
    || endpoint.hostname === '127.0.0.1'
    || endpoint.hostname === '[::1]';
  if (endpoint.protocol !== 'https:' && !(local && endpoint.protocol === 'http:')) {
    throw new AIProviderError(
      'request-invalid',
      'Remote AI endpoints must use HTTPS',
      false,
    );
  }
  return endpoint;
}

async function readBoundedResponse(
  response: Response,
  limit: number,
  providerId: string,
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    await response.body?.cancel();
    throw responseTooLarge(providerId);
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw responseTooLarge(providerId);
    }
    chunks.push(value);
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function discardResponse(response: Response, limit: number): Promise<void> {
  try {
    await readBoundedResponse(response, limit, 'openai-compatible');
  } catch {
    await response.body?.cancel().catch(() => undefined);
  }
}

function responseTooLarge(providerId: string): AIProviderError {
  return new AIProviderError(
    'response-invalid',
    'AI provider response exceeds the configured byte limit',
    false,
    providerId,
  );
}

function parseEnvelope(
  value: unknown,
  providerId: string,
): { rawResult: unknown; usage?: AIProviderUsage } {
  if (!isRecord(value) || !Array.isArray(value.choices)) {
    throw new AIProviderError('response-invalid', 'AI response envelope is malformed', false, providerId);
  }
  const first = value.choices[0];
  if (!isRecord(first) || !isRecord(first.message) || typeof first.message.content !== 'string') {
    throw new AIProviderError('response-invalid', 'AI response content is missing', false, providerId);
  }
  let rawResult: unknown;
  try {
    rawResult = JSON.parse(first.message.content) as unknown;
  } catch {
    throw new AIProviderError('response-invalid', 'AI response content is not valid JSON', false, providerId);
  }
  const usage = parseUsage(value.usage);
  return { rawResult, ...(usage ? { usage } : {}) };
}

function parseUsage(value: unknown): AIProviderUsage | undefined {
  if (!isRecord(value)) return undefined;
  const inputTokens = finiteNumber(value.prompt_tokens);
  const outputTokens = finiteNumber(value.completion_tokens);
  const totalTokens = finiteNumber(value.total_tokens);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return undefined;
  }
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    providerReported: true,
  };
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
