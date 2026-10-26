import ts from 'typescript';
import type { FunctionInfo } from '../core/types';
import { findLeadingComment, type IndexedComment } from './comments';
import type { LocationMapper } from './location';

type IndexedFunctionNode =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration;

export function indexFunctions(
  sourceFile: ts.SourceFile,
  comments: readonly IndexedComment[],
  toLocation: LocationMapper,
): FunctionInfo[] {
  const functions: FunctionInfo[] = [];

  const visit = (node: ts.Node): void => {
    if (isIndexedFunction(node)) {
      const startOffset = node.getStart(sourceFile);
      const anchorOffset = getCommentAnchor(node).getStart(sourceFile);
      const leadingComment = findLeadingComment(comments, anchorOffset, sourceFile.text);

      functions.push({
        name: inferFunctionName(node, sourceFile) ?? '<anonymous>',
        kind: ts.SyntaxKind[node.kind],
        start: toLocation(startOffset),
        end: toLocation(node.getEnd()),
        ...(leadingComment === undefined ? {} : { leadingComment }),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return functions;
}

function isIndexedFunction(node: ts.Node): node is IndexedFunctionNode {
  return ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node);
}

function inferFunctionName(
  node: IndexedFunctionNode,
  sourceFile: ts.SourceFile,
): string | undefined {
  if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name) {
    return node.name.text;
  }

  if (ts.isMethodDeclaration(node)) return propertyNameText(node.name, sourceFile);

  const expression = climbParentheses(node);
  const parent = expression.parent;

  if (parent && ts.isVariableDeclaration(parent) && parent.initializer === expression) {
    return parent.name.getText(sourceFile);
  }

  if (parent && ts.isPropertyAssignment(parent) && parent.initializer === expression) {
    return propertyNameText(parent.name, sourceFile);
  }

  if (
    parent
    && ts.isBinaryExpression(parent)
    && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && parent.right === expression
  ) {
    return parent.left.getText(sourceFile);
  }

  return undefined;
}

function propertyNameText(name: ts.PropertyName, sourceFile: ts.SourceFile): string {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return name.getText(sourceFile);
}

function climbParentheses(node: ts.Node): ts.Node {
  let current = node;
  while (ts.isParenthesizedExpression(current.parent) && current.parent.expression === current) {
    current = current.parent;
  }
  return current;
}

function getCommentAnchor(node: IndexedFunctionNode): ts.Node {
  const expression = climbParentheses(node);
  const parent = expression.parent;

  if (parent && ts.isVariableDeclaration(parent) && parent.initializer === expression) {
    const declarationList = parent.parent;
    if (
      ts.isVariableDeclarationList(declarationList)
      && declarationList.declarations[0] === parent
      && ts.isVariableStatement(declarationList.parent)
    ) {
      return declarationList.parent;
    }
    return parent;
  }

  if (parent && ts.isPropertyAssignment(parent) && parent.initializer === expression) {
    return parent;
  }

  if (
    parent
    && ts.isBinaryExpression(parent)
    && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && parent.right === expression
  ) {
    return getOutermostAssignmentAnchor(parent);
  }

  return node;
}

function getOutermostAssignmentAnchor(assignment: ts.BinaryExpression): ts.Node {
  let current: ts.Node = climbParentheses(assignment);

  while (
    ts.isBinaryExpression(current.parent)
    && current.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && current.parent.right === current
  ) {
    current = climbParentheses(current.parent);
  }

  return ts.isExpressionStatement(current.parent) ? current.parent : current;
}
