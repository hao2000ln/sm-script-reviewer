# Sprint 5D UAT

In VS Code settings set `smReviewer.language` to `vi`, `en`, then `auto` and
verify Problems, hover, suggestions, evidence, and notifications change only at
the presentation layer. Rule IDs, locations, and severities must remain stable.

Run **SM Reviewer: Review Folder** from Explorer on a folder containing nested
`.js` and `.txt` ScriptLibraries. Verify `.git`, `node_modules`, `dist`, hidden
folders, symlinks, and `smReviewer.folderReview.exclude` are skipped. Set
`smReviewer.folderReview.maxFiles` to a small value and confirm the incomplete
warning. Dirty open files use their in-memory text; the summary reports this
behavior. Folder review never calls AI. Use **Clear Folder Review Results** to
remove only folder diagnostics.
