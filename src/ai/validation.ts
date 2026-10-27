import type { SourceLocation } from '../core/types';
import type { SourceRange } from '../rules/types';
import type {
  AIAssertionKind,
  AIFinding,
  AIFindingCategory,
  AIFindingSeverity,
  AIReviewContext,
  AIValidationError,
  AIValidationResult,
  AIValidationStatus,
} from './types';

const CATEGORIES = new Set<AIFindingCategory>([
  'logic',
  'maintainability',
  'security',
  'sm-api',
  'error-handling',
  'performance',
  'other',
]);
const SEVERITIES = new Set<AIFindingSeverity>(['info', 'warning', 'error', 'critical']);
const ASSERTION_KINDS = new Set<AIAssertionKind>([
  'source-fact',
  'model-inference',
  'unknown',
]);
const VALIDATION_STATUSES = new Set<AIValidationStatus>([
  'unvalidated',
  'validated',
  'rejected',
]);

export function validateAIResponse(raw: unknown, context: AIReviewContext): AIValidationResult {
  if (!isRecord(raw) || !Array.isArray(raw.findings)) {
    return {
      findings: [],
      errors: [{ path: 'findings', code: 'type', message: 'Response findings must be an array' }],
    };
  }

  const findings: AIFinding[] = [];
  const errors: AIValidationError[] = [];
  for (const [index, candidate] of raw.findings.entries()) {
    const result = validateFinding(candidate, context, `findings[${index}]`);
    errors.push(...result.errors);
    if (result.finding) findings.push(result.finding);
  }
  return { findings, errors };
}

function validateFinding(
  raw: unknown,
  context: AIReviewContext,
  path: string,
): { finding?: AIFinding; errors: AIValidationError[] } {
  if (!isRecord(raw)) {
    return { errors: [{ path, code: 'type', message: 'Finding must be an object' }] };
  }
  const errors: AIValidationError[] = [];
  const stringFields = [
    'id',
    'sourceId',
    'sourceHash',
    'message',
    'explanation',
    'suggestion',
  ] as const;
  for (const field of stringFields) {
    if (typeof raw[field] !== 'string' || raw[field].length === 0) {
      errors.push({ path: `${path}.${field}`, code: 'type', message: `${field} must be a non-empty string` });
    }
  }

  if (raw.sourceId !== context.source.id || raw.sourceHash !== context.source.hash) {
    errors.push({
      path: `${path}.sourceId`,
      code: 'source-identity',
      message: 'Finding source identity does not match the supplied context',
    });
  }
  validateEnum(raw.category, CATEGORIES, `${path}.category`, errors);
  validateEnum(raw.severity, SEVERITIES, `${path}.severity`, errors);
  validateEnum(raw.assertionKind, ASSERTION_KINDS, `${path}.assertionKind`, errors);
  validateEnum(raw.validationStatus, VALIDATION_STATUSES, `${path}.validationStatus`, errors);

  if (typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence)
    || raw.confidence < 0 || raw.confidence > 1) {
    errors.push({
      path: `${path}.confidence`,
      code: 'range',
      message: 'confidence must be a finite number between 0 and 1',
    });
  }

  const range = parseRange(raw.range, `${path}.range`, errors);
  if (range && (
    range.start.offset < context.snippet.range.start.offset
    || range.end.offset > context.snippet.range.end.offset
  )) {
    errors.push({
      path: `${path}.range`,
      code: 'range',
      message: 'Finding range is outside the supplied source snippet',
    });
  } else if (range && (
    !locationMatchesSnippet(range.start, context)
    || !locationMatchesSnippet(range.end, context)
  )) {
    errors.push({
      path: `${path}.range`,
      code: 'range',
      message: 'Finding line and column values do not match supplied snippet offsets',
    });
  }

  const evidenceIds = new Set(context.evidence.map(({ id }) => id));
  if (!Array.isArray(raw.evidenceReferences)
    || raw.evidenceReferences.length === 0
    || raw.evidenceReferences.some((value) => typeof value !== 'string')) {
    errors.push({
      path: `${path}.evidenceReferences`,
      code: 'type',
      message: 'evidenceReferences must be a non-empty array of strings',
    });
  } else {
    for (const [referenceIndex, reference] of raw.evidenceReferences.entries()) {
      if (!evidenceIds.has(reference)) {
        errors.push({
          path: `${path}.evidenceReferences[${referenceIndex}]`,
          code: 'evidence-reference',
          message: `Unknown evidence reference: ${reference}`,
        });
      }
    }
  }

  if (!isRecord(raw.model)
    || typeof raw.model.providerId !== 'string'
    || typeof raw.model.modelId !== 'string'
    || raw.model.providerId.length === 0
    || raw.model.modelId.length === 0) {
    errors.push({
      path: `${path}.model`,
      code: 'type',
      message: 'model must contain non-empty providerId and modelId strings',
    });
  }

  return errors.length === 0
    ? {
      finding: {
        ...(raw as unknown as AIFinding),
        validationStatus: 'validated',
      },
      errors,
    }
    : { errors };
}

function parseRange(
  raw: unknown,
  path: string,
  errors: AIValidationError[],
): SourceRange | undefined {
  if (!isRecord(raw)) {
    errors.push({ path, code: 'type', message: 'range must be an object' });
    return undefined;
  }
  const start = parseLocation(raw.start, `${path}.start`, errors);
  const end = parseLocation(raw.end, `${path}.end`, errors);
  if (!start || !end) return undefined;
  if (end.offset < start.offset) {
    errors.push({ path, code: 'range', message: 'range end must not precede its start' });
    return undefined;
  }
  return { start, end };
}

function parseLocation(
  raw: unknown,
  path: string,
  errors: AIValidationError[],
): SourceLocation | undefined {
  if (!isRecord(raw)
    || !isNonNegativeInteger(raw.offset)
    || !isPositiveInteger(raw.line)
    || !isPositiveInteger(raw.column)) {
    errors.push({
      path,
      code: 'type',
      message: 'location requires non-negative offset and positive line/column integers',
    });
    return undefined;
  }
  return { offset: raw.offset, line: raw.line, column: raw.column };
}

function validateEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  path: string,
  errors: AIValidationError[],
): void {
  if (typeof value !== 'string' || !allowed.has(value as T)) {
    errors.push({ path, code: 'enum', message: `Unsupported value: ${String(value)}` });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function locationMatchesSnippet(location: SourceLocation, context: AIReviewContext): boolean {
  const relativeOffset = location.offset - context.snippet.range.start.offset;
  if (relativeOffset < 0 || relativeOffset > context.snippet.text.length) return false;
  let line = context.snippet.range.start.line;
  let column = context.snippet.range.start.column;
  for (let index = 0; index < relativeOffset; index += 1) {
    if (context.snippet.text.charCodeAt(index) === 10) {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return location.line === line && location.column === column;
}
