import ts from 'typescript';
import { createAnalysisArtifact } from '../parser/analysis-artifact';
import { createLocationMapper } from '../parser/location';
import type { SourceDocument } from '../core/types';
import type { ExtractedDependencyReference } from './types';

interface Scope { readonly parent?: Scope; readonly bindsLib: boolean; }

export function extractDependencies(source: SourceDocument): readonly ExtractedDependencyReference[] {
  const artifact = createAnalysisArtifact(source);
  const results: ExtractedDependencyReference[] = [];
  walk(artifact.sourceFile, undefined, artifact.sourceFile, results);
  return results.sort((left, right) => left.range.start.offset - right.range.start.offset);
}

function walk(
  node: ts.Node,
  parentScope: Scope | undefined,
  sourceFile: ts.SourceFile,
  results: ExtractedDependencyReference[],
): void {
  const scope = createsScope(node) ? { parent: parentScope, bindsLib: scopeBindsLib(node) } : parentScope;
  const candidate = extractReference(node, scope, sourceFile);
  if (candidate) {
    results.push(candidate);
    return; // A single property chain produces exactly one library reference.
  }
  ts.forEachChild(node, (child) => walk(child, scope, sourceFile, results));
}

function extractReference(
  node: ts.Node,
  scope: Scope | undefined,
  sourceFile: ts.SourceFile,
): ExtractedDependencyReference | undefined {
  if (!isTopLevelLibChain(node)) return undefined;
  const chain = decomposeLibChain(node);
  if (!chain) return undefined;
  const location = createLocationMapper(sourceFile);
  const range = { start: location(node.getStart(sourceFile)), end: location(node.getEnd()) };
  const shadowed = isBound(scope);
  if (chain.dynamic) {
    return {
      range, syntax: 'bracket', targetExpression: chain.dynamicExpression,
      confidence: 0, evidence: 'Computed lib reference has no provable literal library target.', shadowed,
    };
  }
  return {
    range, syntax: chain.syntax, libraryName: chain.libraryName,
    confidence: shadowed ? 0 : 1,
    evidence: shadowed
      ? 'Identifier lib is lexically shadowed; this is not treated as the SM global library object.'
      : chain.syntax === 'property'
        ? 'Static property access on unshadowed lib identifier.'
        : 'Static string-literal bracket access on unshadowed lib identifier.',
    shadowed,
  };
}

function isTopLevelLibChain(node: ts.Node): boolean {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return false;
  const parent = node.parent;
  return !((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node);
}

interface LibChain { readonly libraryName?: string; readonly syntax: 'property' | 'bracket'; readonly dynamic: boolean; readonly dynamicExpression?: string; }

function decomposeLibChain(node: ts.Node): LibChain | undefined {
  const segments: { readonly kind: 'property' | 'bracket'; readonly value?: string; readonly dynamicExpression?: string }[] = [];
  let current: ts.Node = node;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    if (ts.isPropertyAccessExpression(current)) {
      segments.unshift({ kind: 'property', value: current.name.text });
      current = current.expression;
    } else {
      const argument = current.argumentExpression;
      if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) {
        segments.unshift({ kind: 'bracket', value: argument.text });
      } else {
        segments.unshift({ kind: 'bracket', dynamicExpression: argument?.getText() ?? '<missing>' });
      }
      current = current.expression;
    }
  }
  if (!ts.isIdentifier(current) || current.text !== 'lib' || segments.length === 0) return undefined;
  const first = segments[0];
  if (first.dynamicExpression !== undefined) return { syntax: 'bracket', dynamic: true, dynamicExpression: first.dynamicExpression };
  return { libraryName: first.value, syntax: first.kind, dynamic: false };
}

function createsScope(node: ts.Node): boolean {
  return ts.isSourceFile(node) || ts.isFunctionLike(node) || ts.isBlock(node) || ts.isCatchClause(node)
    || ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node);
}

function scopeBindsLib(scopeNode: ts.Node): boolean {
  if (ts.isFunctionLike(scopeNode)) {
    if (scopeNode.parameters.some((parameter) => bindingNames(parameter.name).has('lib'))) return true;
    return containsVarBinding('body' in scopeNode ? scopeNode.body : undefined);
  }
  if (ts.isCatchClause(scopeNode) && scopeNode.variableDeclaration) {
    return bindingNames(scopeNode.variableDeclaration.name).has('lib');
  }
  if ((ts.isForStatement(scopeNode) || ts.isForInStatement(scopeNode) || ts.isForOfStatement(scopeNode)) && scopeNode.initializer && ts.isVariableDeclarationList(scopeNode.initializer)) {
    return scopeNode.initializer.declarations.some((declaration) => bindingNames(declaration.name).has('lib'));
  }
  return directBindings(scopeNode).has('lib');
}

function containsVarBinding(node: ts.Node | undefined): boolean {
  if (!node) return false;
  let found = false;
  const visit = (current: ts.Node): void => {
    if (current !== node && ts.isFunctionLike(current)) return;
    if (ts.isVariableDeclaration(current) && bindingNames(current.name).has('lib')) found = true;
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function directBindings(node: ts.Node): ReadonlySet<string> {
  const names = new Set<string>();
  const add = (declaration: ts.BindingName): void => { for (const name of bindingNames(declaration)) names.add(name); };
  const children = ts.isSourceFile(node) || ts.isBlock(node) ? node.statements : [];
  for (const child of children) {
    if (ts.isVariableStatement(child)) for (const declaration of child.declarationList.declarations) add(declaration.name);
    if (ts.isFunctionDeclaration(child) && child.name) names.add(child.name.text);
    if (ts.isClassDeclaration(child) && child.name) names.add(child.name.text);
  }
  return names;
}

function bindingNames(binding: ts.BindingName): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (node: ts.BindingName): void => {
    if (ts.isIdentifier(node)) names.add(node.text);
    else for (const element of node.elements) if (ts.isBindingElement(element)) visit(element.name);
  };
  visit(binding);
  return names;
}

function isBound(scope: Scope | undefined): boolean {
  for (let current = scope; current; current = current.parent) if (current.bindsLib) return true;
  return false;
}
