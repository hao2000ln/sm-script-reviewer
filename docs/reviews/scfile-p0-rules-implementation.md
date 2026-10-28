# SCFile P0 rules implementation

Date: 2026-10-28. Target: OpenText/HPE Service Manager 9.8x ScriptLibrary.
Static analysis only; source is never executed.

## Rule-ID mapping and policy

| ID | Status | Default severity | Evidence boundary |
|---|---|---:|---|
| `SM-SCF-001` | implemented | error | A direct/one-hop tracked object has verified READONLY mode and calls verified `doUpdate`, `doInsert`, or `doDelete`. |
| `SM-SCF-002` | implemented | warning | A direct/one-hop tracked object has verified READWRITE mode and calls `setFields()` with no statically invalid arguments. |
| `SM-SCF-003` | implemented | error | `setFields()` has a proven invalid count/type: number, boolean, object literal, literal mixed array, or >1 argument. |
| `SM-SCF-004` | implemented | error | A recognized SCFile constructor has >2 arguments, numeric/boolean first literal, or string/boolean second mode literal. |
| `SM-RC-003` | not added | — | Existing `SM-RC-001` already produces exactly one warning for ignored `doInsert`/`doUpdate`/`doDelete` results. A second ID would duplicate the same evidence. |

The registry had no `SM-SCF-*` collision. Existing IDs and their semantics are
unchanged. All new rules are deterministic with confidence `1` and valid-only
syntax policy.

## API evidence and constraints

The catalog retains 9.60 SCFile object/method evidence and 9.80 `setFields`
evidence. READONLY is only established by literal second argument
`SCFILE_READONLY`; omitted mode is the documented normal/read-write mode.
`setFields()` is documented for initialized READONLY objects and accepts zero
arguments, one string, or one string array. These documents still require
representative 9.8x UAT. `doRemove()` remains unknown for the target and is not
treated as `doDelete()`.

Sources: [SCFile object 9.60](https://docs.microfocus.com/SM/9.60/Codeless/Content/programming/javascript/reference/javascript_object_scfile.htm),
[setFields 9.80](https://docs.microfocus.com/doc/Service_Manager/9.80/JavascriptMethodscfilesetfields),
and [doRemove 9.52](https://docs.microfocus.com/SM/9.52/Hybrid/Content/programming/javascript/reference/javascript_method_scfile_doremove.htm).

## State hardening and false-positive prevention

The state projection now merges `setFields` selections by control-flow branch:
equal known selections remain known; different or one-sided selections become
`unknown`. Loop/switch/try flow is merged with its entry state instead of using
the last syntactic event. Dynamic field lists and unknown calls on a tracked
receiver invalidate selection. Direct local bindings and one-hop aliases are
supported; reassignment invalidates a binding. Deferred closures never receive
an outer SCFile identity. This is intraprocedural and not a claim of complete
control-flow or interprocedural coverage.

Rules suppress findings for unknown dynamic modes, unknown receivers, deep or
property aliases, reassigned aliases, shadowed constructors/variables, and
unverified `doRemove`. `SM-SCF-002` suppresses itself when `SM-SCF-003` has a
proven argument violation on the same call, avoiding duplicate diagnostics.

## Acceptance matrix

Exact executable input strings and assertions are in
`tests/scfile-rules.test.ts`, `tests/scfile-state.test.ts`, and
`tests/fixtures/scfile-contract.ts`.

| Cases | Input shape | Expected result / justification | 9.8x UAT |
|---|---|---|---|
| TC01–02 | normal/READONLY + `doSelect` | no SCF-001; select is not approved write scope | yes |
| TC03–05 | READONLY + update/insert/delete | one `SM-SCF-001` error per call, call + constructor evidence | yes |
| TC06–07 | normal/unknown mode + update | no SCF-001; mode is writable or unknown | yes |
| TC08–10 | one-hop alias; reassigned alias; shadowed local | alias reports once; invalidated/shadowed names report none | yes |
| TC11–13 | READONLY/normal/unknown + valid `setFields` | no SCF-002 for READONLY/unknown; normal gets one warning with contract + constructor evidence | yes |
| TC14–17 | number, boolean, object, mixed literal array | `SM-SCF-003` error, statically proven type violation | yes |
| TC18–20 | reset, string, string array, `new Array(strings)` | no SCF-003; documented syntax or statically all-string array | yes |
| TC21 | READONLY without setFields | no finding; setFields is never mandatory | yes |
| TC22–24 | branches different/one-sided/equal fields | final selection unknown/unknown/known respectively; no field-access rule | yes |
| TC25 | dynamic field list | no SCF-003; type cannot be proven | yes |
| TC26 | deferred closure captures READONLY object | no SCF-001; declaration is not execution | yes |
| TC27–28 | ignored/checked write result | exactly one existing SM-RC-001/no return-code finding | existing UAT pending |
| TC29 | READONLY + `doRemove` | no SCF finding; target API unsupported | required before implementation |
| TC30 | existing RC/LOOP corpus | unchanged behavior in `sm-rules.test.ts` | existing UAT pending |
| Constructor | 0/1/2 documented args vs literals/count | `SM-SCF-004` only for proven count/type violations; dynamic mode remains silent | yes |

Ranges, severity, confidence, deterministic ordering, no duplicate findings,
and evidence counts are asserted by the automated tests.

## Presentation and compatibility

Rules are registered in the existing Rule Engine, so CLI text/JSON/HTML,
folder review, and VS Code diagnostics use the same findings/fingerprints.
Vietnamese VS Code localization (`smReviewer.language=vi`) supplies finding,
suggestion, evidence, title, and description for `SM-SCF-001` to `004`.
English mode preserves the core English message and stable rule IDs.

## Remaining limitations and recommended next phase

No field-read-after-selection, DBDICT, SQL, RAD, `doClose`, `doRemove`, custom
wrapper, property alias, or interprocedural rule was added. Runtime UAT on the
project's SM 9.8x environment is still required before treating error findings
as release-blocking. Next review should validate these P0 messages on
representative ScriptLibraries, then decide whether `setFields` mode remains a
warning or becomes project-policy configurable.
