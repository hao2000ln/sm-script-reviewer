# SM ScriptLibrary Reviewer VS Code Extension

Read-only static review for OpenText/HPE Service Manager ScriptLibrary source.
The extension reuses the repository parser and static Rule Engine; it never
executes the document text and never changes ScriptLibrary source automatically.

## Capabilities

- Command: **SM Reviewer: Review Current File** (`smReviewer.reviewCurrentFile`).
- Supports `.js` and ScriptLibrary `.txt` documents, including unsaved editor
  changes.
- Shows static-rule findings and parser diagnostics in a dedicated diagnostic
  collection.
- Provides hover details with suggestions and available evidence.
- Optionally reviews supported documents on save.

AI review is optional and disabled by default. Offline static review needs no API key.

## Local development and F5

From Git Bash at the repository root:

```bash
cd vscode-extension
npm install
npm run build
npm test
```

Open the `vscode-extension/` directory in VS Code and press `F5`. This starts an
Extension Development Host. In that host, open or create a `.js` or `.txt` file,
then run **SM Reviewer: Review Current File** from the Command Palette.

## Settings

- `smReviewer.enableOnSave` — default `true`; review supported files on save.
- `smReviewer.enableDiagnostics` — default `true`; show diagnostics. Disabling
  it clears the extension's stale diagnostics.

## Manual UAT

## AI review setup and privacy

- Command: **SM Reviewer: AI Review Current File** (`smReviewer.aiReviewCurrentFile`).
- Store a credential only with **SM Reviewer: Set AI API Key**; remove it with
  **SM Reviewer: Clear AI API Key**. Keys use VS Code Secret Storage, never the
  CLI `.env`, workspace settings, reports, or extension logs.
- Configure `smReviewer.ai.enabled` (default `false`), `smReviewer.ai.model`,
  `smReviewer.ai.endpoint`, and `smReviewer.ai.timeoutMs` (default `30000`).
- Every manually invoked AI request shows the endpoint hostname and requires
  source-transmission consent. Cancel sends no source. AI never runs on save.
- AI findings appear separately under source **SM Reviewer AI**. They are
  model-generated, locally validated suggestions; static diagnostics remain the
  deterministic baseline. A `partial` coverage status means only one function
  context was reviewed in this MVP.
- Remote endpoints must use HTTPS. Use localhost mocks for automated/UAT work;
  production API verification is blocked by `credit_balance_exhausted`.

1. Open a `.js` file containing `print("debug")`; run the command and confirm
   `SM-DBG-001` is displayed at the matching source range.
2. Open a ScriptLibrary `.txt` file containing an SCFile query loop without
   `getNext()`; confirm `SM-LOOP-002` is displayed.
3. Edit the document without saving, run the command, and confirm diagnostics
   reflect the unsaved text.
4. Save a supported document and confirm review runs when `enableOnSave` is on.
5. Set `smReviewer.enableDiagnostics` to `false` and confirm existing diagnostics
   are cleared.
6. Open an unsupported file such as `.md`; the manual command should display an
   informative message and not add diagnostics.

## Packaging

Prerequisites: VS Code `^1.95.0`, Node.js compatible with the lockfile, and
Git Bash or another terminal with `npm`. Build a deterministic local package:

```bash
cd vscode-extension
npm ci
npm run build
npm test
npm run package
npm run inspect:vsix
```

The resulting artifact is `sm-scriptlibrary-reviewer-0.1.0.vsix`. Install it in
a normal VS Code instance with **Extensions: Install from VSIX...**, then reload
when prompted. The package is standalone: it contains compiled extension/core
modules and the TypeScript Compiler API runtime, but excludes TypeScript source,
tests, UAT fixtures, `.env`, and developer settings. See
[`../uat/sprint5c/README.md`](../uat/sprint5c/README.md) for release UAT,
troubleshooting, uninstall, and the local Mock AI workflow.

No license metadata is declared because the project owner has not approved a
license. Do not publish to Marketplace or create a release until ownership,
license, and independent review are complete.

## Known limitations

- Reviews the active document only; there is no workspace/folder review.
- No automatic fixes, code actions, AI calls, SM connector, or RAG.
- Parser acceptance does not prove SM runtime compatibility.
- Full Extension Development Host UI tests remain manual UAT; automated tests
  cover the review adapter, source-location conversion, lifecycle and static
  rule integration without requiring a VS Code host.
