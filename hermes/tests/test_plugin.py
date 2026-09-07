from concurrent.futures import ThreadPoolExecutor
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import entrypoint
import mango_plugin as plugin

RUN = "run_" + "a" * 32
SESSION = "conversation-fixture"
UUID_A = "11111111-1111-4111-8111-111111111111"
UUID_B = "22222222-2222-4222-8222-222222222222"


class PluginTests(unittest.TestCase):
    def setUp(self):
        self.session = types.ModuleType("gateway.session_context")
        self.native = {
            "HERMES_SESSION_KEY": RUN,
            "HERMES_SESSION_ID": SESSION,
            "HERMES_SESSION_PLATFORM": "api_server",
        }
        self.session.get_session_env = lambda name: self.native.get(name, "")
        self.modules = patch.dict(sys.modules, {"gateway.session_context": self.session})
        self.modules.start()
        self.addCleanup(self.modules.stop)

    def invoke(self, handler=plugin.list_processes, args=None):
        return plugin.bind_tool_context(
            "mango_list_processes", {} if args is None else args,
            lambda value: handler(value, session_id=SESSION),
            session_id=SESSION, tool_call_id="call_fixture")

    def test_handler_fails_closed_without_middleware(self):
        self.assertIn("no action was submitted", plugin.list_processes({}, session_id=SESSION))

    def test_untrusted_identity_arguments_rejected(self):
        for field in ("company_id", "user_id", "run_id", "tool_call_id", "url"):
            with self.subTest(field=field):
                self.assertIn("Invalid Mango", self.invoke(args={field: "forged"}))

    def test_native_context_must_be_an_api_run(self):
        for field, forged in (("HERMES_SESSION_KEY", "not-a-run"),
                              ("HERMES_SESSION_ID", "other-session"),
                              ("HERMES_SESSION_PLATFORM", "cron")):
            with self.subTest(field=field), patch.dict(self.native, {field: forged}):
                self.assertIn("authenticated Mango run", self.invoke())

    def test_binding_is_cleared_on_exception_and_between_threads(self):
        def fail(args, **kwargs):
            self.assertEqual(plugin._context.get().run_id, RUN)
            raise RuntimeError("fixture")
        with self.assertRaises(RuntimeError):
            self.invoke(fail)
        self.assertIsNone(plugin._context.get())
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(list(pool.map(lambda _: plugin._context.get(), range(2))), [None, None])

    def test_callback_has_trusted_metadata_and_no_retry_or_redirect(self):
        httpx = types.ModuleType("httpx")
        httpx.HTTPError = OSError
        client = MagicMock()
        httpx.Client = MagicMock(return_value=client)
        response = client.__enter__.return_value.post.return_value
        response.status_code = 200
        response.content = b'{}'
        response.json.return_value = {"node_id": UUID_A}
        with patch.dict(sys.modules, {"httpx": httpx}), patch.dict(os.environ, {
            "MANGO_CALLBACK_URL": "https://mango.internal/internal/hermes/actions",
            "MANGO_CALLBACK_KEY": "fixture-callback-key-" + "x" * 32,
        }):
            self.assertEqual(json.loads(self.invoke()), {"node_id": UUID_A})
            sent = client.__enter__.return_value.post.call_args.kwargs["json"]
            self.assertEqual(sent, {"run_id": RUN, "session_id": SESSION,
                "tool_call_id": "call_fixture", "action": "mango_list_processes", "arguments": {}})
            httpx.Client.assert_called_once_with(timeout=30, follow_redirects=False, trust_env=False)
            response.status_code = 409
            self.assertIn("rejected", self.invoke())
            self.assertEqual(client.__enter__.return_value.post.call_count, 2)
            response.status_code = 302
            self.assertIn("rejected", self.invoke())

    def test_create_requires_existing_typed_ids_and_nonempty_title(self):
        valid = {"logic_gate_id": UUID_A, "process_step_id": UUID_B, "title": "Call customer"}
        self.assertTrue(plugin._validate_arguments("mango_create_node", valid))
        self.assertFalse(plugin._validate_arguments("mango_create_node", {**valid, "title": " "}))
        self.assertFalse(plugin._validate_arguments("mango_create_node", {**valid, "process_step_id": "../../other"}))

    def test_only_three_typed_business_tools_registered(self):
        ctx = MagicMock()
        plugin.register(ctx)
        self.assertEqual({call.kwargs["name"] for call in ctx.register_tool.call_args_list}, set(plugin._ACTIONS))
        for call in ctx.register_tool.call_args_list:
            schema = call.kwargs["schema"]["parameters"]
            self.assertFalse(schema["additionalProperties"])
            self.assertNotIn("company_id", schema["properties"])
            self.assertNotIn("user_id", schema["properties"])


class RuntimeTests(unittest.TestCase):
    def test_windows_stdin_startup_uses_only_injected_credentials_without_aws_or_secret_files(self):
        credentials = {"OPENAI_API_KEY": "fixture-local-provider", "API_SERVER_KEY": "a" * 32,
                       "MANGO_CALLBACK_KEY": "b" * 32}
        # The next line stays unread: startup must not wait for Docker stdin EOF.
        stream = io.TextIOWrapper(io.BytesIO(b"\xef\xbb\xbf" +
            (json.dumps(credentials) + "\nremaining input\n").encode("utf-8")), encoding="utf-8")
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory) / "scope"
            with patch.dict(sys.modules, {"boto3": None}), patch.dict(os.environ, {
                "HERMES_HOME": str(home), "MANGO_COMPANY_ID": UUID_A, "MANGO_USER_ID": UUID_B,
                "OPENAI_BASE_URL": "https://untrusted.invalid/v1", "HERMES_MANAGED_DIR": "",
            }, clear=True), patch.object(sys, "stdin", stream), patch.object(entrypoint.os, "execvp") as execute:
                entrypoint.main(["--runtime-stdin"])
                self.assertEqual({key: os.environ[key] for key in credentials}, credentials)
                self.assertEqual(os.environ["OPENAI_BASE_URL"], "https://api.openai.com/v1")
                self.assertEqual(stream.readline(), "remaining input\n")
                execute.assert_called_once_with("hermes", ["hermes", "gateway"])
            self.assertEqual(json.loads((home / "mango-scope.json").read_text(encoding="utf-8")),
                             {"company_id": UUID_A, "user_id": UUID_B})
            config = (home / "config.yaml").read_text(encoding="utf-8")
            for secret in credentials.values():
                self.assertNotIn(secret, config)
            self.assertFalse((home / ".env").exists())

    def test_invalid_stdin_credentials_fail_before_writing_a_home(self):
        credentials = {"OPENAI_API_KEY": "fixture-local-provider", "API_SERVER_KEY": "a" * 32,
                       "MANGO_CALLBACK_KEY": "b" * 32}
        invalid = [
            "", json.dumps(credentials), "{invalid}\n", json.dumps(credentials) + " extra\n", "[]\n",
            json.dumps({**credentials, "OPENAI_API_KEY": "x" * entrypoint.MAX_RUNTIME_INPUT}) + "\n",
            json.dumps({**credentials, "OPENAI_API_KEY": "\u00e9" * (entrypoint.MAX_RUNTIME_INPUT // 2)}, ensure_ascii=False) + "\n",
            json.dumps({key: value for key, value in credentials.items() if key != "OPENAI_API_KEY"}) + "\n",
            json.dumps({**credentials, "AWS_SESSION_TOKEN": "not-allowed"}) + "\n",
            json.dumps({**credentials, "OPENAI_API_KEY": None}) + "\n",
            json.dumps({**credentials, "OPENAI_API_KEY": " "}) + "\n",
            json.dumps({**credentials, "OPENAI_API_KEY": "invalid\x00key"}) + "\n",
            json.dumps({**credentials, "API_SERVER_KEY": "a" * 31}) + "\n",
            json.dumps({**credentials, "MANGO_CALLBACK_KEY": "b" * 31}) + "\n",
            json.dumps({**credentials, "MANGO_CALLBACK_KEY": credentials["API_SERVER_KEY"]}) + "\n",
        ]
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory) / "scope"
            for index, payload in enumerate(invalid):
                with self.subTest(case=index), patch.dict(os.environ, {
                    "HERMES_HOME": str(home), "MANGO_COMPANY_ID": UUID_A, "MANGO_USER_ID": UUID_B,
                }, clear=True), patch.object(sys, "stdin", io.TextIOWrapper(io.BytesIO(payload.encode("utf-8")))), \
                        patch.object(entrypoint, "bind_home") as bind, patch.object(entrypoint.os, "execvp") as execute:
                    with self.assertRaises(ValueError):
                        entrypoint.main(["--runtime-stdin"])
                    bind.assert_not_called()
                    execute.assert_not_called()
                    self.assertFalse(home.exists())

    def test_startup_pins_provider_destination_before_native_exec(self):
        with tempfile.TemporaryDirectory() as directory:
            sdk = MagicMock()
            sdk.Session.return_value.client.return_value.get_secret_value.return_value = {"SecretString": "fixture-key"}
            with patch.dict(sys.modules, {"boto3": sdk}), patch.dict(os.environ, {
                "HERMES_HOME": str(Path(directory) / "scope"), "MANGO_COMPANY_ID": UUID_A,
                "MANGO_USER_ID": UUID_B, "API_SERVER_KEY": "a" * 32, "MANGO_CALLBACK_KEY": "b" * 32,
                "OPENAI_BASE_URL": "https://untrusted.invalid/v1", "HERMES_MANAGED_DIR": "",
            }), patch.object(entrypoint.os, "execvp") as execute:
                entrypoint.main()
                self.assertEqual(os.environ["OPENAI_BASE_URL"], "https://api.openai.com/v1")
                self.assertEqual(os.environ["OPENAI_API_KEY"], "fixture-key")
                execute.assert_called_once_with("hermes", ["hermes", "gateway"])

    def test_sticky_profile_and_multiplexing_cannot_change_bound_home(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            environment = {"HERMES_HOME": str(home), "GATEWAY_MULTIPLEX_PROFILES": "true"}
            entrypoint.lock_native_scope(home, environment)
            self.assertEqual(environment["HERMES_HOME"], str(home))
            self.assertEqual(environment["GATEWAY_MULTIPLEX_PROFILES"], "false")
            self.assertEqual(environment["HERMES_GATEWAY_EXTERNAL_SUPERVISOR"], "1")
            with self.assertRaisesRegex(ValueError, "managed configuration"):
                entrypoint.lock_native_scope(home, {**environment, "HERMES_MANAGED_DIR": str(home)})
            with patch.object(entrypoint.Path, "exists", return_value=True):
                with self.assertRaisesRegex(ValueError, "managed configuration"):
                    entrypoint.lock_native_scope(home, environment)
            (home / "active_profile").write_text("another-user", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "different Hermes profile"):
                entrypoint.lock_native_scope(home, environment)
            (home / "active_profile").write_text("default", encoding="utf-8")
            for name in ("gateway.json", ".env", ".op.env"):
                file = home / name
                file.write_text("{}", encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "alternate"):
                    entrypoint.lock_native_scope(home, environment)
                file.unlink()

    def test_home_cannot_change_owner_or_adopt_unbound_data(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory) / "scope"
            entrypoint.bind_home(home, UUID_A, UUID_B)
            (home / "memories").mkdir()
            (home / "memories" / "MEMORY.md").write_text("private fixture", encoding="utf-8")
            entrypoint.bind_home(home, UUID_A, UUID_B)
            with self.assertRaisesRegex(ValueError, "different Mango"):
                entrypoint.bind_home(home, UUID_B, UUID_A)
            other = Path(directory) / "unbound"
            other.mkdir()
            (other / "MEMORY.md").write_text("other private fixture", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "must be empty"):
                entrypoint.bind_home(other, UUID_A, UUID_B)

    def test_only_native_memory_learning_and_mango_tools_enabled(self):
        config = entrypoint.runtime_config("fixture-model")
        self.assertEqual(config["platform_toolsets"]["api_server"], ["memory", "skills", "session_search", "mango"])
        self.assertTrue(config["memory"]["memory_enabled"])
        self.assertTrue(config["memory"]["user_profile_enabled"])
        self.assertEqual(config["model"]["provider"], "openai-api")

    def test_secret_remains_in_memory_and_uses_only_authorized_reference(self):
        client = MagicMock()
        client.get_secret_value.return_value = {"SecretString": " fixture-openai-key "}
        self.assertEqual(entrypoint.load_openai_key(client, entrypoint.OPENAI_SECRET_ID), "fixture-openai-key")
        client.get_secret_value.assert_called_once_with(SecretId=entrypoint.OPENAI_SECRET_ID)
        client.get_secret_value.return_value = {"SecretString": " "}
        with self.assertRaises(ValueError):
            entrypoint.load_openai_key(client, entrypoint.OPENAI_SECRET_ID)
        for name in ("api_key", "openai_api_key", "OPENAI_API_KEY"):
            client.get_secret_value.return_value = {"SecretString": json.dumps({name: "fixture-openai-key"})}
            self.assertEqual(entrypoint.load_openai_key(client, entrypoint.OPENAI_SECRET_ID), "fixture-openai-key")
        for invalid in ("{}", '{"unrelated":"fixture"}', '{"api_key":123}'):
            client.get_secret_value.return_value = {"SecretString": invalid}
            with self.assertRaises(ValueError):
                entrypoint.load_openai_key(client, entrypoint.OPENAI_SECRET_ID)


if __name__ == "__main__":
    unittest.main()
