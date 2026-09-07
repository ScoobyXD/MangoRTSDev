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
import mango_scope as scope
import mango_history as history

A = "11111111-1111-4111-8111-111111111111"
B = "22222222-2222-4222-8222-222222222222"
C = "33333333-3333-4333-8333-333333333333"


class ScopeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.home = Path(self.directory.name) / "gateway"
        self.pairs = [{"company_id": A, "user_id": B}, {"company_id": C, "user_id": B}]
        self.names = [scope.profile_name(**pair) for pair in self.pairs]
        self.environment = {
            "HERMES_HOME": str(self.home), "MANGO_HERMES_PROFILES": json.dumps(self.pairs),
            "MANGO_HERMES_PROFILE_VOLUMES": json.dumps(dict.fromkeys(self.names)),
            "API_SERVER_KEY": "a" * 32, "MANGO_CALLBACK_KEY": "b" * 32,
            "OPENAI_API_KEY": "fixture-model-key", "OPENAI_BASE_URL": "https://api.openai.com/v1",
            "MANGO_CALLBACK_URL": "http://localhost:8080/internal/hermes/actions",
        }
        self.env = patch.dict(os.environ, self.environment, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)

    def configure(self):
        entrypoint.configure_gateway(self.home, os.environ)

    def test_one_gateway_routes_two_exact_company_user_profiles(self):
        self.configure()
        config = json.loads((self.home / "config.yaml").read_text())
        self.assertTrue(config["gateway"]["multiplex_profiles"])
        self.assertEqual(config["gateway"]["multiplex_profile_allowlist"], self.names)
        self.assertEqual(config["platform_toolsets"]["api_server"], [])
        self.assertEqual(os.environ["GATEWAY_MULTIPLEX_PROFILES"], "true")
        for name, pair in zip(self.names, self.pairs):
            home = self.home / "profiles" / name
            self.assertEqual(len(name), 64)
            self.assertEqual(json.loads((home / "mango-scope.json").read_text()), pair)
            self.assertEqual(scope.bound_profile(home), name)
            text = (home / "config.yaml").read_text()
            self.assertNotIn("fixture-model-key", text)
            self.assertNotIn("a" * 32, text)

    def test_profile_credentials_are_distinct_stable_and_never_inherit_another_home(self):
        self.configure()
        homes = [self.home / "profiles" / name for name in self.names]
        with ThreadPoolExecutor(max_workers=2) as pool:
            keys = list(pool.map(scope.runtime_secrets, homes))
        self.assertNotEqual(keys[0]["API_SERVER_KEY"], keys[1]["API_SERVER_KEY"])
        self.assertNotEqual(keys[0]["MANGO_CALLBACK_KEY"], keys[1]["MANGO_CALLBACK_KEY"])
        self.assertNotEqual(keys[0]["API_SERVER_KEY"], keys[0]["MANGO_CALLBACK_KEY"])
        self.assertEqual(scope.runtime_secrets(homes[0]), keys[0])
        with self.assertRaises(ValueError):
            scope.callback_key(self.home)
        (homes[1] / "mango-scope.json").write_text(json.dumps(self.pairs[0]))
        with self.assertRaises(ValueError):
            scope.runtime_secrets(homes[1])

    def test_restart_preserves_native_data_and_profile_settings(self):
        self.configure()
        home = self.home / "profiles" / self.names[0]
        memory = home / "memories" / "MEMORY.md"
        memory.parent.mkdir()
        memory.write_text("private fixture")
        config = json.loads((home / "config.yaml").read_text())
        config["agent"]["max_turns"] = 12
        config["memory"]["memory_char_limit"] = 4200
        config["model"]["default"] = "selected-model"
        (home / "config.yaml").write_text(json.dumps(config))
        self.configure()
        saved = json.loads((home / "config.yaml").read_text())
        self.assertEqual(memory.read_text(), "private fixture")
        self.assertEqual(saved["agent"]["max_turns"], 12)
        self.assertEqual(saved["memory"]["memory_char_limit"], 4200)
        self.assertEqual(saved["model"]["default"], "selected-model")

    def test_existing_bound_volume_is_adopted_in_place_but_never_reassigned(self):
        home = self.home / "profiles" / self.names[0]
        entrypoint.bind_home(home, **self.pairs[0])
        (home / "private.txt").write_text("existing fixture")
        mounts = dict.fromkeys(self.names)
        mounts[self.names[0]] = "mangorts-hermes-" + A + "-" + B
        os.environ["MANGO_HERMES_PROFILE_VOLUMES"] = json.dumps(mounts)
        self.configure()
        self.assertEqual((home / "private.txt").read_text(), "existing fixture")
        mounts[self.names[0]] = None
        os.environ["MANGO_HERMES_PROFILE_VOLUMES"] = json.dumps(mounts)
        with self.assertRaisesRegex(ValueError, "switch persistent volumes"):
            self.configure()
        with self.assertRaisesRegex(ValueError, "different Mango"):
            entrypoint.bind_home(home, C, B)

    def test_compression_retains_the_admitted_native_session_identity(self):
        self.configure()
        home = self.home / "profiles" / self.names[0]
        config = json.loads((home / "config.yaml").read_text())
        config["compression"] = {"in_place": False, "threshold": 0.7}
        (home / "config.yaml").write_text(json.dumps(config))
        self.configure()
        saved = json.loads((home / "config.yaml").read_text())
        self.assertEqual(saved["compression"], {"in_place": True, "threshold": 0.7})

    def test_removed_profile_stays_private_and_retains_its_volume_binding(self):
        self.configure()
        os.environ["MANGO_HERMES_PROFILES"] = json.dumps(self.pairs[:1])
        os.environ["MANGO_HERMES_PROFILE_VOLUMES"] = json.dumps({self.names[0]: None})
        self.configure()
        self.assertIn(self.names[1], json.loads((self.home / "mango-gateway.json").read_text())["profile_volumes"])
        with self.assertRaises(ValueError):
            scope.bound_profile(self.home / "profiles" / self.names[1])

    def test_unbound_or_listener_private_data_is_never_adopted(self):
        self.home.mkdir()
        (self.home / "MEMORY.md").write_text("private")
        with self.assertRaisesRegex(ValueError, "new shared home"):
            self.configure()
        other = Path(self.directory.name) / "unbound"
        other.mkdir()
        (other / "private.txt").write_text("private")
        with self.assertRaisesRegex(ValueError, "must be empty"):
            entrypoint.bind_home(other, A, B)

    def test_changed_api_seed_cannot_orphan_durable_run_ownership(self):
        self.configure()
        os.environ["API_SERVER_KEY"] = "changed" * 8
        with self.assertRaisesRegex(ValueError, "durable run storage"):
            self.configure()

    def test_integration_credentials_are_scoped_and_cannot_override_runtime(self):
        self.configure()
        reference = "MANGO_INTEGRATION_GOOGLE_CLIENT_SECRET"
        os.environ["MANGO_INTEGRATION_SECRETS"] = json.dumps({self.names[0]: {reference: "fixture-google"}})
        self.assertEqual(scope.runtime_secrets(self.home / "profiles" / self.names[0])[reference], "fixture-google")
        self.assertNotIn(reference, scope.runtime_secrets(self.home / "profiles" / self.names[1]))
        self.assertNotIn(reference, scope.runtime_secrets(self.home))
        for invalid in [{"unknown-profile": {reference: "value"}}, {self.names[0]: {"API_SERVER_KEY": "override"}}, {self.names[0]: {reference: None}}]:
            os.environ["MANGO_INTEGRATION_SECRETS"] = json.dumps(invalid)
            with self.assertRaises(ValueError):
                scope.integration_secrets()

    def test_background_outboxes_capture_profile_credentials_before_thread_handoff(self):
        self.configure()
        constants = types.ModuleType("hermes_constants")
        constants.get_hermes_home = lambda: self.home
        with patch.dict(sys.modules, {"hermes_constants": constants}):
            boxes = [history.HistoryOutbox(self.home / "profiles" / name, start_worker=False) for name in self.names]
        self.assertNotEqual(boxes[0].configuration[1], boxes[1].configuration[1])
        self.assertNotEqual(boxes[0].path, boxes[1].path)
        boxes[0].enqueue({"event_id": "same", "run_id": "run_fixture", "data": {"output": "first"}})
        boxes[1].enqueue({"event_id": "same", "run_id": "run_fixture", "data": {"output": "second"}})
        httpx = types.ModuleType("httpx")
        httpx.HTTPError = OSError
        httpx.Client = MagicMock()
        send = httpx.Client.return_value.__enter__.return_value.post
        send.return_value.status_code = 200
        with patch.dict(sys.modules, {"httpx": httpx}), ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(list(pool.map(lambda box: box.flush_one(), boxes)), ["sent", "sent"])
        actual = {call.kwargs["headers"]["Authorization"]: json.loads(call.kwargs["content"])["data"]["output"] for call in send.call_args_list}
        self.assertEqual(actual, {"Bearer " + boxes[0].configuration[1]: "first", "Bearer " + boxes[1].configuration[1]: "second"})

    def test_root_registration_resumes_all_queues_without_named_profile_rescans(self):
        self.configure()
        constants = types.ModuleType("hermes_constants")
        constants.get_hermes_home = MagicMock(return_value=self.home)
        with patch.dict(sys.modules, {"hermes_constants": constants}), patch.object(history, "profile_outbox") as resume:
            history.register(MagicMock())
            self.assertEqual([call.args[0] for call in resume.call_args_list],
                             [self.home / "profiles" / name for name in self.names])
            resume.reset_mock()
            with patch.object(scope, "profiles", side_effect=AssertionError("Named registration rescanned profiles")):
                for name in self.names:
                    constants.get_hermes_home.return_value = self.home / "profiles" / name
                    ctx = MagicMock()
                    history.register(ctx)
                    ctx.register_middleware.assert_called_once_with("tool_execution", history.observe_tool)
                    self.assertEqual(ctx.register_hook.call_count, 6)
            resume.assert_not_called()

    def test_stdin_is_bounded_and_never_reads_aws_or_saves_credentials(self):
        credentials = {name: self.environment[name] for name in ("OPENAI_API_KEY", "API_SERVER_KEY", "MANGO_CALLBACK_KEY")}
        stream = io.TextIOWrapper(io.BytesIO(b"\xef\xbb\xbf" + (json.dumps(credentials) + "\nunused\n").encode()))
        with patch.dict(sys.modules, {"boto3": None}), patch.object(sys, "stdin", stream), patch.object(entrypoint.os, "execvp") as execute:
            entrypoint.main(["--runtime-stdin"])
            execute.assert_called_once_with("hermes", ["hermes", "gateway"])
            self.assertEqual(stream.readline(), "unused\n")
        for invalid in ["", "{}\n", "[]\n", json.dumps(credentials), json.dumps({**credentials, "AWS_SESSION_TOKEN": "forbidden"}) + "\n", "x" * (entrypoint.MAX_RUNTIME_INPUT + 1)]:
            with patch.object(sys, "stdin", io.TextIOWrapper(io.BytesIO(invalid.encode()))), self.assertRaises(ValueError):
                entrypoint.read_runtime_credentials()


if __name__ == "__main__":
    unittest.main()
