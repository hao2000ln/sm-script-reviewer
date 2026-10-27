# Sprint 5C — VSIX packaging and release UAT

## Automated packaging verification

From Git Bash at repository root:

```bash
npm run build
npm test
npm run test:acceptance
npm run test:uat:sprint4
cd vscode-extension
npm ci
npm run build
npm test
npm run package
npm run inspect:vsix
cd ..
node uat/sprint5b/run-uat.cjs
```

`inspect:vsix` reads the actual VSIX archive. It verifies the manifest,
extension entrypoint, compiled core reviewer/AI modules, the TypeScript runtime,
and exclusion of tests, source TypeScript, UAT files, `.env`, `.vscode`, and
nested VSIX files.

## Manual normal-VS-Code installation UAT

1. In a normal VS Code instance, run **Extensions: Install from VSIX...**.
2. Select `vscode-extension/sm-scriptlibrary-reviewer-0.1.0.vsix`.
3. Reload VS Code when prompted; do not use Extension Development Host for this
   verification.
4. Open an unsaved `.js` and ScriptLibrary `.txt` file. Run **SM Reviewer:
   Review Current File** and verify Problems/hover findings, including
   `SM-LOOP-002` and `SM-DBG-001`.
5. Save a supported file and verify only static review runs automatically.
6. Confirm AI is disabled by default. Configure local Mock AI as described in
   [`../sprint5b/README.md`](../sprint5b/README.md), then verify consent,
   separate `SM Reviewer AI` diagnostics, edit invalidation, partial coverage,
   and static-diagnostic preservation on HTTP 429.
7. Uninstall with **Extensions: Show Installed Extensions**, select SM
   ScriptLibrary Reviewer, then choose **Uninstall** and reload VS Code.

## Troubleshooting and release readiness

- A missing command after install normally requires Reload Window and checking
  that VS Code satisfies engine `^1.95.0`.
- Do not configure a production AI key for mock UAT.
- Production provider UAT remains postponed due to `credit_balance_exhausted`.
- Version remains `0.1.0`; owner approval is required before changing version,
  publisher, licensing, Marketplace publication, or GitHub release.
- Manual installation is a required owner/independent-review step and is not
  replaced by archive inspection.
