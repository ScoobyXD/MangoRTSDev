# Hermes integrations

Mango's built-in capabilities are **Mango tools**. External connections are **integrations**; the connections below use MCP. The shared container includes the pinned native Hermes MCP dependency. It uses native discovery, transport, OAuth refresh, execution, and profile token storage. Codex plugins and Codex sign-ins provide none of these credentials.

The web tools use the bundled Parallel free-tier provider for search and page extraction. They require outbound HTTPS and may return provider rate limits. A paid provider can be selected through native profile web settings. The container does not gain general shell, arbitrary file access, MCP management, or browser-computer control from enabling web tools.

## Connect an account

Use the **existing** exact profile directory `/data/profiles/<company UUID hex><user UUID hex>`. Do not create a profile manually or move another account's tokens into it. The setup command verifies `mango-scope.json`; the model has no setup or profile-switch tool.

Run the following as the human operator in the existing shared container, replacing the profile placeholder with the 64-character profile name chosen by Mango:

```powershell
docker exec -it --env HERMES_HOME=/data/profiles/<profile> mangorts-hermes python -m mango_integrations configure linear
```

The command returns the native `server_name`, such as `linear-<12 hex characters>`. This short suffix only separates native MCP connections within one process. Tenant authority remains the exact company/user binding. Configuring a provider leaves it **disabled**.

Complete the native OAuth login personally, then inspect its current tools:

```powershell
docker exec -it --env HERMES_HOME=/data/profiles/<profile> mangorts-hermes hermes mcp login <server_name>
docker exec -it --env HERMES_HOME=/data/profiles/<profile> mangorts-hermes python -m mango_integrations discover linear
```

The native callback is `http://localhost:8765/callback`. When the browser runs outside Docker, copy the final redirected URL into the native login prompt; the redirect need not resolve in that browser. Complete one profile's login at a time. Do not paste the code, redirect URL, or token into Mango chat or Codex.

Choose exact basic read/create/update tool names shown by that authenticated provider. Example only, if those exact names are present:

```powershell
docker exec -it --env HERMES_HOME=/data/profiles/<profile> mangorts-hermes python -m mango_integrations enable linear --tool list_issues --tool get_issue --tool create_issue --tool update_issue
```

`enable` connects to the actual provider, checks the selected names exist, rejects delete/send tools and names over the model's length limit, then stores an exact native allowlist. It does not perform a business-data write. Restart the shared gateway through the normal human startup flow and start a new Mango run so its tool catalog reflects the changed configuration. A disabled or removed connection also requires this restart to remove an already-running native connection.

Ask Mango to list its integrations, then perform one permitted read from the intended account. An actual successful tool result establishes that operation's success. A saved skill, OAuth configuration, connection, or schema list does not establish business-operation success. Authorize a specific disposable create/update before testing provider writes. This implementation has not performed live provider writes or sent messages.

## Provider prerequisites

| Integration | Setup argument | Human prerequisites |
| --- | --- | --- |
| Linear | `configure linear` | Sign in, select the intended workspace, and consent to read/create/update access. Native OAuth uses Linear's hosted Streamable HTTP MCP endpoint. |
| ClickUp | `configure clickup` | Sign in to the intended workspace and consent using OAuth. The official server supports an MCP client with OAuth 2.1/PKCE. |
| Airtable | `configure airtable` | Sign in and select the intended bases. Your Airtable role and organization integration policy must allow the selected operations. |
| Google Gmail/Docs/Sheets/Drive | `configure gmail`, `docs`, `sheets`, or `drive` plus options below | Workspace Developer Preview access, enabled product and MCP APIs, OAuth app/consent configuration, and sign-in for this exact Mango profile. |
| Microsoft Outlook/Word | `configure outlook` or `word` plus options below | Supported Work IQ tenant access, Entra public-client registration, the matching Work IQ permission, required tenant consent, and sign-in as the intended user. |
| Microsoft Excel | Unavailable in this build | No supported standalone Excel MCP endpoint was verified in Microsoft's reviewed public server reference. A tenant-supported endpoint and permissions must be identified before adding it. Do not substitute documentation/search access for workbook execution. |

Linear uses `https://mcp.linear.app/mcp`; ClickUp uses `https://mcp.clickup.com/mcp`; Airtable uses `https://mcp.airtable.com/mcp`. Provider permissions remain authoritative. See [Linear MCP](https://linear.app/docs/mcp), [ClickUp MCP](https://developer.clickup.com/docs/connect-an-ai-assistant-to-clickups-mcp-server), and [Airtable MCP setup](https://support.airtable.com/articles/9897799762-using-the-airtable-mcp-server).

### Google Workspace

Google publishes dedicated remote endpoints for [Gmail](https://developers.google.com/workspace/gmail/api/guides/configure-mcp-server), [Docs](https://developers.google.com/workspace/docs/api/guides/configure-mcp-server), [Sheets](https://developers.google.com/workspace/sheets/api/guides/configure-mcp-server), and [Drive](https://developers.google.com/workspace/guides/configure-mcp-servers). These are Developer Preview services. Enable the corresponding product API and MCP service, such as `gmail.googleapis.com` and `gmailmcp.googleapis.com`, in the operator's approved Cloud project. Configure the OAuth consent audience and test users when required.

The supported endpoints are `https://gmailmcp.googleapis.com/mcp/v1`, `https://docsmcp.googleapis.com/mcp/v1`, `https://sheetsmcp.googleapis.com/mcp/v1`, and `https://drivemcp.googleapis.com/mcp/v1`. Register the native callback URL for the Google Web OAuth client. Configure its non-secret client ID and a **profile-scoped runtime secret reference**:

```text
python -m mango_integrations configure docs --client-id <Google OAuth client ID> --client-secret-env MANGO_INTEGRATION_GOOGLE_CLIENT_SECRET
```

The variable's actual secret must be supplied by the human/runtime secret mechanism to this profile for both login and gateway execution. The configure command stores only `${MANGO_INTEGRATION_GOOGLE_CLIENT_SECRET}`. For a human native login, populate that variable through your approved secret mechanism, then add `--env MANGO_INTEGRATION_GOOGLE_CLIENT_SECRET` (name only) to `docker exec`; Docker reads its value from your shell without putting the value in the command arguments. A fresh `docker exec` process cannot read the gateway's in-memory secrets and does not need its API, callback, or model keys. For gateway execution, the optional `MANGO_INTEGRATION_SECRETS` runtime JSON maps the exact profile name to only that profile's named secret values; names must start with `MANGO_INTEGRATION_`. Do not commit or paste client secrets or tokens. Production values belong in the established secret service; this task does not configure or deploy it.

Google documents `gmail.readonly` and `gmail.compose` for Gmail; Docs uses `drive.readonly`, `drive.file`, `documents.readonly`, and `documents`; Sheets uses `drive.readonly`, `drive.file`, `spreadsheets.readonly`, and `spreadsheets` under the `https://www.googleapis.com/auth/` prefix. Review the consent scope list for the operations actually selected. Google's current Docs MCP reference exposes document read/update; creating a Drive file requires a separately authorized Drive capability. [Google Workspace configuration](https://developers.google.com/workspace/guides/configure-mcp-servers)

Mango's existing Nylas grants are retained. They authorize existing Mango email flows, not Google Docs/Sheets or Google's remote MCP services. This change does not extract Nylas credentials, copy grants, or build a second email store. Direct Gmail MCP access requires separate provider consent and uses the provider's native email IDs.

### Microsoft

Use a human-approved Entra public client with the Work IQ permissions for the selected service. Add the native callback URL to its desktop/mobile redirects and obtain any required tenant/admin consent. Then configure:

```text
python -m mango_integrations configure outlook --tenant <Entra tenant UUID> --client-id <public client ID>
python -m mango_integrations configure word --tenant <Entra tenant UUID> --client-id <public client ID>
```

Outlook uses the tenant endpoint ending in `servers/mcp_MailTools`; Word uses `servers/mcp_WordServer`. These are Work IQ MCP services under `https://agent365.svc.cloud.microsoft/agents/tenants/<tenant>/`. They require the service's tenant access and consent; an Outlook account or Word installation alone is insufficient. See [Microsoft's coding-agent setup](https://learn.microsoft.com/en-us/microsoft-agent-365/tooling-servers-overview) and [Word server reference](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-word-work-iq). The documented Word service supports create/read/comment operations; select only tools actually returned to your authorized account. Microsoft can change preview tool names.

## Verification limits and rollout

The code and fixture tests do not supply provider credentials or establish any live account connection. Every private integration remains unavailable until its owner completes the setup above. There is no in-app OAuth connection page in this change; the native profile CLI is the working connection flow. No new database schema or migration is required for these native integrations. The public web smoke has successfully called native search and page extraction against public MCP documentation using the anonymous Parallel provider; that check does not verify any private account.

Rebuild the image to install its pinned `mcp` extra, then use the normal shared-container startup. Do not replace or clear the durable profile volume. Native config, tokens, sessions, and memory remain in that profile across restarts.
