# SCFile API contract foundation

Date: 2026-10-28. This change adds contracts and state evidence only. It adds
no `SM-SCF-*` finding and does not alter existing CLI, report, extension, AI,
`SM-RC-001`, or `SM-LOOP-002` output.

## Verified contract baseline

| API | Status / version | Contract retained by catalog |
|---|---|---|
| `new SCFile()` / `new SCFile(object)` / `new SCFile(object, SCFILE_READONLY)` | VERIFIED, official 9.60 reference | 0, 1, or 2 arguments; `SCFILE_READONLY` is only recognized as literal second argument. |
| Normal SCFile object | VERIFIED, official 9.60 object reference | State is `READWRITE` when no mode argument is supplied. This is a static interpretation of the documented READONLY switch, not a claim about dynamic arguments. |
| `setFields()` | VERIFIED, official 9.80 reference | zero args reset selection; one string or string-array selects fields; documented for initialized READONLY objects; returns an SM return code. |
| `doSelect()` | VERIFIED, official 9.60/9.80 reference | 1 or 2 argument forms; first query is a string. The second parameter's precise type is retained as unknown. |
| `getNext()`, `getLastRC()`, `doInsert()`, `doUpdate()`, `doDelete()` | VERIFIED, existing official 9.60 catalog | zero-argument, return-code methods. Existing analyzer/rules retain their prior binding restrictions. |

`setFields()` is intentionally marked ineligible for `SM-RC-001` until a
separate rule decision is approved. The state analyzer still preserves a
return-code assignment syntactically; this avoids silently claiming that its
return result was validated by the existing rule.

## Unverified or target-incomplete contracts

`doRemove()` is documented for SM 9.52 as a `doDelete()` synonym, but there is
no supplied or located 9.8x reference/UAT. It is catalogued as `UNKNOWN`, is
not recognized as a verified call, and is never substituted for `doDelete()`.
Dynamic constructor modes, object/record constructor values, wrappers, deep or
property aliases, DBDICT field validity, LDAP behaviour, and field reads are
not statically validated.

Official sources: [SCFile object (9.60)](https://docs.microfocus.com/SM/9.60/Codeless/Content/programming/javascript/reference/javascript_object_scfile.htm),
[setFields (9.80)](https://docs.microfocus.com/doc/Service_Manager/9.80/JavascriptMethodscfilesetfields),
and [doRemove (9.52)](https://docs.microfocus.com/SM/9.52/Hybrid/Content/programming/javascript/reference/javascript_method_scfile_doremove.htm).

## State analyzer design

`getScFileStateAnalysis(context)` is a read-only projection of cached SM event
extraction. One tracked object has a stable constructor-offset identity,
constructor location, static table name where literal, mode and mode certainty,
latest `setFields` selection, method-call locations, alias/reassignment events,
and supporting evidence IDs. The extractor recognizes direct bindings and
one-hop local aliases. Reassignment invalidates the name; subsequent calls are
not attributed to the old object. Deferred closures do not receive captured
outer SCFile identities, so function definition is never interpreted as
execution.

Branches contribute possible events only. After divergent branch values join,
the binding becomes unknown. This is intraprocedural evidence, not control-flow
proof or interprocedural analysis.

## Acceptance corpus and readiness

`tests/fixtures/scfile-contract.ts` contains 16 source fixtures: READONLY
select/setFields/select, write calls, normal mode, numeric/reset `setFields`,
outside-selected-field read, alias/reassignment, dynamic mode, conditional
flow, nested reference, and target-incomplete `doRemove`. Each fixture is
classified as confirmed-valid, confirmed-invalid, contract-dependent, or
unknown; classifications do not cause findings.

Ready for a separately approved next phase:

- `SM-SCF-001` READONLY write calls, limited to direct/one-hop tracked objects
  and verified `doInsert`, `doUpdate`, `doDelete`.
- `SM-SCF-006` `setFields` on known READWRITE objects and known invalid literal
  argument forms, after severity and policy approval.

Not ready: field access after `setFields`, DBDICT validation, dynamic modes,
`doRemove`, lifecycle/`doClose`, wrappers, and full branch/function flow.
