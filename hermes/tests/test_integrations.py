from copy import deepcopy
from contextlib import nullcontext
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import MagicMock, patch
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import mango_integrations as integrations

COMPANY = "11111111-1111-4111-8111-111111111111"
USER = "22222222-2222-4222-8222-222222222222"
PROFILE = UUID(COMPANY).hex + UUID(USER).hex
OTHER = UUID(USER).hex + UUID(COMPANY).hex


def server(provider="linear", profile=PROFILE):
    return {integrations.server_name(provider, profile): {
        "url": integrations.PROVIDERS[provider][1], "auth": "oauth", "enabled": True,
        "tools": {"include": ["list_issues", "create_issue"]}, "oauth": {},
    }}


class IntegrationTests(unittest.TestCase):
    def test_same_provider_in_different_companies_has_separate_native_connection_names(self):
        first = integrations.server_name("linear", PROFILE)
        second = integrations.server_name("linear", OTHER)
        self.assertNotEqual(first, second)
        configs = {PROFILE: {"mcp_servers": server()}, OTHER: {"mcp_servers": server(profile=OTHER)}}
        integrations.validate_profile_integrations(configs)
        configs[OTHER] = configs[PROFILE]
        with self.assertRaises(ValueError):
            integrations.validate_profile_integrations(configs)

    def test_config_preserves_native_oauth_and_filters_without_enabling_unconfigured_provider(self):
        saved = {"mcp_servers": server(), "web": {"backend": "parallel"}}
        original = deepcopy(saved)
        result = integrations.apply_profile_integrations(
            {"platform_toolsets": {"api_server": ["mango"]}}, saved, PROFILE)
        self.assertEqual(saved, original)
        self.assertEqual(result["mcp_servers"], saved["mcp_servers"])
        self.assertEqual(result["platform_toolsets"]["api_server"],
                         ["mango", "web", "mcp-" + integrations.server_name("linear", PROFILE)])
        self.assertNotIn("gmail", result["mcp_servers"])

    def test_disabled_integration_does_not_enter_model_toolset(self):
        saved = {"mcp_servers": server()}
        next(iter(saved["mcp_servers"].values()))["enabled"] = False
        result = integrations.apply_profile_integrations({}, saved, PROFILE)
        self.assertEqual(result["platform_toolsets"]["api_server"], ["web"])

    def test_native_default_enabled_cannot_bypass_explicit_tool_selection(self):
        config = {"mcp_servers": server()}
        selected = next(iter(config["mcp_servers"].values()))
        selected.pop("enabled")
        selected.pop("tools")
        with self.assertRaisesRegex(ValueError, "explicit enabled state"):
            integrations.apply_profile_integrations({}, config, PROFILE)
        with self.assertRaisesRegex(ValueError, "explicit enabled state"):
            integrations.validate_profile_integrations({PROFILE: config})

    def test_foreign_name_arbitrary_url_plaintext_credentials_or_unselected_tools_fail_closed(self):
        for change in ({"url": "http://127.0.0.1/admin"}, {"command": "sh"},
                       {"headers": {"Authorization": "Bearer secret"}},
                       {"oauth": {"client_secret": "do-not-store-me"}},
                       {"oauth": {"client_secret": "${API_SERVER_KEY}"}},
                       {"oauth": {"client_secret": "${GOOGLE_CLIENT_SECRET}"}},
                       {"tools": {"include": []}}, {"tools": {"include": ["*"]}},
                       {"tools": {"include": ["x" * 64]}}):
            config = {"mcp_servers": server()}
            next(iter(config["mcp_servers"].values())).update(change)
            with self.subTest(change=tuple(change)), self.assertRaises(ValueError):
                integrations.apply_profile_integrations({}, config, PROFILE)

    def test_saved_native_config_cannot_restore_deletion_or_sending_tools(self):
        for tool in ("delete_issue", "RemoveItem", "trash_file", "purge_record", "send_email"):
            for enabled in (False, True):
                config = {"mcp_servers": server()}
                selected = next(iter(config["mcp_servers"].values()))
                selected.update({"enabled": enabled, "tools": {"include": [tool]}})
                with self.subTest(tool=tool, enabled=enabled), self.assertRaises(ValueError):
                    integrations.validate_profile_integrations({PROFILE: config})

    def test_configure_uses_only_integration_runtime_secret_references(self):
        with patch.object(integrations, "_bound_profile", return_value=PROFILE), \
                patch.object(integrations, "_read_config", return_value={}), \
                patch.object(integrations, "_save_config") as save:
            for reference in ("API_SERVER_KEY", "OPENAI_API_KEY", "GOOGLE_CLIENT_SECRET", "MANGO_INTEGRATION_"):
                with self.subTest(reference=reference), self.assertRaises(ValueError):
                    integrations.configure(Path("/profile"), "docs", client_id="fixture-client", client_secret_env=reference)
                save.assert_not_called()
            reference = "MANGO_INTEGRATION_GOOGLE_CLIENT_SECRET"
            result = integrations.configure(Path("/profile"), "docs", client_id="fixture-client", client_secret_env=reference)
            configured = save.call_args.args[1]["mcp_servers"][result["server_name"]]
            self.assertEqual(configured["oauth"]["client_secret"], "${" + reference + "}")
            self.assertEqual(configured["oauth"]["redirect_port"], 8765)
            self.assertEqual(configured["oauth"]["redirect_uri"], "http://localhost:8765/callback")
            self.assertNotIn("callback_port", configured["oauth"])
            self.assertFalse(configured["enabled"])

    def test_scope_binding_requires_exact_existing_profile(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary) / PROFILE
            home.mkdir()
            (home / "mango-scope.json").write_text(json.dumps({"company_id": COMPANY, "user_id": USER}))
            self.assertEqual(integrations._bound_profile(home), PROFILE)
            (home / "mango-scope.json").write_text(json.dumps({"company_id": USER, "user_id": COMPANY}))
            with self.assertRaises(ValueError):
                integrations._bound_profile(home)

    def test_model_discovery_never_accepts_tenant_or_credentials(self):
        for arguments in ({"profile": OTHER}, {"user_id": USER}, {"token": "secret"}, None):
            self.assertIn("error", json.loads(integrations.list_integrations(arguments)))

    def test_enabling_requires_exact_live_discovery_and_rejects_send_delete_without_writing(self):
        name = integrations.server_name("linear", PROFILE)
        saved = {"mcp_servers": server()}
        with patch.object(integrations, "_bound_profile", return_value=PROFILE), \
                patch.object(integrations, "_read_config", return_value=saved), \
                patch.object(integrations, "discover", return_value={"tools": [{"name": "list_issues"}]}) as discover, \
                patch.object(integrations, "_save_config") as save:
            for tools in ([], ["delete_issue"], ["send_email"], ["invented_tool"]):
                with self.subTest(tools=tools), self.assertRaises(ValueError):
                    integrations.enable(Path("/profile"), "linear", tools)
                save.assert_not_called()
            result = integrations.enable(Path("/profile"), "linear", ["list_issues"])
            self.assertEqual(saved["mcp_servers"][name]["tools"]["include"], ["list_issues"])
            self.assertTrue(saved["mcp_servers"][name]["enabled"])
            self.assertFalse(result["execution_verified"])
            save.assert_called_once()

    def test_public_schema_discovery_without_profile_oauth_cannot_enable_private_integration(self):
        native = types.ModuleType("hermes_cli.mcp_config")
        native._probe_single_server = MagicMock(return_value=[("list_issues", "Read issues")])
        oauth = types.ModuleType("tools.mcp_oauth")
        oauth.HermesTokenStorage = MagicMock()
        oauth.HermesTokenStorage.return_value.has_cached_tokens.return_value = False
        oauth.suppress_interactive_oauth = nullcontext
        with patch.dict(sys.modules, {"hermes_cli.mcp_config": native, "tools.mcp_oauth": oauth}), \
                patch.object(integrations, "_bound_profile", return_value=PROFILE), \
                patch.object(integrations, "_read_config", return_value={"mcp_servers": server()}):
            with self.assertRaisesRegex(ValueError, "Complete native OAuth"):
                integrations.discover(Path("/profile"), "linear")
            native._probe_single_server.assert_not_called()

    def test_discovery_does_not_advertise_skills_or_failed_or_disabled_connections_as_callable(self):
        native = types.ModuleType("hermes_constants")
        native.get_hermes_home = lambda: Path("/profile")
        discovery = types.ModuleType("tools.mcp_tool_discovery")
        linear = integrations.server_name("linear", PROFILE)
        gmail = integrations.server_name("gmail", PROFILE)
        discovery.get_mcp_status = lambda: [
            {"name": linear, "status": "connected", "connected": True},
            {"name": gmail, "status": "failed", "connected": False, "error": "SECRET PROVIDER ERROR"},
        ]
        registry = MagicMock()
        registry.get_tool_names_for_toolset.return_value = ["mcp__" + linear + "__list_issues"]
        registry.get_definitions.return_value = [{"type": "function", "function": {"name": "web_search"}}]
        module = types.ModuleType("tools.registry")
        module.registry = registry
        config = {"mcp_servers": {**server(), **server("gmail")}}
        with patch.dict(sys.modules, {"hermes_constants": native, "tools.mcp_tool_discovery": discovery,
                                     "tools.registry": module}), \
                patch.object(integrations, "_bound_profile", return_value=PROFILE), \
                patch.object(integrations, "_read_config", return_value=config):
            result = json.loads(integrations.list_integrations({}))
            by_name = {item["integration"]: item for item in result["integrations"]}
            self.assertEqual(len(by_name["linear"]["callable_tools"]), 1)
            self.assertEqual(by_name["gmail"]["callable_tools"], [])
            self.assertEqual(by_name["docs"]["status"], "not_configured")
            self.assertFalse(by_name["linear"]["execution_verified"])
            self.assertEqual(result["web"]["callable_tools"], ["web_search"])
            self.assertNotIn("SECRET", json.dumps(result))
            config["mcp_servers"][linear]["enabled"] = False
            result = json.loads(integrations.list_integrations({}))
            by_name = {item["integration"]: item for item in result["integrations"]}
            self.assertEqual(by_name["linear"]["status"], "disabled")
            self.assertEqual(by_name["linear"]["callable_tools"], [])


if __name__ == "__main__":
    unittest.main()
