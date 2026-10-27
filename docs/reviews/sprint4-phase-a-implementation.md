# Sprint 4 Phase A implementation report

- Status: Complete locally; pending independent review
- Date: 2026-10-27
- Scope: Offline AI contracts, context building, budgeting, validation, and privacy foundation

## Implemented components

- provider-independent request/response, usage, limits, structured errors,
  cancellation, timeout, and explicit permission gateway;
- offline fake provider with no SDK, endpoint, API key, or network access;
- function-first context builder using existing source, analysis, diagnostics,
  function index, and static findings;
- deterministic character/token budgeting with explicit omission and truncation
  metadata plus full serialized-request enforcement at the provider boundary;
- separate AI finding/evidence schema with assertion kind, confidence,
  provider/model metadata, and validation status;
- local structured-response validation for fields, enums, confidence, source
  identity/ranges, line mapping, evidence references, finding-count limits, and
  bounded text fields;
- disabled-by-default privacy policy and composable redaction hooks.

## Architecture decisions

The static review pipeline and public contracts are unchanged. Source text is
structured as untrusted data and is never combined with trusted instructions.
AI findings do not extend or replace static findings. The token estimate is
explicitly approximate and provider usage, when available, remains separate.
The provider gateway measures the complete serialized request rather than
trusting context usage metadata, and context construction rejects foreign or
out-of-range static findings.
See ADR 0004 for the complete decision and Phase B gates.

## Verification

Executed on 2026-10-27:

| Command | Result |
|---|---|
| `npm run build` | Pass |
| `npm test` | Pass; 116/116 tests |
| `node sprint2-acceptance.cjs` | Pass; 17/17 cases |

The 19 focused AI foundation tests cover provider success/failures, permission,
timeout/cancellation, request limits, function context, stable ordering, source
locations, small budgets, omissions/truncation, empty/invalid context,
prompt-injection comments, parser diagnostics, malformed responses, confidence,
invented positions/references, privacy defaults, and redaction hooks.

## Limitations

- no live provider, AI CLI, credential storage, prompt logging, or network calls;
- no interprocedural/dependency context or SM knowledge base;
- no provider tokenizer; the current estimate uses configurable characters per token;
- no automatic secret detection beyond future redaction hooks;
- validation proves structure and grounding only, not semantic correctness.

## Phase B prerequisites

Provider/data-governance approval, explicit consent UX, credential and retention
policy, approved redactors, live-provider error/retry policy, offline fallback,
and representative evaluation fixtures are required before integration.
