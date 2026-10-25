# SM ScriptLibrary Reviewer — Sprint 1 scaffold

Independent, read-only JavaScript source inspection for OpenText Service Manager ScriptLibrary.

## Setup

```bash
npm install
npm test
npm run review -- inspect ./examples
npm run review -- inspect ./examples --json
```

## Current capabilities
- Discover `.js` files recursively (excluding `.git`-style hidden folders, `dist`, `node_modules`).
- Read UTF-8 source, compute SHA-256.
- Parse JavaScript with TypeScript compiler API (no code execution).
- Extract declarations, expressions, arrows, object methods, property functions, and nested functions.
- Extract AST-aware comments without treating template, string, or regular-expression text as comments.
- Report parser diagnostics while retaining recoverable index entries.
- Report 1-based line/column locations with end-exclusive UTF-16 offsets.
- CLI text or JSON output.

## Not yet implemented
- Rule Engine, code findings, SM-specific control flow, AI, VS Code extension, SM Connector.
- Validate against real SM ScriptLibrary samples before treating parser coverage as complete.

## Codex collaboration contract
1. Work on a separate feature branch; never change production SM.
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

## First Codex task
Review and harden `src/parser/analyze.ts`: leading-comment association, multiline/inline comments, function expressions assigned to object properties, nested functions, parse recovery, and source locations. Add regression fixtures. Keep the public `AnalysisResult` contract stable or explain proposed changes.
