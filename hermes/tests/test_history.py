import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import types
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import mango_history as history
import mango_scope

RUN = "run_" + "a" * 32
SESSION = "history-fixture"


class HistoryTests(unittest.TestCase):
    def setUp(self):
        native = {"HERMES_SESSION_KEY": RUN, "HERMES_SESSION_ID": SESSION,
                  "HERMES_SESSION_PLATFORM": "api_server"}
        context = types.ModuleType("gateway.session_context")
        context.get_session_env = lambda name: native.get(name, "")
        self.context = patch.dict(sys.modules, {"gateway.session_context": context})
        self.context.start()
        self.addCleanup(self.context.stop)
        constants = types.ModuleType("hermes_constants")
        constants.get_hermes_home = lambda: Path("fixture-profile").resolve()
        self.constants = patch.dict(sys.modules, {"hermes_constants": constants})
        self.constants.start()
        self.addCleanup(self.constants.stop)
        binding = patch.object(mango_scope, "bound_profile", return_value="fixture-profile")
        binding.start()
        self.addCleanup(binding.stop)
        self.events = []
        outbox = MagicMock()
        outbox.enqueue.side_effect = self.events.append
        self.queue = patch.object(history, "outbox", return_value=outbox)
        self.queue.start()
        self.addCleanup(self.queue.stop)
        history._outputs.clear()
        history._model_starts.clear()

    def test_observation_identity_comes_only_from_native_context(self):
        history.on_run_start(session_id="forged", run_id=RUN, turn_id="turn")
        self.assertEqual(self.events, [])
        history.on_run_start(session_id=SESSION, run_id="forged", turn_id="turn", model="fixture-model")
        self.assertEqual(self.events[0]["run_id"], RUN)
        self.assertEqual(self.events[0]["session_id"], SESSION)
        self.assertEqual(self.events[0]["data"], {"model": "fixture-model"})

    def test_all_tools_are_observed_without_exporting_arguments_or_results(self):
        with patch.object(history, "_safe_snapshot") as capture:
            result = history.observe_tool("memory", {"secret": "private-argument"},
                lambda args: '{"error":"private-result"}', session_id=SESSION, tool_call_id="call-memory")
        capture.assert_not_called()
        self.assertIn("private-result", result)
        self.assertEqual([event["type"] for event in self.events], ["tool.started", "tool.completed"])
        self.assertFalse(self.events[1]["data"]["succeeded"])
        self.assertNotIn("private-argument", json.dumps(self.events))
        self.assertNotIn("private-result", json.dumps(self.events))

    def test_tool_exception_is_observed_and_next_call_runs_once(self):
        execute = MagicMock(side_effect=RuntimeError("private exception"))
        with patch.object(history, "_safe_snapshot"), self.assertRaises(RuntimeError):
            history.observe_tool("session_search", {}, execute, session_id=SESSION, tool_call_id="call-search")
        execute.assert_called_once_with({})
        self.assertFalse(self.events[-1]["data"]["succeeded"])
        self.assertNotIn("private exception", json.dumps(self.events))

    def test_completion_uses_exact_output_hook_and_clears_run_state(self):
        history.on_reply(session_id=SESSION, turn_id="turn", assistant_response="Visible final reply.", reasoning="private reasoning")
        with patch.object(history, "_safe_snapshot", return_value=True) as capture:
            history.on_run_end(session_id=SESSION, turn_id="turn", completed=True)
        capture.assert_called_once_with((RUN, SESSION), "finished")
        self.assertEqual([event["type"] for event in self.events], ["message.completed", "run.finished"])
        self.assertEqual(self.events[-1]["data"]["output"], "Visible final reply.")
        self.assertNotIn("private reasoning", json.dumps(self.events))
        self.assertEqual(history._outputs, {})
        with patch.object(history, "_safe_snapshot", return_value=True):
            history.on_run_end(session_id=SESSION, turn_id="next", failed=True)
        self.assertNotIn("output", self.events[-1]["data"])

    def test_failed_final_snapshot_never_claims_saved_history_and_cleans_run_state(self):
        history.on_reply(session_id=SESSION, assistant_response="Visible final reply.")
        history._model_starts.add(history._run_key((RUN, SESSION)))
        with patch.object(history, "snapshot", side_effect=OSError("private database detail")), self.assertLogs(history.logger, level="ERROR") as logs:
            history.on_run_end(session_id=SESSION, completed=True)
        self.assertEqual([event["type"] for event in self.events], ["message.completed"])
        self.assertEqual(history._outputs, {})
        self.assertEqual(history._model_starts, set())
        self.assertIn(RUN, logs.output[0])
        self.assertNotIn("private database detail", logs.output[0])

    def test_missing_native_session_never_claims_saved_history(self):
        db = MagicMock()
        db.get_session.return_value = None
        native = types.ModuleType("hermes_state")
        native.SessionDB = MagicMock(return_value=db)
        projection = types.ModuleType("agent.compaction_display")
        projection.project_compaction_message_for_display = lambda row: row
        with patch.dict(sys.modules, {"hermes_state": native, "agent.compaction_display": projection}), patch.object(history, "_native_dbs", {str(Path("fixture-profile").resolve()): db}), self.assertLogs(history.logger, level="ERROR"):
            history.on_run_end(session_id=SESSION, completed=True)
        self.assertEqual(self.events, [])
        db.get_messages.assert_not_called()

    def test_transcript_keeps_native_ids_and_only_visible_content(self):
        db = MagicMock()
        db.get_session.return_value = {"id": SESSION, "title": "Fixture chat", "started_at": 100}
        db.get_messages.return_value = [
            {"id": 7, "role": "user", "content": "Hello", "timestamp": 101},
            {"id": 8, "role": "tool", "content": "private tool body", "timestamp": 102},
            {"id": 9, "role": "assistant", "content": "", "reasoning": "private reasoning", "timestamp": 103},
            {"id": 10, "role": "user", "content": "private compaction", "timestamp": 104, "display_kind": "hidden"},
            {"id": 11, "role": "assistant", "content": [{"type": "text", "text": "Answer"}, {"type": "reasoning", "text": "private reasoning"}], "timestamp": 105},
        ]
        native = types.ModuleType("hermes_state")
        native.SessionDB = MagicMock(return_value=db)
        projection = types.ModuleType("agent.compaction_display")
        projection.project_compaction_message_for_display = lambda row: row
        with patch.dict(sys.modules, {"hermes_state": native, "agent.compaction_display": projection}), patch.object(history, "_native_dbs", {str(Path("fixture-profile").resolve()): db}):
            history.on_run_end(session_id=SESSION, completed=True)
        db.get_messages.assert_called_once_with(SESSION, include_compacted=True)
        batch, complete, finished = self.events
        self.assertEqual([message["message_id"] for message in batch["messages"]], [7, 11])
        self.assertEqual(batch["messages"][1]["content"], "Answer")
        self.assertTrue(all(message["current_run"] is False for message in batch["messages"]))
        self.assertEqual(complete["message_ids"], [7, 11])
        self.assertTrue(complete["messages_complete"])
        self.assertEqual(complete["messages"], [])
        self.assertEqual(complete["chat_created_at"], "1970-01-01T00:01:40Z")
        self.assertEqual(finished["type"], "run.finished")
        self.assertNotIn("private", json.dumps(self.events))

    def test_model_observers_never_copy_raw_provider_payloads(self):
        with patch.object(history, "_safe_snapshot") as capture:
            history.on_model_start(session_id=SESSION, api_request_id="api1", api_call_count=1, model="fixture", request={"secret": "private"})
            history.on_model_start(session_id=SESSION, api_request_id="api2", api_call_count=2, model="fixture")
            history.on_model_end(session_id=SESSION, api_request_id="api1", api_call_count=1, api_duration=0.2, response={"reasoning": "private"})
            history.on_model_error(session_id=SESSION, api_request_id="api2", error="private")
        capture.assert_called_once_with((RUN, SESSION), "input")
        self.assertNotIn("private", json.dumps(self.events))
        self.assertEqual(self.events[-1]["type"], "model.failed")

    def test_missing_or_invalid_metrics_cannot_poison_the_delivery_queue(self):
        with patch.object(history, "_safe_snapshot"):
            history.on_model_start(session_id=SESSION, api_request_id="api1", api_call_count=None, model=None)
            history.on_model_end(session_id=SESSION, api_request_id="api1", api_call_count=float("nan"), api_duration=-1)
        self.assertEqual(self.events[0]["data"], {"model": "", "call": 0})
        self.assertEqual(self.events[1]["data"], {"call": 0, "duration_seconds": 0})

    def test_large_snapshot_batches_finish_before_the_complete_marker(self):
        db = MagicMock()
        db.get_session.return_value = {"id": SESSION}
        db.get_messages.return_value = [
            {"id": index, "role": "user", "content": "x" * 100, "timestamp": index}
            for index in range(1, 4)
        ]
        native = types.ModuleType("hermes_state")
        native.SessionDB = MagicMock(return_value=db)
        projection = types.ModuleType("agent.compaction_display")
        projection.project_compaction_message_for_display = lambda row: row
        with patch.dict(sys.modules, {"hermes_state": native, "agent.compaction_display": projection}), patch.object(history, "_native_dbs", {str(Path("fixture-profile").resolve()): db}), patch.object(history, "_MAX_BATCH_BYTES", 300):
            history.snapshot((RUN, SESSION), "finished")
        self.assertEqual(len(self.events), 4)
        self.assertTrue(self.events[-1]["messages_complete"])
        self.assertEqual(self.events[-1]["message_ids"], [1, 2, 3])
        self.assertTrue(all("messages_complete" not in event for event in self.events[:-1]))
        self.assertEqual([event["messages"][0]["message_id"] for event in self.events[:-1]], [1, 2, 3])

    def test_concurrent_snapshots_cannot_interleave_batches(self):
        db = MagicMock()
        db.get_session.return_value = {"id": SESSION}
        entered, release = threading.Event(), threading.Event()
        def read_messages(*args, **kwargs):
            if threading.current_thread().name == "snapshot-first":
                entered.set()
                self.assertTrue(release.wait(3))
                return [{"id": 1, "role": "user", "content": "first", "timestamp": 1}]
            return [{"id": 2, "role": "user", "content": "second", "timestamp": 2}]
        db.get_messages.side_effect = read_messages
        native = types.ModuleType("hermes_state")
        native.SessionDB = MagicMock(return_value=db)
        projection = types.ModuleType("agent.compaction_display")
        projection.project_compaction_message_for_display = lambda row: row
        with patch.dict(sys.modules, {"hermes_state": native, "agent.compaction_display": projection}), patch.object(history, "_native_dbs", {str(Path("fixture-profile").resolve()): db}):
            first = threading.Thread(target=history.snapshot, args=((RUN, SESSION), "first"), name="snapshot-first")
            second = threading.Thread(target=history.snapshot, args=((RUN, SESSION), "second"))
            first.start()
            self.assertTrue(entered.wait(3))
            second.start()
            release.set()
            first.join(3)
            second.join(3)
            self.assertFalse(first.is_alive() or second.is_alive())
        self.assertEqual([event["message_ids"] for event in self.events if event.get("messages_complete")], [[1], [2]])
        self.assertEqual(["first" if ":first:" in event["event_id"] else "second" for event in self.events], ["first", "first", "second", "second"])


class OutboxTests(unittest.TestCase):
    def setUp(self):
        constants = types.ModuleType("hermes_constants")
        constants.get_hermes_home = lambda: Path("fixture-profile").resolve()
        modules = patch.dict(sys.modules, {"hermes_constants": constants})
        modules.start()
        self.addCleanup(modules.stop)
        key = patch.object(mango_scope, "callback_key", return_value="fixture-" + "x" * 40)
        key.start()
        self.addCleanup(key.stop)

    def test_lost_acknowledgement_survives_restart_and_preserves_fifo(self):
        httpx = types.ModuleType("httpx")
        httpx.HTTPError = OSError
        client = MagicMock()
        httpx.Client = MagicMock(return_value=client)
        send = client.__enter__.return_value.post
        response = MagicMock(status_code=200)
        with tempfile.TemporaryDirectory() as directory, patch.dict(sys.modules, {"httpx": httpx}), patch.dict(os.environ, {
            "MANGO_CALLBACK_URL": "https://mango.internal/internal/hermes/actions",
            "MANGO_CALLBACK_KEY": "fixture-" + "x" * 40,
        }):
            first = history.HistoryOutbox(directory, start_worker=False)
            first.enqueue({"event_id": "first", "run_id": RUN, "data": {"output": "reply"}})
            first.enqueue({"event_id": "second", "run_id": RUN, "data": {}})
            first.enqueue({"event_id": "first", "run_id": RUN, "data": {"output": "must not overwrite"}})
            send.side_effect = [OSError("private transport failure"), response, response]
            self.assertEqual(first.flush_one(), "retry")
            resumed = history.HistoryOutbox(directory, start_worker=False)
            self.assertEqual(resumed.flush_one(), "sent")
            self.assertEqual(resumed.flush_one(), "sent")
            self.assertEqual(resumed.flush_one(), "empty")
            calls = send.call_args_list
            self.assertEqual(calls[0].kwargs["content"], calls[1].kwargs["content"])
            self.assertEqual(json.loads(calls[1].kwargs["content"])["data"]["output"], "reply")
            self.assertEqual(json.loads(calls[2].kwargs["content"])["event_id"], "second")
            self.assertEqual(calls[0].args[0], "https://mango.internal/internal/hermes/history")
            for call in httpx.Client.call_args_list:
                self.assertEqual(call.kwargs, {"timeout": 10, "follow_redirects": False, "trust_env": False})

    def test_redirect_never_removes_a_queued_event(self):
        httpx = types.ModuleType("httpx")
        httpx.HTTPError = OSError
        client = MagicMock()
        httpx.Client = MagicMock(return_value=client)
        client.__enter__.return_value.post.return_value.status_code = 302
        with tempfile.TemporaryDirectory() as directory, patch.dict(sys.modules, {"httpx": httpx}), patch.dict(os.environ, {
            "MANGO_CALLBACK_URL": "http://localhost/internal/hermes/actions",
            "MANGO_CALLBACK_KEY": "fixture-" + "x" * 40,
        }):
            queue = history.HistoryOutbox(directory, start_worker=False)
            queue.enqueue({"event_id": "first", "run_id": RUN})
            self.assertEqual(queue.flush_one(), "retry")
            self.assertEqual(queue.flush_one(), "retry")
            self.assertEqual(client.__enter__.return_value.post.call_count, 2)

    def test_rejected_run_is_retained_and_cannot_block_or_prune_a_new_run(self):
        httpx = types.ModuleType("httpx")
        httpx.HTTPError = OSError
        client = MagicMock()
        httpx.Client = MagicMock(return_value=client)
        send = client.__enter__.return_value.post
        with tempfile.TemporaryDirectory() as directory, patch.dict(sys.modules, {"httpx": httpx}), patch.dict(os.environ, {
            "MANGO_CALLBACK_URL": "http://localhost/internal/hermes/actions",
            "MANGO_CALLBACK_KEY": "fixture-" + "x" * 40,
        }):
            queue = history.HistoryOutbox(directory, start_worker=False)
            queue.enqueue({"event_id": "bad-batch", "run_id": RUN, "messages": [{"content": "retained visible text"}]})
            queue.enqueue({"event_id": "old-complete", "run_id": RUN, "messages_complete": True})
            queue.enqueue({"event_id": "healthy", "run_id": "new-run"})
            send.side_effect = [MagicMock(status_code=410), MagicMock(status_code=200)]
            with self.assertLogs(history.logger, level="ERROR"):
                self.assertEqual(queue.flush_one(), "rejected")
            queue.enqueue({"event_id": "late-old", "run_id": RUN})
            self.assertEqual(queue.flush_one(), "sent")
            self.assertEqual(queue.flush_one(), "empty")
            self.assertEqual([json.loads(call.kwargs["content"])["event_id"] for call in send.call_args_list], ["bad-batch", "healthy"])
            with queue.connect() as db:
                rows = db.execute("SELECT event_id,rejected_status,payload FROM events ORDER BY sequence").fetchall()
            self.assertEqual([(row[0], row[1]) for row in rows], [("bad-batch", 410), ("old-complete", 410), ("late-old", 410)])
            self.assertIn("retained visible text", rows[0][2])


if __name__ == "__main__":
    unittest.main()
