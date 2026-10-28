# SCFile state execution-scope isolation

## Purpose

`getScFileStateAnalysis` now evaluates `setFields()` state only within the
execution scope that created a tracked `SCFile` identity. A function declaration
does not execute its body. Consequently, a later declaration that captures an
outer `SCFile` cannot change the outer object's field-selection state merely by
appearing in source.

For a source-level construction, only source-level statements are projected.
For a construction inside a function-like body, only that function's block is
projected. Nested function-like bodies are excluded. Objects with the same local
variable name in different functions therefore keep separate state.

## Conservatism and limitations

This remains intraprocedural analysis. The reviewer does not determine whether a
callback, closure, wrapper, or dynamically selected function is invoked. It
does not propagate captured-object effects across a call boundary. Where such an
effect would be required to establish a safe state, the analyzer leaves the
state unknown rather than inferring an invocation from a declaration.

Branch merging is unchanged: identical known selections remain known; distinct
or one-sided selections become unknown. Alias reassignment continues to end
tracking for that alias. This change neither adds nor changes verified SCFile API
contracts or the P0 findings `SM-SCF-001` through `SM-SCF-004`.
