# Mango chat setup

The bottom composer, authenticated status/chat endpoints, streamed OpenAI Responses API calls, and internal Mango functions are implemented. Ordinary chat has 25 tools; selecting a Process replaces them with 3 Process tools. The exact current catalog and behavior live in [AI & MCP](tests/AI%26MCP.md). The official Go SDK is pinned to `v3.30.0`, which supports Mango's existing Go version. The assistant adds no schema migration.

An operator must supply the model and one server-side key source:

| Setting | Value |
| --- | --- |
| `OPENAI_API_KEY` | An OpenAI project API key injected directly into the server environment. This takes precedence when present. |
| `OPENAI_API_KEY_SECRET_ARN` | An alternative Secrets Manager ARN that the API resolves once at startup through the AWS credential chain. |
| `MANGORTS_ASSISTANT_MODEL` | An enabled Responses API model ID supporting text output and strict function calling. |

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

Use Mango's existing authenticated app setup and selected `company_id` query scope. `GET /v1/assistant/status` reports whether chat is configured. `POST /v1/assistant/chat` accepts `{ "request_id": "UUID", "reasoning_effort": "medium", "messages": [{ "role": "user", "content": "Hello" }] }`; selecting a Process also supplies its exact `process_id`. The stream carries `text`, `tool`, `node`, `done`, or sanitized `error` events.

[AI & MCP](tests/AI%26MCP.md) is the single current record for business rules, CRUD/HTTP tool mappings, permissions, request limits, confirmation behavior, Process execution, attachment constraints, and verification coverage. Keep setup and credential instructions here; update tool behavior and the inventory there.

Protocol references: [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling) and [streaming Responses](https://developers.openai.com/api/docs/guides/streaming-responses).
