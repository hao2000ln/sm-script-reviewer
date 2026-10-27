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

AI review is deferred to Sprint 5B. Offline static review needs no API key.

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

After building, install or invoke the VS Code extension packager:

```bash
cd vscode-extension
npm install
npm run build
npx @vscode/vsce package --out sm-scriptlibrary-reviewer.vsix
```

Install the resulting VSIX with VS Code's **Extensions: Install from VSIX...**
command. Packaging should be done only after independent review.

## Known limitations

- Reviews the active document only; there is no workspace/folder review.
- No automatic fixes, code actions, AI calls, SM connector, or RAG.
- Parser acceptance does not prove SM runtime compatibility.
- Full Extension Development Host UI tests remain manual UAT; automated tests
  cover the review adapter, source-location conversion, lifecycle and static
  rule integration without requiring a VS Code host.
