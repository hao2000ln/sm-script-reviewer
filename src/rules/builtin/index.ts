import { commentedOutCodeRule } from './commented-out-code';
import { RuleRegistry } from '../registry';
import { directPrintRule } from './direct-print';
import { missingFunctionCommentRule } from './missing-function-comment';
import { unconditionalLoopRule } from './unconditional-loop';
import { unnecessaryCommentRule } from './unnecessary-comment';
import { unreachableCodeRule } from './unreachable-code';

export function createBuiltinRuleRegistry(): RuleRegistry {
  return new RuleRegistry([
    missingFunctionCommentRule,
    commentedOutCodeRule,
    unnecessaryCommentRule,
    directPrintRule,
    unreachableCodeRule,
    unconditionalLoopRule,
  ]);
}

