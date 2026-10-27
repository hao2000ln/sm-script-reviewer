export interface ReviewToken {
  readonly uri: string;
  /** Invalidates every token when diagnostics are cleared globally. */
  readonly epoch: number;
  readonly generation: number;
  readonly version: number;
}

export class ReviewLifecycle {
  readonly #generation = new Map<string, number>();
  #epoch = 0;

  begin(uri: string, version: number): ReviewToken {
    const generation = (this.#generation.get(uri) ?? 0) + 1;
    this.#generation.set(uri, generation);
    return { uri, epoch: this.#epoch, generation, version };
  }

  isCurrent(token: ReviewToken, currentVersion: number): boolean {
    return token.epoch === this.#epoch
      && this.#generation.get(token.uri) === token.generation
      && token.version === currentVersion;
  }

  clear(uri: string): void {
    // Retain a monotonically increasing tombstone. Deleting would allow a
    // stale token and a new review to share generation 1 for the same URI.
    this.#generation.set(uri, (this.#generation.get(uri) ?? 0) + 1);
  }

  clearAll(): void {
    // A new epoch lets this release per-URI state without revalidating tokens
    // that were created before global diagnostics were disabled.
    this.#epoch += 1;
    this.#generation.clear();
  }
}

export function shouldReviewOnSave(enableOnSave: boolean, supported: boolean): boolean {
  return enableOnSave && supported;
}
