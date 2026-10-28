# Roadmap assessment and Phase A implementation

Date: 2026-10-28. This assessment uses current source/tests rather than stale
roadmap status. The reviewer remains read-only and offline by default.

## Current implementation audit

| Area | Status | Evidence / limitation |
|---|---|---|
| Parser/indexer | READY | TypeScript AST, locations, comments, recovery tests; parsing is not SM runtime validation. |
| Rule engine | READY | Configurable deterministic/heuristic rules, stable fingerprints, syntax gating and isolated errors. |
| SM/SCFile analysis | CONDITIONAL | Direct/one-hop SCFile, RC/loop and P0 contracts; 9.8x UAT remains necessary. |
| Batch CLI/reporting | READY | Stable folder discovery, text/JSON/HTML, file failure isolation. |
| AI | CONDITIONAL | Explicit consent, local mocks, one-context/file MVP; no accuracy claim. |
| VS Code extension | READY for local UAT | Static/folder review and Vietnamese presentation; real-host UAT remains manual. |
| Real ScriptLibrary UAT | READY | Implemented below; no real corpus is stored in this repository. |
| Dependency graph | NOT STARTED | No declared corpus-completeness contract or `lib.*` resolver. |
| SM connector | BLOCKED | No approved environment-specific source/authentication contract. |
| DBDICT/RAD metadata | CONDITIONAL | SCFile catalog exists; no complete versioned table/field/RAD source. |

Risks: documentation versions mix 9.60/9.80; symbol analysis is deliberately
intraprocedural; existing fingerprints change with source; project-plan status
does not always match current source.

## Revised implementation order

1. **Phase A — READY, implemented:** obtain approved exports, label findings,
   measure false positives, and record SM 9.8x UAT.
2. **Phase D foundation — CONDITIONAL:** define versioned metadata provenance
   and completeness before missing table/field/RAD errors.
3. **Phase B — CONDITIONAL:** add `lib.*` dependency graph only after corpus
   completeness and export naming conventions are approved.
4. **Phase E — CONDITIONAL:** build trends only after Phase A has labels; never
   calculate a false-positive rate without ground truth.
5. **Phase C — BLOCKED:** design/implement only after an owner-approved,
   read-only SM source retrieval and authentication contract exists.
6. **Phase F — CONDITIONAL:** enrich opt-in AI with approved versioned evidence;
   preserve consent and never make automatic code changes.

This moves metadata before dependency “missing library” errors, and validates
rule quality before reports/AI make broader accuracy claims.

## Phase A delivered

`src/uat/baseline.ts` runs the existing batch reviewer and records
path-qualified identities, raw fingerprints, manual labels, deterministic vs
heuristic counts, unsupported files, file failures, parser/syntax coverage, and
unmatched labels. Snapshot comparison distinguishes new, removed, persistent,
and changed-source entries. An unmatched prior label is never called resolved.

`npm run uat:baseline -- <folder> ...` prints a Vietnamese summary and can
write baseline JSON and a review-label template only when explicit paths are
provided. Commands and data-handling guidance are in `uat/phase-a/README.md`.

## Acceptance and future readiness

| Phase | Complexity | Acceptance criterion |
|---|---:|---|
| A | low/medium | Approved corpus, reproducible labeled baseline, false-positive triage, SM 9.8x UAT record. |
| D foundation | medium | Versioned metadata marks provenance/completeness; absent metadata never yields error. |
| B | medium/high | Static/dynamic dependency distinction, cycles and impact validated against complete corpus. |
| E | medium | New/resolved/persistent snapshots accurate; rates only when labels exist. |
| C | high/risk | Owner-approved read-only API/export/authentication contract; no write capability. |
| F | medium/high | Evidence-linked knowledge, consent, offline mock UAT, independent static findings. |

## Security and operational boundary

Phase A uses no network and never executes reviewed source. Exported source and
labels may be sensitive and belong outside Git. Connector work is blocked until
an approved read-only contract is supplied; AI must never transmit folders
implicitly.
