import type { RuleSetConfig } from '../rules/types';

export const V1_PRODUCTION_PRESET = 'v1-production';

export type ReviewPreset = 'default' | typeof V1_PRODUCTION_PRESET;

const V1_PRODUCTION_RULES: NonNullable<RuleSetConfig['rules']> = Object.freeze({
  // Quality-policy rules remain available, but must not hide SM safety findings
  // in the default internal-release workflow.
  'SM-CMT-001': false,
  'SM-CMT-002': false,
  'SM-CMT-003': false,
  'SM-DBG-001': false,
  'SM-CODE-001': false,
  'SM-LOOP-001': false,
});

/**
 * Returns the shared V1 safety-focused configuration. Explicit caller rules
 * override the preset, so teams can opt a quality rule back in per review.
 */
export function resolveReviewPreset(
  preset: ReviewPreset = 'default',
  overrides: RuleSetConfig = {},
): RuleSetConfig {
  if (preset === 'default') return overrides;
  return {
    ...overrides,
    rules: {
      ...V1_PRODUCTION_RULES,
      ...overrides.rules,
    },
  };
}

export function isReviewPreset(value: string): value is ReviewPreset {
  return value === 'default' || value === V1_PRODUCTION_PRESET;
}
