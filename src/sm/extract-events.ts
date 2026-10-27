import ts from 'typescript';
import type { RuleContext } from '../rules/types';
import { getScFileMethod, SCFILE_OBJECT_EVIDENCE } from './api-catalog';
import type {
  SmAnalysis,
  SmCallEvent,
  SmConstructionEvent,
  SmLoopNode,
  SmResultUse,
  SmReturnCodeComparisonEvent,
  SmReturnCodeRecord,
} from './events';
import {
  SmSymbolTracker,
  UNKNOWN_SYMBOL,
  type SmSymbolValue,
} from './symbols';

interface ExtractionState {
  readonly context: RuleContext;
  readonly constructions: SmConstructionEvent[];
  readonly calls: SmCallEvent[];
  readonly returnCodes: SmReturnCodeRecord[];
  readonly returnCodesById: Map<string, SmReturnCodeRecord>;
  readonly comparisons: SmReturnCodeComparisonEvent[];
  readonly callsByNode: Map<ts.CallExpression, SmCallEvent>;
  readonly loopSymbols: Map<SmLoopNode, ReturnType<SmSymbolTracker['snapshot']>>;
  readonly deferredCapturedNames: Map<string, Set<string>>;
  currentFunctionId: string;
}

export function extractSmEvents(context: RuleContext): SmAnalysis {
  const state: ExtractionState = {
    context,
    constructions: [],
    calls: [],
    returnCodes: [],
    returnCodesById: new Map(),
    comparisons: [],
    callsByNode: new Map(),
    loopSymbols: new Map(),
    deferredCapturedNames: new Map(),
    currentFunctionId: '<source>',
  };
  const symbols = new SmSymbolTracker();
  predeclareFunctionScoped(context.sourceFile, symbols);
  predeclareBlockScoped(context.sourceFile.statements, symbols);
  processStatementList(context.sourceFile.statements, symbols, state);

  return {
    constructions: state.constructions,
    calls: state.calls,
    returnCodes: state.returnCodes,
    comparisons: state.comparisons,
    callsByNode: state.callsByNode,
    loopSymbols: state.loopSymbols,
  };
}

function processStatementList(
  statements: readonly ts.Statement[],
  symbols: SmSymbolTracker,
  state: ExtractionState,
): boolean {
  let terminated = false;
  for (const statement of statements) {
    if (terminated) {
      if (ts.isFunctionDeclaration(statement)) analyzeFunction(statement, symbols, state);
      continue;
    }
    terminated = processStatement(statement, symbols, state) || terminated;
  }
  return terminated;
}

function processStatement(
  statement: ts.Statement,
  symbols: SmSymbolTracker,
  state: ExtractionState,
): boolean {
  if (ts.isVariableStatement(statement)) {
    processVariableDeclarationList(statement.declarationList, symbols, state);
    return false;
  }
  if (ts.isExpressionStatement(statement)) {
    evaluateExpression(statement.expression, symbols, state, 'ignored');
    return false;
  }
  if (ts.isReturnStatement(statement)) {
    if (statement.expression) evaluateExpression(statement.expression, symbols, state, 'returned');
    return true;
  }
  if (ts.isThrowStatement(statement)) {
    evaluateExpression(statement.expression, symbols, state, 'passed');
    return true;
  }
  if (ts.isBreakStatement(statement) || ts.isContinueStatement(statement)) return true;
  if (ts.isFunctionDeclaration(statement)) {
    analyzeFunction(statement, symbols, state);
    return false;
  }
  if (ts.isBlock(statement)) return processBlock(statement, symbols, state);
  if (ts.isIfStatement(statement)) {
    evaluateExpression(statement.expression, symbols, state, 'condition');
    const left = symbols.clone();
    const right = symbols.clone();
    const leftTerminates = processNestedStatement(statement.thenStatement, left, state);
    const rightTerminates = statement.elseStatement
      ? processNestedStatement(statement.elseStatement, right, state)
      : false;
    symbols.joinBranches(left, right);
    return leftTerminates && rightTerminates;
  }
  if (ts.isWhileStatement(statement) || ts.isDoStatement(statement)) {
    state.loopSymbols.set(statement, symbols.snapshot());
    if (ts.isWhileStatement(statement)) {
      evaluateExpression(statement.expression, symbols, state, 'condition');
    }
    const before = symbols.clone();
    const body = symbols.clone();
    processNestedStatement(statement.statement, body, state);
    if (ts.isDoStatement(statement)) {
      evaluateExpression(statement.expression, body, state, 'condition');
    } else {
      markLoopBackEdgeConditionUses(statement.expression, body, state);
    }
    symbols.joinBranches(before, body);
    return false;
  }
  if (ts.isForStatement(statement)) {
    if (statement.initializer) {
      if (ts.isVariableDeclarationList(statement.initializer)) {
        processVariableDeclarationList(statement.initializer, symbols, state);
      } else {
        evaluateExpression(statement.initializer, symbols, state, 'unknown');
      }
    }
    state.loopSymbols.set(statement, symbols.snapshot());
    if (statement.condition) evaluateExpression(statement.condition, symbols, state, 'condition');
    const before = symbols.clone();
    const body = symbols.clone();
    processNestedStatement(statement.statement, body, state);
    if (statement.incrementor) evaluateExpression(statement.incrementor, body, state, 'unknown');
    if (statement.condition) markLoopBackEdgeConditionUses(statement.condition, body, state);
    symbols.joinBranches(before, body);
    return false;
  }
  if (ts.isForInStatement(statement) || ts.isForOfStatement(statement)) {
    evaluateExpression(statement.expression, symbols, state, 'unknown');
    const body = symbols.clone();
    processNestedStatement(statement.statement, body, state);
    invalidateAssignments(statement, symbols);
    return false;
  }
  if (ts.isSwitchStatement(statement)) {
    evaluateExpression(statement.expression, symbols, state, 'condition');
    for (const clause of statement.caseBlock.clauses) {
      const branch = symbols.clone();
      if (ts.isCaseClause(clause)) evaluateExpression(clause.expression, branch, state, 'condition');
      processStatementList(clause.statements, branch, state);
    }
    invalidateAssignments(statement, symbols);
    return false;
  }
  if (ts.isTryStatement(statement)) {
    processBlock(statement.tryBlock, symbols.clone(), state);
    if (statement.catchClause) {
      const catchSymbols = symbols.clone();
      if (statement.catchClause.variableDeclaration
        && ts.isIdentifier(statement.catchClause.variableDeclaration.name)) {
        catchSymbols.declare(statement.catchClause.variableDeclaration.name.text);
      }
      processBlock(statement.catchClause.block, catchSymbols, state);
    }
    if (statement.finallyBlock) processBlock(statement.finallyBlock, symbols.clone(), state);
    invalidateAssignments(statement, symbols);
    return false;
  }
  if (ts.isLabeledStatement(statement)) {
    return processNestedStatement(statement.statement, symbols, state);
  }

  ts.forEachChild(statement, (node) => processUnknownNode(node, symbols, state));
  return false;
}

function processBlock(
  block: ts.Block,
  symbols: SmSymbolTracker,
  state: ExtractionState,
): boolean {
  symbols.enterScope(`block:${block.pos}`, 'block');
  predeclareBlockScoped(block.statements, symbols);
  const terminates = processStatementList(block.statements, symbols, state);
  symbols.leaveScope();
  return terminates;
}

function processNestedStatement(
  statement: ts.Statement,
  symbols: SmSymbolTracker,
  state: ExtractionState,
): boolean {
  return ts.isBlock(statement)
    ? processBlock(statement, symbols, state)
    : processStatement(statement, symbols, state);
}

function processVariableDeclarationList(
  list: ts.VariableDeclarationList,
  symbols: SmSymbolTracker,
  state: ExtractionState,
): void {
  const functionScoped = (list.flags & ts.NodeFlags.BlockScoped) === 0;
  for (const declaration of list.declarations) {
    if (!ts.isIdentifier(declaration.name)) continue;
    const name = declaration.name.text;
    symbols.declare(name, UNKNOWN_SYMBOL, functionScoped);
    if (!declaration.initializer) continue;
    const value = evaluateExpression(declaration.initializer, symbols, state, 'assigned', name);
    symbols.assign(name, value);
  }
}

function analyzeFunction(
  node: ts.FunctionLikeDeclaration,
  outerSymbols: SmSymbolTracker,
  state: ExtractionState,
): void {
  if (!node.body) return;
  registerDeferredCaptures(node, state.currentFunctionId, state);
  const symbols = outerSymbols.cloneForDeferredFunction();
  const previousFunction = state.currentFunctionId;
  state.currentFunctionId = `function:${node.getStart(state.context.sourceFile)}`;
  symbols.enterScope(state.currentFunctionId, 'function');
  for (const parameter of node.parameters) {
    if (ts.isIdentifier(parameter.name)) symbols.declare(parameter.name.text);
  }
  if (ts.isBlock(node.body)) {
    predeclareFunctionScoped(node.body, symbols);
    processBlock(node.body, symbols, state);
  } else {
    evaluateExpression(node.body, symbols, state, 'returned');
  }
  symbols.leaveScope();
  state.currentFunctionId = previousFunction;
}

function evaluateExpression(
  expression: ts.Expression,
  symbols: SmSymbolTracker,
  state: ExtractionState,
  usage: SmResultUse,
  targetName?: string,
): SmSymbolValue {
  const node = unwrapExpression(expression);

  if (ts.isIdentifier(node)) {
    const value = symbols.resolve(node.text) ?? UNKNOWN_SYMBOL;
    if (value.kind === 'return-code') markReturnCodeUse(value.resultId, usage, state);
    if (value.kind === 'captured-return-code') {
      markReturnCodeUse(value.resultId, 'unknown', state);
      return UNKNOWN_SYMBOL;
    }
    if (value.kind === 'scfile' && usage === 'assigned' && targetName !== node.text) {
      return value.aliasDepth === 0
        ? { ...value, aliasDepth: 1 }
        : UNKNOWN_SYMBOL;
    }
    return value;
  }

  if (ts.isNewExpression(node)) {
    for (const argument of node.arguments ?? []) {
      evaluateExpression(argument, symbols, state, 'passed');
    }
    if (
      ts.isIdentifier(node.expression)
      && node.expression.text === 'SCFile'
      && symbols.resolve('SCFile') === undefined
    ) {
      const bindingId = `scfile:${node.getStart(state.context.sourceFile)}`;
      const bindingName = targetName ?? '<temporary>';
      state.constructions.push({
        kind: 'scfile-construction',
        bindingId,
        bindingName,
        ...(node.arguments?.[0]
          ? { tableText: node.arguments[0].getText(state.context.sourceFile) }
          : {}),
        range: state.context.rangeOf(node),
        containingFunctionId: state.currentFunctionId,
        containingScopeId: symbols.currentScopeId(),
        evidence: SCFILE_OBJECT_EVIDENCE,
      });
      return { kind: 'scfile', bindingId, aliasDepth: 0 };
    }
    return UNKNOWN_SYMBOL;
  }

  if (ts.isCallExpression(node)) {
    const recognized = createCallEvent(node, symbols, state, usage, targetName);
    if (recognized) return recognized;
    evaluateUnknownCall(node, symbols, state);
    return UNKNOWN_SYMBOL;
  }

  if (ts.isBinaryExpression(node)) {
    if (isAssignment(node.operatorToken.kind)) {
      const name = ts.isIdentifier(node.left) ? node.left.text : undefined;
      const value = evaluateExpression(
        node.right,
        symbols,
        state,
        name ? 'assigned' : 'unknown',
        name,
      );
      if (name) symbols.assign(name, value);
      else evaluateExpression(node.left as ts.Expression, symbols, state, 'unknown');
      return value;
    }

    const comparison = getReturnCodeComparison(node, symbols);
    if (comparison) {
      markReturnCodeUse(comparison.value.resultId, 'condition', state);
      state.comparisons.push({
        returnCodeName: comparison.name,
        resultId: comparison.value.resultId,
        operator: node.operatorToken.getText(state.context.sourceFile),
        range: state.context.rangeOf(node),
        containingFunctionId: state.currentFunctionId,
        containingScopeId: symbols.currentScopeId(),
        evidence: state.returnCodesById.get(comparison.value.resultId)!.call.evidence,
      });
    }
    const childUsage = isConditionalOperator(node.operatorToken.kind) ? 'condition' : 'unknown';
    evaluateExpression(node.left, symbols, state, childUsage);
    evaluateExpression(node.right, symbols, state, childUsage);
    return UNKNOWN_SYMBOL;
  }

  if (ts.isPrefixUnaryExpression(node)) {
    evaluateExpression(node.operand, symbols, state, usage === 'condition' ? 'condition' : 'unknown');
    return UNKNOWN_SYMBOL;
  }
  if (ts.isConditionalExpression(node)) {
    evaluateExpression(node.condition, symbols, state, 'condition');
    const left = symbols.clone();
    const right = symbols.clone();
    const leftValue = evaluateExpression(node.whenTrue, left, state, usage, targetName);
    const rightValue = evaluateExpression(node.whenFalse, right, state, usage, targetName);
    symbols.joinBranches(left, right);
    return sameValue(leftValue, rightValue) ? leftValue : UNKNOWN_SYMBOL;
  }
  if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
    analyzeFunction(node, symbols, state);
    return UNKNOWN_SYMBOL;
  }
  if (ts.isPropertyAccessExpression(node)) {
    evaluateExpression(node.expression, symbols, state, 'unknown');
    return UNKNOWN_SYMBOL;
  }
  if (ts.isElementAccessExpression(node)) {
    evaluateExpression(node.expression, symbols, state, 'unknown');
    if (node.argumentExpression) evaluateExpression(node.argumentExpression, symbols, state, 'unknown');
    return UNKNOWN_SYMBOL;
  }

  ts.forEachChild(node, (child) => {
    if (ts.isExpression(child)) evaluateExpression(child, symbols, state, 'unknown');
  });
  return UNKNOWN_SYMBOL;
}

function createCallEvent(
  node: ts.CallExpression,
  symbols: SmSymbolTracker,
  state: ExtractionState,
  usage: SmResultUse,
  targetName?: string,
): SmSymbolValue | undefined {
  if (!ts.isPropertyAccessExpression(node.expression)) return undefined;
  const receiver = unwrapExpression(node.expression.expression);
  if (!ts.isIdentifier(receiver)) return undefined;
  const receiverValue = symbols.resolve(receiver.text);
  if (receiverValue?.kind !== 'scfile') return undefined;
  const methodSpec = getScFileMethod(node.expression.name.text);
  if (!methodSpec) return undefined;

  for (const argument of node.arguments) evaluateExpression(argument, symbols, state, 'passed');
  const id = `call:${node.getStart(state.context.sourceFile)}`;
  const resultId = `result:${node.getStart(state.context.sourceFile)}`;
  const call: SmCallEvent = {
    kind: 'scfile-call',
    id,
    node,
    bindingId: receiverValue.bindingId,
    receiverName: receiver.text,
    method: methodSpec.method,
    methodSpec,
    arguments: node.arguments.map((argument) => ({
      text: argument.getText(state.context.sourceFile),
      range: state.context.rangeOf(argument),
    })),
    resultUse: usage,
    ...(targetName ? { resultTarget: targetName } : {}),
    range: state.context.rangeOf(node),
    containingFunctionId: state.currentFunctionId,
    containingScopeId: symbols.currentScopeId(),
    evidence: {
      status: methodSpec.evidenceStatus,
      documentationUrl: methodSpec.documentationUrl,
    },
    resultId,
  };
  const record: SmReturnCodeRecord = {
    id: resultId,
    call,
    ...(targetName ? { targetName } : {}),
    status: initialReturnCodeStatus(
      usage,
      targetName !== undefined
        && state.deferredCapturedNames.get(state.currentFunctionId)?.has(targetName) === true,
    ),
  };
  state.calls.push(call);
  state.callsByNode.set(node, call);
  state.returnCodes.push(record);
  state.returnCodesById.set(resultId, record);
  return {
    kind: 'return-code',
    resultId,
    bindingId: receiverValue.bindingId,
    method: methodSpec.method,
  };
}

function evaluateUnknownCall(
  node: ts.CallExpression,
  symbols: SmSymbolTracker,
  state: ExtractionState,
): void {
  if (ts.isPropertyAccessExpression(node.expression)) {
    evaluateExpression(node.expression.expression, symbols, state, 'unknown');
  }
  for (const argument of node.arguments) evaluateExpression(argument, symbols, state, 'passed');
}

function getReturnCodeComparison(
  node: ts.BinaryExpression,
  symbols: SmSymbolTracker,
): { name: string; value: Extract<SmSymbolValue, { kind: 'return-code' }> } | undefined {
  if (!isComparisonOperator(node.operatorToken.kind)) return undefined;
  const pairs: readonly [ts.Expression, ts.Expression][] = [
    [node.left, node.right],
    [node.right, node.left],
  ];
  for (const [candidate, constant] of pairs) {
    const identifier = unwrapExpression(candidate);
    const other = unwrapExpression(constant);
    if (!ts.isIdentifier(identifier) || !ts.isIdentifier(other)) continue;
    if (!other.text.startsWith('RC_')) continue;
    const value = symbols.resolve(identifier.text);
    if (value?.kind === 'return-code') return { name: identifier.text, value };
  }
  return undefined;
}

function markReturnCodeUse(resultId: string, usage: SmResultUse, state: ExtractionState): void {
  const record = state.returnCodesById.get(resultId);
  if (!record || record.status === 'consumed') return;
  if (usage === 'condition' || usage === 'returned' || usage === 'passed') {
    record.status = 'consumed';
  } else if (usage === 'unknown' || usage === 'ignored') {
    record.status = 'ambiguous';
  }
}

function markLoopBackEdgeConditionUses(
  condition: ts.Expression,
  symbols: SmSymbolTracker,
  state: ExtractionState,
): void {
  const visit = (node: ts.Node): void => {
    if (node !== condition && ts.isFunctionLike(node)) return;
    if (ts.isIdentifier(node)) {
      const value = symbols.resolve(node.text);
      if (value?.kind === 'return-code') markReturnCodeUse(value.resultId, 'condition', state);
    }
    ts.forEachChild(node, visit);
  };
  visit(condition);
}

function initialReturnCodeStatus(
  usage: SmResultUse,
  capturedByDeferredFunction = false,
): SmReturnCodeRecord['status'] {
  if (usage === 'condition' || usage === 'returned' || usage === 'passed') return 'consumed';
  if (usage === 'unknown') return 'ambiguous';
  if (capturedByDeferredFunction && usage === 'assigned') return 'ambiguous';
  return 'unhandled';
}

function registerDeferredCaptures(
  node: ts.FunctionLikeDeclaration,
  ownerFunctionId: string,
  state: ExtractionState,
): void {
  const captured = collectCapturedNames(node);
  if (captured.size === 0) return;
  const existing = state.deferredCapturedNames.get(ownerFunctionId) ?? new Set<string>();
  for (const name of captured) existing.add(name);
  state.deferredCapturedNames.set(ownerFunctionId, existing);
}

function collectCapturedNames(node: ts.FunctionLikeDeclaration): Set<string> {
  const declared = new Set<string>();
  for (const parameter of node.parameters) collectBindingNames(parameter.name, declared);

  const collectDeclarations = (current: ts.Node): void => {
    if (current !== node && ts.isFunctionLike(current)) {
      if (ts.isFunctionDeclaration(current) && current.name) declared.add(current.name.text);
      return;
    }
    if (ts.isVariableDeclaration(current)) collectBindingNames(current.name, declared);
    if (ts.isCatchClause(current) && current.variableDeclaration) {
      collectBindingNames(current.variableDeclaration.name, declared);
    }
    ts.forEachChild(current, collectDeclarations);
  };
  collectDeclarations(node.body!);

  const captured = new Set<string>();
  const collectReferences = (current: ts.Node): void => {
    if (current !== node && ts.isFunctionLike(current)) return;
    if (ts.isIdentifier(current) && isIdentifierReference(current) && !declared.has(current.text)) {
      captured.add(current.text);
    }
    ts.forEachChild(current, collectReferences);
  };
  collectReferences(node.body!);
  return captured;
}

function collectBindingNames(name: ts.BindingName, target: Set<string>): void {
  if (ts.isIdentifier(name)) {
    target.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) collectBindingNames(element.name, target);
  }
}

function isIdentifierReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (
    (ts.isVariableDeclaration(parent) && parent.name === node)
    || (ts.isParameter(parent) && parent.name === node)
    || (ts.isFunctionDeclaration(parent) && parent.name === node)
    || (ts.isFunctionExpression(parent) && parent.name === node)
    || (ts.isPropertyAccessExpression(parent) && parent.name === node)
    || (ts.isPropertyAssignment(parent) && parent.name === node)
    || (ts.isMethodDeclaration(parent) && parent.name === node)
    || (ts.isLabeledStatement(parent) && parent.label === node)
    || ((ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === node)
  ) {
    return false;
  }
  return true;
}

function predeclareFunctionScoped(root: ts.Node, symbols: SmSymbolTracker): void {
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      symbols.declare(node.name.text, UNKNOWN_SYMBOL, true);
    }
    if (node !== root && ts.isFunctionLike(node)) return;
    if (ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.BlockScoped) === 0) {
      for (const declaration of node.declarations) {
        if (ts.isIdentifier(declaration.name)) symbols.declare(declaration.name.text, UNKNOWN_SYMBOL, true);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
}

function predeclareBlockScoped(
  statements: readonly ts.Statement[],
  symbols: SmSymbolTracker,
): void {
  for (const statement of statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if ((statement.declarationList.flags & ts.NodeFlags.BlockScoped) === 0) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) symbols.declare(declaration.name.text);
    }
  }
}

function invalidateAssignments(node: ts.Node, symbols: SmSymbolTracker): void {
  const visit = (current: ts.Node): void => {
    if (current !== node && ts.isFunctionLike(current)) return;
    if (
      ts.isBinaryExpression(current)
      && isAssignment(current.operatorToken.kind)
      && ts.isIdentifier(current.left)
    ) {
      symbols.assign(current.left.text, UNKNOWN_SYMBOL);
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
}

function processUnknownNode(node: ts.Node, symbols: SmSymbolTracker, state: ExtractionState): void {
  if (ts.isExpression(node)) {
    evaluateExpression(node, symbols, state, 'unknown');
    return;
  }
  ts.forEachChild(node, (child) => processUnknownNode(child, symbols, state));
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isAssignment(kind: ts.SyntaxKind): boolean {
  return kind === ts.SyntaxKind.EqualsToken;
}

function isComparisonOperator(kind: ts.SyntaxKind): boolean {
  return kind === ts.SyntaxKind.EqualsEqualsToken
    || kind === ts.SyntaxKind.EqualsEqualsEqualsToken
    || kind === ts.SyntaxKind.ExclamationEqualsToken
    || kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
}

function isConditionalOperator(kind: ts.SyntaxKind): boolean {
  return isComparisonOperator(kind)
    || kind === ts.SyntaxKind.AmpersandAmpersandToken
    || kind === ts.SyntaxKind.BarBarToken;
}

function sameValue(left: SmSymbolValue, right: SmSymbolValue): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'unknown' && right.kind === 'unknown') return true;
  if (left.kind === 'scfile' && right.kind === 'scfile') {
    return left.bindingId === right.bindingId && left.aliasDepth === right.aliasDepth;
  }
  if (left.kind === 'return-code' && right.kind === 'return-code') {
    return left.resultId === right.resultId;
  }
  if (left.kind === 'captured-return-code' && right.kind === 'captured-return-code') {
    return left.resultId === right.resultId;
  }
  return false;
}

