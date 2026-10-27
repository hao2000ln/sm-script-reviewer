# SM ScriptLibrary Reviewer

Independent, read-only JavaScript source inspection for OpenText Service Manager ScriptLibrary.

## Setup

```bash
npm ci
npm test
npm run review -- inspect ./examples
npm run review -- inspect ./examples --json
npm run review -- review ./examples
npm run review -- review ./examples --format json
npm run review -- review ./examples --format html --output review.html
```

## Current capabilities
- Discover `.js` files for inspection and `.js`/`.txt` files for recursive review
  (excluding hidden folders, `.git`, `dist`, `node_modules`, symlinks, and configured globs).
- Read UTF-8 source, compute SHA-256.
- Parse JavaScript with TypeScript compiler API (no code execution).
- Extract declarations, expressions, arrows, object methods, property functions, and nested functions.
- Extract AST-aware comments without treating template, string, or regular-expression text as comments.
- Report parser diagnostics while retaining recoverable index entries.
- Report 1-based line/column locations with end-exclusive UTF-16 offsets.
- Run configurable deterministic and heuristic static rules with evidence,
  confidence, severity, stable fingerprints, and syntax gating.
- Recognize evidence-backed SCFile construction and approved methods with direct
  bindings, one-hop aliases, lexical shadowing, and reassignment invalidation.
- Report supported unhandled SCFile return-code and query-loop progress patterns.
- Run single-file or batch CLI reviews with text, versioned JSON, or standalone
  HTML reports, configuration, filters, stable ordering, and deterministic exit codes.

## Not yet implemented
- AI, VS Code extension, SM Connector, interprocedural SM analysis, and
  unverified custom SM APIs.
- Mandatory SCFile `doClose()` analysis; no verified lifecycle contract has
  been accepted for that method.
- Validate against real SM ScriptLibrary samples before treating parser coverage as complete.

## Offline review CLI

```bash
npm run review -- review <file-or-directory> [options]
```

Supported options:

- `--format text|json|html` (default: `text`)
- `--output <path>`
- `--config <path>` for a JSON `RuleSetConfig`
- `--min-severity info|warning|error` (default: `warning`)
- repeatable `--rule <rule-id>` report filter
- repeatable `--exclude <glob>` discovery filter

All configured rules execute before report filters are applied. The minimum
severity is both the display and failure threshold. Exit code `0` means no
reported finding meets that threshold, `1` means at least one does, and `2`
means invalid input/configuration or an operational file, rule, or report error.
Parser diagnostics remain report data and do not independently change the exit
code.

The JSON contract is documented in
[`docs/reporting-schema-v1.md`](docs/reporting-schema-v1.md).

## Codex collaboration contract
1. Work on a separate feature branch created by the project owner; never change production SM.
2. Implement one bounded task at a time, with positive/negative/edge-case tests.
3. Provide changed-file list, test results, assumptions, and known limitations.
4. Request independent architecture/code review before merge.
5. Do not introduce Node/browser runtime assumptions into SM source being analyzed.

## Source location contract

All `SourceLocation` values use 1-based `line` and `column` values. `offset` is a
zero-based UTF-16 code-unit offset, matching JavaScript strings and the
TypeScript compiler API. All `end` locations are exclusive.

Parser/indexer decisions for Sprint 1 are recorded in
[`docs/decisions/0001-parser-indexing.md`](docs/decisions/0001-parser-indexing.md).

Project scope, roadmap, and collaboration rules are recorded in
[`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md) and [`AGENTS.md`](AGENTS.md).

## Delivery status

Current sprint scope and delivery status are maintained in
[`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md). Treat roadmap entries as plans;
inspect source, tests, and the relevant pull request before concluding that a
capability is implemented.
