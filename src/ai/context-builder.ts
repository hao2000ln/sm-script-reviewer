import type {
  AnalysisResult,
  FunctionInfo,
  SourceDocument,
  SourceLocation,
} from '../core/types';
import type { Finding, SourceRange } from '../rules/types';
import {
  effectiveContextCharacterLimit,
  estimateInputTokens,
  resolveTokenBudget,
  type AITokenBudget,
} from './token-budget';
import type {
  AIContextEvidence,
  AIContextFunction,
  AIContextOmission,
  AIReviewContext,
  AIValidationError,
} from './types';

export interface AIContextTarget {
  readonly functionName?: string;
  readonly range?: SourceRange;
}

export interface AIContextBuildInput {
  readonly source: SourceDocument;
  readonly analysis: AnalysisResult;
  readonly findings: readonly Finding[];
  readonly target?: AIContextTarget;
  readonly budget?: Partial<AITokenBudget>;
}

export type AIContextBuildResult =
  | { readonly ok: true; readonly context: AIReviewContext }
  | { readonly ok: false; readonly errors: readonly AIValidationError[] };

export function buildAIReviewContext(input: AIContextBuildInput): AIContextBuildResult {
  if (input.analysis.source.id !== input.source.id || input.analysis.source.hash !== input.source.hash) {
    return failure('source', 'source-identity', 'AnalysisResult does not belong to the supplied source');
  }
  const findingErrors = validateStaticFindings(input.findings, input.source);
  if (findingErrors.length > 0) return { ok: false, errors: findingErrors };

  const selection = selectTarget(input);
  if (!selection.ok) return selection;
  const { range: targetRange, targetFunction, kind } = selection;
  const rangeError = validateRange(targetRange, input.source.content, 'target.range');
  if (rangeError) return { ok: false, errors: [rangeError] };

  let budget: AITokenBudget;
  try {
    budget = resolveTokenBudget(input.budget);
  } catch (error) {
    return failure('budget', 'range', error instanceof Error ? error.message : String(error));
  }

  const omissions: AIContextOmission[] = [];
  const limit = effectiveContextCharacterLimit(budget);
  const initialEnd = Math.min(targetRange.end.offset, targetRange.start.offset + limit);
  let snippetStart = targetRange.start.offset;
  let snippetEnd = initialEnd;
  let remaining = Math.max(0, limit - (snippetEnd - snippetStart));
  const evidence: AIContextEvidence[] = [{
    id: 'source:target',
    kind: 'source-snippet',
    provenance: 'source',
    message: 'Target source selected by the local context builder.',
    range: targetRange,
  }];

  const targetFindings = [...input.findings]
    .filter((finding) => rangesOverlap(finding.range, targetRange))
    .sort(compareFindings);
  const relevantFindings = targetFindings
    .filter((finding) => (
      finding.range.start.offset >= snippetStart
      && finding.range.end.offset <= initialEnd
    ));
  if (relevantFindings.length < targetFindings.length) {
    omissions.push({
      kind: 'finding',
      count: targetFindings.length - relevantFindings.length,
      reason: 'character-budget',
    });
  }
  let selectedFindingCount = 0;
  for (const finding of relevantFindings) {
    if (selectedFindingCount >= budget.maxFindingsPerRequest) break;
    const message = `${finding.ruleId} [${finding.severity}]: ${finding.message}`;
    if (message.length > remaining) break;
    evidence.push({
      id: `static:${finding.fingerprint}`,
      kind: 'static-finding',
      provenance: 'static-analyzer',
      message,
      range: finding.range,
    });
    remaining -= message.length;
    selectedFindingCount += 1;
  }
  if (selectedFindingCount < relevantFindings.length) {
    omissions.push({
      kind: 'finding',
      count: relevantFindings.length - selectedFindingCount,
      reason: selectedFindingCount >= budget.maxFindingsPerRequest ? 'item-limit' : 'character-budget',
    });
  }

  let selectedDiagnosticCount = 0;
  for (const [index, diagnostic] of input.analysis.issues.entries()) {
    if (!offsetWithin(diagnostic.start.offset, targetRange)) continue;
    if (diagnostic.message.length > remaining) break;
    const range = { start: diagnostic.start, end: diagnostic.start };
    evidence.push({
      id: `diagnostic:${diagnostic.start.offset}:${index}`,
      kind: 'parser-diagnostic',
      provenance: 'parser',
      message: diagnostic.message,
      range,
    });
    remaining -= diagnostic.message.length;
    selectedDiagnosticCount += 1;
  }
  const relevantDiagnosticCount = input.analysis.issues
    .filter(({ start }) => offsetWithin(start.offset, targetRange)).length;
  if (selectedDiagnosticCount < relevantDiagnosticCount) {
    omissions.push({
      kind: 'diagnostic',
      count: relevantDiagnosticCount - selectedDiagnosticCount,
      reason: 'character-budget',
    });
  }

  if (initialEnd === targetRange.end.offset && remaining > 0) {
    const expanded = expandRange(
      input.source.content.length,
      snippetStart,
      snippetEnd,
      remaining,
    );
    snippetStart = expanded.start;
    snippetEnd = expanded.end;
  }
  const omittedSourceCharacters = snippetStart + (input.source.content.length - snippetEnd);
  if (omittedSourceCharacters > 0) {
    omissions.push({
      kind: 'source',
      count: omittedSourceCharacters,
      reason: 'character-budget',
    });
  }

  const snippetRange = rangeFromOffsets(input.source.content, snippetStart, snippetEnd);
  evidence[0] = { ...evidence[0], range: snippetRange };
  const functions = selectFunctions(
    input.analysis.functions,
    targetFunction,
    snippetRange,
    budget.maxFunctionsPerRequest,
  );
  const overlappingFunctionCount = input.analysis.functions
    .filter((fn) => rangesOverlap(functionRange(fn), snippetRange)).length;
  if (functions.length < overlappingFunctionCount) {
    omissions.push({
      kind: 'function',
      count: overlappingFunctionCount - functions.length,
      reason: 'item-limit',
    });
  }

  const text = input.source.content.slice(snippetStart, snippetEnd);
  const contextCharacters = text.length
    + evidence
      .filter(({ kind: evidenceKind }) => evidenceKind !== 'source-snippet')
      .reduce((total, item) => total + item.message.length, 0);
  return {
    ok: true,
    context: {
      source: {
        id: input.source.id,
        hash: input.source.hash,
        filePath: input.source.filePath,
      },
      target: {
        kind,
        ...(targetFunction ? { functionName: targetFunction.name } : {}),
        range: targetRange,
      },
      snippet: {
        text,
        range: snippetRange,
        targetRange,
        truncatedStart: snippetStart > 0,
        truncatedEnd: snippetEnd < input.source.content.length,
        trust: 'untrusted-source',
      },
      functions,
      evidence,
      parserLimitations: [
        'Parser acceptance does not establish Service Manager runtime compatibility.',
        ...(input.analysis.issues.length > 0
          ? ['Recovered AST entries near syntax errors may be semantically unreliable.']
          : []),
      ],
      omissions,
      estimatedUsage: {
        contextContentCharacters: contextCharacters,
        estimatedContextTokens: estimateInputTokens(contextCharacters, budget),
        reservedOutputTokens: budget.reservedOutputTokenBudget,
        estimation: 'character-approximation',
      },
      sourceHandling: {
        trust: 'untrusted-data',
        instructionPolicy: 'never-follow-source-instructions',
      },
    },
  };
}

type TargetSelection =
  | {
    readonly ok: true;
    readonly range: SourceRange;
    readonly targetFunction?: FunctionInfo;
    readonly kind: AIReviewContext['target']['kind'];
  }
  | { readonly ok: false; readonly errors: readonly AIValidationError[] };

function selectTarget(input: AIContextBuildInput): TargetSelection {
  if (input.target?.functionName) {
    const fn = input.analysis.functions.find(({ name }) => name === input.target!.functionName);
    if (!fn) return failure('target.functionName', 'missing', 'Target function was not found');
    return { ok: true, range: functionRange(fn), targetFunction: fn, kind: 'function' };
  }
  if (input.target?.range) {
    const fn = [...input.analysis.functions]
      .filter((candidate) => containsRange(functionRange(candidate), input.target!.range!))
      .sort((left, right) => (
        (left.end.offset - left.start.offset) - (right.end.offset - right.start.offset)
      ))[0];
    return {
      ok: true,
      range: input.target.range,
      ...(fn ? { targetFunction: fn } : {}),
      kind: fn ? 'function' : 'range',
    };
  }
  const firstFunction = input.analysis.functions[0];
  if (firstFunction) {
    return {
      ok: true,
      range: functionRange(firstFunction),
      targetFunction: firstFunction,
      kind: 'function',
    };
  }
  return {
    ok: true,
    range: rangeFromOffsets(input.source.content, 0, input.source.content.length),
    kind: 'source',
  };
}

function selectFunctions(
  functions: readonly FunctionInfo[],
  target: FunctionInfo | undefined,
  snippetRange: SourceRange,
  limit: number,
): AIContextFunction[] {
  const selected = [...functions]
    .filter((fn) => rangesOverlap(functionRange(fn), snippetRange))
    .sort((left, right) => (
      Number(right === target) - Number(left === target)
      || left.start.offset - right.start.offset
      || left.name.localeCompare(right.name)
    ))
    .slice(0, limit);
  return selected.map((fn) => ({
    name: fn.name,
    kind: fn.kind,
    range: functionRange(fn),
    isTarget: fn === target,
  }));
}

function validateStaticFindings(
  findings: readonly Finding[],
  source: SourceDocument,
): AIValidationError[] {
  const errors: AIValidationError[] = [];
  for (const [index, finding] of findings.entries()) {
    if (finding.sourceId !== source.id) {
      errors.push({
        path: `findings[${index}].sourceId`,
        code: 'source-identity',
        message: 'Static finding does not belong to the supplied source',
      });
    }
    const rangeError = validateRange(
      finding.range,
      source.content,
      `findings[${index}].range`,
    );
    if (rangeError) errors.push(rangeError);
  }
  return errors;
}

function validateRange(
  range: SourceRange,
  source: string,
  path: string,
): AIValidationError | undefined {
  if (
    range.start.offset < 0
    || range.end.offset < range.start.offset
    || range.end.offset > source.length
  ) {
    return {
      path,
      code: 'range',
      message: 'Target offsets must be ordered and inside the supplied source',
    };
  }
  const expected = rangeFromOffsets(source, range.start.offset, range.end.offset);
  if (!sameLocation(range.start, expected.start) || !sameLocation(range.end, expected.end)) {
    return {
      path,
      code: 'range',
      message: 'Target line and column values do not match its UTF-16 offsets',
    };
  }
  return undefined;
}

function expandRange(
  sourceLength: number,
  start: number,
  end: number,
  available: number,
): { start: number; end: number } {
  const before = Math.min(start, Math.floor(available / 2));
  const after = Math.min(sourceLength - end, available - before);
  const unused = available - before - after;
  const extraBefore = Math.min(start - before, unused);
  return { start: start - before - extraBefore, end: end + after };
}

function rangeFromOffsets(source: string, start: number, end: number): SourceRange {
  return { start: locationAt(source, start), end: locationAt(source, end) };
}

function locationAt(source: string, offset: number): SourceLocation {
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: offset - lineStart + 1, offset };
}

function functionRange(fn: FunctionInfo): SourceRange {
  return { start: fn.start, end: fn.end };
}

function compareFindings(left: Finding, right: Finding): number {
  return left.range.start.offset - right.range.start.offset
    || left.range.end.offset - right.range.end.offset
    || left.ruleId.localeCompare(right.ruleId)
    || left.fingerprint.localeCompare(right.fingerprint);
}

function rangesOverlap(left: SourceRange, right: SourceRange): boolean {
  return left.start.offset < right.end.offset && right.start.offset < left.end.offset;
}

function containsRange(outer: SourceRange, inner: SourceRange): boolean {
  return outer.start.offset <= inner.start.offset && outer.end.offset >= inner.end.offset;
}

function offsetWithin(offset: number, range: SourceRange): boolean {
  return offset >= range.start.offset && offset <= range.end.offset;
}

function sameLocation(left: SourceLocation, right: SourceLocation): boolean {
  return left.offset === right.offset && left.line === right.line && left.column === right.column;
}

function failure(
  path: string,
  code: AIValidationError['code'],
  message: string,
): { readonly ok: false; readonly errors: readonly AIValidationError[] } {
  return { ok: false, errors: [{ path, code, message }] };
}
