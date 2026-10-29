import * as vscode from 'vscode';
import { OpenAICompatibleProvider } from '../../src/ai/openai-compatible-provider';
import { createBuiltinRuleRegistry } from '../../src/rules/builtin';
import type { FindingEvidence } from '../../src/rules/types';
import { isReviewPreset, resolveReviewPreset } from '../../src/reviewer/presets';
import { reviewAIInMemoryDocument, type AIReviewDiagnosticData } from './ai-review-adapter';
import {
  isSupportedDocument,
  reviewInMemoryDocument,
  type EditorRange,
  type InMemoryReviewResult,
  type ReviewDiagnosticData,
  toEditorRange,
  toReviewDiagnostics,
} from './review-adapter';
import { ReviewLifecycle, shouldReviewOnSave } from './review-lifecycle';
import { reviewFolder } from './folder-review-adapter';
import { analyzeDependencyFolder, resolveDependencyReferencePath } from './dependency-adapter';
import { calculateImpact } from '../../src/dependencies/graph';
import { renderDependencyText, type DependencyReport } from '../../src/dependencies/report';
import type { DependencyAnalysisConfig, DependencyAnalysisResult, ResolvedDependencyReference } from '../../src/dependencies/types';
import { TOOL_VERSION } from '../../src/core/version';
import { localizeDiagnostic, localizeRuleMetadata, resolveLanguage } from './localization';

const DIAGNOSTIC_SOURCE = 'SM Reviewer';
const AI_DIAGNOSTIC_SOURCE = 'SM Reviewer AI';
const AI_API_KEY_SECRET = 'smReviewer.ai.apiKey';
const ruleRegistry = createBuiltinRuleRegistry();

export function activate(context: vscode.ExtensionContext): void {
  const controller = new ExtensionReviewController(vscode, context.secrets);
  context.subscriptions.push(
    controller.collection,
    controller.aiCollection,
    controller.folderCollection,
    controller.output,
    vscode.commands.registerCommand('smReviewer.reviewCurrentFile', () => controller.reviewActiveDocument()),
    vscode.commands.registerCommand('smReviewer.aiReviewCurrentFile', () => controller.aiReviewActiveDocument()),
    vscode.commands.registerCommand('smReviewer.setAiApiKey', () => controller.setAiApiKey()),
    vscode.commands.registerCommand('smReviewer.clearAiApiKey', () => controller.clearAiApiKey()),
    vscode.commands.registerCommand('smReviewer.reviewFolder', (uri?: vscode.Uri) => controller.reviewFolder(uri)),
    vscode.commands.registerCommand('smReviewer.clearFolderReviewResults', () => controller.clearFolderResults()),
    vscode.commands.registerCommand('smReviewer.analyzeDependencies', (uri?: vscode.Uri) => controller.analyzeDependencies(uri)),
    vscode.commands.registerCommand('smReviewer.showDirectDependencies', () => controller.showDependencies(false)),
    vscode.commands.registerCommand('smReviewer.showReverseDependencies', () => controller.showDependencies(true)),
    vscode.commands.registerCommand('smReviewer.showDependencyCycles', () => controller.showCycles()),
    vscode.commands.registerCommand('smReviewer.analyzeImpact', () => controller.analyzeImpact()),
    vscode.languages.registerHoverProvider([{ language: 'javascript' }, { pattern: '**/*.txt' }], controller),
    vscode.workspace.onDidChangeTextDocument((event) => controller.invalidateAIForEdit(event.document.uri)),
    vscode.workspace.onDidSaveTextDocument((document) => void controller.reviewOnSave(document)),
    vscode.workspace.onDidCloseTextDocument((document) => controller.clear(document.uri)),
    vscode.workspace.onDidChangeConfiguration((event) => controller.handleConfigurationChange(event)),
  );
}

export function deactivate(): void {}

class ExtensionReviewController implements vscode.HoverProvider {
  readonly collection: vscode.DiagnosticCollection;
  readonly aiCollection: vscode.DiagnosticCollection;
  readonly folderCollection: vscode.DiagnosticCollection;
  readonly output: vscode.OutputChannel;
  readonly #lifecycle = new ReviewLifecycle();
  readonly #aiLifecycle = new ReviewLifecycle();
  readonly #aiControllers = new Map<string, AbortController>();
  readonly #presentations = new Map<string, readonly ReviewDiagnosticData[]>();
  #folderGeneration = 0;
  #dependencyAnalysis: DependencyAnalysisResult | undefined;
  #dependencyRoot: string | undefined;

  constructor(
    private readonly api: typeof vscode,
    private readonly secrets: vscode.SecretStorage,
  ) {
    this.collection = api.languages.createDiagnosticCollection('smReviewer');
    this.aiCollection = api.languages.createDiagnosticCollection('smReviewerAI');
    this.folderCollection = api.languages.createDiagnosticCollection('smReviewerFolder');
    this.output = api.window.createOutputChannel('SM Reviewer AI');
  }

  async reviewActiveDocument(): Promise<void> {
    const document = this.api.window.activeTextEditor?.document;
    if (!document) {
      void this.api.window.showInformationMessage('SM Reviewer: no active document to review.');
      return;
    }
    await this.reviewDocument(document, true);
  }

  async reviewFolder(contextUri?: vscode.Uri): Promise<void> {
    const folder = contextUri ?? (await this.api.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Review Folder' }))?.[0];
    if (!folder) return;
    const maxFiles = this.setting<number>('folderReview.maxFiles');
    const excludedPatterns = this.setting<readonly string[]>('folderReview.exclude') ?? [];
    const generation = ++this.#folderGeneration;
    const snapshots = new Map<string, string>();
    for (const document of this.api.workspace.textDocuments) if (document.isDirty && isSupportedDocument({ fileName: document.fileName, languageId: document.languageId })) snapshots.set(document.fileName.toLowerCase(), document.getText());
    await this.api.window.withProgress({ location: this.api.ProgressLocation.Notification, title: 'SM Reviewer: reviewing folder', cancellable: true }, async (progress, token) => {
      const result = await reviewFolder(folder.fsPath, { maxFiles, excludedPatterns, config: this.reviewConfig(), openDocuments: snapshots, isCancellationRequested: () => token.isCancellationRequested, onProgress: (done, total) => progress.report({ increment: total ? 100 / total : 0, message: `${done}/${total}` }) });
      if (generation !== this.#folderGeneration || result.cancelled) return;
      this.folderCollection.clear();
      let findingCount = 0; let warnings = 0; let errors = 0;
      for (const file of result.files) {
        const uri = this.api.Uri.file(file.filePath); const diagnostics = toReviewDiagnostics(file.result).map((item) => this.localized(item));
        findingCount += diagnostics.length; warnings += diagnostics.filter(({ severity }) => severity === 'warning').length; errors += diagnostics.filter(({ severity }) => severity === 'error').length;
        this.folderCollection.set(uri, diagnostics.map((item) => toVsCodeDiagnostic(this.api, uri, item, 'SM Reviewer Folder')));
      }
      const incomplete = result.limited ? ' Incomplete: file limit reached.' : '';
      void this.api.window.showInformationMessage(`SM Reviewer [${this.reviewPreset()}]: folder review ${result.files.length} files, ${findingCount} findings, ${warnings} warnings, ${errors} errors, ${result.failures.length} failures, ${result.skippedFileCount} skipped.${incomplete}`);
    });
  }

  clearFolderResults(): void { this.#folderGeneration += 1; this.folderCollection.clear(); }

  async analyzeDependencies(contextUri?: vscode.Uri): Promise<void> {
    const folder = contextUri ?? (await this.api.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Analyze dependencies' }))?.[0];
    if (!folder) return;
    const snapshots = new Map<string, string>();
    for (const document of this.api.workspace.textDocuments) if (document.isDirty && isSupportedDocument({ fileName: document.fileName, languageId: document.languageId })) snapshots.set(document.fileName.toLowerCase(), document.getText());
    const result = await this.api.window.withProgress({ location: this.api.ProgressLocation.Notification, title: 'SM Reviewer: analyzing dependencies', cancellable: true }, async (progress, token) => analyzeDependencyFolder(folder.fsPath, {
      config: this.dependencyConfig(), maxFiles: this.setting<number>('folderReview.maxFiles'), openDocuments: snapshots,
      isCancellationRequested: () => token.isCancellationRequested,
      onProgress: (done, total) => progress.report({ increment: total ? 100 / total : 0, message: `${done}/${total}` }),
    }));
    if (result.cancelled) return;
    this.#dependencyAnalysis = result.analysis; this.#dependencyRoot = folder.fsPath;
    const report: DependencyReport = { schemaVersion: '1.0.0', generatedAt: new Date().toISOString(), toolVersion: TOOL_VERSION, analysis: result.analysis };
    this.output.appendLine(renderDependencyText(report)); this.output.show(true);
    void this.api.window.showInformationMessage(`SM Reviewer: dependencies ${result.analysis.graph.nodes.length} libraries, ${result.analysis.graph.edges.length} resolved references${result.limited ? ' (incomplete: file limit)' : ''}.`);
  }

  async showDependencies(reverse: boolean): Promise<void> {
    const active = this.api.window.activeTextEditor?.document;
    if (!active || !this.#dependencyAnalysis || !this.#dependencyRoot) { void this.api.window.showInformationMessage('SM Reviewer: run Analyze ScriptLibrary Dependencies first.'); return; }
    const filePath = active.fileName.replace(this.#dependencyRoot, '').replace(/^[/\\]/u, '').replaceAll('\\', '/');
    const node = this.#dependencyAnalysis.graph.nodes.find((item) => item.filePath === filePath);
    if (!node) { void this.api.window.showInformationMessage('SM Reviewer: active document is outside the analyzed dependency folder.'); return; }
    const edges = this.#dependencyAnalysis.graph.edges.filter((edge) => reverse ? edge.toNodeId === node.id : edge.fromNodeId === node.id);
    if (edges.length === 0) {
      void this.api.window.showInformationMessage(`SM Reviewer: ${reverse ? 'reverse' : 'direct'} dependencies for ${node.libraryName ?? node.filePath}: none.`);
      return;
    }
    const selected = await this.api.window.showQuickPick(edges.flatMap((edge) => edge.references.map((reference) => ({
      label: reverse ? edge.fromNodeId : edge.toNodeId,
      description: `${reference.sourceNodeId}:${reference.range.start.line}:${reference.range.start.column}`,
      reference,
    }))).sort((left, right) => `${left.label}\u0000${left.description}`.localeCompare(`${right.label}\u0000${right.description}`)), {
      placeHolder: `SM Reviewer: select a ${reverse ? 'dependent' : 'dependency'} reference to open`,
    });
    if (selected) await this.openDependencyReference(selected.reference);
  }

  showCycles(): void {
    if (!this.#dependencyAnalysis) { void this.api.window.showInformationMessage('SM Reviewer: run Analyze ScriptLibrary Dependencies first.'); return; }
    const cycles = this.#dependencyAnalysis.graph.cycles.map((cycle) => cycle.join(' -> '));
    void this.api.window.showInformationMessage(`SM Reviewer: dependency cycles: ${cycles.join('; ') || 'none'}.`);
  }

  async analyzeImpact(): Promise<void> {
    if (!this.#dependencyAnalysis) { void this.api.window.showInformationMessage('SM Reviewer: run Analyze ScriptLibrary Dependencies first.'); return; }
    const value = await this.api.window.showInputBox({ prompt: 'Changed ScriptLibrary names, comma-separated' });
    if (!value) return;
    const impact = calculateImpact(this.#dependencyAnalysis.graph, value.split(',').map((item) => item.trim()).filter(Boolean));
    void this.api.window.showInformationMessage(`SM Reviewer: impact direct=${impact.directDependents.join(',') || 'none'} indirect=${impact.indirectDependents.join(',') || 'none'}.`);
  }

  async aiReviewActiveDocument(): Promise<void> {
    const document = this.api.window.activeTextEditor?.document;
    if (!document) {
      void this.api.window.showInformationMessage('SM Reviewer AI: no active document to review.');
      return;
    }
    if (!isSupportedDocument({ fileName: document.fileName, languageId: document.languageId })) {
      void this.api.window.showInformationMessage(
        'SM Reviewer AI supports JavaScript (.js) and ScriptLibrary text (.txt) documents only.',
      );
      return;
    }
    if (!this.setting<boolean>('ai.enabled')) {
      void this.api.window.showInformationMessage(
        'SM Reviewer AI is disabled. Enable smReviewer.ai.enabled before requesting an AI review.',
      );
      return;
    }

    const apiKey = await this.secrets.get(AI_API_KEY_SECRET);
    if (!apiKey) {
      void this.api.window.showErrorMessage('SM Reviewer AI: no API key is stored. Run “SM Reviewer: Set AI API Key”.');
      return;
    }
    const endpoint = this.setting<string>('ai.endpoint');
    const modelId = this.setting<string>('ai.model');
    const timeoutMs = this.setting<number>('ai.timeoutMs');
    let provider: OpenAICompatibleProvider;
    let hostname: string;
    try {
      hostname = new URL(endpoint).hostname;
      provider = new OpenAICompatibleProvider({ endpoint, apiKey });
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('AI timeout must be positive');
    } catch {
      void this.api.window.showErrorMessage('SM Reviewer AI: endpoint, API key, or timeout configuration is invalid.');
      return;
    }

    const consent = await this.api.window.showWarningMessage(
      `SM Reviewer AI will send the current document source to ${hostname}. Source content leaves this machine.`,
      { modal: true },
      'Send source',
    );
    if (consent !== 'Send source') {
      this.reportAIStatus('AI review cancelled before source transmission.');
      return;
    }

    // Preserve deterministic static diagnostics even when the AI request fails.
    await this.reviewDocument(document, false);
    await this.reviewAIDocument(document, provider, modelId, timeoutMs);
  }

  async setAiApiKey(): Promise<void> {
    const value = await this.api.window.showInputBox({
      prompt: 'Store an API key in VS Code Secret Storage',
      password: true,
      ignoreFocusOut: true,
      validateInput: (candidate) => candidate.trim() ? undefined : 'An API key is required.',
    });
    if (value === undefined) return;
    await this.secrets.store(AI_API_KEY_SECRET, value.trim());
    void this.api.window.showInformationMessage('SM Reviewer AI: API key stored in VS Code Secret Storage.');
  }

  async clearAiApiKey(): Promise<void> {
    await this.secrets.delete(AI_API_KEY_SECRET);
    void this.api.window.showInformationMessage('SM Reviewer AI: stored API key cleared.');
  }

  async reviewOnSave(document: vscode.TextDocument): Promise<void> {
    if (!shouldReviewOnSave(
      this.setting<boolean>('enableOnSave'),
      isSupportedDocument({ fileName: document.fileName, languageId: document.languageId }),
    )) return;
    await this.reviewDocument(document, false);
  }

  clear(uri: vscode.Uri): void {
    this.#lifecycle.clear(uri.toString());
    this.#presentations.delete(uri.toString());
    this.collection.delete(uri);
    this.folderCollection.delete(uri);
    this.clearAI(uri);
  }

  /** Editing makes both an in-flight response and published AI ranges stale. */
  invalidateAIForEdit(uri: vscode.Uri): void {
    this.clearAI(uri);
  }

  handleConfigurationChange(event: vscode.ConfigurationChangeEvent): void {
    const diagnosticsChanged = event.affectsConfiguration('smReviewer.enableDiagnostics');
    const aiEnabledChanged = event.affectsConfiguration('smReviewer.ai.enabled');
    if (!diagnosticsChanged && !aiEnabledChanged) return;
    if (diagnosticsChanged && !this.setting<boolean>('enableDiagnostics')) {
      this.#lifecycle.clearAll();
      this.#presentations.clear();
      this.collection.clear();
      this.clearAllAI();
      return;
    }
    if (aiEnabledChanged && !this.setting<boolean>('ai.enabled')) this.clearAllAI();
  }

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const entries = this.#presentations.get(document.uri.toString()) ?? [];
    const entry = entries.find(({ range }) => contains(range, position));
    if (!entry) return undefined;
    const markdown = new this.api.MarkdownString();
    const metadata = localizeRuleMetadata(ruleRegistry.get(entry.code)?.metadata, this.language());
    if (metadata) {
      markdown.appendMarkdown(`**${entry.code}: ${metadata.title}**\n\n${metadata.description}\n\n`);
    }
    markdown.appendMarkdown(`**${entry.code}** — ${entry.message}`);
    if (entry.suggestion) markdown.appendMarkdown(`\n\n**Suggestion:** ${entry.suggestion}`);
    appendEvidence(markdown, entry.evidence);
    return new this.api.Hover(markdown, toVsCodeRange(this.api, entry.range));
  }

  private async reviewDocument(document: vscode.TextDocument, manual: boolean): Promise<void> {
    const input = {
      uri: document.uri.toString(),
      fileName: document.fileName,
      languageId: document.languageId,
      text: document.getText(),
      version: document.version,
    };
    const key = input.uri;
    const token = this.#lifecycle.begin(key, input.version);
    const reviewed = await Promise.resolve().then(() => reviewInMemoryDocument(input, this.reviewConfig()));
    if (!this.#lifecycle.isCurrent(token, document.version)) return;
    if (!reviewed.supported) {
      this.clear(document.uri);
      if (manual) void this.api.window.showInformationMessage(`SM Reviewer: ${reviewed.reason}`);
      return;
    }
    this.publish(document.uri, reviewed);
    if (manual) {
      void this.api.window.showInformationMessage(
        `SM Reviewer [${this.reviewPreset()}]: ${reviewed.diagnostics.length} diagnostic(s) found.`,
      );
    }
  }

  private async reviewAIDocument(
    document: vscode.TextDocument,
    provider: OpenAICompatibleProvider,
    modelId: string,
    timeoutMs: number,
  ): Promise<void> {
    const input = {
      uri: document.uri.toString(),
      fileName: document.fileName,
      languageId: document.languageId,
      text: document.getText(),
      version: document.version,
    };
    const key = input.uri;
    this.clearAI(document.uri);
    const token = this.#aiLifecycle.begin(key, input.version);
    const controller = new AbortController();
    this.#aiControllers.set(key, controller);
    this.reportAIStatus('AI review started; source transmission was explicitly approved.');
    let reviewed;
    try {
      reviewed = await reviewAIInMemoryDocument(input, {
        enabled: true,
        allowSourceTransmission: true,
        provider,
        modelId,
        timeoutMs,
        signal: controller.signal,
      });
    } catch {
      if (this.#aiLifecycle.isCurrent(token, document.version)) {
        this.#aiControllers.delete(key);
        this.reportAIStatus('AI review failed unexpectedly; static diagnostics were preserved.');
        void this.api.window.showWarningMessage('SM Reviewer AI: review failed. Static diagnostics were preserved.');
      }
      return;
    }
    if (!this.#aiLifecycle.isCurrent(token, document.version)) return;
    this.#aiControllers.delete(key);
    if (!reviewed.supported) return;
    if (reviewed.ai.errors.length > 0) {
      this.reportAIStatus(`AI review failed: ${reviewed.ai.errors.map(({ category }) => category).join(', ')}.`);
      void this.api.window.showWarningMessage('SM Reviewer AI: review did not complete. Static diagnostics were preserved.');
      return;
    }
    if (this.setting<boolean>('enableDiagnostics') && this.setting<boolean>('ai.enabled')) {
      this.aiCollection.set(document.uri, reviewed.diagnostics.map((item) => toVsCodeAIDiagnostic(this.api, document.uri, item)));
    }
    const coverage = reviewed.ai.coverage[0];
    this.reportAIStatus(
      `AI review complete: ${reviewed.diagnostics.length} finding(s); coverage ${coverage?.status ?? 'not-run'} `
      + `(${coverage?.selectedForAIReview ?? 0}/${coverage?.totalIndexedFunctions ?? 0} function(s) selected).`,
    );
    void this.api.window.showInformationMessage(`SM Reviewer AI: ${reviewed.diagnostics.length} model-generated diagnostic(s).`);
  }

  private publish(uri: vscode.Uri, reviewed: Extract<InMemoryReviewResult, { supported: true }>): void {
    if (!this.setting<boolean>('enableDiagnostics')) {
      this.clear(uri);
      return;
    }
    const diagnostics = reviewed.diagnostics.map((item) => this.localized(item));
    this.#presentations.set(uri.toString(), diagnostics);
    this.folderCollection.delete(uri);
    this.collection.set(uri, diagnostics.map((item) => toVsCodeDiagnostic(this.api, uri, item)));
  }

  private clearAI(uri: vscode.Uri): void {
    const key = uri.toString();
    this.#aiLifecycle.clear(key);
    this.#aiControllers.get(key)?.abort('document-invalidated');
    this.#aiControllers.delete(key);
    this.aiCollection.delete(uri);
  }

  private clearAllAI(): void {
    this.#aiLifecycle.clearAll();
    for (const controller of this.#aiControllers.values()) controller.abort('diagnostics-disabled');
    this.#aiControllers.clear();
    this.aiCollection.clear();
  }

  private reportAIStatus(message: string): void {
    this.output.appendLine(`SM Reviewer AI: ${message}`);
  }

  private setting<T>(name: string): T {
    return this.api.workspace.getConfiguration('smReviewer').get<T>(name) as T;
  }

  private reviewConfig() {
    return resolveReviewPreset(this.reviewPreset());
  }

  private reviewPreset() {
    const configured = this.setting<string>('rulePreset');
    return isReviewPreset(configured) ? configured : 'v1-production';
  }

  private dependencyConfig(): DependencyAnalysisConfig {
    return this.setting<DependencyAnalysisConfig>('dependencies.config') ?? {};
  }

  private async openDependencyReference(reference: ResolvedDependencyReference): Promise<void> {
    if (!this.#dependencyRoot) return;
    const target = resolveDependencyReferencePath(this.#dependencyRoot, reference.sourceNodeId);
    if (!target) { void this.api.window.showErrorMessage('SM Reviewer: dependency reference is outside the analyzed corpus.'); return; }
    const document = await this.api.workspace.openTextDocument(this.api.Uri.file(target));
    const start = new this.api.Position(Math.max(0, reference.range.start.line - 1), Math.max(0, reference.range.start.column - 1));
    const end = new this.api.Position(Math.max(start.line, reference.range.end.line - 1), Math.max(0, reference.range.end.column - 1));
    const editor = await this.api.window.showTextDocument(document);
    editor.selection = new this.api.Selection(start, end);
    editor.revealRange(new this.api.Range(start, end));
  }

  private language() { return resolveLanguage(this.setting('language') as 'vi' | 'en' | 'auto', this.api.env.language); }
  private localized(item: ReviewDiagnosticData): ReviewDiagnosticData { return localizeDiagnostic(item, this.language()); }
}

function toVsCodeDiagnostic(
  api: typeof vscode,
  uri: vscode.Uri,
  item: ReviewDiagnosticData,
  source = DIAGNOSTIC_SOURCE,
): vscode.Diagnostic {
  const diagnostic = new api.Diagnostic(
    toVsCodeRange(api, item.range),
    item.message,
    item.severity === 'error'
      ? api.DiagnosticSeverity.Error
      : item.severity === 'warning'
        ? api.DiagnosticSeverity.Warning
        : api.DiagnosticSeverity.Information,
  );
  diagnostic.code = item.code;
  diagnostic.source = source;
  diagnostic.relatedInformation = item.evidence.map((evidence) => new api.DiagnosticRelatedInformation(
    new api.Location(uri, toVsCodeRange(api, toEditorEvidenceRange(evidence))),
    evidence.message,
  ));
  return diagnostic;
}

function toVsCodeAIDiagnostic(
  api: typeof vscode,
  uri: vscode.Uri,
  item: AIReviewDiagnosticData,
): vscode.Diagnostic {
  const diagnostic = new api.Diagnostic(
    toVsCodeRange(api, item.range),
    item.message,
    item.severity === 'error'
      ? api.DiagnosticSeverity.Error
      : item.severity === 'warning'
        ? api.DiagnosticSeverity.Warning
        : api.DiagnosticSeverity.Information,
  );
  diagnostic.code = item.code;
  diagnostic.source = AI_DIAGNOSTIC_SOURCE;
  diagnostic.relatedInformation = [
    new api.DiagnosticRelatedInformation(
      new api.Location(uri, toVsCodeRange(api, item.range)),
      `Validation: ${item.validationStatus}; suggestion: ${item.suggestion}`,
    ),
    ...item.evidenceReferences.map((reference) => new api.DiagnosticRelatedInformation(
      new api.Location(uri, toVsCodeRange(api, item.range)),
      `AI evidence reference: ${reference}`,
    )),
  ];
  return diagnostic;
}

function toEditorEvidenceRange(evidence: FindingEvidence): EditorRange {
  return toEditorRange(evidence.range);
}

function toVsCodeRange(api: typeof vscode, range: EditorRange): vscode.Range {
  const start = new api.Position(range.start.line, range.start.character);
  const end = new api.Position(range.end.line, range.end.character);
  return new api.Range(start, end);
}

function contains(range: EditorRange, position: vscode.Position): boolean {
  const start = range.start;
  const end = range.end;
  const afterStart = position.line > start.line
    || (position.line === start.line && position.character >= start.character);
  const isZeroLength = start.line === end.line && start.character === end.character;
  const beforeEnd = isZeroLength
    ? position.line === end.line && position.character === end.character
    : position.line < end.line
      || (position.line === end.line && position.character < end.character);
  return afterStart && beforeEnd;
}

function appendEvidence(markdown: vscode.MarkdownString, evidence: readonly FindingEvidence[]): void {
  if (evidence.length === 0) return;
  markdown.appendMarkdown('\n\n**Evidence:**');
  for (const item of evidence) markdown.appendMarkdown(`\n- ${item.message}`);
}
