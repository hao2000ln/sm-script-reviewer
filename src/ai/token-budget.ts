export interface AITokenBudget {
  readonly maxContextCharacters: number;
  readonly estimatedInputTokenBudget: number;
  readonly reservedOutputTokenBudget: number;
  readonly maxFindingsPerRequest: number;
  readonly maxFunctionsPerRequest: number;
  readonly estimatedCharactersPerToken: number;
}

export const DEFAULT_AI_TOKEN_BUDGET: AITokenBudget = Object.freeze({
  maxContextCharacters: 12_000,
  estimatedInputTokenBudget: 3_000,
  reservedOutputTokenBudget: 800,
  maxFindingsPerRequest: 20,
  maxFunctionsPerRequest: 1,
  estimatedCharactersPerToken: 4,
});

export interface BudgetValidationError {
  readonly field: keyof AITokenBudget;
  readonly message: string;
}

export function resolveTokenBudget(
  overrides: Partial<AITokenBudget> = {},
): AITokenBudget {
  const budget = { ...DEFAULT_AI_TOKEN_BUDGET, ...overrides };
  const errors = validateTokenBudget(budget);
  if (errors.length > 0) throw new Error(errors.map(({ message }) => message).join('; '));
  return budget;
}

export function validateTokenBudget(budget: AITokenBudget): BudgetValidationError[] {
  const errors: BudgetValidationError[] = [];
  for (const field of Object.keys(budget) as (keyof AITokenBudget)[]) {
    const value = budget[field];
    if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
      errors.push({ field, message: `${field} must be a positive integer` });
    }
  }
  return errors;
}

export function effectiveContextCharacterLimit(budget: AITokenBudget): number {
  return Math.min(
    budget.maxContextCharacters,
    budget.estimatedInputTokenBudget * budget.estimatedCharactersPerToken,
  );
}

export function estimateInputTokens(characters: number, budget: AITokenBudget): number {
  return Math.ceil(characters / budget.estimatedCharactersPerToken);
}

export interface AISerializedPayloadUsage {
  readonly serializedCharacters: number;
  readonly estimatedInputTokens: number;
  readonly estimation: 'character-approximation';
}

export function estimateSerializedPayloadUsage(
  payload: unknown,
  estimatedCharactersPerToken: number,
): AISerializedPayloadUsage {
  if (!Number.isFinite(estimatedCharactersPerToken) || estimatedCharactersPerToken <= 0) {
    throw new Error('estimatedCharactersPerToken must be positive and finite');
  }
  const serialized = JSON.stringify(payload);
  if (serialized === undefined) throw new Error('Request payload is not serializable');
  const serializedCharacters = serialized.length;
  return {
    serializedCharacters,
    estimatedInputTokens: Math.ceil(serializedCharacters / estimatedCharactersPerToken),
    estimation: 'character-approximation',
  };
}
