# ADR 0004: AI review foundation and context boundaries

- Status: Proposed for independent review
- Date: 2026-10-27

## Context

AI review is optional and supplementary to deterministic static analysis. Source
may contain credentials, personal data, misleading comments, or prompt-injection
text. Providers differ in tokenization, request schemas, usage reporting, and
failure behavior. Existing parser, static finding, CLI, and report contracts must
remain usable without AI.

## Decision

1. Keep AI findings separate from static `Finding`. AI findings carry assertion
   kind, confidence, evidence references, model/provider metadata, and local
   validation status; model output alone never makes a finding deterministic.
2. Use a provider-independent `AIProvider` contract. Calls receive structured
   context, trusted reviewer instructions, explicit limits, cancellation, and
   explicit source-transmission permission. Phase A provides only an offline fake.
3. Build function-level context by default from existing `SourceDocument`,
   `AnalysisResult`, parser diagnostics, and static findings. Preserve UTF-16
   offsets and 1-based line/column locations.
4. Mark all source snippets as untrusted data. Source comments are never merged
   into trusted instructions and must not alter reviewer policy.
5. Select content deterministically. Preserve the target before optional nearby
   source, bound findings/functions, and record every budget-driven omission or
   truncation.
6. Use a labeled character-based token estimate. It is not provider token usage.
   Providers may report their own optional usage without changing the estimate.
7. Validate structured responses locally. Reject malformed fields, invalid
   confidence, mismatched source identity, positions outside or inconsistent
   with the supplied snippet, and unknown evidence references.
8. Disable AI and source transmission by default. Do not store credentials or
   log raw prompts/full source. Provide deterministic redaction hooks for future
   integrations.
9. Do not execute analyzed source, auto-fix code, write to SM, or infer new SM
   semantics from model output.

## Budget policy

The preliminary budget has independent limits for context characters, estimated
input tokens, reserved output tokens, findings, and functions. The effective
source/evidence character limit is the smaller of the configured character limit
and estimated input tokens multiplied by estimated characters per token. Target
source is selected first. Findings, diagnostics, and nearby source are optional
and are included only while budget remains.

## Privacy boundary

No network provider, API key lookup, credential store, telemetry, or AI CLI flag
exists in Phase A. `requestAIReview()` refuses calls without explicit permission.
The fake provider performs no network I/O and exists only to test contracts,
timeouts, cancellation, failures, and response validation.

## Known limitations

- Character/token estimates are deliberately approximate.
- Context relevance is range-based; there is no dependency graph or
  interprocedural summary.
- Redaction hooks are available, but no project-specific secret detector is yet
  approved.
- Runtime validation establishes schema and source grounding, not correctness of
  the model's reasoning or SM semantics.

## Phase B prerequisites

Before integrating a live provider, the project owner must approve provider and
model policy, data residency, source-transmission consent UX, secret-redaction
policy, retry/rate limits, credential handling, logging/retention, and evaluation
criteria. Phase B must preserve static results when AI is unavailable and must
add explicit opt-in configuration rather than enabling AI by default.
