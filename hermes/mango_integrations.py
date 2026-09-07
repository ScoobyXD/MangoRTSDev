"""Profile-local integration setup and discovery over Hermes's native MCP client.

There is no second token store, OAuth implementation, or MCP execution proxy.
The command line is for the human operating the bound profile, never the model.
"""

import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import sys
from uuid import UUID


class IntegrationSetupError(ValueError):
    """Safe operator guidance authored here, never arbitrary provider output."""


PROVIDERS = {
    "gmail": ("Gmail", "https://gmailmcp.googleapis.com/mcp/v1"),
    "docs": ("Google Docs", "https://docsmcp.googleapis.com/mcp/v1"),
    "sheets": ("Google Sheets", "https://sheetsmcp.googleapis.com/mcp/v1"),
    "drive": ("Google Drive", "https://drivemcp.googleapis.com/mcp/v1"),
    "linear": ("Linear", "https://mcp.linear.app/mcp"),
    "clickup": ("ClickUp", "https://mcp.clickup.com/mcp"),
    "airtable": ("Airtable", "https://mcp.airtable.com/mcp"),
    "outlook": ("Microsoft Outlook", "https://agent365.svc.cloud.microsoft/agents/tenants/{tenant}/servers/mcp_MailTools"),
    "word": ("Microsoft Word", "https://agent365.svc.cloud.microsoft/agents/tenants/{tenant}/servers/mcp_WordServer"),
}

# The remaining requested provider is explicit about its current support boundary.
UNAVAILABLE = {"excel": "Microsoft Excel needs a supported tenant MCP endpoint and permissions; no Excel endpoint is configured by this build."}
DEFAULT_WEB = {"backend": "parallel", "provider_tier": {"parallel": "free"}}


def server_name(provider, profile_name):
    if provider not in PROVIDERS or not re.fullmatch(r"[0-9a-f]{64}", profile_name):
        raise IntegrationSetupError("Integration requires an existing exact Mango profile.")
    # A transport namespace, not a tenant/resource identity. The exact company/user
    # remains in the immutable profile binding. Upstream live MCP connections are
    # keyed by server name across profiles, so plain 'linear' is unsafe here.
    return provider + "-" + hashlib.sha256(profile_name.encode("ascii")).hexdigest()[:12]


def _provider_for_name(name, profile_name):
    provider = name.rsplit("-", 1)[0]
    if provider not in PROVIDERS or name != server_name(provider, profile_name):
        raise IntegrationSetupError("MCP server name does not belong to this Mango profile.")
    return provider


def _validate_server(name, server, profile_name):
    provider = _provider_for_name(name, profile_name)
    if not isinstance(server, dict) or "command" in server or "headers" in server or "env" in server:
        raise IntegrationSetupError("Mango integrations require native remote MCP OAuth.")
    endpoint = PROVIDERS[provider][1]
    if "{tenant}" in endpoint:
        pattern = re.escape(endpoint).replace(re.escape("{tenant}"), r"[0-9a-f-]{36}")
        if not re.fullmatch(pattern, server.get("url", "")):
            raise IntegrationSetupError("Microsoft integration endpoint must use the configured tenant.")
        UUID(server["url"].split("/tenants/", 1)[1].split("/", 1)[0])
    elif server.get("url") != endpoint:
        raise IntegrationSetupError("Integration endpoint is not the provider's supported MCP server.")
    if server.get("auth") != "oauth" or not isinstance(server.get("enabled", False), bool):
        raise IntegrationSetupError("Integration requires native OAuth and an explicit enabled state.")
    oauth = server.get("oauth", {})
    if not isinstance(oauth, dict):
        raise IntegrationSetupError("Invalid native OAuth configuration.")
    if "client_secret" in oauth and not re.fullmatch(r"\$\{MANGO_INTEGRATION_[A-Z0-9_]+\}", oauth["client_secret"]):
        raise IntegrationSetupError("OAuth client secrets must use profile-scoped runtime secret references.")
    selected = (server.get("tools") or {}).get("include")
    if server.get("enabled") and (not isinstance(selected, list) or not selected):
        raise IntegrationSetupError("Enable an integration only after discovering and selecting its exact tools.")
    for tool in selected or []:
        if not isinstance(tool, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+", tool):
            raise IntegrationSetupError("Integration tools must be exact discovered names, without wildcards.")
        if re.search(r"delete|remove|trash|purge|send", tool, re.I):
            raise IntegrationSetupError("Select basic read/create/update tools; deletion and sending are not enabled here.")
        if len("mcp__" + name + "__" + tool) > 64:
            raise IntegrationSetupError("Integration tool name exceeds the model provider's 64-character limit.")
    return provider


def apply_profile_integrations(config, saved_config, profile_name):
    """Preserve native profile connection settings while generating Mango config."""
    servers = deepcopy(saved_config.get("mcp_servers") or {})
    if not isinstance(servers, dict):
        raise IntegrationSetupError("Invalid native MCP configuration.")
    for name, server in servers.items():
        _validate_server(name, server, profile_name)
    config["mcp_servers"] = servers
    config["web"] = deepcopy(saved_config.get("web") or DEFAULT_WEB)
    toolsets = config.setdefault("platform_toolsets", {}).setdefault("api_server", [])
    for toolset in ["web", *("mcp-" + name for name, server in servers.items() if server.get("enabled"))]:
        if toolset not in toolsets:
            toolsets.append(toolset)
    return config


def validate_profile_integrations(profile_configs):
    owners = {}
    for profile_name, config in profile_configs.items():
        for name, server in (config.get("mcp_servers") or {}).items():
            _validate_server(name, server, profile_name)
            if name in owners and owners[name] != profile_name:
                raise IntegrationSetupError("Two Mango profiles cannot share a native MCP connection name.")
            owners[name] = profile_name


def _bound_profile(home):
    home = Path(home)
    binding = home / "mango-scope.json"
    if not home.is_absolute() or home.is_symlink() or binding.is_symlink():
        raise IntegrationSetupError("Integration setup requires the existing private profile directory.")
    scope = json.loads(binding.read_text(encoding="utf-8"))
    if not isinstance(scope, dict) or set(scope) != {"company_id", "user_id"}:
        raise IntegrationSetupError("Invalid immutable Mango profile binding.")
    profile_name = UUID(scope["company_id"]).hex + UUID(scope["user_id"]).hex
    if home.name != profile_name:
        raise IntegrationSetupError("Integration home does not match its exact company/user binding.")
    return profile_name


def _read_config(home):
    import yaml
    path = Path(home) / "config.yaml"
    if path.is_symlink():
        raise IntegrationSetupError("Profile configuration must not be a symbolic link.")
    config = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(config, dict):
        raise IntegrationSetupError("Invalid native Hermes profile configuration.")
    return config


def configure(home, provider, *, client_id=None, client_secret_env=None, tenant=None):
    """Write only native MCP config; leave disabled until real OAuth/discovery."""
    profile_name = _bound_profile(home)
    config = _read_config(home)
    name = server_name(provider, profile_name)
    endpoint = PROVIDERS[provider][1]
    if "{tenant}" in endpoint:
        if not tenant or not client_id:
            raise IntegrationSetupError("Microsoft requires the Entra tenant ID and public client ID.")
        endpoint = endpoint.format(tenant=str(UUID(tenant)))
    if provider in {"gmail", "docs", "sheets", "drive"} and (not client_id or not client_secret_env):
        raise IntegrationSetupError("Google requires an OAuth client ID and profile runtime client-secret reference.")
    oauth = {"callback_port": 8765, "redirect_uri": "http://localhost:8765/callback"}
    if client_id:
        oauth["client_id"] = client_id
    if client_secret_env:
        if not re.fullmatch(r"MANGO_INTEGRATION_[A-Z0-9_]+", client_secret_env):
            raise IntegrationSetupError("OAuth runtime secret variables must start with MANGO_INTEGRATION_.")
        oauth["client_secret"] = "${" + client_secret_env + "}"
    server = {"url": endpoint, "auth": "oauth", "oauth": oauth, "enabled": False,
              "lazy": False, "tools": {"resources": False, "prompts": False}}
    existing = config.setdefault("mcp_servers", {}).get(name)
    if existing is not None:
        raise IntegrationSetupError("Integration is already configured; use the native profile MCP settings to update it.")
    config["mcp_servers"][name] = server
    apply_profile_integrations(config, config, profile_name)
    _save_config(home, config)
    return {"integration": provider, "server_name": name, "status": "configured",
            "next": "Complete native Hermes MCP OAuth login, then run this module's enable command."}


def _save_config(home, config):
    # Native config.yaml remains the only connection configuration authority.
    from hermes_cli.config import save_config
    from hermes_constants import get_hermes_home
    if Path(get_hermes_home()).resolve() != Path(home).resolve():
        raise IntegrationSetupError("Run setup inside the selected native Hermes profile.")
    save_config(config)


def discover(home, provider):
    """Inspect the authorized provider with the native read-only discovery probe."""
    from hermes_cli.mcp_config import _probe_single_server
    from tools.mcp_oauth import HermesTokenStorage, suppress_interactive_oauth
    profile_name = _bound_profile(home)
    config = _read_config(home)
    name = server_name(provider, profile_name)
    server = config.get("mcp_servers", {}).get(name)
    if server is None:
        raise IntegrationSetupError("Configure this integration and complete OAuth first.")
    _validate_server(name, server, profile_name)
    if not HermesTokenStorage(name, hermes_home=home).has_cached_tokens():
        raise IntegrationSetupError("Complete native OAuth login for this exact profile before discovery or enabling tools.")
    with suppress_interactive_oauth():
        tools = _probe_single_server(name, server)
    return {"integration": provider, "server_name": name,
            "tools": [{"name": name, "description": description} for name, description in tools],
            "execution_verified": False}


def enable(home, provider, selected_tools):
    """Discover against the authorized provider, then save an exact tool allowlist."""
    profile_name = _bound_profile(home)
    config = _read_config(home)
    name = server_name(provider, profile_name)
    # Only the human operator supplies the selected names. The model has no setup
    # or account-switch tool. Discovery makes no provider business-data mutation.
    if not selected_tools:
        raise IntegrationSetupError("Select at least one exact tool from this module's discover command.")
    if any(re.search(r"delete|remove|trash|purge|send", tool, re.I) for tool in selected_tools):
        raise IntegrationSetupError("Select basic read/create/update tools; deletion and sending are not enabled here.")
    discovered = {item["name"] for item in discover(home, provider)["tools"]}
    if not set(selected_tools).issubset(discovered):
        raise IntegrationSetupError("A selected tool is not in this provider's current authorized discovery result.")
    server = config["mcp_servers"][name]
    server["tools"] = {"include": sorted(set(selected_tools)), "resources": False, "prompts": False}
    server["enabled"] = True
    server["lazy"] = False
    apply_profile_integrations(config, config, profile_name)
    _save_config(home, config)
    return {"integration": provider, "status": "configured_and_discovered", "tools": server["tools"]["include"],
            "execution_verified": False, "next": "Start a new Mango run; verify a read before authorizing a concrete write."}


def list_integrations(args, **kwargs):
    if args != {}:
        return json.dumps({"error": "Integration discovery takes no identity or credential arguments."})
    from hermes_constants import get_hermes_home
    from tools.mcp_tool_discovery import get_mcp_status
    from tools.registry import registry
    try:
        home = get_hermes_home()
        profile_name = _bound_profile(home)
        config = _read_config(home)
        apply_profile_integrations({}, config, profile_name)
        # Native status applies the current ContextVar profile before looking at
        # live connection state. Do not expose raw errors, URLs, or OAuth values.
        states = {entry["name"]: entry for entry in get_mcp_status()}
        integrations = []
        for provider, (label, _) in PROVIDERS.items():
            name = server_name(provider, profile_name)
            state = states.get(name, {})
            status = state.get("status", "not_configured")
            enabled = config.get("mcp_servers", {}).get(name, {}).get("enabled", False)
            if name in config.get("mcp_servers", {}) and not enabled:
                status = "disabled"
            names = registry.get_tool_names_for_toolset("mcp-" + name) if enabled and state.get("connected") else []
            integrations.append({"integration": provider, "label": label, "protocol": "mcp",
                                 "status": status, "callable_tools": names,
                                 "execution_verified": False})
        integrations.extend({"integration": key, "status": "setup_required", "reason": value,
                             "callable_tools": []} for key, value in UNAVAILABLE.items())
        web_tools = registry.get_definitions({"web_search", "web_extract"}, quiet=True)
        return json.dumps({"integrations": integrations,
                           "web": {"status": "available" if web_tools else "unavailable",
                                   "callable_tools": [item["function"]["name"] for item in web_tools],
                                   "execution_verified": False},
                           "skills": "Installed skills are instructions, not callable integrations. Use native skills discovery for their text.",
                           "verification": "Connection and schema discovery do not prove a provider business operation succeeded. Confirm each result."})
    except (OSError, ValueError, TypeError):
        return json.dumps({"error": "Integration discovery is unavailable for this bound profile."})


def register(ctx):
    ctx.register_tool(name="mango_list_integrations", toolset="mango", handler=list_integrations, schema={
        "description": "Read the current Mango profile's connected integrations and actual callable tools. Installed skills and configured OAuth clients do not prove an integration is connected or an action succeeded.",
        "parameters": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
    })


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["configure", "discover", "enable"])
    parser.add_argument("provider", choices=sorted(PROVIDERS))
    parser.add_argument("--client-id")
    parser.add_argument("--client-secret-env")
    parser.add_argument("--tenant")
    parser.add_argument("--tool", action="append", default=[])
    args = parser.parse_args(argv)
    from hermes_constants import get_hermes_home
    home = get_hermes_home()
    if args.command == "configure":
        result = configure(home, args.provider, client_id=args.client_id,
                           client_secret_env=args.client_secret_env, tenant=args.tenant)
    elif args.command == "discover":
        result = discover(home, args.provider)
    else:
        result = enable(home, args.provider, args.tool)
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Native errors may contain provider response text. No token/header values
        # or arbitrary provider errors are copied into setup output.
        message = str(error) if isinstance(error, IntegrationSetupError) else "Integration setup failed (" + type(error).__name__ + "). Check this profile's binding, native OAuth login and the documented provider prerequisites."
        print(json.dumps({"error": message}), file=sys.stderr)
        raise SystemExit(1)
