import {
  AIProviderError,
  type AIProvider,
  type AIProviderCallOptions,
  type AIProviderRequest,
  type AIProviderResponse,
} from './provider';

export interface FakeAIProviderOptions {
  readonly id?: string;
  readonly response?: unknown;
  readonly failure?: AIProviderError;
  readonly delayMs?: number;
}

/** Offline-only provider used by foundation tests. It performs no network I/O. */
export class FakeAIProvider implements AIProvider {
  readonly id: string;
  readonly requests: AIProviderRequest[] = [];

  constructor(private readonly options: FakeAIProviderOptions = {}) {
    this.id = options.id ?? 'fake';
  }

  async review(
    request: AIProviderRequest,
    callOptions: AIProviderCallOptions,
  ): Promise<AIProviderResponse> {
    this.requests.push(request);
    if (this.options.delayMs) await wait(this.options.delayMs, callOptions.signal);
    if (callOptions.signal?.aborted) throw new Error('aborted');
    if (this.options.failure) throw this.options.failure;
    return {
      providerId: this.id,
      modelId: request.modelId,
      rawResult: this.options.response ?? { findings: [] },
      usage: { providerReported: false },
    };
  }
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      reject(new Error('aborted'));
    }, { once: true });
  });
}
