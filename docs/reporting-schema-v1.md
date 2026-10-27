# Review report JSON schema v1

`sm-reviewer review <target> --format json` emits one JSON object with
`schemaVersion: "1.0.0"`. Additive fields may be introduced within major version
1; removing fields or changing their meaning requires a new major version.

## Top-level fields

| Field | Meaning |
|---|---|
| `schemaVersion` | Report contract version. |
| `failureThreshold` | Minimum reported severity and exit-code threshold. |
| `summary` | Counts for files, findings, diagnostics, skipped rules, rule errors, and file failures. |
| `files` | Stable path-ordered file summaries and source hashes. |
| `findings` | Filtered findings with `filePath` plus the unchanged public `Finding` fields. |
| `diagnostics` | Parser diagnostics with file paths and public source locations. |
| `skippedRules` | Disabled or syntax-gated rules, qualified by file path. |
| `ruleErrors` | Isolated rule execution failures, qualified by file path. |
| `failures` | File discovery/loading failures that did not prevent other files being reviewed. |

Files are ordered by normalized path. Findings preserve rule-engine ordering
within each file. Diagnostics, skipped rules, rule errors, and failures follow
the same stable file order. Filtering never recalculates a finding fingerprint;
fingerprints retain the rule-engine contract based on source hash, rule ID,
source range, and message.

## Filtering and execution

`--rule` and `--min-severity` filter report findings after analysis. They do not
enable, disable, or short-circuit rules. Rule execution is controlled only by
the configuration supplied through `--config`.

## Exit codes

| Code | Meaning |
|---:|---|
| `0` | Review completed with no reported finding meeting the threshold. |
| `1` | One or more reported findings meet the threshold. |
| `2` | Invalid CLI input/configuration, output failure, file failure, or isolated rule failure. |

Parser diagnostics are included in the report but do not independently produce
exit code `1` or `2`. Syntax-gated rules appear in `skippedRules`.
