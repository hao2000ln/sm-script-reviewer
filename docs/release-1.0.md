# SM ScriptLibrary Reviewer 1.0.0 — Internal Pilot

## Installation

CLI development use:

```bash
npm ci
npm run build
npm run review -- review ./SM-Exports/ScriptLibrary --preset v1-production
```

VS Code package use:

```bash
cd vscode-extension
npm ci
npm run package
npm run inspect:vsix
```

Install the resulting VSIX with **Extensions: Install from VSIX...**, then
reload VS Code. Package creation is not proof of installation UAT.

## Dependency analysis configuration

No filename is assumed to be a runtime ScriptLibrary name. Use an explicit
owner-maintained mapping file:

```json
{
  "corpusComplete": false,
  "mappingsComplete": false,
  "caseSensitive": true,
  "libraryMappings": [
    { "libraryName": "ESD_Utils", "filePath": "ESD_SHARED/ESD_Utils.js" }
  ]
}
```

`MISSING` is emitted only when both `corpusComplete` and `mappingsComplete` are
true **and** the actual scan has complete execution coverage. A file limit,
load failure, skipped file, partial injected source set, or parse diagnostic
makes effective corpus coverage incomplete and keeps an unmapped static
reference `UNRESOLVED`. Computed targets are `DYNAMIC`; duplicate or
conflicting owner mappings are rejected as invalid configuration.

Dependency JSON/HTML reports contain relative source paths and locations only;
they never include reviewed source content or absolute local paths.

```bash
npm run review -- dependencies ./SM-Exports/ScriptLibrary --config ./dependency-map.json --format html --output dependencies.html
npm run review -- impact ./SM-Exports/ScriptLibrary --config ./dependency-map.json --changed ESD_Utils --format json
```

VS Code uses the same configuration in `smReviewer.dependencies.config`.

## Supported syntax

- `lib.LibraryName`
- `lib.LibraryName.method()`
- `lib["LibraryName"]` and further static member access

Computed targets such as `lib[name]`, dynamic wrappers, and lexically shadowed
`lib` identifiers are never invented as static edges.

## Known limitations

- Static references do not prove SM runtime loading, execution order, or
  runtime failure caused by a cycle.
- No Connector, auto-fix, source execution, RAG, or mandatory `doClose` rule.
- Normal VS Code UAT and SM 9.8x runtime verification require owner evidence.
- The V1 evidence reconciliation status is recorded in `docs/reviews/v1-release-gap-audit.md`.

## Rollback

Uninstall the VSIX in VS Code and reload. For a prior internal VSIX, install
that explicitly approved artifact. The reviewer never writes to SM or changes
reviewed ScriptLibrary source.

## Release checklist

1. Run build, tests, CLI smoke, extension tests, package, and archive inspect.
2. Record owner-reviewed corpus snapshot and classification manifest.
3. Complete normal-VS-Code manual UAT.
4. Mark SM runtime claims as `NOT_VERIFIED` unless separately tested on 9.8x.
5. Owner performs version commit, tag, publication, or rollback decisions.
