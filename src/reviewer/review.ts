import type { SourceDocument } from '../core/types';
import { createAnalysisArtifact } from '../parser/analysis-artifact';
import { createBuiltinRuleRegistry } from '../rules/builtin';
import { RuleRunner } from '../rules/runner';
import type { RuleRunResult, RuleSetConfig } from '../rules/types';

const builtinRunner = new RuleRunner(createBuiltinRuleRegistry());

export function review(
  source: SourceDocument,
  config: RuleSetConfig = {},
): RuleRunResult {
  return builtinRunner.run(createAnalysisArtifact(source), config);
}

