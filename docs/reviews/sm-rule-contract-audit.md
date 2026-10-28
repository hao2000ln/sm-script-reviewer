# SM Rule Engine and API Contract Audit

Date: 2026-10-28. Scope: audit only; no rule detection, IDs, severity, provider,
packaging, or SM connector behavior was changed.

## Evidence baseline and current inventory

The only SM API contract encoded by the repository is `src/sm/api-catalog.ts`:
official SCFile object/method references for `doSelect`, `getNext`, `getLastRC`,
`doInsert`, `doUpdate`, and `doDelete` (9.60 documentation; 9.8x UAT pending).
Analysis is conservative, intraprocedural, direct binding/one-hop alias only;
dynamic receivers, wrappers, unknown reassignment, and deferred closures are
ambiguous. ADR 0003 explicitly blocks `doClose` lifecycle claims.

| Existing ID | Status/classification | Audit result |
|---|---|---|
| SM-CMT-001 | project convention | READY; adjacent comments only; CRLF regression added separately. |
| SM-CMT-002/003 | heuristic | Keep opt-in; prose/separator false positives possible. |
| SM-DBG-001 | syntactic policy | CONDITIONAL; direct `print()` is not proof of debug logging. Default should become configurable `off`, `debug-patterns`, `all-print`; default `debug-patterns` only after approved pattern definition. |
| SM-CODE-001, SM-LOOP-001 | deterministic syntax subset | Keep; do not claim runtime reachability/infinite execution. |
| SM-RC-001 | deterministic within catalog/flow subset | READY; only cataloged return values and observable use. Unknown/captured flow remains ambiguous. |
| SM-LOOP-002 | deterministic within supported query-loop subset | READY; error only when a tracked continuing path lacks matching `getNext()` assignment. |

No proposed ID collides with an existing ID. Existing `doDelete` is cataloged;
the requested `doRemove` must not be silently substituted for it.

## Proposed SCFile rules

| IDs | Decision | Evidence / limits / priority |
|---|---|---|
| SM-SCF-001..005 | BLOCKED | Constructor mode and READONLY/write semantics are not in the approved catalog. Need versioned constructor/mode contract and project UAT. P1 after evidence. |
| SM-SCF-006 | BLOCKED | `setFields` signature/reset semantics absent. Need official signature and examples, including `setFields()`. |
| SM-SCF-007..010 | BLOCKED | Require proven field-selection semantics, schema and performance policy; READONLY without `setFields` is never an error by itself. |
| SM-SCF-011 | CONDITIONAL | READY only against an expanded versioned official method catalog and only for confirmed direct SCFile bindings. Custom wrappers/dynamic members excluded. |
| SM-SCF-012 | BLOCKED | Need verified per-method signatures/overloads. |

## Return code, loop, query, RAD and metadata proposals

| ID | Decision | Rationale |
|---|---|---|
| SM-RC-002 field read after failed query | CONDITIONAL | Needs a proven relation between a specific return-code comparison, object record validity, and field access; aliases/unknown helper effects must suppress findings. |
| SM-RC-003 ignored write result | READY | Narrow extension of SM-RC-001 for cataloged `doInsert`/`doUpdate`/`doDelete`; avoid duplicate RC-001 finding by making it a configuration/category view, not a second default finding. P0. |
| SM-LOOP-003 getNext not assigned to controlling code | CONDITIONAL | Potentially overlaps LOOP-002. Implement only as a complementary direct-call misuse rule when no LOOP-002 target exists; otherwise deduplicate. |
| SM-QRY-001 dynamic SM query | HEURISTIC/CONDITIONAL | Dynamic concatenation is not automatically unsafe. Require project escaping policy and confidence/evidence. |
| SM-QRY-002 SQL passed to doSelect | CONDITIONAL | DoSelect is SM query, not generic SQL. Detect only narrow unmistakable SQL tokens with warning/low confidence; never validate actual SQL grammar here. |
| SM-RAD-001/002 | BLOCKED | Need RAD application/parameter metadata contract. `lib.RAD`, `vars`, `funcs`, SCDatum and custom APIs have no verified signatures. |
| SM-DB-001/002 | CONDITIONAL | Need supplied catalog marked complete/versioned plus alias rules. Literal table/field only; dynamic names/incomplete catalog yield no missing-object error. |
| SM-SEC-001 hard-coded secret | HEURISTIC | P2; require string literal + credential context + exclusions/test fixtures; never deterministic. |
| SM-LOG-001 sensitive logging | HEURISTIC | P2; needs approved sensitive-field taxonomy and logging API contract; identifier name alone is insufficient. |

## Required test matrix

For every READY/CONDITIONAL implementation add positive, valid negative, dynamic
ambiguous boundary, alias/reassignment/closure variation, expected range,
severity/confidence, and classification. Mandatory fixtures: READONLY/select,
READONLY/setFields/select, write calls, setFields(number), reset setFields(),
field selection, dynamic mode, query-failure field access, getNext non-update,
RAD mismatch, SQLselect vs doSelect, production error print vs debug print, and
documented function. Conditional cases must assert no finding until contract is
provided.

## Recommended phases and compatibility

P0: retain/fix current parser+RC/LOOP tests; add `SM-RC-003` only with duplicate
policy. P1: import versioned SCFile constructor/setFields metadata, then
SCF-001..012 selectively. P2: project-configured query/security/logging rules.
P3: RAD/dbdict integrations only with supplied metadata adapters.

New findings are additive to CLI/JSON/VS Code contracts; preserve fingerprints,
stable ordering and rule configuration. Do not reinterpret existing severity or
claim SM 9.8x compatibility until representative UAT. BLOCKED rules require
official versioned API documentation or approved project metadata before code.
