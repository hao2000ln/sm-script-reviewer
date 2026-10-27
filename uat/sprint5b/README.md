# Sprint 5B offline mock UAT

No paid API is used. Run from Git Bash or a terminal after installing packages:

```bash
npm run build
cd vscode-extension && npm run build && npm test && cd ..
node uat/sprint5b/run-uat.cjs
```

The runner starts an OpenAI-compatible HTTP mock bound only to `127.0.0.1` and
checks successful model findings, HTTP 429 fallback, malformed responses,
unsaved content, and partial one-function coverage.

## Manual VS Code Extension UAT

Start this server in a dedicated Git Bash terminal and leave it running while
using the Extension Development Host:

```bash
node uat/sprint5b/mock-openai.cjs
```

It binds only to `127.0.0.1:8787`. In VS Code Settings configure:

```json
{
  "smReviewer.ai.enabled": true,
  "smReviewer.ai.model": "local-mock-model",
  "smReviewer.ai.endpoint": "http://127.0.0.1:8787/v1/chat/completions",
  "smReviewer.ai.timeoutMs": 30000
}
```

Run **SM Reviewer: Set AI API Key** and enter any non-empty dummy value, then
run **SM Reviewer: AI Review Current File** and approve the consent prompt.
Expected result: a validated diagnostic with source `SM Reviewer AI`; no real
API call occurs. To verify deterministic HTTP 429 handling, temporarily set
the endpoint to:

```text
http://127.0.0.1:8787/v1/chat/completions?scenario=429
```

Static diagnostics must remain after the AI warning. Stop the server with
`Ctrl+C`. Do not use a production key for mock UAT.
