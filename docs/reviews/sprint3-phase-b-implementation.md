# Sprint 3 Phase B implementation report

- Status: Complete locally; pending independent review
- Date: 2026-10-27
- Scope: SM-specific internal analysis and two static rules only

## Implementation summary

Phase B adds a read-only, intraprocedural SM analysis layer without changing the
public `AnalysisResult`, `RuleContext`, or `Finding` contracts. It never executes
analyzed source and does not access an SM environment.

The implementation consists of:

- an evidence-backed SCFile API catalog;
- typed construction, call, return-code, and comparison events;
- lexical symbol scopes with direct bindings, one-hop aliases, shadowing, and
  reassignment invalidation;
- conservative sequential/branch/loop analysis with bounded path states;
- `SM-RC-001` and `SM-LOOP-002`, both `valid-only` deterministic rules.

## SM API evidence matrix

| Object | Method | Category | Return code | Evidence | Analysis limitation |
|---|---|---:|---:|---|---|
| SCFile | `doSelect` | select | verified | Official SM 9.60 method reference | SM query, not assumed SQL |
| SCFile | `getNext` | cursor | verified | Official SM 9.60 method reference | Only direct/one-hop receiver identity |
| SCFile | `getLastRC` | read | verified | Official SM 9.60 method reference | No interpretation of specific numeric code |
| SCFile | `doInsert` | write | verified | Official SM 9.60 method reference | No record-schema validation |
| SCFile | `doUpdate` | write | verified | Official SM 9.60 method reference | No authorization/business-policy inference |
| SCFile | `doDelete` | write | verified | Official SM 9.60 method reference | No authorization/business-policy inference |

`doClose` is deliberately absent. No accepted evidence establishes a mandatory
SCFile close lifecycle.

## Result-use policy for SM-RC-001

| Use | Policy |
|---|---|
| Expression statement | Finding: result is discarded |
| Simple variable assignment with no later supported use | Finding: assigned but unconsumed |
| Comparison/condition | Suppress: possible handling |
| Returned from function | Suppress: ownership transferred |
| Passed as call argument | Suppress: possible handler |
| Unsupported arithmetic/property/dynamic use | Suppress as ambiguous |
| Used on loop back-edge condition | Suppress: condition consumes next iteration's result |

This policy does not claim that comparison, return, or passing is adequate error
handling. It only avoids the narrower finding that the result is unobserved.

## Flow policy for SM-LOOP-002

The rule recognizes equality with `RC_SUCCESS` in either operand order, strict or
loose equality, plus the equivalent negated inequality. It requires the condition
variable to originate from the same tracked SCFile binding's `doSelect` or
`getNext` result.

Supported body flow is bounded to a finite set of path states across sequential
statements, blocks, and if/else. An unconditional matching `getNext` update makes
all continuing paths progress. For-loop incrementors are included, and a
`continue` path reaches the incrementor as required by JavaScript semantics. A
conditional update without an else leaves a non-progress path. A possible
break/return/throw suppresses the finding under the shared conservative exit
policy.

Nested loops, switch, try/catch/finally, unknown return-code reassignment, deep
aliases, and dynamic property calls produce unknown and suppress deterministic
output. The analysis does not unroll loops and its path state set is deduplicated,
so complexity is bounded by AST size rather than runtime iteration count.

## Known limitations and expected misses

- No interprocedural summaries or custom wrapper semantics.
- Destructuring, property-stored identities, computed methods, and aliases deeper
  than one hop are unknown.
- Any supported/ambiguous return-code use suppresses `SM-RC-001`, even if only one
  branch handles the result.
- Deferred function bodies are analyzed for their own local findings, but are not
  treated as executed at declaration time. Captured SCFile identity is unknown;
  captured return-code reads make the producer ambiguous. Invocation order and
  call effects remain intentionally unmodeled.
- Any possible syntactic loop exit suppresses `SM-LOOP-002`, even if unreachable.
- Unknown helper calls are not assumed to advance the tracked return-code
  variable; the finding still describes only missing visible supported progress.
- Whole-program exception and non-returning-call behavior is not modeled.
- Method-level evidence currently comes from official SM 9.60 references while
  the SCFile object itself is confirmed in the official 9.80 catalog. Patch-level
  9.8x equivalence remains a UAT requirement.
- Real SM ScriptLibrary UAT is still required before coverage claims or severity
  tuning.

## Explicit exclusions

- No mandatory `doClose` rule.
- No SQL classification for SM query strings.
- No CLI review, JSON/HTML reporting, batch review, AI, editor, or connector work.

