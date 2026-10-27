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

For manual UAT, start `node uat/sprint4/mock-openai.cjs`, configure
`smReviewer.ai.endpoint` to its `http://127.0.0.1` URL, save a dummy key using
the extension command, enable `smReviewer.ai.enabled`, then invoke the AI
command and approve consent. Do not use a production key for mock UAT.
