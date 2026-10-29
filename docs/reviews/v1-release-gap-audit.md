# V1 internal-pilot release audit

## Product boundary

V1 is an offline, read-only reviewer for local ScriptLibrary exports and the
VS Code extension. It does not require AI, an SM Connector, source execution,
or automatic code changes.

## Shared V1 rule policy

`v1-production` is implemented in `src/reviewer/presets.ts` and is selected
explicitly in the review CLI and by default in the VS Code extension. CLI
JSON, text, and HTML reports include additive `reviewPreset` metadata; VS Code
manual file/folder review messages identify the active preset. It keeps the supported SM
safety rules enabled:

- `SM-SCF-001` through `SM-SCF-004`
- `SM-RC-001`
- `SM-LOOP-002`

It disables comment, print, generic code-hygiene, and generic-loop rules.
Teams can use `--preset default` or an explicit config override for policy
reviews. This avoids interpreting a comment convention as a release-blocking
SM defect.

## Reconciled local corpus evidence

The committed `SM-UAT/baseline-001.json` is schema `1.2.0`, generated at
`2026-10-28T07:50:07.971Z`, for profile `production`. It records corpus hash
`ba709bc1dbd7813e0cebf5b105c6fd2590adc3484bea0a75a7f083057292a53a` and
rule configuration hash
`c4f36ba1c39958ecef0c7446270a06ae4eff38330e651cc322a7c61747aa1edc`.
Its profile includes unknown `ESD_TEST` because the applied exclusion is the
non-matching `ESD_TEST1/**` pattern.

The committed baseline contains 44 findings with no UAT classification. A
local ignored `labels-001.json` contains 44 identity/fingerprint matches with
27 `TRUE_POSITIVE` and 17 `FALSE_POSITIVE`, while local
`baseline-labelled-001.json` instead records 10 `TRUE_POSITIVE` and 34
`NEEDS_VERIFICATION`. Neither local artifact records a human reviewer,
approval, or source revision. They are therefore not independently verifiable
human classifications and must not be cited as accepted UAT results.

All ten baseline file paths currently exist locally, but only nine hashes match
the baseline. `ESD_TEST/ESD_CRUD_NQ.js` exists and still contains the two
discarded `doDelete()` calls at lines 24 and 28, but its current SHA-256 differs
from the baseline hash. It is not tracked at reviewed commit `4d94d9b`; the
baseline-specific source revision is unavailable. The two `SM-RC-001` findings
are reproducible against the current local source but are not verified evidence
for the committed baseline snapshot.

This corpus is incomplete evidence only. It does not establish full SM 9.8x
runtime semantics, complete ScriptLibrary coverage, or human UAT acceptance.

## Reproducible verification at the Release 1.0 candidate worktree

The last committed reviewer revision inspected here is `4d94d9b`. Release
candidate changes remain in the local working tree pending owner review and
Git operations. The export corpus has no Git revision at that commit because
`ESD_CRUD_NQ.js` is not tracked; its baseline-specific revision is therefore
unavailable.

The following local checks were executed without AI or SM Connector access:

- TypeScript build: passed.
- Full root unit suite: passed, **188/188**.
- Acceptance suite: passed, 17/17.
- Sprint 4 offline UAT: passed, 9/9 (localhost mock only).
- Extension build and tests: passed, **26/26**.
- CLI `v1-production` review of the current local corpus: completed with the
  expected exit code 1 for 4 findings across 12 files; no parser,
  rule, or file failures.
- Dependency CLI scan of the same corpus: completed with exit code 0; 12
  files, 20 `UNRESOLVED` references, zero resolved edges and zero cycles. No
  owner-maintained runtime-name mapping was supplied, so this is deliberately
  not evidence of missing libraries.
- VSIX package and archive inspection: passed (193 archive entries).

These are automated/code evidence only. No normal-VS-Code manual UAT or SM
9.8x runtime verification is claimed here.

## Release gates

1. Owner confirms which local export/UAT artifacts must never be Git tracked.
2. Run the V1 CLI command on an approved representative corpus and retain the
   generated HTML/JSON report outside Git.
3. Capture a versioned, owner-reviewed classification manifest with source
   revision/hash provenance before reporting true/false-positive metrics.
4. Package and inspect the VSIX, then run normal-VS-Code manual UAT for file,
   folder, on-save, diagnostics, and Vietnamese presentation.
5. Record supported SM API evidence and explicitly retain pending 9.8x runtime
   limitations. Passing Node tests is not runtime proof.

## Pilot recommendation

**NO-GO for an independently verifiable internal pilot today.** The code and
automated packaging checks are ready for owner review, but the source revision
behind one committed baseline file is unavailable, manual classification
evidence conflicts, and normal-VS-Code/SM runtime verification is not recorded.
The recommendation can change to a conditional pilot GO only after an approved
source snapshot, owner-reviewed manifest, and manual VSIX UAT record exist.

## Recommended pilot command

```bash
npm run review -- review ./SM-Exports/ScriptLibrary \
  --preset v1-production --format html --output ./SM-UAT/v1-review.html
```

## Explicit non-goals

No SM Connector, automatic remediation, mandatory `doClose` rule,
interprocedural analysis, RAG, or production AI-provider requirement is part
of this release gate.
