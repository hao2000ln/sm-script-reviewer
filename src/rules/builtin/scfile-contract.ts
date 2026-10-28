import ts from 'typescript';
import type { FindingCandidate, Rule, RuleContext, SourceRange } from '../types';
import { getSmAnalysis } from '../../sm/analysis';
import type { SmConstructionEvent } from '../../sm/events';

const WRITE_METHODS = new Set(['doUpdate', 'doInsert', 'doDelete']);

export const scFileReadonlyWriteRule: Rule = {
  metadata: {
    id: 'SM-SCF-001',
    title: 'Write operation on read-only SCFile',
    description: 'Reports verified write operations on a directly tracked SCFile created with SCFILE_READONLY.',
    classification: 'deterministic',
    defaultEnabled: true,
    defaultSeverity: 'error',
    syntaxPolicy: 'valid-only',
  },
  run: (context) => {
    const analysis = getSmAnalysis(context);
    const constructors = new Map(analysis.constructions.map((item) => [item.bindingId, item]));
    return analysis.calls
      .filter((call) => WRITE_METHODS.has(call.method))
      .flatMap((call) => {
        const constructor = constructors.get(call.bindingId);
        if (!constructor || !isVerifiedReadonly(constructor) || call.methodSpec.status !== 'VERIFIED') return [];
        return [{
          message: `SCFile.${call.method}() is called on READONLY object "${call.receiverName}".`,
          range: call.range,
          evidence: [
            evidence('Verified SCFile write operation is called here.', call.range),
            evidence('This SCFile was constructed with SCFILE_READONLY here.', constructor.range),
          ],
          suggestion: 'Use a separate writable SCFile object after verifying the intended update, insert, or delete behaviour.',
        }];
      });
  },
};

export const scFileSetFieldsModeRule: Rule = {
  metadata: {
    id: 'SM-SCF-002',
    title: 'setFields on non-read-only SCFile',
    description: 'Reports setFields() on a directly tracked SCFile known not to be READONLY.',
    classification: 'deterministic',
    defaultEnabled: true,
    defaultSeverity: 'warning',
    syntaxPolicy: 'valid-only',
  },
  run: (context) => {
    const analysis = getSmAnalysis(context);
    const constructors = new Map(analysis.constructions.map((item) => [item.bindingId, item]));
    return analysis.calls
      .filter((call) => call.method === 'setFields')
      .flatMap((call) => {
        const constructor = constructors.get(call.bindingId);
        if (!constructor || !isVerifiedReadwrite(constructor) || setFieldsArgumentIssue(call.node) !== undefined) return [];
        return [{
          message: `SCFile.setFields() is called on non-READONLY object "${call.receiverName}".`,
          range: call.range,
          evidence: [
            evidence('setFields() is documented for initialized READONLY SCFile objects.', call.range),
            evidence('This SCFile was constructed without SCFILE_READONLY here.', constructor.range),
          ],
          suggestion: 'Create the query object with SCFILE_READONLY before setFields(), or remove setFields() if full-field selection is intended.',
        }];
      });
  },
};

export const scFileSetFieldsArgumentsRule: Rule = {
  metadata: {
    id: 'SM-SCF-003',
    title: 'Invalid static setFields arguments',
    description: 'Reports only statically provable setFields() argument count or type violations.',
    classification: 'deterministic',
    defaultEnabled: true,
    defaultSeverity: 'error',
    syntaxPolicy: 'valid-only',
  },
  run: (context) => getSmAnalysis(context).calls
    .filter((call) => call.method === 'setFields')
    .flatMap((call) => {
      const issue = setFieldsArgumentIssue(call.node);
      if (!issue || call.methodSpec.status !== 'VERIFIED') return [];
      return [{
        message: `SCFile.setFields() has invalid static arguments: ${issue}.`,
        range: call.range,
        evidence: [evidence('Verified setFields() signatures accept no argument, one string, or one string array.', call.range)],
        suggestion: 'Use setFields(), setFields("field.name other.field"), or an array containing only field-name strings.',
      }];
    }),
};

export const scFileConstructorArgumentsRule: Rule = {
  metadata: {
    id: 'SM-SCF-004',
    title: 'Invalid static SCFile constructor arguments',
    description: 'Reports only statically provable SCFile constructor count or literal-type violations.',
    classification: 'deterministic',
    defaultEnabled: true,
    defaultSeverity: 'error',
    syntaxPolicy: 'valid-only',
  },
  run: (context) => {
    const analysis = getSmAnalysis(context);
    const recognizedStarts = new Set(analysis.constructions.map(({ range }) => range.start.offset));
    const findings: FindingCandidate[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isNewExpression(node) && recognizedStarts.has(node.getStart(context.sourceFile))) {
        const issue = constructorArgumentIssue(node);
        if (issue) {
          findings.push({
            message: `SCFile constructor has invalid static arguments: ${issue}.`,
            range: context.rangeOf(node),
            evidence: [evidence('Verified SCFile constructor signatures accept 0, 1, or 2 documented arguments.', context.rangeOf(node))],
            suggestion: 'Use new SCFile(), new SCFile(object), or new SCFile("table", SCFILE_READONLY). Keep dynamic values unmodified until their runtime type is known.',
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(context.sourceFile);
    return findings;
  },
};

function isVerifiedReadonly(construction: SmConstructionEvent): boolean {
  return construction.mode === 'READONLY'
    && construction.modeCertainty === 'verified'
    && construction.evidence.status === 'VERIFIED';
}

function isVerifiedReadwrite(construction: SmConstructionEvent): boolean {
  return construction.mode === 'READWRITE'
    && construction.modeCertainty === 'verified'
    && construction.evidence.status === 'VERIFIED';
}

function setFieldsArgumentIssue(node: ts.CallExpression): string | undefined {
  const args = node.arguments;
  if (args.length > 1) return `expected at most 1 argument but received ${args.length}`;
  if (args.length === 0 || ts.isStringLiteral(args[0])) return undefined;
  if (isStaticStringArray(args[0])) return undefined;
  if (ts.isNumericLiteral(args[0])) return 'number is not a supported field-list type';
  if (args[0].kind === ts.SyntaxKind.TrueKeyword || args[0].kind === ts.SyntaxKind.FalseKeyword) return 'boolean is not a supported field-list type';
  if (ts.isObjectLiteralExpression(args[0])) return 'object literal is not a supported field-list type';
  if (ts.isArrayLiteralExpression(args[0]) && args[0].elements.every(isStaticLiteral)) {
    return 'field arrays must contain only strings';
  }
  return undefined;
}

function constructorArgumentIssue(node: ts.NewExpression): string | undefined {
  const args = node.arguments ?? [];
  if (args.length > 2) return `expected at most 2 arguments but received ${args.length}`;
  if (args.length > 0 && isUnsupportedConstructorLiteral(args[0])) {
    return 'first argument must be a documented object value, not a number or boolean literal';
  }
  if (args.length === 2 && isUnsupportedModeLiteral(args[1])) {
    return 'second argument must be SCFILE_READONLY or an unknown dynamic mode';
  }
  return undefined;
}

function isUnsupportedConstructorLiteral(node: ts.Expression): boolean {
  return ts.isNumericLiteral(node)
    || node.kind === ts.SyntaxKind.TrueKeyword
    || node.kind === ts.SyntaxKind.FalseKeyword;
}

function isUnsupportedModeLiteral(node: ts.Expression): boolean {
  return ts.isStringLiteral(node)
    || node.kind === ts.SyntaxKind.TrueKeyword
    || node.kind === ts.SyntaxKind.FalseKeyword;
}

function isStaticStringArray(node: ts.Expression): boolean {
  const values = ts.isArrayLiteralExpression(node)
    ? node.elements
    : ts.isNewExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'Array'
      ? node.arguments ?? []
      : undefined;
  return values !== undefined && values.every(ts.isStringLiteral);
}

function isStaticLiteral(node: ts.Expression | ts.SpreadElement): boolean {
  return ts.isStringLiteral(node) || ts.isNumericLiteral(node)
    || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword;
}

function evidence(message: string, range: SourceRange) {
  return { kind: 'ast' as const, message, range };
}
