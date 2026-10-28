import { createHash } from 'node:crypto';
import { relative, resolve } from 'node:path';
import { reviewTarget, type BatchReviewResult } from '../reviewer/batch';
import type { Finding, RuleClassification, RuleSetConfig } from '../rules/types';

export const UAT_MANIFEST_SCHEMA_VERSION = '1.0.0';
export const UAT_BASELINE_SCHEMA_VERSION = '1.1.0';
export const LEGACY_UAT_BASELINE_SCHEMA_VERSION = '1.0.0';

export type UatCorpusProfile = 'production' | 'full' | 'custom';

export type UatFindingClassification = 'TRUE_POSITIVE' | 'FALSE_POSITIVE' | 'NEEDS_VERIFICATION';

export interface UatClassificationEntry {
  /** Per-file stable finding identity; prevents cross-file fingerprint collisions. */
  readonly identity: string;
  readonly fingerprint: string;
  readonly classification: UatFindingClassification;
  readonly note?: string;
}

export interface UatManifest {
  readonly schemaVersion: typeof UAT_MANIFEST_SCHEMA_VERSION;
  /** Declaring a corpus complete is an owner assertion, never inferred. */
  readonly corpusComplete?: boolean;
  readonly classifications: readonly UatClassificationEntry[];
}

export interface UatBaselineOptions {
  readonly manifest?: UatManifest;
  readonly config?: RuleSetConfig;
  readonly excludedPatterns?: readonly string[];
  readonly generatedAt?: string;
  readonly profile?: UatCorpusProfile;
  /** Non-sensitive corpus root label supplied by the CLI/host. */
  readonly relativeCorpusRoot?: string;
  /** Internal host seam for deterministic UAT regression tests. */
  readonly reviewTarget?: typeof reviewTarget;
}

export interface UatFinding extends Finding {
  readonly filePath: string;
  readonly relativeFilePath: string;
  /** Stable only while the underlying finding fingerprint remains unchanged. */
  readonly identity: string;
  readonly uatClassification?: UatFindingClassification;
  readonly classificationNote?: string;
}

export interface UatCoverage {
  readonly status: 'complete' | 'incomplete';
  readonly corpus: {
    readonly status: 'complete' | 'incomplete';
    readonly reasons: readonly string[];
  };
  readonly execution: {
    readonly status: 'complete' | 'incomplete';
    readonly ruleErrorCount: number;
    readonly ruleErrors: readonly { readonly relativeFilePath: string; readonly ruleId: string; readonly message: string }[];
    readonly reasons: readonly string[];
  };
  /** Static review and local labels cannot establish SM runtime semantic coverage. */
  readonly semantic: {
    readonly status: 'not-established';
    readonly reasons: readonly string[];
  };
  readonly corpusDeclaredComplete: boolean;
  readonly unsupportedFileCount: number;
  readonly fileFailureCount: number;
  readonly filesWithParseDiagnostics: number;
  readonly filesWithSyntaxGatedRules: number;
  readonly reasons: readonly string[];
}

export interface UatBaselineReport {
  readonly schemaVersion: typeof UAT_BASELINE_SCHEMA_VERSION;
  readonly generatedAt: string;
  /** A shareable relative path; never an absolute local filesystem path. */
  readonly targetPath: string;
  readonly provenance: {
    readonly profile: UatCorpusProfile;
    readonly relativeCorpusRoot: string;
    readonly appliedExclusions: readonly string[];
    readonly reviewedFileCount: number;
    readonly skippedFileCount: number;
    /** Deterministic aggregate of relative path and per-file source hashes. */
    readonly sourceHash: string;
    readonly ruleConfigurationHash: string;
    /** Populated by npm when available; absent for direct Node invocation. */
    readonly toolVersion?: string;
    /** New project-specific groups included by production profile remain visible. */
    readonly includedUnknownDirectories: readonly string[];
  };
  readonly files: readonly {
    relativeFilePath: string;
    sourceHash: string;
    functionCount: number;
    parseDiagnosticCount: number;
    skippedRuleCount: number;
  }[];
  readonly findings: readonly UatFinding[];
  readonly unclassifiedFindings: readonly string[];
  readonly unmatchedClassifications: readonly UatClassificationEntry[];
  readonly coverage: UatCoverage;
  readonly summary: {
    readonly files: number;
    readonly findings: number;
    readonly deterministicFindings: number;
    readonly heuristicFindings: number;
    readonly truePositives: number;
    readonly falsePositives: number;
    readonly needsVerification: number;
    readonly unclassified: number;
  };
}

export interface UatBaselineComparison {
  readonly newFindings: readonly string[];
  readonly removedFindings: readonly string[];
  readonly persistentFindings: readonly string[];
  readonly changedSourceFiles: readonly string[];
  /** Prior labels not present in the current result are never called resolved. */
  readonly unmatchedPriorClassifications: readonly UatClassificationEntry[];
}

export async function createUatBaseline(
  target: string,
  options: UatBaselineOptions = {},
): Promise<UatBaselineReport> {
  const targetPath = resolve(target);
  const runTarget = options.reviewTarget ?? reviewTarget;
  const batch = await runTarget(targetPath, {
    config: options.config,
    excludedPatterns: options.excludedPatterns,
  });
  const manifest = options.manifest ?? emptyManifest();
  validateManifest(manifest);
  const files = batch.files.map((file) => ({
    relativeFilePath: relativePath(targetPath, file.filePath),
    sourceHash: file.result.analysis.source.hash,
    functionCount: file.result.analysis.functions.length,
    parseDiagnosticCount: file.result.analysis.issues.length,
    skippedRuleCount: file.result.skippedRules.length,
  })).sort((left, right) => left.relativeFilePath.localeCompare(right.relativeFilePath));
  const findings = batch.files.flatMap((file) => file.result.findings.map((finding) => {
    const relativeFilePath = relativePath(targetPath, file.filePath);
    const identity = findingIdentity(relativeFilePath, finding);
    return {
      ...finding,
      filePath: file.filePath,
      relativeFilePath,
      identity,
    };
  })).sort(compareFinding);
  validateManifestFindings(manifest, findings);
  const labels = new Map(manifest.classifications.map((entry) => [entry.identity, entry]));
  const classifiedFindings = findings.map((finding) => {
    const label = labels.get(finding.identity);
    return {
      ...finding,
      ...(label ? { uatClassification: label.classification } : {}),
      ...(label?.note ? { classificationNote: label.note } : {}),
    };
  });
  const matchedIdentities = new Set(classifiedFindings.map(({ identity }) => identity));
  const unmatchedClassifications = manifest.classifications
    .filter(({ identity }) => !matchedIdentities.has(identity))
    .sort((left, right) => left.identity.localeCompare(right.identity));
  const coverage = calculateCoverage(batch, manifest, targetPath);
  const relativeCorpusRoot = options.relativeCorpusRoot ?? shareablePath(targetPath);
  const appliedExclusions = [...(options.excludedPatterns ?? [])].sort();
  const count = (value: UatFindingClassification) => classifiedFindings.filter((finding) => finding.uatClassification === value).length;
  return {
    schemaVersion: UAT_BASELINE_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    targetPath: relativeCorpusRoot,
    provenance: {
      profile: options.profile ?? 'custom',
      relativeCorpusRoot,
      appliedExclusions,
      reviewedFileCount: files.length,
      skippedFileCount: batch.skippedFileCount,
      sourceHash: aggregateSourceHash(files),
      ruleConfigurationHash: hashValue(options.config ?? {}),
      ...(process.env.npm_package_version ? { toolVersion: process.env.npm_package_version } : {}),
      includedUnknownDirectories: unknownDirectories(files, options.profile ?? 'custom'),
    },
    files,
    findings: classifiedFindings,
    unclassifiedFindings: classifiedFindings.filter(({ uatClassification }) => !uatClassification).map(({ identity }) => identity),
    unmatchedClassifications,
    coverage,
    summary: {
      files: files.length,
      findings: classifiedFindings.length,
      deterministicFindings: classifiedFindings.filter(({ classification }) => classification === 'deterministic').length,
      heuristicFindings: classifiedFindings.filter(({ classification }) => classification === 'heuristic').length,
      truePositives: count('TRUE_POSITIVE'),
      falsePositives: count('FALSE_POSITIVE'),
      needsVerification: count('NEEDS_VERIFICATION'),
      unclassified: classifiedFindings.filter(({ uatClassification }) => !uatClassification).length,
    },
  };
}

export function compareUatBaselines(
  previous: UatBaselineReport,
  current: UatBaselineReport,
): UatBaselineComparison {
  const previousByIdentity = new Map(previous.findings.map((finding) => [finding.identity, finding]));
  const currentByIdentity = new Map(current.findings.map((finding) => [finding.identity, finding]));
  const previousFiles = new Map(previous.files.map((file) => [file.relativeFilePath, file.sourceHash]));
  const currentFiles = new Map(current.files.map((file) => [file.relativeFilePath, file.sourceHash]));
  const newFindings = [...currentByIdentity.keys()].filter((id) => !previousByIdentity.has(id)).sort();
  const removedFindings = [...previousByIdentity.keys()].filter((id) => !currentByIdentity.has(id)).sort();
  const persistentFindings = [...currentByIdentity.keys()].filter((id) => previousByIdentity.has(id)).sort();
  const fileNames = new Set([...previousFiles.keys(), ...currentFiles.keys()]);
  const changedSourceFiles = [...fileNames]
    .filter((path) => previousFiles.get(path) !== currentFiles.get(path))
    .sort();
  const currentIdentities = new Set(current.findings.map(({ identity }) => identity));
  const unmatchedPriorClassifications = previous.findings
    .filter(({ uatClassification, identity }) => uatClassification && !currentIdentities.has(identity))
    .map(({ identity, fingerprint, uatClassification, classificationNote }) => ({
      identity,
      fingerprint,
      classification: uatClassification!,
      ...(classificationNote ? { note: classificationNote } : {}),
    }))
    .sort((left, right) => left.identity.localeCompare(right.identity));
  return { newFindings, removedFindings, persistentFindings, changedSourceFiles, unmatchedPriorClassifications };
}

export function createManifestTemplate(report: UatBaselineReport): UatManifest {
  return {
    schemaVersion: UAT_MANIFEST_SCHEMA_VERSION,
    corpusComplete: false,
    classifications: report.findings.map(({ identity, fingerprint }) => ({
      identity,
      fingerprint,
      classification: 'NEEDS_VERIFICATION' as const,
    })),
  };
}

export function renderVietnameseSummary(report: UatBaselineReport): string {
  const coverage = report.coverage.status === 'complete' ? 'đầy đủ theo phạm vi quét' : 'chưa đầy đủ';
  return [
    'Tóm tắt UAT ScriptLibrary',
    `- File đã phân tích: ${report.summary.files}`,
    `- Findings: ${report.summary.findings} (deterministic: ${report.summary.deterministicFindings}, heuristic: ${report.summary.heuristicFindings})`,
    `- Phân loại: đúng=${report.summary.truePositives}, false positive=${report.summary.falsePositives}, cần xác minh=${report.summary.needsVerification}, chưa phân loại=${report.summary.unclassified}`,
    `- Coverage: ${coverage}; file không hỗ trợ=${report.coverage.unsupportedFileCount}, lỗi file=${report.coverage.fileFailureCount}, lỗi cú pháp=${report.coverage.filesWithParseDiagnostics}`,
    `- Nhãn cũ chưa khớp: ${report.unmatchedClassifications.length} (không tự coi là đã sửa).`,
  ].join('\n');
}

function emptyManifest(): UatManifest {
  return { schemaVersion: UAT_MANIFEST_SCHEMA_VERSION, classifications: [] };
}

function validateManifest(manifest: UatManifest): void {
  if (!isPlainObject(manifest) || manifest.schemaVersion !== UAT_MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Unsupported UAT manifest schema: ${String((manifest as { schemaVersion?: unknown })?.schemaVersion)}`);
  }
  if (manifest.corpusComplete !== undefined && typeof manifest.corpusComplete !== 'boolean') throw new Error('UAT manifest corpusComplete must be boolean');
  if (!Array.isArray(manifest.classifications)) throw new Error('UAT manifest classifications must be an array');
  const seen = new Set<string>();
  for (const entry of manifest.classifications) {
    if (!isPlainObject(entry) || typeof entry.identity !== 'string' || !entry.identity
      || typeof entry.fingerprint !== 'string' || !entry.fingerprint || seen.has(entry.identity)) {
      throw new Error('UAT manifest has duplicate or empty identity');
    }
    if (!isClassification(entry.classification)) throw new Error(`UAT manifest has invalid classification for ${entry.identity}`);
    if (entry.note !== undefined && typeof entry.note !== 'string') throw new Error(`UAT manifest note must be a string for ${entry.identity}`);
    seen.add(entry.identity);
  }
}

function validateManifestFindings(manifest: UatManifest, findings: readonly UatFinding[]): void {
  const fingerprintsByIdentity = new Map(findings.map((finding) => [finding.identity, finding.fingerprint]));
  for (const entry of manifest.classifications) {
    const currentFingerprint = fingerprintsByIdentity.get(entry.identity);
    // An absent identity is historical/unmatched and remains visible in the report.
    if (currentFingerprint !== undefined && currentFingerprint !== entry.fingerprint) {
      throw new Error(`UAT manifest fingerprint does not match current finding: ${entry.identity}`);
    }
  }
}

function calculateCoverage(
  batch: BatchReviewResult,
  manifest: UatManifest,
  targetPath: string,
): UatCoverage {
  const filesWithParseDiagnostics = batch.files.filter((file) => file.result.analysis.issues.length > 0).length;
  const filesWithSyntaxGatedRules = batch.files.filter((file) => (
    file.result.skippedRules.some(({ reason }) => reason === 'syntax-errors')
  )).length;
  const ruleErrors = batch.files.flatMap((file) => file.result.ruleErrors.map((error) => ({
    relativeFilePath: relativePath(targetPath, file.filePath), ruleId: error.ruleId, message: error.message,
  }))).sort((left, right) => left.relativeFilePath.localeCompare(right.relativeFilePath) || left.ruleId.localeCompare(right.ruleId));
  const corpusReasons: string[] = [];
  if (!manifest.corpusComplete) corpusReasons.push('Corpus completeness was not declared by the owner.');
  if (batch.skippedFileCount > 0) corpusReasons.push('Unsupported or excluded files were skipped.');
  const executionReasons: string[] = [];
  if (batch.failures.length > 0) executionReasons.push('Some files could not be reviewed.');
  if (filesWithParseDiagnostics > 0) executionReasons.push('Some files have parse diagnostics.');
  if (filesWithSyntaxGatedRules > 0) executionReasons.push('Valid-only rules were skipped for syntax-invalid files.');
  if (ruleErrors.length > 0) executionReasons.push('One or more rules failed during execution.');
  const semanticReasons = ['Static analysis and manual labels do not establish SM runtime semantic coverage.'];
  const corpus = { status: corpusReasons.length === 0 ? 'complete' as const : 'incomplete' as const, reasons: corpusReasons };
  const execution = {
    status: executionReasons.length === 0 ? 'complete' as const : 'incomplete' as const,
    ruleErrorCount: ruleErrors.length,
    ruleErrors,
    reasons: executionReasons,
  };
  const reasons = [...corpusReasons, ...executionReasons, ...semanticReasons];
  return {
    status: 'incomplete',
    corpus,
    execution,
    semantic: { status: 'not-established', reasons: semanticReasons },
    corpusDeclaredComplete: manifest.corpusComplete === true,
    unsupportedFileCount: batch.skippedFileCount,
    fileFailureCount: batch.failures.length,
    filesWithParseDiagnostics,
    filesWithSyntaxGatedRules,
    reasons,
  };
}

function isClassification(value: unknown): value is UatFindingClassification {
  return value === 'TRUE_POSITIVE' || value === 'FALSE_POSITIVE' || value === 'NEEDS_VERIFICATION';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function relativePath(targetPath: string, filePath: string): string {
  const value = relative(targetPath, filePath).replaceAll('\\', '/');
  return value || filePath.replaceAll('\\', '/');
}

function shareablePath(path: string): string {
  const value = relative(process.cwd(), path).replaceAll('\\', '/');
  return value || '.';
}

function aggregateSourceHash(files: readonly UatBaselineReport['files'][number][]): string {
  return createHash('sha256')
    .update(files.map((file) => `${file.relativeFilePath}\0${file.sourceHash}`).join('\n'))
    .digest('hex');
}

function hashValue(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function unknownDirectories(
  files: readonly UatBaselineReport['files'][number][],
  profile: UatCorpusProfile,
): readonly string[] {
  if (profile !== 'production') return [];
  const known = new Set(['ESD_CONFIG', 'ESD_CORE', 'ESD_FORM', 'ESD_SHARED']);
  return [...new Set(files
    .map(({ relativeFilePath }) => relativeFilePath.split('/')[0])
    .filter((directory) => directory && !known.has(directory)))]
    .sort();
}

function findingIdentity(relativeFilePath: string, finding: Finding): string {
  return createHash('sha256').update(`${relativeFilePath}\0${finding.ruleId}\0${finding.fingerprint}`).digest('hex');
}

function compareFinding(left: UatFinding, right: UatFinding): number {
  return left.relativeFilePath.localeCompare(right.relativeFilePath)
    || left.range.start.offset - right.range.start.offset
    || left.ruleId.localeCompare(right.ruleId)
    || left.fingerprint.localeCompare(right.fingerprint);
}
