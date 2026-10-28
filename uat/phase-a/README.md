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
JSON report. A result marked `coverage.status: "incomplete"` means the corpus
was not declared complete, unsupported/excluded files exist, a file failed to
load, parser diagnostics occurred, or valid-only rules were skipped.

Synthetic fixtures in automated tests are only regression data. They are not
evidence of production accuracy or SM 9.8x runtime compatibility.
