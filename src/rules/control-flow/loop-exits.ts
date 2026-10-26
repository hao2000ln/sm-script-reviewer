import ts from 'typescript';

export type LoopStatement =
  | ts.WhileStatement
  | ts.DoStatement
  | ts.ForStatement;

export function isUnconditionalLoop(node: ts.Node): node is LoopStatement {
  if (ts.isForStatement(node)) return node.condition === undefined;
  if (ts.isWhileStatement(node) || ts.isDoStatement(node)) {
    return unwrapParentheses(node.expression).kind === ts.SyntaxKind.TrueKeyword;
  }
  return false;
}

export function hasSyntacticLoopExit(loop: LoopStatement): boolean {
  let hasExit = false;

  const visit = (node: ts.Node): void => {
    if (hasExit) return;
    if (node !== loop && ts.isFunctionLike(node)) return;

    if (ts.isReturnStatement(node) || ts.isThrowStatement(node)) {
      hasExit = true;
      return;
    }
    if (ts.isBreakStatement(node) && breakExitsLoop(node, loop)) {
      hasExit = true;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(loop.statement);
  return hasExit;
}

function breakExitsLoop(statement: ts.BreakStatement, loop: LoopStatement): boolean {
  if (statement.label) {
    for (let current: ts.Node | undefined = loop.parent; current; current = current.parent) {
      if (ts.isFunctionLike(current)) break;
      if (ts.isLabeledStatement(current) && current.label.text === statement.label.text) {
        return true;
      }
    }
    return false;
  }

  for (let current: ts.Node | undefined = statement.parent; current; current = current.parent) {
    if (current === loop) return true;
    if (isBreakableStatement(current)) return false;
    if (ts.isFunctionLike(current)) return false;
  }
  return false;
}

function isBreakableStatement(node: ts.Node): boolean {
  return ts.isWhileStatement(node)
    || ts.isDoStatement(node)
    || ts.isForStatement(node)
    || ts.isForInStatement(node)
    || ts.isForOfStatement(node)
    || ts.isSwitchStatement(node);
}

function unwrapParentheses(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

