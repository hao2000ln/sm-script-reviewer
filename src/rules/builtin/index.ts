import { RuleRegistry } from '../registry';
import { directPrintRule } from './direct-print';
import { missingFunctionCommentRule } from './missing-function-comment';

export function createBuiltinRuleRegistry(): RuleRegistry {
  return new RuleRegistry([
    missingFunctionCommentRule,
    directPrintRule,
  ]);
}

