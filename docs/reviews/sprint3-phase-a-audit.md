# Sprint 3 Phase A: SM-specific analysis audit

- Status: Proposed for independent review
- Date: 2026-10-26
- Scope: Architecture and rule specification only; no SM-specific rule is implemented

## Executive assessment

The Sprint 2 engine can support conservative, intraprocedural SM rules without
changing `AnalysisResult` or the rule runner. `RuleContext` already provides the
JavaScript AST, parser diagnostics, source text, and location helpers. The rule
engine also provides syntax gating, evidence, confidence, deterministic ordering,
configuration, and per-rule error isolation.

The missing capability is an SM semantic layer between the AST and individual
rules. Implementing each rule as an independent AST walk would duplicate alias,
call, return-value, and control-flow logic. Sprint 3 should first extract typed SM
events, then evaluate those events per function with a deliberately small flow
model.

The most important semantic finding is that the official SCFile method lists
reviewed for Service Manager 9.5 and 9.8 document `doSelect`, `getNext`,
`getLastRC`, and CRUD methods, but do not list `doClose`. Absence from the list is
not proof that no environment exposes it; however, it is insufficient evidence
to claim that every SCFile must be closed. The repository's sample call to
`doClose()` is not authoritative product documentation. Any close/lifecycle rule
is therefore blocked pending verified project-specific evidence.

## Evidence reviewed

Primary product documentation:

1. [Service Manager 9.80 defined JavaScript objects](https://docs.microfocus.com/doc/Service_Manager/9.80/ServiceManagerDefinedJavascriptObjects)
   describes SCFile as an SM-specific object used to access, update, and move
   between SM files.
2. [SCFile.doSelect](https://docs.microfocus.com/doc/425/9.63/javascriptmethodscfiledoselect)
   documents a Service Manager query argument and return codes including
   `RC_SUCCESS` and error return codes.
3. [SCFile.getNext](https://docs.microfocus.com/SM/9.52/Hybrid/Content/programming/javascript/reference/javascript_method_scfile_getnext.htm)
   documents movement to the next record and the global return-code contract.
4. [Restricting fields selected by a query](https://docs.microfocus.com/SM/9.60/Codeless/Content/programming/javascript/concepts/restricting_fields_selected_by_query.htm)
   gives the canonical pattern `rc = file.doSelect(query)` followed by
   `while (RC_SUCCESS == rc) { ...; rc = file.getNext(); }` and documents the
   performance purpose of read-only SCFile plus `setFields`.
5. [SCFile object reference](https://docs.microfocus.com/SM/9.50/Hybrid/Content/programming/javascript/reference/javascript_object_scfile.htm)
   lists SCFile constructors and methods and states that its methods use
   Service Manager global return codes.
6. [Corresponding RAD and JavaScript syntax](https://docs.microfocus.com/SM/9.52/Codeless/Content/programming/javascript/wp/Corresponding_JavaScript_syntax.htm)
   maps SM select/CRUD tasks to SCFile calls whose results are assigned to a
   return-code variable.

Evidence boundary:

- These sources cover several 9.x documentation versions, including an official
  9.80 object catalog, but they do not prove every customer customization.
- The query passed to `doSelect` is an SM query. It must not be labeled SQL unless
  a separately verified integration actually uses SQL.
- No official source reviewed in this audit establishes a mandatory `doClose`
  lifecycle for SCFile.
- RAD, RuleSet, `lib.*`, `vars.*`, `funcs.*`, and custom wrapper semantics remain
  unverified and must not be inferred from their names.

## Current architecture assessment

### Reusable without public API change

- `AnalysisArtifact`: parse once and retain internal AST and raw diagnostics.
- `RuleContext`: AST/source/diagnostics/range access for SM analyzers.
- `RuleRunner`: valid-only gating, config validation, severity override,
  deterministic ordering, same-rule deduplication, and failure isolation.
- `SourceLocation`: 1-based line/column, 0-based UTF-16 offset, end-exclusive
  ranges, suitable for JSON, HTML, and future editor diagnostics.
- Existing generic control-flow helpers: safe termination checks and loop-exit
  recognition can be shared, but are not a full control-flow graph.

### Missing capabilities

- Identification of `new SCFile(...)` bindings.
- Member-call extraction with receiver identity and argument ranges.
- Direct assignment and one-hop alias tracking.
- Return-code use classification: ignored, assigned, compared, returned, passed,
  or unknown.
- Per-function event ordering and branch-aware state joins.
- Project-specific API catalog and evidence provenance.
- Batch review, stable report schema, HTML escaping, and CLI review command.

### Explicit non-capabilities

- No TypeScript `Program`, type checker, interprocedural call graph, or runtime
  execution.
- No reliable identity after arbitrary property storage, container mutation,
  closure capture, dynamic property access, `eval`, or unknown custom wrappers.
- No proof that parser acceptance implies compatibility with the SM JavaScript
  runtime.

## Proposed internal architecture

```text
SourceDocument
  -> AnalysisArtifact
  -> SM API catalog
  -> per-function SM event extraction
  -> lightweight symbol/alias tracking
  -> bounded control-flow state evaluation
  -> SM rule evaluators
  -> existing RuleRunner normalization
  -> ReviewResult
```

Proposed files:

```text
src/sm/api-catalog.ts
src/sm/events.ts
src/sm/extract-events.ts
src/sm/symbols.ts
src/sm/flow.ts
src/sm/evidence.ts
src/rules/builtin/sm-return-code.ts
src/rules/builtin/sm-query-loop-progress.ts
src/rules/builtin/sm-dynamic-query.ts
```

Do not put SM semantics into `RuleRunner`. The runner must remain domain-neutral.
Do not expose TypeScript AST nodes in JSON output.

## Proposed analysis contracts

```ts
type SmApiEvidenceStatus = 'official' | 'project-verified' | 'unverified';

interface SmApiMethodSpec {
  readonly objectType: 'SCFile' | 'SCDatum' | 'custom';
  readonly method: string;
  readonly category: 'select' | 'cursor' | 'read' | 'write' | 'action';
  readonly returnsCode: boolean;
  readonly evidenceStatus: SmApiEvidenceStatus;
  readonly evidenceUrls: readonly string[];
}

interface SmBinding {
  readonly id: string;
  readonly name: string;
  readonly objectType: SmApiMethodSpec['objectType'];
  readonly declarationRange: SourceRange;
  readonly certainty: 'direct' | 'alias';
}

interface SmCallEvent {
  readonly bindingId: string;
  readonly receiverText: string;
  readonly method: string;
  readonly callRange: SourceRange;
  readonly argumentRanges: readonly SourceRange[];
  readonly resultUse: 'ignored' | 'assigned' | 'condition' | 'returned' | 'passed';
  readonly resultTarget?: string;
}
```

All contracts remain internal in Sprint 3. They may change after real-source UAT.

## Error and uncertainty policy

- SM rules default to `valid-only`.
- Unknown receiver identity, alias escape, dynamic method name, or unsupported
  control flow produces no deterministic finding.
- A rule may emit a heuristic finding only when explicitly classified as
  heuristic, with confidence and evidence.
- Flow evaluation must cap branch/path expansion and join to `unknown` instead
  of timing out or claiming certainty.
- One file or rule failure must not stop batch review of other files.

## Delivery sequence

1. Obtain anonymized representative SM sources and confirm the API catalog.
2. Implement event extraction and direct/one-hop symbol tracking with tests.
3. Implement return-code consumption analysis for officially documented methods.
4. Implement query-loop progress analysis for canonical SCFile cursor patterns.
5. Consider dynamic-query heuristics only after the project defines acceptable
   construction patterns.
6. Reconsider close/lifecycle rules only after `doClose` semantics are verified.
7. Add CLI `review`, versioned JSON, escaped static HTML, and batch isolation.
8. Run UAT and tune only from recorded false-positive/false-negative examples.

## Phase A approval gates

The project owner and independent reviewer must decide:

1. Whether project SCFile objects really expose `doClose`, its version/source,
   and whether it is mandatory, optional, or wrapper-specific.
2. Which methods require their return code to be checked, and what counts as
   consumption beyond direct comparison with `RC_SUCCESS`.
3. Whether query concatenation is forbidden, conditionally allowed, or only an
   informational heuristic.
4. The allowed alias depth and whether interprocedural analysis is required for
   the representative codebase.
5. The minimum UAT corpus and acceptable false-positive rate for enabling each
   heuristic rule by default.

