# ADR 0003: Evidence-gated SM semantic analysis

- Status: Proposed for independent review
- Date: 2026-10-26

## Context

Sprint 3 introduces rules for APIs that exist in the Service Manager JavaScript
runtime rather than Node.js. Names alone do not establish API identity or
behavior, and customer installations can add wrappers and conventions. A false
claim about resource lifecycle, query language, or return-code handling would be
more harmful than a conservative missed finding.

## Decision

1. Introduce an internal, evidence-backed SM API catalog. Each method records its
   object type, behavior category, return-code contract, evidence status, and
   source URLs.
2. Extract SM calls into typed per-function events before evaluating rules.
   Individual rules consume shared events instead of independently guessing
   receiver identity and aliases.
3. Begin with direct bindings and one-hop aliases. When identity escapes through
   properties, containers, closures, dynamic access, or unknown calls, join the
   state to unknown and suppress deterministic findings.
4. Keep analysis intraprocedural for the Sprint 3 MVP. Interprocedural summaries
   require a separate decision after representative-source UAT.
5. Treat official product documentation as evidence for built-in APIs and
   verified project examples as evidence for custom wrappers. Unverified names
   cannot support deterministic findings.
6. Call `doSelect` input an SM query, not SQL. Security or injection wording is
   prohibited until the relevant grammar, escaping, and trust boundary are
   verified.
7. Do not implement mandatory `SCFile.doClose` or use-after-close rules until the
   project supplies a verified lifecycle contract. Official SCFile method lists
   reviewed in Phase A do not document `doClose`.
8. Reuse the generic Rule Engine unchanged. SM analyzers remain internal and do
   not add AST nodes to public JSON contracts.
9. Default SM rules to `valid-only`. Unknown state produces no deterministic
   finding; heuristic output requires explicit classification and confidence.
10. Bound flow exploration and prefer false negatives to speculative findings.

## Alternatives considered

- Per-rule AST traversal: simpler initially, but duplicates identity and flow
  logic and causes inconsistent findings.
- Full TypeScript type checker: does not know SM runtime types without reliable
  declarations and still would not solve project wrapper semantics.
- Full interprocedural CFG/data flow in Sprint 3: higher theoretical coverage but
  disproportionate complexity before real-source UAT establishes need.
- Assume `doClose` is mandatory from the sample: rejected because the sample is
  not authoritative evidence and official method catalogs reviewed do not list it.

## Consequences

- Initial coverage is intentionally narrow and explainable.
- API evidence and project policy can evolve without changing the rule runner.
- Some real defects involving deep aliases or wrappers will be missed in the MVP.
- Phase B cannot start for lifecycle or custom API rules until the corresponding
  evidence gate is satisfied.

