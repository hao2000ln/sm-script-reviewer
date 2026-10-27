# Sprint 5B — VS Code AI review integration

Status: implemented locally; independent review and production-provider UAT pending.

The extension reuses `reviewInMemoryDocument()` and the existing Sprint 4
`runAIReview()` orchestration through a one-file `BatchReviewResult` adapter.
It does not duplicate parsing, static rules, context building, provider request
budgeting, or response validation.

AI is disabled by default. API keys are stored only in VS Code Secret Storage.
Each manual AI review asks for source-transmission consent and identifies the
endpoint hostname. Static diagnostics and model-generated diagnostics use
separate collections. The existing lifecycle epoch/generation mechanism drops
stale AI responses after a new request, document close, or diagnostics disable.

The MVP remains one selected function context per file. Coverage is surfaced as
complete, partial, failed, or not-run and must not be read as a whole-file AI
guarantee. Production verification is blocked by `credit_balance_exhausted`.
