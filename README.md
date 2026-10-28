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
- Build provider-independent, function-level AI context offline with explicit
  budgets, source grounding, response validation, and privacy-safe defaults.
- Optionally run an explicitly consented OpenAI-compatible AI review and keep
  validated model-generated findings separate from static findings.

## Not yet implemented
- RAG/knowledge base, multiple AI provider adapters, SM Connector,
  interprocedural SM analysis, and unverified custom SM APIs.
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
- `--preset default|v1-production` (default: `default`)
- `--min-severity info|warning|error` (default: `warning`)
- repeatable `--rule <rule-id>` report filter
- repeatable `--exclude <glob>` discovery filter
- `--help`

All configured rules execute before report filters are applied. The minimum
severity is both the display and failure threshold. Exit code `0` means no
reported finding meets that threshold, `1` means at least one does, and `2`
means invalid input/configuration or an operational file, rule, or report error.
Syntax errors that prevent valid-only rules from running remain present in JSON
diagnostics and `skippedRules`, and produce exit code `2`. An explicitly supplied
file must use `.js` or `.txt`; unsupported files produce exit code `2`, while an
empty directory is a successful empty review.

The JSON contract is documented in
[`docs/reporting-schema-v1.md`](docs/reporting-schema-v1.md).

## V1 internal pilot preset

The `v1-production` preset is the recommended starting point for an internal
offline rollout. It prioritizes evidence-backed SCFile contract checks,
unhandled SCFile return codes, and SCFile query-loop progress. Comment, print,
generic code-hygiene, and generic-loop rules are disabled so they do not hide
higher-risk SM findings.

```bash
npm run review -- review ./SM-Exports/ScriptLibrary \
  --preset v1-production --format html --output ./SM-UAT/v1-review.html
```

Use `--preset default` to restore every built-in default rule (the CLI default),
or pass `--config <path>` to explicitly override a single preset rule. The
VS Code extension defaults to `v1-production` through
`smReviewer.rulePreset`.

## Cross-ScriptLibrary dependencies

Dependency analysis is offline and AST-based. Runtime library identity is never
guessed from a filename: provide an explicit mapping configuration before
expecting resolved graph edges or missing-library findings.

```bash
npm run review -- dependencies ./SM-Exports/ScriptLibrary --config ./dependency-map.json --format html --output dependencies.html
npm run review -- impact ./SM-Exports/ScriptLibrary --config ./dependency-map.json --changed ESD_Utils --format json
```

Supported static forms are `lib.LibraryName`, `lib.LibraryName.method()`, and
`lib["LibraryName"]`. Computed names remain `DYNAMIC`; incomplete mappings
produce `UNRESOLVED`, not `MISSING`. See
[`docs/release-1.0.md`](docs/release-1.0.md) for mapping configuration,
installation, rollback, supported syntax, and release limitations.

## V1 evidence status

- **Code review:** static contracts and release changes are subject to normal
  independent review; they are not proof of SM runtime behavior.
- **Automated verification:** build, unit, acceptance, extension, and VSIX
  archive checks are recorded in the V1 audit.
- **Real-corpus UAT:** the committed baseline is reproducible only where source
  hashes still match. It must not be used to claim human true/false-positive
  metrics without a versioned, owner-reviewed manifest.
- **SM 9.8x runtime verification:** pending. Normal-VS-Code manual UAT is also
  pending unless separately recorded by the project owner.

See [`docs/reviews/v1-release-gap-audit.md`](docs/reviews/v1-release-gap-audit.md)
for the exact evidence and pilot release gates.

## Offline UAT baseline

For a local, approved ScriptLibrary export folder, create an offline static
baseline and optional classification template. This does not connect to SM or
send source to AI:

```bash
npm run uat:baseline -- ./approved-scriptlibrary-export \
  --output ./uat-baseline.json --write-manifest ./uat-labels.json
```

The workflow preserves path-qualified finding identities, tracks manual
`TRUE_POSITIVE`/`FALSE_POSITIVE`/`NEEDS_VERIFICATION` labels, and reports
unmatched labels rather than silently calling changed findings resolved. See
[`uat/phase-a/README.md`](uat/phase-a/README.md).

## Optional AI review

AI remains disabled unless `--ai` is supplied. Remote transmission additionally
requires `--allow-source-transmission`; this sends selected source, source/path
metadata, parser context, and static evidence to the configured provider. Review
the provider's privacy and retention policy before granting consent. Credentials
are read only from `SM_REVIEWER_AI_API_KEY` and are not included in reports.

PowerShell setup and example:

```powershell
$env:SM_REVIEWER_AI_API_KEY = '<api-key>'
npm run review -- review ./examples/sample.js --ai --allow-source-transmission `
  --ai-model gpt-4o-mini `
  --ai-endpoint https://api.openai.com/v1/chat/completions `
  --ai-timeout 30000 --format json
```

For local development or UAT, copy `.env.example` to `.env` and provide values
locally:

```dotenv
SM_REVIEWER_AI_API_KEY=your-api-key
SM_REVIEWER_AI_MODEL=gpt-4o-mini
SM_REVIEWER_AI_ENDPOINT=https://api.openai.com/v1/chat/completions
SM_REVIEWER_AI_TIMEOUT_MS=30000
```

Configuration priority is CLI arguments, then operating-system environment,
then `.env`, then application defaults. Missing `.env` files are ignored.
Neither credentials nor other environment settings enable AI or source
transmission: both `--ai` and `--allow-source-transmission` remain explicit.
`.env` and `.env.*` are ignored by Git; `.env.example` is safe to commit.

The live adapter supports one OpenAI-compatible chat-completions endpoint.
Remote endpoints must use HTTPS; plain HTTP is accepted only for localhost test
servers. Requests use approximate budgets, a timeout, response validation, and
a hard response-byte limit. AI errors produce exit code `2` while retaining the
static report. AI findings are model-generated suggestions, are not deterministic
static findings, and require human review. The MVP analyzes one selected context
per file; JSON, text, and HTML reports explicitly show complete, partial, failed,
or not-run function coverage. It does not provide RAG, deduplication, provider-specific token counts,
or interprocedural reasoning.

The architecture is documented in
[`docs/decisions/0004-ai-review-architecture.md`](docs/decisions/0004-ai-review-architecture.md).

Sprint 3 Phase B status remains: **Static Code Review Approved — Independent
Verification & SM 9.8x UAT Pending.**

Current reproducible release evidence, including its limitations, is recorded
in [`docs/reviews/v1-release-gap-audit.md`](docs/reviews/v1-release-gap-audit.md).
HTTP tests use localhost mocks and make no paid provider calls.

## Codex collaboration contract
1. The project owner manages all Git/GitHub history operations; Codex never creates
   branches, commits, pushes, merges, rebases, or publishes. Never change production SM.
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

The VS Code extension can be packaged locally as a standalone VSIX; archive
inspection and offline mock UAT are documented in
[`uat/sprint5c/README.md`](uat/sprint5c/README.md). Normal-VS-Code installation
UAT and real-provider UAT remain manual/pending; the latter is blocked by
`credit_balance_exhausted`.

Current sprint scope and delivery status are maintained in
[`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md). Treat roadmap entries as plans;
inspect source, tests, and the relevant pull request before concluding that a
capability is implemented.
