import { createHash } from 'node:crypto';
import { relative, resolve } from 'node:path';
import { reviewTarget } from '../reviewer/batch';
import type { Finding, RuleClassification, RuleSetConfig } from '../rules/types';

export const UAT_BASELINE_SCHEMA_VERSION = '1.0.0';

export type UatFindingClassification = 'TRUE_POSITIVE' | 'FALSE_POSITIVE' | 'NEEDS_VERIFICATION';

export interface UatClassificationEntry {
  /** Per-file stable finding identity; prevents cross-file fingerprint collisions. */
  readonly identity: string;
  readonly fingerprint: string;
  readonly classification: UatFindingClassification;
  readonly note?: string;
}

export interface UatManifest {
  readonly schemaVersion: typeof UAT_BASELINE_SCHEMA_VERSION;
  /** Declaring a corpus complete is an owner assertion, never inferred. */
  readonly corpusComplete?: boolean;
  readonly classifications: readonly UatClassificationEntry[];
}

export interface UatBaselineOptions {
  readonly manifest?: UatManifest;
  readonly config?: RuleSetConfig;
  readonly excludedPatterns?: readonly string[];
  readonly generatedAt?: string;
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
  readonly targetPath: string;
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
  const batch = await reviewTarget(targetPath, {
    config: options.config,
    excludedPatterns: options.excludedPatterns,
  });
  const manifest = options.manifest ?? emptyManifest();
  validateManifest(manifest);
  const labels = new Map(manifest.classifications.map((entry) => [entry.identity, entry]));
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
    const label = labels.get(identity);
    return {
      ...finding,
      filePath: file.filePath,
      relativeFilePath,
      identity,
      ...(label ? { uatClassification: label.classification } : {}),
      ...(label?.note ? { classificationNote: label.note } : {}),
    };
  })).sort(compareFinding);
  const matchedIdentities = new Set(findings.map(({ identity }) => identity));
  const unmatchedClassifications = manifest.classifications
    .filter(({ identity }) => !matchedIdentities.has(identity))
    .sort((left, right) => left.identity.localeCompare(right.identity));
  const coverage = calculateCoverage(batch, manifest);
  const count = (value: UatFindingClassification) => findings.filter((finding) => finding.uatClassification === value).length;
  return {
    schemaVersion: UAT_BASELINE_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    targetPath,
    files,
    findings,
    unclassifiedFindings: findings.filter(({ uatClassification }) => !uatClassification).map(({ identity }) => identity),
    unmatchedClassifications,
    coverage,
    summary: {
      files: files.length,
      findings: findings.length,
      deterministicFindings: findings.filter(({ classification }) => classification === 'deterministic').length,
      heuristicFindings: findings.filter(({ classification }) => classification === 'heuristic').length,
      truePositives: count('TRUE_POSITIVE'),
      falsePositives: count('FALSE_POSITIVE'),
      needsVerification: count('NEEDS_VERIFICATION'),
      unclassified: findings.filter(({ uatClassification }) => !uatClassification).length,
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
    schemaVersion: UAT_BASELINE_SCHEMA_VERSION,
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
  return { schemaVersion: UAT_BASELINE_SCHEMA_VERSION, classifications: [] };
}

function validateManifest(manifest: UatManifest): void {
  if (manifest.schemaVersion !== UAT_BASELINE_SCHEMA_VERSION) {
    throw new Error(`Unsupported UAT manifest schema: ${manifest.schemaVersion}`);
  }
  const seen = new Set<string>();
  for (const entry of manifest.classifications) {
    if (!entry.identity || !entry.fingerprint || seen.has(entry.identity)) throw new Error('UAT manifest has duplicate or empty identity');
    seen.add(entry.identity);
  }
}

function calculateCoverage(
  batch: Awaited<ReturnType<typeof reviewTarget>>,
  manifest: UatManifest,
): UatCoverage {
  const filesWithParseDiagnostics = batch.files.filter((file) => file.result.analysis.issues.length > 0).length;
  const filesWithSyntaxGatedRules = batch.files.filter((file) => (
    file.result.skippedRules.some(({ reason }) => reason === 'syntax-errors')
  )).length;
  const reasons: string[] = [];
  if (!manifest.corpusComplete) reasons.push('Corpus completeness was not declared by the owner.');
  if (batch.skippedFileCount > 0) reasons.push('Unsupported or excluded files were skipped.');
  if (batch.failures.length > 0) reasons.push('Some files could not be reviewed.');
  if (filesWithParseDiagnostics > 0) reasons.push('Some files have parse diagnostics.');
  if (filesWithSyntaxGatedRules > 0) reasons.push('Valid-only rules were skipped for syntax-invalid files.');
  return {
    status: reasons.length === 0 ? 'complete' : 'incomplete',
    corpusDeclaredComplete: manifest.corpusComplete === true,
    unsupportedFileCount: batch.skippedFileCount,
    fileFailureCount: batch.failures.length,
    filesWithParseDiagnostics,
    filesWithSyntaxGatedRules,
    reasons,
  };
}

function relativePath(targetPath: string, filePath: string): string {
  const value = relative(targetPath, filePath).replaceAll('\\', '/');
  return value || filePath.replaceAll('\\', '/');
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
