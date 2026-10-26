import type { Rule } from './types';

export class RuleRegistry {
  readonly #rules: readonly Rule[];
  readonly #rulesById: ReadonlyMap<string, Rule>;

  constructor(rules: Iterable<Rule> = []) {
    const byId = new Map<string, Rule>();
    for (const rule of rules) {
      const id = rule.metadata.id;
      if (byId.has(id)) throw new Error(`Duplicate rule ID: ${id}`);
      byId.set(id, rule);
    }

    this.#rules = Object.freeze(
      [...byId.values()].sort(
        (left, right) => left.metadata.id.localeCompare(right.metadata.id),
      ),
    );
    this.#rulesById = byId;
  }

  all(): readonly Rule[] {
    return this.#rules;
  }

  get(id: string): Rule | undefined {
    return this.#rulesById.get(id);
  }
}

