# Sprint 4 Offline UAT

These fixtures verify the Sprint 4 AI MVP without sending source to an external
provider. The UAT runner creates an ephemeral HTTP server bound to `127.0.0.1`
and constructs its provider endpoint internally. It does not read an API key or
endpoint from `.env`.

From Git Bash at the repository root:

```bash
npm ci
npm run build
npm test
node sprint2-acceptance.cjs
npm run test:uat:sprint4
```

The runner exits `0` only when all static, consent, provider-error, validation,
fallback, and AI-coverage checks pass. No paid AI API is called.
