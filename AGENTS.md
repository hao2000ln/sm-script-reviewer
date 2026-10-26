# AGENTS.md — SM ScriptLibrary Reviewer

## Project mission

Build an **independent, read-only code quality and review tool** for JavaScript ScriptLibrary sources used in **OpenText / HPE Service Manager (SM 9.8x)**.

The tool must help identify syntax and structural problems, coding-convention violations, SM-specific API misuse, risky control flow, and maintainability concerns. It must explain findings with evidence and source locations. **Never execute analyzed SM source or write changes back to an SM instance.**

Repository: https://github.com/hao2000ln/sm-script-reviewer

Read `README.md`, `docs/PROJECT_PLAN.md`, and `docs/decisions/` before proposing architecture changes. The project plan describes planned work, not necessarily implemented features. Inspect code and tests to establish the actual state.

## Runtime boundaries

- The reviewer is implemented in **TypeScript/Node.js**; the reviewed code targets the **SM JavaScript runtime**, not Node.js or browsers.
- Do not assume SM source supports modern JavaScript syntax or Node.js APIs merely because TypeScript can parse it.
- Parse source **without executing it**. Keep `ScriptTarget.Latest` for tolerant structural analysis; runtime compatibility checks belong in explicit rules.
- SM-specific semantics (`SCFile`, `SCDatum`, `doSelect`, `getNext`, `doClose`, RAD, RuleSet, return codes, `lib.*`, `vars.*`, `funcs.*`) must be supported by verified examples or documented evidence. Do not invent SM behavior.
- Prefer deterministic static analysis for objectively checkable rules. AI review is a later, supplementary layer; uncertain findings must be labeled as such.

## Roadmap and scope

1. **Sprint 1 — Core Foundation & Parser:** source loader, CLI, AST parser, function/comment indexers, diagnostics, source locations, regression tests.
2. **Sprint 2 — Static Rule Engine:** rule registry, configurable rules, comment/debug/code-hygiene checks, safe control-flow checks.
3. **Sprint 3 — SM-Specific Rules & Reports:** `SCFile`/RAD patterns, return codes, loop risks, JSON/HTML reports, batch review. **Offline MVP milestone.**
4. **Sprint 4 — AI Review:** SM knowledge base, logic review, confidence and deduplication.
5. **Sprint 5 — VS Code Extension:** review source and display findings in the editor.
6. **Sprint 6 — Read-only SM Connector & UAT:** source extraction, batch validation with representative SM scripts, operational documentation.

Do not implement future-sprint features unless the project owner explicitly requests them.

## Sprint 1 contracts and review focus

- Preserve existing public `AnalysisResult` fields and document any additive schema change.
- Keep parser orchestration separate from comment/function/location indexing where practical.
- Handle function declarations, expressions, arrows, object/property methods, nested functions, anonymous functions, and straightforward assignment-name inference.
- Avoid false comment positives in strings, templates, and regular expressions.
- Associate comments conservatively: preserve contiguous documentation groups; exclude trailing comments and detached comments. Test multiple variable declarators, nested scopes, same-line block comments, and code/comment boundaries.
- Report parse diagnostics and recoverable AST entries without claiming semantic reliability near syntax errors.
- Locations: `line` and `column` are **1-based**; `offset` is **0-based UTF-16**; `end` is **exclusive**. Changes to JSON output are schema changes even if additive.
- Treat TypeScript `SourceFile.parseDiagnostics` as an implementation detail requiring regression coverage.

## Coding and testing expectations

- Prefer small, cohesive modules, explicit types, readable code, and stable public interfaces.
- Add a regression test for every fixed defect; include positive, negative, and boundary cases.
- Run relevant checks before reporting completion (`npm ci` if lockfile is available, `npm test`, CLI text/JSON smoke tests, and `git diff --check` as appropriate).
- Distinguish **tests actually run** from checks not run; report failures and environment constraints accurately.
- Never claim that parser acceptance proves SM runtime compatibility.
- Do not silently change architecture or expand task scope. Propose significant changes with rationale, alternatives, risks, and tests.
- Source inspection and review must be read-only with respect to SM environments.

## Collaboration model

- **Project owner:** approves scope and architecture decisions; personally performs Git history/remote operations and decides merges.
- **Codex:** implementation engineer and technical challenger. Audit, implement, test, document, and challenge assumptions with evidence.
- **ChatGPT:** solution architect and independent reviewer. Review architecture, SM semantics, diffs, regression coverage, and acceptance criteria.
- Codex and ChatGPT **do not automatically share chat context**. Preserve decisions in repository documentation, PR descriptions, and review reports.
- Independent disagreement is encouraged when supported by code, tests, or reliable SM documentation. Neither AI has automatic final authority.

## Git and approval policy — mandatory

**The project owner performs all Git/GitHub write operations manually. Codex must never execute them.**

**Do not execute**:

- `git switch -c`, `git checkout -b`, or other branch-creation commands
- `git add`, `git commit`, `git push`
- `git merge`, `git rebase`, `git cherry-pick`, `git revert`, or `git reset --hard`
- branch deletion, tag creation/update, or force-push operations
- `gh pr create`, `gh pr merge`, releases, or any GitHub API write operation
- GitHub comments, reviews, labels, issue/PR state changes, or other remote mutations

You may inspect repository status, diffs, history, and PRs read-only. You may edit source files and run local build/tests for an approved implementation task. **Provide commands for the owner to run manually** when branch creation, staging, committing, pushing, PR creation, or merging is required. Do not interpret a request to “finish the task” or conversational approval as permission to perform Git/GitHub write operations. If this policy changes, the project owner must update `AGENTS.md` before the new policy takes effect.

## Task workflow

1. Read task, current source, tests, and relevant ADRs.
2. Provide a brief audit/plan before significant implementation; surface architecture decisions for review.
3. Implement only the approved scope, preferably with failing regression tests first.
4. Run checks and document actual results.
5. Stop before Git write operations; provide a concise handoff:
   - changed files and why;
   - build/test commands and results;
   - assumptions, known limitations, and unresolved risks;
   - suggested commit message;
   - exact **manual** Git/PR commands for the owner;
   - questions requiring independent ChatGPT review.
6. Wait for owner approval before any further scope expansion.

## Current status

Delivery status is tracked in `docs/PROJECT_PLAN.md` and the relevant pull request or review report. Always verify the current branch, code, tests, and PR state; do not infer implementation status from roadmap text alone.
