import type ts from 'typescript';
import type { SourceRange } from '../rules/types';
import type { SmApiMethodSpec, SmObjectMode } from './api-catalog';
import type { SmSymbolSnapshot } from './symbols';

export type SmResultUse =
  | 'ignored'
  | 'assigned'
  | 'condition'
  | 'returned'
  | 'passed'
  | 'unknown';

export type SmReturnCodeStatus = 'unhandled' | 'consumed' | 'ambiguous';

export interface SmEvidenceProvenance {
  readonly status: SmApiMethodSpec['status'];
  readonly documentationUrl: string;
}

export type SmModeCertainty = 'verified' | 'unknown';

export interface SmConstructionEvent {
  readonly kind: 'scfile-construction';
  readonly bindingId: string;
  readonly bindingName: string;
  readonly tableName?: string;
  readonly tableText?: string;
  readonly mode: SmObjectMode;
  readonly modeCertainty: SmModeCertainty;
  readonly range: SourceRange;
  readonly containingFunctionId: string;
  readonly containingScopeId: string;
  readonly evidence: SmEvidenceProvenance;
}

export interface SmBindingEvent {
  readonly kind: 'scfile-binding' | 'scfile-reassignment';
  readonly bindingName: string;
  readonly bindingId: string;
  readonly relation: 'construction' | 'alias' | 'unknown-reassignment';
  readonly range: SourceRange;
  readonly containingFunctionId: string;
  readonly containingScopeId: string;
}

export interface SmArgumentEvent {
  readonly text: string;
  readonly range: SourceRange;
}

export interface SmCallEvent {
  readonly kind: 'scfile-call';
  readonly id: string;
  readonly node: ts.CallExpression;
  readonly bindingId: string;
  readonly receiverName: string;
  readonly method: string;
  readonly methodSpec: SmApiMethodSpec;
  readonly arguments: readonly SmArgumentEvent[];
  readonly resultUse: SmResultUse;
  readonly resultTarget?: string;
  readonly range: SourceRange;
  readonly containingFunctionId: string;
  readonly containingScopeId: string;
  readonly evidence: SmEvidenceProvenance;
  readonly resultId?: string;
}

export interface SmReturnCodeRecord {
  readonly id: string;
  readonly call: SmCallEvent;
  readonly targetName?: string;
  status: SmReturnCodeStatus;
}

export interface SmReturnCodeComparisonEvent {
  readonly returnCodeName: string;
  readonly resultId: string;
  readonly operator: string;
  readonly range: SourceRange;
  readonly containingFunctionId: string;
  readonly containingScopeId: string;
  readonly evidence: SmEvidenceProvenance;
}

export type SmLoopNode = ts.WhileStatement | ts.DoStatement | ts.ForStatement;

export interface SmAnalysis {
  readonly constructions: readonly SmConstructionEvent[];
  readonly bindings: readonly SmBindingEvent[];
  readonly calls: readonly SmCallEvent[];
  readonly returnCodes: readonly SmReturnCodeRecord[];
  readonly comparisons: readonly SmReturnCodeComparisonEvent[];
  readonly callsByNode: ReadonlyMap<ts.CallExpression, SmCallEvent>;
  readonly loopSymbols: ReadonlyMap<SmLoopNode, SmSymbolSnapshot>;
}

