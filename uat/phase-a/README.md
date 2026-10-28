# Phase A: ScriptLibrary UAT baseline

This workflow is offline. It reviews exported `.js` and `.txt` files using the
existing static Rule Engine; it does not connect to Service Manager, execute
source, use AI, or modify input files.

Do not add production ScriptLibrary exports to this repository. Keep them in an
approved local folder and retain their provenance outside Git.

## Git Bash commands on Windows

From the repository root, make a first snapshot and an explicit review-label
template. With no source argument, the command uses
`./SM-Exports/ScriptLibrary`; `--profile production` excludes only the
project-specific `Samples`, `Tests`, and `Tools` groups. New/unknown top-level
groups are included and recorded in `provenance.includedUnknownDirectories`.
Use `--profile full` to include every supported file. `corpusComplete` is
deliberately `false` in the generated template:
change it only when the project owner has confirmed the export is complete.

```bash
npm.cmd run uat:baseline -- --profile production \
  --output ./SM-UAT/baseline-production-001.json \
  --write-manifest ./SM-UAT/labels.json
```

Open `labels.json` and classify every selected entry with one of:

- `TRUE_POSITIVE`
- `FALSE_POSITIVE`
- `NEEDS_VERIFICATION`

Each entry uses `identity` (relative source path + rule + fingerprint) and also
retains the original `fingerprint`. Do not change `identity`; it prevents an
identical finding in one ScriptLibrary from labeling a different file.

Run the labeled baseline:

```bash
npm.cmd run uat:baseline -- ./SM-Exports/ScriptLibrary \
  --manifest ./SM-UAT/labels.json \
  --output ./SM-UAT/baseline-production-002.json
```

For a full snapshot, including `Samples`, `Tests`, and `Tools`:

```bash
npm.cmd run uat:baseline -- --profile full \
  --output ./SM-UAT/baseline-full-001.json
```

`SM_SCRIPTLIBRARY_DIR` and `SM_UAT_DIR` may be set in the project `.env` for
local convenience. A positional source folder or `--output` path always wins
over those defaults. The command creates the output directory when necessary.
Use explicit, versioned output filenames for later comparisons; if `--output`
is omitted in the all-default workflow, the local default is
`SM-UAT/baseline-<profile>.json`. An explicitly supplied source without
`--output` retains the earlier console-only behavior.

Compare a later run. Changed fingerprints are listed as new/removed and prior
labels that no longer match are retained as `unmatchedPriorClassifications`;
they are never automatically considered resolved.

```bash
npm.cmd run uat:baseline -- ./SM-Exports/ScriptLibrary \
  --profile production \
  --manifest ./SM-UAT/labels.json \
  --previous ./SM-UAT/baseline-production-002.json \
  --output ./SM-UAT/baseline-production-003.json \
  --exclude 'generated/**'
```

The console summary is Vietnamese. `--output` is a stable machine-readable
JSON report. Classification manifests are validated strictly: schema version,
classification enum, unique identity, and the fingerprint of every matching
current finding must agree. Historical entries whose identity no longer exists
remain `unmatchedClassifications`; they are not migrated or treated as resolved.
The serialized report never exposes local absolute paths: `targetPath`,
`findings[].sourceId`, and `findings[].filePath` are corpus-relative labels.
The reviewer may retain absolute paths internally while it runs; they are not
part of the shareable baseline JSON.

Coverage is deliberately split:

- `coverage.corpus`: whether the owner declared the corpus complete and whether
  files were unsupported. Intentional profile exclusions are recorded in
  `provenance.appliedExclusions` and do not increment `unsupportedFileCount`;
- `coverage.execution`: file failures, parser/syntax gating, and every
  `ruleErrors` entry with its affected file and rule ID;
- `coverage.semantic`: always `not-established` in this offline workflow.

The aggregate `coverage.status` is therefore `incomplete`: a static baseline
and manual labels cannot establish complete SM runtime semantic coverage.
Reports use baseline schema `1.2.0`; comparison accepts legacy `1.0.0` and
`1.1.0` snapshots because finding identities remain unchanged. Fingerprints contain the source hash, so a source edit can turn a prior finding
into a new/unmatched entry even when it appears conceptually similar. Labels are
never migrated heuristically.

## Configurable review-noise policies

The default rule behavior remains compatible with earlier baselines:

- `SM-CMT-001` uses `all-functions` and reports every named indexed function
  without an adjacent leading comment.
- `SM-DBG-001` uses `all-print` and reports every direct `print()` call as a
  warning.

For UAT triage, supply a normal RuleSet JSON file with
`--config ./SM-UAT/uat-policy.json`. `SM-CMT-001` supports `all-functions`,
`public-functions` (only source-root `FunctionDeclaration` nodes), and `off`.
`SM-DBG-001` supports `all-print`, `debug-patterns`, and `off`.
`debug-patterns` only recognizes static string literals or no-substitution
templates containing the whole-word markers `DEBUG`, `TRACE`, or `TEMP DEBUG`.
It emits heuristic `info` findings; dynamic arguments and arbitrary `print()`
calls are not treated as proven debug output.

Baseline JSON `groups` provides stable count tables by rule ID, file, severity,
deterministic/heuristic classification, and UAT classification. Schema `1.2.0`
adds these tables; comparison continues to accept `1.0.0` and `1.1.0` snapshots.

When comparing snapshots, the report includes
`configurationComparisonStatus: "same" | "changed" | "unknown"` and
`configurationChanged`. A changed rule configuration, or a legacy snapshot
without `provenance.ruleConfigurationHash`, produces a Vietnamese warning. In
either case, `removedFindings` remains available for compatibility but must not
be interpreted as source defects that were fixed.

Example `./SM-UAT/uat-policy.json`:

```json
{
  "rules": {
    "SM-CMT-001": { "options": { "mode": "public-functions" } },
    "SM-DBG-001": { "options": { "mode": "debug-patterns" } }
  }
}
```

Synthetic fixtures in automated tests are only regression data. They are not
evidence of production accuracy or SM 9.8x runtime compatibility.
