# Sprint 3 SM-specific rule specifications

- Status: Phase B implemented; requires independent review and real-source UAT
- Date: 2026-10-26

These specifications intentionally separate verified product behavior from
project policy. Rule IDs are provisional until independent review accepts them.

## SM-RC-001: Ignored SM return code

- Classification: deterministic for cataloged methods
- Proposed default: enabled
- Severity: warning
- Syntax policy: valid-only
- Initial method scope: officially verified SCFile operations that return global
  return codes, starting with `doSelect` and `getNext`

Report only when all conditions hold:

1. Receiver is directly known as an SCFile binding or supported one-hop alias.
2. Method exists in the verified API catalog and `returnsCode` is true.
3. Call result is an expression statement and therefore ignored, or is assigned
   to a simple tracked variable with no supported observable consumption.

Assignment alone is not handling. Do not report when the result is returned,
passed to another call, used directly as a condition/comparison, or later read
in an unsupported/ambiguous expression. Those cases are possible consumption,
not proof that business handling is adequate. Branch-specific consumption is
joined conservatively: any supported or ambiguous use suppresses a deterministic
finding.

Boundary cases:

- `file.doSelect(query);` -> finding after catalog verification.
- `rc = file.doSelect(query);` with no later use -> finding.
- `if (file.doSelect(query) == RC_SUCCESS) {}` -> no finding.
- `handle(file.doSelect(query));` -> no finding.
- `unknown.doSelect(query);` -> no deterministic finding.
- `wrapper.select(query);` -> no finding until wrapper semantics are verified.

## SM-LOOP-002: SCFile cursor loop does not progress

- Classification: deterministic safe subset
- Proposed default: enabled
- Severity: error
- Syntax policy: valid-only

Candidate loop requirements:

1. Condition is tied to the return code produced by a verified SCFile
   `doSelect`/`getNext` call or directly calls a verified cursor method.
2. At least one continuing path in the supported statement/block/if subset does
   not assign the same SCFile binding's `getNext()` result to the tracked return
   code, and no syntactic loop exit is recognized by the shared helper.
3. Binding identity remains known through the loop.

Do not report general `while (flag)` loops, loops with unknown condition origins,
deep aliases, unknown return-code reassignment, nested loops, switch, or try
inside the analyzed body. The rule proves a supported syntactic progress pattern
is missing; it does not prove runtime non-termination.

Positive fixture:

```js
var file = new SCFile("contacts");
var rc = file.doSelect(query);
while (rc == RC_SUCCESS) {
  process(file);
}
```

Negative fixture:

```js
var file = new SCFile("contacts");
var rc = file.doSelect(query);
while (rc == RC_SUCCESS) {
  process(file);
  rc = file.getNext();
}
```

## SM-QRY-001: Dynamically constructed SM query

- Classification: heuristic
- Proposed default: disabled
- Severity: info
- Confidence: pattern-dependent, never 1
- Syntax policy: valid-only

Potentially report string concatenation or template interpolation passed to
`SCFile.doSelect`. Evidence must show the dynamic expression and call range.

This rule must say **SM query**, not SQL injection. It cannot claim exploitability
without verified SM query escaping, trust-boundary, and authorization semantics.
The project owner must define permitted query builders and escaping helpers before
implementation.

## SM-SCF-001: Missing SCFile close

- Status: blocked
- Reason: official SCFile method catalogs reviewed in Phase A do not document
  `doClose`, and no verified project-specific contract currently establishes a
  mandatory close lifecycle.

Do not implement or enable this rule based only on the repository sample. To
unblock it, provide documentation or representative runtime code that establishes:

- which object exposes `doClose`;
- supported SM versions;
- whether close is mandatory for reads, writes, or both;
- behavior on normal exit, early return, exception, and repeated close;
- whether wrappers automatically close resources.

## SM-SCF-002: Use after close

- Status: blocked with SM-SCF-001
- Reason: a use-after-close state is meaningful only after the close operation
  and lifecycle contract are verified.

## RAD and custom API rules

- Status: deferred
- Required evidence: method signatures, return contracts, representative positive
  and negative source, and project owner confirmation.
- Names such as `lib.*`, `vars.*`, `funcs.*`, or a method resembling an SM API are
  not sufficient evidence.

## Minimum test matrix for every implemented rule

- Direct positive case.
- Direct negative case.
- Nested function boundary.
- Early return and branch join.
- One-hop alias and alias escape.
- Shadowed `SCFile` identifier.
- Computed property access.
- Syntax-invalid source.
- LF, CRLF, and UTF-16 offsets.
- Multiple findings with deterministic order and fingerprints.
- Unknown/custom wrapper suppression.

