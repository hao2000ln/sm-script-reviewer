# Phase A: ScriptLibrary UAT baseline

This workflow is offline. It reviews exported `.js` and `.txt` files using the
existing static Rule Engine; it does not connect to Service Manager, execute
source, use AI, or modify input files.

Do not add production ScriptLibrary exports to this repository. Keep them in an
approved local folder and retain their provenance outside Git.

## Git Bash commands on Windows

From the repository root, make a first snapshot and an explicit review-label
template. `corpusComplete` is deliberately `false` in the generated template:
change it only when the project owner has confirmed the export is complete.

```bash
npm.cmd run uat:baseline -- /d/SM-Exports/ScriptLibrary \
  --output /d/SM-UAT/baseline-001.json \
  --write-manifest /d/SM-UAT/labels.json
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
npm.cmd run uat:baseline -- /d/SM-Exports/ScriptLibrary \
  --manifest /d/SM-UAT/labels.json \
  --output /d/SM-UAT/baseline-002.json
```

Compare a later run. Changed fingerprints are listed as new/removed and prior
labels that no longer match are retained as `unmatchedPriorClassifications`;
they are never automatically considered resolved.

```bash
npm.cmd run uat:baseline -- /d/SM-Exports/ScriptLibrary \
  --manifest /d/SM-UAT/labels.json \
  --previous /d/SM-UAT/baseline-002.json \
  --output /d/SM-UAT/baseline-003.json \
  --exclude 'generated/**'
```

The console summary is Vietnamese. `--output` is a stable machine-readable
JSON report. Classification manifests are validated strictly: schema version,
classification enum, unique identity, and the fingerprint of every matching
current finding must agree. Historical entries whose identity no longer exists
remain `unmatchedClassifications`; they are not migrated or treated as resolved.

Coverage is deliberately split:

- `coverage.corpus`: whether the owner declared the corpus complete and whether
  files were excluded or unsupported;
- `coverage.execution`: file failures, parser/syntax gating, and every
  `ruleErrors` entry with its affected file and rule ID;
- `coverage.semantic`: always `not-established` in this offline workflow.

The aggregate `coverage.status` is therefore `incomplete`: a static baseline
and manual labels cannot establish complete SM runtime semantic coverage.
Fingerprints contain the source hash, so a source edit can turn a prior finding
into a new/unmatched entry even when it appears conceptually similar. Labels are
never migrated heuristically.

Synthetic fixtures in automated tests are only regression data. They are not
evidence of production accuracy or SM 9.8x runtime compatibility.
