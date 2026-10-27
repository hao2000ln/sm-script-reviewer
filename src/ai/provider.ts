import type { AIReviewContext } from './types';

export type AIProviderErrorCategory =
  | 'cancelled'
  | 'timeout'
  | 'permission-denied'
  | 'request-invalid'
  | 'provider-unavailable'
  | 'rate-limited'
  | 'response-invalid'
  | 'unknown';

export interface AIProviderUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly providerReported: boolean;
}

export interface AIRequestLimits {
  readonly timeoutMs: number;
  readonly maxInputCharacters: number;
  readonly estimatedInputTokens: number;
  readonly reservedOutputTokens: number;
}

export interface AIProviderRequest {
  readonly requestId: string;
  readonly modelId: string;
  readonly trustedInstructions: string;
  readonly context: AIReviewContext;
  readonly limits: AIRequestLimits;
  readonly permission: {
    readonly sourceTransmissionApproved: boolean;
  };
}

export interface AIProviderResponse {
  readonly providerId: string;
  readonly modelId: string;
  readonly rawResult: unknown;
  readonly usage?: AIProviderUsage;
}

export interface AIProviderCallOptions {
  readonly signal?: AbortSignal;
}

export interface AIProvider {
  readonly id: string;
  review(
    request: AIProviderRequest,
    options: AIProviderCallOptions,
  ): Promise<AIProviderResponse>;
}

export class AIProviderError extends Error {
  constructor(
    readonly category: AIProviderErrorCategory,
    message: string,
    readonly retryable: boolean,
    readonly providerId?: string,
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}

export async function requestAIReview(
  provider: AIProvider,
  request: AIProviderRequest,
  options: AIProviderCallOptions = {},
): Promise<AIProviderResponse> {
  if (!request.permission.sourceTransmissionApproved) {
    throw new AIProviderError(
      'permission-denied',
      'Explicit source transmission permission is required',
      false,
      provider.id,
    );
  }
  if (!Number.isInteger(request.limits.timeoutMs) || request.limits.timeoutMs <= 0) {
    throw new AIProviderError('request-invalid', 'timeoutMs must be positive', false, provider.id);
  }
  if (
    request.context.estimatedUsage.contextCharacters > request.limits.maxInputCharacters
    || request.context.estimatedUsage.estimatedInputTokens > request.limits.estimatedInputTokens
  ) {
    throw new AIProviderError(
      'request-invalid',
      'AI context exceeds configured request limits',
      false,
      provider.id,
    );
  }
  if (options.signal?.aborted) {
    throw new AIProviderError('cancelled', 'AI request was cancelled', false, provider.id);
  }

  const controller = new AbortController();
  const cancel = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(() => controller.abort('timeout'), request.limits.timeoutMs);
  try {
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
    return await Promise.race([
      provider.review(request, { signal: controller.signal }),
      aborted,
    ]);
  } catch (error) {
    if (error instanceof AIProviderError) throw error;
    if (controller.signal.aborted) {
      const timedOut = controller.signal.reason === 'timeout';
      throw new AIProviderError(
        timedOut ? 'timeout' : 'cancelled',
        timedOut ? 'AI request timed out' : 'AI request was cancelled',
        timedOut,
        provider.id,
      );
    }
    throw new AIProviderError(
      'unknown',
      error instanceof Error ? error.message : String(error),
      false,
      provider.id,
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancel);
  }
}
