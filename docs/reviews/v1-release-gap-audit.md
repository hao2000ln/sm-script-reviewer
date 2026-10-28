# V1 internal-pilot release audit

## Product boundary

V1 is an offline, read-only reviewer for local ScriptLibrary exports and the
VS Code extension. It does not require AI, an SM Connector, source execution,
or automatic code changes.

## Shared V1 rule policy

`v1-production` is implemented in `src/reviewer/presets.ts` and is selected
explicitly in the review CLI and by default in the VS Code extension. It keeps the supported SM
safety rules enabled:

- `SM-SCF-001` through `SM-SCF-004`
- `SM-RC-001`
- `SM-LOOP-002`

It disables comment, print, generic code-hygiene, and generic-loop rules.
Teams can use `--preset default` or an explicit config override for policy
reviews. This avoids interpreting a comment convention as a release-blocking
SM defect.

## Evidence from the first local corpus

The classified local scan contains 10 files and 44 findings: 27 true positive,
17 false positive, and no unclassified findings. The two `SM-RC-001` findings
identify discarded `SCFile.doDelete()` results. The 17 comment false positives
are underscore-prefixed helpers under the current project convention; this is a
policy decision, not a parser failure.

This corpus is an initial signal only. It does not establish full SM 9.8x
runtime semantics or complete ScriptLibrary coverage.

## Release gates

1. Owner confirms which local export/UAT artifacts must never be Git tracked.
2. Run the V1 CLI command on an approved representative corpus and retain the
   generated HTML/JSON report outside Git.
3. Label high-signal rules by ID and review any false-positive pattern before
   changing a rule contract.
4. Package and inspect the VSIX, then run normal-VS-Code manual UAT for file,
   folder, on-save, diagnostics, and Vietnamese presentation.
5. Record supported SM API evidence and explicitly retain pending 9.8x runtime
   limitations. Passing Node tests is not runtime proof.

## Recommended pilot command

```bash
npm run review -- review ./SM-Exports/ScriptLibrary \
  --preset v1-production --format html --output ./SM-UAT/v1-review.html
```

## Explicit non-goals

No SM Connector, automatic remediation, mandatory `doClose` rule,
interprocedural analysis, RAG, or production AI-provider requirement is part
of this release gate.
