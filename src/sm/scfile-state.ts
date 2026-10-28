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
  const objects = analysis.constructions.map((construction) => buildStateObject(construction, analysis));
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
): ScFileStateObject {
  const methodCalls = analysis.calls.filter(({ bindingId }) => bindingId === construction.bindingId);
  const bindings = analysis.bindings.filter(({ bindingId }) => bindingId === construction.bindingId);
  const selection = selectionFor(methodCalls);
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

function selectionFor(calls: readonly SmCallEvent[]): ScFileSelection {
  let selection: ScFileSelection = {
    kind: 'all-fields',
    range: calls[0]?.range ?? emptyRange(),
    evidenceId: 'default-all-fields',
  };
  for (const call of calls) {
    if (call.method !== 'setFields') continue;
    if (call.arguments.length === 0) {
      selection = { kind: 'all-fields', range: call.range, evidenceId: call.id };
      continue;
    }
    const fields = literalFields(call.node.arguments[0]);
    selection = fields
      ? { kind: 'selected-fields', fields, range: call.range, evidenceId: call.id }
      : { kind: 'unknown', range: call.range, evidenceId: call.id };
  }
  return selection;
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
