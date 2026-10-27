export interface ReviewToken {
  readonly uri: string;
  readonly generation: number;
  readonly version: number;
}

export class ReviewLifecycle {
  readonly #generation = new Map<string, number>();

  begin(uri: string, version: number): ReviewToken {
    const generation = (this.#generation.get(uri) ?? 0) + 1;
    this.#generation.set(uri, generation);
    return { uri, generation, version };
  }

  isCurrent(token: ReviewToken, currentVersion: number): boolean {
    return this.#generation.get(token.uri) === token.generation
      && token.version === currentVersion;
  }

  clear(uri: string): void {
    this.#generation.delete(uri);
  }

  clearAll(): void {
    this.#generation.clear();
  }
}

export function shouldReviewOnSave(enableOnSave: boolean, supported: boolean): boolean {
  return enableOnSave && supported;
}
