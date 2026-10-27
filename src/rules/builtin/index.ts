import { commentedOutCodeRule } from './commented-out-code';
import { RuleRegistry } from '../registry';
import { directPrintRule } from './direct-print';
import { missingFunctionCommentRule } from './missing-function-comment';
import { smQueryLoopProgressRule } from './sm-query-loop-progress';
import { smReturnCodeRule } from './sm-return-code';
import { unconditionalLoopRule } from './unconditional-loop';
import { unnecessaryCommentRule } from './unnecessary-comment';
import { unreachableCodeRule } from './unreachable-code';

export function createBuiltinRuleRegistry(): RuleRegistry {
  return new RuleRegistry([
    missingFunctionCommentRule,
    commentedOutCodeRule,
    unnecessaryCommentRule,
    directPrintRule,
    smQueryLoopProgressRule,
    smReturnCodeRule,
    unreachableCodeRule,
    unconditionalLoopRule,
  ]);
}

