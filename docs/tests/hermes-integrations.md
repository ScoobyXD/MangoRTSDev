# Integration Business Logic Laws

1. Mango tools execute Mango commands, and integrations connect external providers.
2. An integration is called MCP only when execution uses the MCP protocol.
3. Every private integration belongs to one immutable exact Mango company and user profile.
4. Model arguments never select a profile, OAuth client, credential, or external connection.
5. Integration configuration lives in that profile's native Hermes `config.yaml`, and OAuth state stays in its native profile token store.
6. The shared gateway gives each profile a distinct native MCP server name and rejects collisions before serving runs.
7. Only approved provider HTTPS endpoints with native OAuth may be configured by the integration setup command.
8. Configuring a provider leaves its tools disabled until the operator completes OAuth and selects exact names returned by live discovery.
9. An enabled integration exposes only its selected tools, and no selected model tool name exceeds 64 characters.
10. Integration setup and gateway startup reject deletion and sending tools and expose no model tool for connection management.
11. Installed skills describe instructions and never establish a connected account or callable tool.
12. Failed, disabled, unconfigured, and other-profile integrations expose no callable tools in Mango integration discovery.
13. A connection or schema discovery result never claims that a provider business operation succeeded.
14. Web search and page extraction use the selected native Hermes web provider and report provider errors honestly.
15. Existing Nylas email connections remain under Mango's existing account and permission rules and are never copied into external MCP OAuth state.
16. Provider OAuth consent, required application registration, or missing product support is reported as a setup requirement rather than fabricated access.
17. OAuth client secrets must use profile runtime references named `MANGO_INTEGRATION_` followed by uppercase letters, digits or underscores.

## Verification

`hermes/tests/test_integrations.py` checks configuration preservation, exact profile binding, separate connection names, rejection of cross-profile settings, endpoint/secret/tool validation, and truthful discovery.

`hermes/tests/native_integrations_smoke.py --source /opt/hermes` runs the pinned native MCP client against a loopback HTTP fixture. It verifies real protocol discovery, tool dispatch, concurrent profile credentials, blocked cross-profile invocation, and excluded deletion tools. Its two fixture accounts are disposable and do not verify a live external provider or its OAuth service.

Adding `--installed` verifies the installed integration CLI and native `hermes mcp list` in named profile homes without gateway credentials, private native OAuth token persistence, and native client-secret reference resolution using a synthetic secret. It does not perform a provider login.

Provider acceptance requires a successful read from the intended signed-in account and a separately authorized concrete create/update operation whose resulting provider object is checked. Sending messages is not an acceptance test for this change.

`hermes/tests/native_web_smoke.py --source /opt/hermes --live-public-read` is an explicit public-read check. It verifies nonempty live search results and page extraction through native web tools using the anonymous provider. It needs outbound HTTPS and performs no provider writes.
