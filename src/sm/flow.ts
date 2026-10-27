import ts from 'typescript';
import { hasSyntacticLoopExit, type LoopStatement } from '../rules/control-flow/loop-exits';
import type { SmAnalysis, SmLoopNode } from './events';
import type { SmSymbolValue } from './symbols';

export interface SmQueryLoopTarget {
  readonly returnCodeName: string;
  readonly bindingId: string;
}

export type SmLoopProgress = 'progresses' | 'missing' | 'possible-exit' | 'unknown';

interface ProgressPath {
  readonly progressed: boolean;
  readonly active: boolean;
}

interface ProgressResult {
  readonly paths: readonly ProgressPath[];
  readonly unknown: boolean;
}

export function getSmQueryLoopTarget(
  loop: SmLoopNode,
  analysis: SmAnalysis,
): SmQueryLoopTarget | undefined {
  const condition = getLoopCondition(loop);
  const symbols = analysis.loopSymbols.get(loop);
  if (!condition || !symbols) return undefined;
  return parseSuccessCondition(condition, symbols.resolve.bind(symbols), false);
}

export function assessSmQueryLoopProgress(
  loop: SmLoopNode,
  target: SmQueryLoopTarget,
  analysis: SmAnalysis,
): SmLoopProgress {
  if (hasSyntacticLoopExit(loop as LoopStatement)) return 'possible-exit';
  const result = processStatement(loop.statement, [{ progressed: false, active: true }], target, analysis);
  if (result.unknown) return 'unknown';
  return result.paths.some(({ progressed }) => !progressed) ? 'missing' : 'progresses';
}

function parseSuccessCondition(
  expression: ts.Expression,
  resolve: (name: string) => SmSymbolValue | undefined,
  negated: boolean,
): SmQueryLoopTarget | undefined {
  const node = unwrapExpression(expression);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    return parseSuccessCondition(node.operand, resolve, !negated);
  }
  if (!ts.isBinaryExpression(node)) return undefined;

  const equality = node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken
    || node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken;
  const inequality = node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken
    || node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
  if (!equality && !inequality) return undefined;
  if (equality === negated) return undefined;

  const pairs: readonly [ts.Expression, ts.Expression][] = [
    [node.left, node.right],
    [node.right, node.left],
  ];
  for (const [candidate, constant] of pairs) {
    const identifier = unwrapExpression(candidate);
    const rcConstant = unwrapExpression(constant);
    if (!ts.isIdentifier(identifier) || !ts.isIdentifier(rcConstant)) continue;
    if (rcConstant.text !== 'RC_SUCCESS') continue;
    const value = resolve(identifier.text);
    if (
      value?.kind === 'return-code'
      && (value.method === 'doSelect' || value.method === 'getNext')
    ) {
      return { returnCodeName: identifier.text, bindingId: value.bindingId };
    }
  }
  return undefined;
}

function processStatement(
  statement: ts.Statement,
  input: readonly ProgressPath[],
  target: SmQueryLoopTarget,
  analysis: SmAnalysis,
): ProgressResult {
  if (ts.isBlock(statement)) return processStatementList(statement.statements, input, target, analysis);
  if (ts.isIfStatement(statement)) {
    const thenResult = processStatement(statement.thenStatement, clonePaths(input), target, analysis);
    const elseResult = statement.elseStatement
      ? processStatement(statement.elseStatement, clonePaths(input), target, analysis)
      : { paths: clonePaths(input), unknown: false };
    return {
      paths: deduplicatePaths([...thenResult.paths, ...elseResult.paths]),
      unknown: thenResult.unknown || elseResult.unknown,
    };
  }
  if (ts.isContinueStatement(statement)) {
    return {
      paths: input.map((path) => path.active ? { ...path, active: false } : path),
      unknown: false,
    };
  }
  if (ts.isFunctionDeclaration(statement) || ts.isEmptyStatement(statement)) {
    return { paths: input, unknown: false };
  }
  if (
    ts.isWhileStatement(statement)
    || ts.isDoStatement(statement)
    || ts.isForStatement(statement)
    || ts.isForInStatement(statement)
    || ts.isForOfStatement(statement)
    || ts.isSwitchStatement(statement)
    || ts.isTryStatement(statement)
  ) {
    return { paths: input, unknown: true };
  }
  if (ts.isLabeledStatement(statement)) {
    return processStatement(statement.statement, input, target, analysis);
  }
  if (ts.isExpressionStatement(statement)) {
    return processExpression(statement.expression, input, target, analysis);
  }
  if (containsAssignmentTo(statement, target.returnCodeName)) {
    return { paths: input, unknown: true };
  }
  return { paths: input, unknown: false };
}

function processStatementList(
  statements: readonly ts.Statement[],
  input: readonly ProgressPath[],
  target: SmQueryLoopTarget,
  analysis: SmAnalysis,
): ProgressResult {
  let paths: readonly ProgressPath[] = clonePaths(input);
  let unknown = false;
  for (const statement of statements) {
    const result = processStatement(statement, paths, target, analysis);
    paths = result.paths;
    unknown ||= result.unknown;
  }
  return { paths, unknown };
}

function processExpression(
  expression: ts.Expression,
  input: readonly ProgressPath[],
  target: SmQueryLoopTarget,
  analysis: SmAnalysis,
): ProgressResult {
  const node = unwrapExpression(expression);
  if (
    ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && ts.isIdentifier(node.left)
    && node.left.text === target.returnCodeName
  ) {
    const right = unwrapExpression(node.right);
    if (ts.isCallExpression(right)) {
      const call = analysis.callsByNode.get(right);
      if (call?.method === 'getNext' && call.bindingId === target.bindingId) {
        return {
          paths: input.map((path) => path.active ? { ...path, progressed: true } : path),
          unknown: false,
        };
      }
      // A verified SCFile call on another binding (or another verified method)
      // is known not to advance the cursor that controls this loop.
      if (call) return { paths: input, unknown: false };
    }
    return { paths: input, unknown: true };
  }
  if (containsAssignmentTo(node, target.returnCodeName)) {
    return { paths: input, unknown: true };
  }
  return { paths: input, unknown: false };
}

function containsAssignmentTo(node: ts.Node, name: string): boolean {
  let found = false;
  const visit = (current: ts.Node): void => {
    if (found || (current !== node && ts.isFunctionLike(current))) return;
    if (
      ts.isBinaryExpression(current)
      && current.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isIdentifier(current.left)
      && current.left.text === name
    ) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function getLoopCondition(loop: SmLoopNode): ts.Expression | undefined {
  if (ts.isWhileStatement(loop) || ts.isDoStatement(loop)) return loop.expression;
  return loop.condition;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function clonePaths(paths: readonly ProgressPath[]): ProgressPath[] {
  return paths.map((path) => ({ ...path }));
}

function deduplicatePaths(paths: readonly ProgressPath[]): ProgressPath[] {
  const byKey = new Map<string, ProgressPath>();
  for (const path of paths) byKey.set(`${path.progressed}:${path.active}`, path);
  return [...byKey.values()];
}

