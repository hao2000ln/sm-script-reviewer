# ADR 0001: Sprint 1 parser and indexer boundaries

- Status: Accepted
- Date: 2026-10-25

## Context

SM ScriptLibrary source must be inspected without execution. The initial
implementation used a standalone TypeScript scanner for comments and combined
AST parsing, comment extraction, function indexing, name inference, and source
locations in one function.

A standalone scanner is not sufficiently context-aware. It cannot resume a
template literal after `${...}` in the same way as the parser, and it can read
comment delimiters inside a regular-expression token as comments. Regression
tests demonstrate both cases.

## Decision

1. Continue parsing JavaScript with `ts.createSourceFile`, `ScriptKind.JS`, and
   `ScriptTarget.Latest`. SM runtime compatibility belongs to a later static
   rule and is not inferred from parser acceptance.
2. Collect comments from leading and trailing comment ranges at AST token
   boundaries, then deduplicate ranges. Do not use an independent lexical scan.
3. Treat a comment as trailing when non-comment code precedes it on the same
   physical line. Trailing comments cannot document a following function.
4. Associate consecutive leading comments when only whitespace and at most one
   line break separates each range. A blank line terminates the group.
5. Index function declarations, function expressions, arrow functions, and
   method declarations recursively. Infer names from variable declarations,
   object properties, and simple assignment expressions.
6. Keep the top-level `AnalysisResult` contract and existing fields. Add
   `SourceLocation.offset` as an additive field required to make locations
   unambiguous.
7. Locations use 1-based lines and columns, zero-based UTF-16 offsets, and
   end-exclusive ranges.
8. Return parser diagnostics and index nodes recovered by TypeScript, but do not
   claim that recovered AST nodes are semantically reliable around an error.

## Consequences

- Comment extraction follows the parser's interpretation of templates and
  regular expressions.
- Comments in regions entirely discarded during TypeScript error recovery may
  be absent from the comment index; diagnostics remain authoritative there.
- Assignment names preserve their source form, such as `obj.load` or
  `namespace["quoted"]`.
- Accessors and constructors are not included in Sprint 1 because they are not
  among the approved function forms.
