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
import mango_scope
from functools import partial
list_processes = partial(plugin._call, "mango_list_processes")

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
        constants = types.ModuleType("hermes_constants")
        constants.get_hermes_home = lambda: Path("fixture-profile").resolve()
        key = patch.object(mango_scope, "callback_key", return_value="fixture-callback-key-" + "x" * 32)
        key.start()
        self.addCleanup(key.stop)
        self.modules = patch.dict(sys.modules, {"gateway.session_context": self.session, "hermes_constants": constants})
        self.modules.start()
        self.addCleanup(self.modules.stop)

    def invoke(self, handler=list_processes, args=None):
        return plugin.bind_tool_context(
            "mango_list_processes", {} if args is None else args,
            lambda value: handler(value, session_id=SESSION),
            session_id=SESSION, tool_call_id="call_fixture")

    def test_handler_fails_closed_without_middleware(self):
        self.assertIn("no action was submitted", list_processes({}, session_id=SESSION))

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

    def test_typed_business_tools_registered_without_identity_arguments_or_deletes(self):
        ctx = MagicMock()
        with patch.object(mango_scope, "register_secret_source"), patch("mango_history.register"), patch("mango_integrations.register"):
            plugin.register(ctx)
        self.assertEqual({call.kwargs["name"] for call in ctx.register_tool.call_args_list}, set(plugin._ACTIONS))
        for call in ctx.register_tool.call_args_list:
            schema = call.kwargs["schema"]["parameters"]
            self.assertFalse(schema["additionalProperties"])
            self.assertNotIn("company_id", schema["properties"])
            self.assertNotIn("user_id", schema["properties"])



if __name__ == "__main__":
    unittest.main()
