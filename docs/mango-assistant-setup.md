# Mango chat setup

The existing Mango composer uses the installed official Pi SDK for its model/tool loop. Go supervises a short-lived Node child and keeps authenticated Mango tool dispatch in the existing backend handlers. The Pi packages are pinned to `0.85.0` in `ai/runtime/package.json` and its lockfile. Generic instructions and the one native Process skill are packaged in `ai/`; live Process SOPs stay in canonical Mango editor storage. The assistant adds no schema migration.

Install the runtime dependencies from the repository root using Node **22.19 or newer**:

```powershell
node --version
npm ci --prefix ai/runtime
```

Backend tests run through WSL on Windows and also require Linux Node 22.19 or newer on the WSL `PATH`. Run the adapter tests with `npm test --prefix ai/runtime`; the full test runner includes them before the backend tests.

The backend finds `ai/` above its development working directory. Set `MANGORTS_AI_ROOT` to the absolute `ai` directory when starting a copied binary from another directory. The backend image includes Node 24, the pinned installed dependencies, and the approved `ai/` files at `/app/ai`, and sets `MANGORTS_AI_ROOT` itself. Build that API image from the repository root with `docker build -f backend/Dockerfile .`. This setup does not deploy it.

An operator must supply the model and one server-side key source:

| Setting | Value |
| --- | --- |
| `OPENAI_API_KEY` | An OpenAI project API key injected directly into the server environment. This takes precedence when present. |
| `OPENAI_API_KEY_SECRET_ARN` | An alternative Secrets Manager ARN that the API resolves once at startup through the AWS credential chain. |
| `MANGORTS_ASSISTANT_MODEL` | One OpenAI Responses model present in the pinned Pi model catalog, for example `gpt-5.6-luna`, with access enabled for the configured key. |
| `MANGORTS_AI_ROOT` | Optional absolute path to the packaged `ai` directory; development otherwise discovers it above the working directory. |

For dev, store the raw OpenAI key only as the plaintext secret value in AWS Secrets Manager. Put only that secret's ARN in the GitHub Actions repository variable `TF_OPENAI_API_KEY_SECRET_ARN`; never put the raw key in GitHub. The repository variable `TF_ASSISTANT_MODEL` defaults to `gpt-5.6-luna`. Run the dev deployment after configuring these variables. ECS resolves the ARN and injects `OPENAI_API_KEY` and `MANGORTS_ASSISTANT_MODEL` into the backend task. Updating the secret value does not refresh a running task; deploy a new source revision or explicitly force a new ECS service deployment after rotating the key.

For cloud-integrated localhost, put the same non-secret configuration in the ignored `infra/aws-dev/terraform.tfvars` file:

```hcl
assistant_model           = "gpt-5.6-luna"
openai_api_key_secret_arn = "arn:aws:secretsmanager:REGION:ACCOUNT:secret:NAME"
```

Then run `.\scripts\start_local_cognito_backend.ps1 -AwsProfile mangorts-dev -StopExisting`. The launcher leaves the non-secret model and secret ARN in that PowerShell session. The Go backend reads the secret into memory through the normal AWS credential chain without printing it, writing it to disk, or leaving the resolved key in the shell.

After stopping that launcher with Ctrl+C, plain Go restarts in the same PowerShell session keep Mango chat configured:

```powershell
cd .\backend
go run .\cmd\miraeopus-api
```

A new PowerShell session still needs the launcher once to load the dev database, Cognito, temporary AWS credentials, assistant model, and secret ARN. Temporary AWS credentials can expire during a long session; rerun `aws sso login --profile mangorts-dev` and the launcher when they do. Restart the backend after changing the secret value.

For a restricted OpenAI key, grant `Responses (/v1/responses)` write access. Mango chat does not need List models, Assistants, Threads, Files, or the other unrelated capabilities.

Use Mango's existing authenticated app setup and selected `company_id` query scope. `GET /v1/assistant/status` reports local configuration/runtime readiness; it does not test provider connectivity, billing, or model entitlement. `POST /v1/assistant/chat` accepts `{ "request_id": "UUID", "reasoning_effort": "medium", "messages": [{ "role": "user", "content": "Hello" }] }`; selecting a Process also supplies its exact `process_id`. A natural-language target can use the existing permission-filtered search followed by `bind_process` in the same interaction. Binding returns the saved Process identity and full live context without creating work. Only an execution request may use the bound Process actions.

The developer-authorized Inspect view records the current interaction's actual final provider requests and native skill/tool activity, including failures and Stop. Clearing or reloading browser chat loses its visible history. Server capture recovery lasts until the next Send by the same actor/company, fifteen minutes, or backend restart; saved Process/Node link receipts remain available for fifteen minutes with fresh permission checks. Provider credentials, authentication headers, and hidden private reasoning are omitted explicitly. No MCP server, general shell/filesystem tool, automatic retry, compaction, or durable trace database is enabled.

[AI & MCP](tests/AI%26MCP.md) is the single current record for business rules, CRUD/HTTP tool mappings, permissions, request limits, confirmation behavior, Process execution, attachment constraints, and verification coverage. Keep setup and credential instructions here; update tool behavior and the inventory there.

Runtime references: [Pi SDK](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/docs/sdk.md), [Pi native skills](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/docs/skills.md), and the installed `ai/runtime/node_modules/@earendil-works/pi-ai/dist/providers/data/openai.json` model catalog.
