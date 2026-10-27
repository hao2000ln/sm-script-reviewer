export interface AIRedactionHook {
  readonly id: string;
  redact(value: string): string;
}

export interface AIRedactionResult {
  readonly value: string;
  readonly appliedHooks: readonly string[];
}

export function applyAIRedactions(
  value: string,
  hooks: readonly AIRedactionHook[],
): AIRedactionResult {
  let redacted = value;
  const appliedHooks: string[] = [];
  for (const hook of hooks) {
    const next = hook.redact(redacted);
    if (next !== redacted) appliedHooks.push(hook.id);
    redacted = next;
  }
  return { value: redacted, appliedHooks };
}

export const DEFAULT_AI_PRIVACY = Object.freeze({
  enabled: false,
  sourceTransmissionApproved: false,
  logRawPrompts: false,
  logFullSource: false,
  storeCredentials: false,
});
