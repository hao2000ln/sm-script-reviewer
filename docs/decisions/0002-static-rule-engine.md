# ADR 0002: Static rule engine contracts and execution policy

- Status: Proposed for independent review
- Date: 2026-10-26

## Context

Sprint 1 exposes a JSON-safe `AnalysisResult`, but AST-based rules also need the
TypeScript `SourceFile`, raw parser diagnostics, and location mapping. Adding an
AST to `AnalysisResult` would break serialization and couple CLI consumers to
the TypeScript Compiler API.

Rules also need predictable configuration, ordering, failure isolation, and a
clear policy for syntax-invalid source. Heuristic findings must not be presented
with the same certainty as deterministic checks.

## Decision

1. Keep the Sprint 1 `AnalysisResult` contract unchanged. Parse once into an
   internal `AnalysisArtifact` containing the public result, AST, raw parser
   diagnostics, and location mapper. `analyze()` delegates to this parser path.
2. Pass rules a `RuleContext` with the source, AST, public analysis, diagnostics,
   syntax status, and range helpers. AST objects remain internal and are not
   included in JSON output.
3. Give every rule immutable metadata: ID, classification, default enablement,
   default severity, and syntax policy. Duplicate IDs are rejected when a
   registry is constructed.
4. Validate the complete configuration before any rule executes. Unknown rule
   IDs, invalid severity values, malformed options, and rule-specific option
   errors fail fast with `RuleConfigurationError`.
5. Run rules sequentially in sorted rule-ID order. Isolate execution errors per
   rule and continue other rules. If one rule fails, discard all partial findings
   from that rule.
6. Default rules to `valid-only`. Such rules are skipped when parser diagnostics
   exist. A rule may explicitly use `recoverable`; its findings are labeled with
   `analysisStatus: recovered` and must not imply semantic reliability.
7. Normalize findings in the runner. Deterministic findings have confidence 1;
   heuristic rules must provide confidence in the inclusive range 0..1.
8. Deduplicate only identical findings emitted by the same rule. Preserve
   findings from different rules even when ranges and messages overlap.
9. Sort findings by start offset, end offset, rule ID, then fingerprint. Sort
   evidence by its source range and kind. Fingerprints use source content hash,
   rule ID, range, and message, so they do not depend on absolute file paths.
10. Implement `SM-CMT-001` for named functions without associated leading
    comments and `SM-DBG-001` for direct calls whose callee is the identifier
    `print`. Both are deterministic syntactic policy checks and are skipped on
    syntax-invalid source.
11. Keep the existing `inspect` CLI output unchanged. CLI review output and its
    JSON schema require a separate integration decision and regression tests.
12. Implement `SM-CODE-001` only for statements following a definitely
    terminating return, throw, break, continue, block, or two-sided if/else in
    the same statement list. Individual `case`/`default` statement lists are
    inspected locally, but switch-wide and try/catch/finally completion are
    outside this safe subset.
13. Implement `SM-LOOP-001` only for `while (true)`, `do/while (true)`, and
    `for (;;)`, suppressing findings when a syntactic break, return, or throw may
    exit the loop. Nested loop and switch breaks do not count as outer-loop exits.
    The rule remains deterministic because it reports only the proven syntactic
    property "unconditional condition with no recognized exit"; it does not
    claim that runtime non-termination is proven.
14. Register `SM-CMT-002` and `SM-CMT-003` as default-disabled heuristic rules.
    They require confidence and use deliberately narrow code-like, empty-comment,
    and separator-only patterns.

## Consequences

- Parser and rule consumers share one parse without exposing a cyclic AST in
  public results.
- Rule execution is reproducible and one faulty rule cannot suppress unrelated
  findings.
- A rule exception is returned as a sanitized rule error message without a
  stack trace. The engine does not silently treat it as a clean review.
- `SM-CMT-001` intentionally skips `<anonymous>` functions because there is no
  stable function identity to report under the current Sprint 1 contract.
- `SM-DBG-001` detects the exact syntax `print(...)`; it excludes property calls
  such as `obj.print(...)`. It does not perform binding analysis, so a locally
  shadowed identifier named `print` is still reported as a policy violation.
- `SM-CODE-001` deliberately does not infer completion of an entire switch or
  try/catch/finally statement. It can therefore miss unreachable code after such
  constructs, while still detecting statements after direct exits inside their
  nested blocks and switch clauses.
- `SM-LOOP-001` does not evaluate branch reachability. Any correctly targeted
  syntactic break, return, or throw suppresses the finding, including one under
  `if (false)`. This creates conservative false negatives and prevents the
  finding from overstating proof of an infinite runtime loop.
- Calls inside an unconditional loop may throw, terminate the SM request, or not
  return. Static syntax alone cannot establish those runtime behaviors.
- `SM-CMT-002` and `SM-CMT-003` remain heuristic and default-disabled because
  commented-out code and comment usefulness can be project-dependent.

