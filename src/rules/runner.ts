import { createHash } from 'node:crypto';
import type { AnalysisArtifact } from '../parser/analysis-artifact';
import { createRuleContext } from './context';
import type { RuleRegistry } from './registry';
import type {
  Finding,
  FindingCandidate,
  Rule,
  RuleConfig,
  RuleRunResult,
  RuleSetConfig,
  RuleSeverity,
} from './types';

const SEVERITIES = new Set<RuleSeverity>(['info', 'warning', 'error', 'critical']);

export class RuleConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleConfigurationError';
  }
}

interface ResolvedRuleConfig {
  enabled: boolean;
  severity: RuleSeverity;
  options: Readonly<Record<string, unknown>>;
}

export class RuleRunner {
  constructor(private readonly registry: RuleRegistry) {}

  run(artifact: AnalysisArtifact, config: RuleSetConfig = {}): RuleRunResult {
    const resolvedConfig = validateAndResolveConfig(this.registry, config);
    const context = createRuleContext(artifact);
    const findings: Finding[] = [];
    const ruleErrors: RuleRunResult['ruleErrors'] = [];
    const skippedRules: RuleRunResult['skippedRules'] = [];

    for (const rule of this.registry.all()) {
      const resolved = resolvedConfig.get(rule.metadata.id)!;
      if (!resolved.enabled) {
        skippedRules.push({ ruleId: rule.metadata.id, reason: 'disabled' });
        continue;
      }
      if (!context.syntaxValid && rule.metadata.syntaxPolicy === 'valid-only') {
        skippedRules.push({ ruleId: rule.metadata.id, reason: 'syntax-errors' });
        continue;
      }

      try {
        const seen = new Set<string>();
        const ruleFindings: Finding[] = [];
        for (const candidate of rule.run(context, resolved.options)) {
          const finding = normalizeFinding(rule, candidate, resolved.severity, context);
          if (seen.has(finding.fingerprint)) continue;
          seen.add(finding.fingerprint);
          ruleFindings.push(finding);
        }
        findings.push(...ruleFindings);
      } catch (error) {
        ruleErrors.push({
          ruleId: rule.metadata.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    findings.sort(compareFindings);
    return { analysis: artifact.analysis, findings, ruleErrors, skippedRules };
  }
}

function validateAndResolveConfig(
  registry: RuleRegistry,
  config: RuleSetConfig,
): ReadonlyMap<string, ResolvedRuleConfig> {
  const configuredRules = config.rules ?? {};
  for (const id of Object.keys(configuredRules)) {
    if (!registry.get(id)) throw new RuleConfigurationError(`Unknown rule ID: ${id}`);
  }

  const resolved = new Map<string, ResolvedRuleConfig>();
  for (const rule of registry.all()) {
    const value = configuredRules[rule.metadata.id];
    if (value !== undefined && value !== false && !isPlainObject(value)) {
      throw new RuleConfigurationError(`Invalid configuration for ${rule.metadata.id}`);
    }

    const ruleConfig = value === false || value === undefined ? undefined : value as RuleConfig;
    if (ruleConfig?.enabled !== undefined && typeof ruleConfig.enabled !== 'boolean') {
      throw new RuleConfigurationError(`Invalid enabled flag for ${rule.metadata.id}`);
    }
    if (ruleConfig?.severity !== undefined && !SEVERITIES.has(ruleConfig.severity)) {
      throw new RuleConfigurationError(
        `Invalid severity for ${rule.metadata.id}: ${String(ruleConfig.severity)}`,
      );
    }
    if (ruleConfig?.options !== undefined && !isPlainObject(ruleConfig.options)) {
      throw new RuleConfigurationError(`Invalid options for ${rule.metadata.id}`);
    }

    const options = ruleConfig?.options ?? {};
    const optionErrors = rule.validateOptions?.(options) ?? [];
    if (optionErrors.length > 0) {
      throw new RuleConfigurationError(
        `Invalid options for ${rule.metadata.id}: ${optionErrors.join('; ')}`,
      );
    }

    resolved.set(rule.metadata.id, {
      enabled: value === false ? false : ruleConfig?.enabled ?? rule.metadata.defaultEnabled,
      severity: ruleConfig?.severity ?? rule.metadata.defaultSeverity,
      options,
    });
  }
  return resolved;
}

function normalizeFinding(
  rule: Rule,
  candidate: FindingCandidate,
  severity: RuleSeverity,
  context: ReturnType<typeof createRuleContext>,
): Finding {
  const confidence = rule.metadata.classification === 'deterministic'
    ? 1
    : candidate.confidence;
  if (confidence === undefined || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error(`Rule ${rule.metadata.id} returned invalid heuristic confidence`);
  }

  const evidence = [...candidate.evidence].sort((left, right) => (
    left.range.start.offset - right.range.start.offset
    || left.range.end.offset - right.range.end.offset
    || left.kind.localeCompare(right.kind)
  ));
  const fingerprint = createHash('sha256').update([
    context.source.hash,
    rule.metadata.id,
    candidate.range.start.offset,
    candidate.range.end.offset,
    candidate.message,
  ].join('\0')).digest('hex');

  return {
    ...candidate,
    evidence,
    fingerprint,
    ruleId: rule.metadata.id,
    sourceId: context.source.id,
    severity,
    classification: rule.metadata.classification,
    confidence,
    analysisStatus: context.syntaxValid ? 'valid' : 'recovered',
  };
}

function compareFindings(left: Finding, right: Finding): number {
  return left.range.start.offset - right.range.start.offset
    || left.range.end.offset - right.range.end.offset
    || left.ruleId.localeCompare(right.ruleId)
    || left.fingerprint.localeCompare(right.fingerprint);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

