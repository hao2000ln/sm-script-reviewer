import ts from 'typescript';
import type { RuleContext, SourceRange } from '../rules/types';
import type { SmObjectMode } from './api-catalog';
import { getSmAnalysis } from './analysis';
import type { SmBindingEvent, SmCallEvent, SmConstructionEvent } from './events';

export type ScFileSelection =
  | { readonly kind: 'all-fields'; readonly range: SourceRange; readonly evidenceId: string }
  | { readonly kind: 'selected-fields'; readonly fields: readonly string[]; readonly range: SourceRange; readonly evidenceId: string }
  | { readonly kind: 'unknown'; readonly range: SourceRange; readonly evidenceId: string };

export interface ScFileStateObject {
  readonly identity: string;
  readonly constructor: SmConstructionEvent;
  readonly mode: SmObjectMode;
  readonly modeCertainty: SmConstructionEvent['modeCertainty'];
  readonly tableName?: string;
  readonly selectedFields: ScFileSelection;
  readonly methodCalls: readonly SmCallEvent[];
  readonly aliases: readonly SmBindingEvent[];
  readonly mutations: readonly SmBindingEvent[];
  readonly evidenceIds: readonly string[];
}

export interface ScFileStateAnalysis {
  readonly objects: readonly ScFileStateObject[];
  readonly unsupported: readonly string[];
}

/**
 * A read-only projection of existing SM extraction events. It is intentionally
 * intraprocedural: branch calls are possible, post-join identities may be
 * unknown, and deferred closures do not inherit an outer SCFile identity.
 */
export function getScFileStateAnalysis(context: RuleContext): ScFileStateAnalysis {
  const analysis = getSmAnalysis(context);
  const objects = analysis.constructions.map((construction) => buildStateObject(construction, analysis, context.sourceFile));
  return {
    objects,
    unsupported: [
      'Dynamic SCFile constructors, deep aliases, property aliases, and wrapper calls are unknown.',
      'Conditional branches record possible calls; no path-complete or interprocedural state is claimed.',
      'Field reads and DBDICT validation are not yet analyzed.',
    ],
  };
}

function buildStateObject(
  construction: SmConstructionEvent,
  analysis: ReturnType<typeof getSmAnalysis>,
  sourceFile: ts.SourceFile,
): ScFileStateObject {
  const methodCalls = analysis.calls.filter(({ bindingId }) => bindingId === construction.bindingId);
  const bindings = analysis.bindings.filter(({ bindingId }) => bindingId === construction.bindingId);
  const selection = selectionFor(construction, analysis, sourceFile);
  return {
    identity: construction.bindingId,
    constructor: construction,
    mode: construction.mode,
    modeCertainty: construction.modeCertainty,
    ...(construction.tableName ? { tableName: construction.tableName } : {}),
    selectedFields: selection,
    methodCalls,
    aliases: bindings.filter(({ kind, relation }) => kind === 'scfile-binding' && relation === 'alias'),
    mutations: bindings.filter(({ kind }) => kind === 'scfile-reassignment'),
    evidenceIds: unique([
      construction.bindingId,
      ...methodCalls.map(({ id }) => id),
      ...bindings.map(({ kind, range }) => `${kind}:${range.start.offset}`),
    ]),
  };
}

function selectionFor(
  construction: SmConstructionEvent,
  analysis: ReturnType<typeof getSmAnalysis>,
  sourceFile: ts.SourceFile,
): ScFileSelection {
  const initial: ScFileSelection = {
    kind: 'all-fields', range: construction.range, evidenceId: 'default-all-fields',
  };
  const knownNames = new Set(
    analysis.bindings
      .filter(({ bindingId, kind }) => bindingId === construction.bindingId && kind === 'scfile-binding')
      .map(({ bindingName }) => bindingName),
  );

  const applyExpression = (node: ts.Node, selection: ScFileSelection): ScFileSelection => {
    let next = selection;
    const visit = (current: ts.Node): void => {
      if (current !== node && ts.isFunctionLike(current)) return;
      if (ts.isCallExpression(current)) {
        const call = analysis.callsByNode.get(current);
        if (call?.bindingId === construction.bindingId) {
          if (call.method === 'setFields') next = selectionFromCall(call);
        } else if (isUnknownCallOnKnownName(current, knownNames)) {
          next = { kind: 'unknown', range: rangeOfNode(sourceFile, current), evidenceId: `unknown-call:${current.getStart(sourceFile)}` };
        }
      }
      ts.forEachChild(current, visit);
    };
    visit(node);
    return next;
  };

  const processStatement = (statement: ts.Statement, selection: ScFileSelection): ScFileSelection => {
    if (ts.isBlock(statement)) return processStatements(statement.statements, selection);
    if (ts.isIfStatement(statement)) {
      const afterCondition = applyExpression(statement.expression, selection);
      const left = processStatement(statement.thenStatement, afterCondition);
      const right = statement.elseStatement
        ? processStatement(statement.elseStatement, afterCondition)
        : afterCondition;
      return mergeSelection(left, right);
    }
    // A declaration does not execute its body. The state projection starts at
    // the constructor's own execution scope, so nested function bodies are
    // deliberately excluded even when they capture an outer SCFile name.
    if (ts.isFunctionDeclaration(statement)) return selection;
    if (ts.isForStatement(statement) || ts.isForInStatement(statement) || ts.isForOfStatement(statement)
      || ts.isWhileStatement(statement) || ts.isDoStatement(statement)
      || ts.isSwitchStatement(statement) || ts.isTryStatement(statement)) {
      // Zero, one, or many iterations/branches are possible. Merge one
      // syntactic execution with the entry state rather than selecting its
      // final event as if it always executed.
      const once = applyControlOnce(statement, selection, applyExpression, processStatement);
      return mergeSelection(selection, once);
    }
    return applyExpression(statement, selection);
  };

  const processStatements = (statements: readonly ts.Statement[], selection: ScFileSelection): ScFileSelection => {
    let next = selection;
    for (const statement of statements) next = processStatement(statement, next);
    return next;
  };

  return processStatements(executionScopeStatements(construction, sourceFile), initial);
}

function executionScopeStatements(
  construction: SmConstructionEvent,
  sourceFile: ts.SourceFile,
): readonly ts.Statement[] {
  if (construction.containingFunctionId === '<source>') return sourceFile.statements;
  let body: ts.Block | undefined;
  const visit = (node: ts.Node): void => {
    if (body || !isExecutableFunction(node)) {
      ts.forEachChild(node, visit);
      return;
    }
    const id = `function:${node.getStart(sourceFile)}`;
    if (id === construction.containingFunctionId && node.body && ts.isBlock(node.body)) {
      body = node.body;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return body?.statements ?? [];
}

function isExecutableFunction(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node);
}

function applyControlOnce(
  statement: ts.Statement,
  selection: ScFileSelection,
  applyExpression: (node: ts.Node, selection: ScFileSelection) => ScFileSelection,
  processStatement: (node: ts.Statement, selection: ScFileSelection) => ScFileSelection,
): ScFileSelection {
  if (ts.isWhileStatement(statement) || ts.isDoStatement(statement)) {
    return processStatement(statement.statement, applyExpression(statement.expression, selection));
  }
  if (ts.isForStatement(statement)) {
    const afterParts = statement.condition ? applyExpression(statement.condition, selection) : selection;
    const afterBody = processStatement(statement.statement, afterParts);
    return statement.incrementor ? applyExpression(statement.incrementor, afterBody) : afterBody;
  }
  if (ts.isForInStatement(statement) || ts.isForOfStatement(statement)) {
    return processStatement(statement.statement, applyExpression(statement.expression, selection));
  }
  if (ts.isSwitchStatement(statement)) {
    let merged = selection;
    for (const clause of statement.caseBlock.clauses) {
      let branch = selection;
      for (const item of clause.statements) branch = processStatement(item, branch);
      merged = mergeSelection(merged, branch);
    }
    return merged;
  }
  if (ts.isTryStatement(statement)) {
    const tried = processStatement(statement.tryBlock, selection);
    const caught = statement.catchClause ? processStatement(statement.catchClause.block, selection) : selection;
    const merged = mergeSelection(tried, caught);
    return statement.finallyBlock ? processStatement(statement.finallyBlock, merged) : merged;
  }
  return selection;
}

function selectionFromCall(call: SmCallEvent): ScFileSelection {
  if (call.arguments.length === 0) return { kind: 'all-fields', range: call.range, evidenceId: call.id };
  const fields = literalFields(call.node.arguments[0]);
  return fields
    ? { kind: 'selected-fields', fields, range: call.range, evidenceId: call.id }
    : { kind: 'unknown', range: call.range, evidenceId: call.id };
}

function mergeSelection(left: ScFileSelection, right: ScFileSelection): ScFileSelection {
  if (left.kind !== right.kind) return unknownSelection(left, right);
  if (left.kind === 'selected-fields' && right.kind === 'selected-fields'
    && (left.fields.length !== right.fields.length || left.fields.some((field, index) => field !== right.fields[index]))) {
    return unknownSelection(left, right);
  }
  return left;
}

function unknownSelection(left: ScFileSelection, right: ScFileSelection): ScFileSelection {
  return {
    kind: 'unknown', range: left.range,
    evidenceId: `branch-merge:${left.evidenceId}:${right.evidenceId}`,
  };
}

function isUnknownCallOnKnownName(node: ts.CallExpression, names: ReadonlySet<string>): boolean {
  return ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && names.has(node.expression.expression.text);
}

function rangeOfNode(sourceFile: ts.SourceFile, node: ts.Node): SourceRange {
  const startOffset = node.getStart(sourceFile);
  const endOffset = node.getEnd();
  const start = sourceFile.getLineAndCharacterOfPosition(startOffset);
  const end = sourceFile.getLineAndCharacterOfPosition(endOffset);
  return {
    start: { line: start.line + 1, column: start.character + 1, offset: startOffset },
    end: { line: end.line + 1, column: end.character + 1, offset: endOffset },
  };
}

function literalFields(expression: ts.Expression | undefined): readonly string[] | undefined {
  if (!expression) return undefined;
  if (ts.isStringLiteral(expression)) return expression.text.split(/\s+/u).filter(Boolean);
  const values = ts.isArrayLiteralExpression(expression)
    ? expression.elements
    : ts.isNewExpression(expression)
      && ts.isIdentifier(expression.expression)
      && expression.expression.text === 'Array'
      ? expression.arguments ?? []
      : undefined;
  if (!values || !values.every(ts.isStringLiteral)) return undefined;
  return values.map((value) => (value as ts.StringLiteral).text);
}

function emptyRange(): SourceRange {
  const point = { line: 1, column: 1, offset: 0 };
  return { start: point, end: point };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
