import * as vscode from 'vscode';
import { createBuiltinRuleRegistry } from '../../src/rules/builtin';
import type { FindingEvidence } from '../../src/rules/types';
import {
  isSupportedDocument,
  reviewInMemoryDocument,
  type EditorRange,
  type InMemoryReviewResult,
  type ReviewDiagnosticData,
  toEditorRange,
} from './review-adapter';
import { ReviewLifecycle, shouldReviewOnSave } from './review-lifecycle';

const DIAGNOSTIC_SOURCE = 'SM Reviewer';
const ruleRegistry = createBuiltinRuleRegistry();

export function activate(context: vscode.ExtensionContext): void {
  const controller = new ExtensionReviewController(vscode);
  context.subscriptions.push(
    controller.collection,
    vscode.commands.registerCommand('smReviewer.reviewCurrentFile', () => controller.reviewActiveDocument()),
    vscode.languages.registerHoverProvider([{ language: 'javascript' }, { pattern: '**/*.txt' }], controller),
    vscode.workspace.onDidSaveTextDocument((document) => void controller.reviewOnSave(document)),
    vscode.workspace.onDidCloseTextDocument((document) => controller.clear(document.uri)),
    vscode.workspace.onDidChangeConfiguration((event) => controller.handleConfigurationChange(event)),
  );
}

export function deactivate(): void {}

class ExtensionReviewController implements vscode.HoverProvider {
  readonly collection: vscode.DiagnosticCollection;
  readonly #lifecycle = new ReviewLifecycle();
  readonly #presentations = new Map<string, readonly ReviewDiagnosticData[]>();

  constructor(private readonly api: typeof vscode) {
    this.collection = api.languages.createDiagnosticCollection('smReviewer');
  }

  async reviewActiveDocument(): Promise<void> {
    const document = this.api.window.activeTextEditor?.document;
    if (!document) {
      void this.api.window.showInformationMessage('SM Reviewer: no active document to review.');
      return;
    }
    await this.reviewDocument(document, true);
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
  }

  handleConfigurationChange(event: vscode.ConfigurationChangeEvent): void {
    if (!event.affectsConfiguration('smReviewer.enableDiagnostics')) return;
    if (!this.setting<boolean>('enableDiagnostics')) {
      this.#lifecycle.clearAll();
      this.#presentations.clear();
      this.collection.clear();
    }
  }

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const entries = this.#presentations.get(document.uri.toString()) ?? [];
    const entry = entries.find(({ range }) => contains(range, position));
    if (!entry) return undefined;
    const markdown = new this.api.MarkdownString();
    const metadata = ruleRegistry.get(entry.code)?.metadata;
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
    const reviewed = await Promise.resolve().then(() => reviewInMemoryDocument(input));
    if (!this.#lifecycle.isCurrent(token, document.version)) return;
    if (!reviewed.supported) {
      this.clear(document.uri);
      if (manual) void this.api.window.showInformationMessage(`SM Reviewer: ${reviewed.reason}`);
      return;
    }
    this.publish(document.uri, reviewed);
    if (manual) {
      void this.api.window.showInformationMessage(
        `SM Reviewer: ${reviewed.diagnostics.length} diagnostic(s) found.`,
      );
    }
  }

  private publish(uri: vscode.Uri, reviewed: Extract<InMemoryReviewResult, { supported: true }>): void {
    if (!this.setting<boolean>('enableDiagnostics')) {
      this.clear(uri);
      return;
    }
    this.#presentations.set(uri.toString(), reviewed.diagnostics);
    this.collection.set(uri, reviewed.diagnostics.map((item) => toVsCodeDiagnostic(this.api, uri, item)));
  }

  private setting<T>(name: string): T {
    return this.api.workspace.getConfiguration('smReviewer').get<T>(name) as T;
  }
}

function toVsCodeDiagnostic(
  api: typeof vscode,
  uri: vscode.Uri,
  item: ReviewDiagnosticData,
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
  diagnostic.source = DIAGNOSTIC_SOURCE;
  diagnostic.relatedInformation = item.evidence.map((evidence) => new api.DiagnosticRelatedInformation(
    new api.Location(uri, toVsCodeRange(api, toEditorEvidenceRange(evidence))),
    evidence.message,
  ));
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
