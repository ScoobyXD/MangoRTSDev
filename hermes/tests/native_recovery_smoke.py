"""Test operator repair against the pinned native SessionDB using temporary data only.

Run: python hermes/tests/native_recovery_smoke.py --source /opt/hermes
No provider or callback is contacted; the existing durable queue is inspected locally.
"""

import argparse
from contextlib import closing
import io
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.scopes = [
            {"company_id": "11111111-1111-4111-8111-111111111111", "user_id": "22222222-2222-4222-8222-222222222222"},
            {"company_id": "33333333-3333-4333-8333-333333333333", "user_id": "22222222-2222-4222-8222-222222222222"},
        ]
        environment = patch.dict(os.environ, {
            "HERMES_HOME": str(self.root), "MANGO_HERMES_PROFILES": json.dumps(self.scopes),
            "MANGO_CALLBACK_KEY": "fixture-callback-seed-" + "x" * 32,
            "MANGO_CALLBACK_URL": "http://127.0.0.1:1/internal/hermes/actions",
        }, clear=True)
        environment.start()
        self.addCleanup(environment.stop)
        self.homes = []
        for scope in self.scopes:
            home = self.root / "profiles" / mango_scope.profile_name(**scope)
            home.mkdir(parents=True)
            (home / "mango-scope.json").write_text(json.dumps(scope))
            self.homes.append(home)
        self.run = "run_" + "a" * 32
        self.session = "native-recovery-fixture"
        history._outboxes.clear()
        history._native_dbs.clear()
        self.addCleanup(self.close_native)

    def close_native(self):
        for db in history._native_dbs.values():
            db.close()
        history._native_dbs.clear()
        history._outboxes.clear()

    def request(self, index=0):
        return {**self.scopes[index], "run_id": self.run, "session_id": self.session}

    def native(self, index=0):
        db = SessionDB(db_path=self.homes[index] / "state.db")
        db.create_session(self.session, "api_server")
        return db

    def queued(self, index=0):
        queue = history.profile_outbox(self.homes[index], start_worker=False)
        with queue.connect() as db:
            return [json.loads(row[0]) for row in db.execute("SELECT payload FROM events ORDER BY sequence")]

    def test_complete_native_display_keeps_archived_ids_and_excludes_rewind(self):
        db = self.native()
        user_id = db.append_message(self.session, "user", 'Literal "text"', timestamp=101)
        ai_id = db.append_message(self.session, "assistant", [{"type": "text", "text": "Saved answer"}], reasoning="private reasoning", timestamp=102)
        db.archive_and_compact(self.session, [{"role": "system", "content": "private summary"}])
        db.append_message(self.session, "tool", "private tool result")
        rewind_id = db.append_message(self.session, "assistant", "private undone reply")
        db.close()
        with closing(sqlite3.connect(self.homes[0] / "state.db")) as fixture, fixture:
            fixture.execute("UPDATE messages SET active=0, compacted=0 WHERE id=?", (rewind_id,))
        with patch.object(history.threading, "Thread", side_effect=AssertionError("repair started a delivery worker")):
            self.assertEqual(recovery.queue_history_repairs(json.dumps([self.request()])), 1)
        batch, complete, recovered = self.queued()
        self.assertEqual([message["message_id"] for message in batch["messages"]], [user_id, ai_id])
        self.assertEqual([message["content"] for message in batch["messages"]], ['Literal "text"', "Saved answer"])
        self.assertEqual(batch["messages"][0]["created_at"], "1970-01-01T00:01:41Z")
        self.assertTrue(all(message["current_run"] is False for message in batch["messages"]))
        self.assertEqual(complete["message_ids"], [user_id, ai_id])
        self.assertTrue(complete["messages_complete"])
        self.assertEqual(recovered["type"], "history.recovered")
        self.assertEqual(recovered["data"], {})
        self.assertTrue(all(event["session_id"] == self.session and event["run_id"] == self.run for event in self.queued()))
        self.assertNotIn("private", json.dumps(self.queued()))
        self.assertNotIn("run.finished", json.dumps(self.queued()))
        self.assertTrue(history._native_dbs[str(self.homes[0].resolve())].read_only)
        self.assertEqual(get_hermes_home(), self.root)
        self.assertEqual(os.environ["HERMES_HOME"], str(self.root))
        recovery.queue_history_repairs(json.dumps([self.request()]))
        self.assertNotEqual(self.queued()[-1]["event_id"], recovered["event_id"])

    def test_exact_profile_and_literal_session_are_never_redirected(self):
        for index in range(2):
            db = self.native(index)
            db.append_message(self.session, "user", f"Profile {index}")
            db.create_session("descendant", "api_server", parent_session_id=self.session)
            db.append_message("descendant", "assistant", "private descendant")
            db.close()
        recovery.queue_history_repairs(json.dumps([self.request(0), self.request(1)]))
        for index in range(2):
            self.assertEqual(self.queued(index)[0]["messages"][0]["content"], f"Profile {index}")
            self.assertNotIn("descendant", json.dumps(self.queued(index)))

    def test_missing_session_and_failed_capture_never_queue_completion(self):
        db = self.native()
        db.close()
        request = {**self.request(), "session_id": "missing"}
        with self.assertRaisesRegex(ValueError, "Native session is unavailable"):
            recovery.queue_history_repairs(json.dumps([request]))
        self.assertEqual(self.queued(), [])
        self.assertEqual(get_hermes_home(), self.root)
        db = SessionDB(db_path=self.homes[0] / "state.db")
        db.append_message(self.session, "user", "This message exceeds the fixture limit")
        db.close()
        with patch.object(history, "_MAX_MESSAGE_BYTES", 1), self.assertRaisesRegex(ValueError, "exceeds"):
            recovery.queue_history_repairs(json.dumps([self.request()]))
        self.assertEqual(self.queued(), [])

    def test_parked_run_is_retained_without_repair_marker(self):
        db = self.native()
        db.close()
        queue = history.profile_outbox(self.homes[0], start_worker=False)
        queue.enqueue({"event_id": self.run + ":old", "run_id": self.run})
        with queue.connect() as db:
            db.execute("UPDATE events SET rejected_status=409")
        before = self.queued()
        with self.assertRaisesRegex(ValueError, "previously rejected"):
            recovery.queue_history_repairs(json.dumps([self.request()]))
        self.assertEqual(self.queued(), before)

    def test_noop_and_invalid_tuples_create_no_queue(self):
        self.assertEqual(recovery.queue_history_repairs("[]"), 0)
        for requests in [self.request(), [self.request(), self.request()], [{**self.request(), "extra": "field"}],
                         [{**self.request(), "user_id": self.scopes[0]["company_id"]}],
                         [{**self.request(), "session_id": "../wrong"}], [{**self.request(), "run_id": "run_wrong"}]]:
            with self.subTest(requests=requests), self.assertRaises(ValueError):
                recovery.queue_history_repairs(json.dumps(requests))
        self.assertFalse(any(self.root.rglob("mango_history_outbox.db")))

    def test_private_stdin_repairs_queue_before_native_exec(self):
        payload = {"OPENAI_API_KEY": "fixture", "API_SERVER_KEY": "a" * 32, "MANGO_CALLBACK_KEY": "b" * 32,
                   "MANGO_HERMES_HISTORY_REPAIRS": "[]"}
        stream = io.TextIOWrapper(io.BytesIO((json.dumps(payload) + "\n").encode()))
        calls = []
        with patch.object(sys, "stdin", stream), patch.object(entrypoint, "configure_gateway"), \
             patch.object(recovery, "queue_history_repairs", side_effect=lambda raw: calls.append(("repair", raw)) or 0), \
             patch.object(entrypoint.os, "execvp", side_effect=lambda *args: calls.append(("exec", args))):
            entrypoint.main(["--runtime-stdin"])
        self.assertEqual([call[0] for call in calls], ["repair", "exec"])
        self.assertNotIn("MANGO_HERMES_HISTORY_REPAIRS", os.environ)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    arguments, remaining = parser.parse_known_args()
    sys.path[:0] = [str(Path(arguments.source).resolve()), str(Path(__file__).resolve().parents[1])]
    from hermes_state import SessionDB
    from hermes_constants import get_hermes_home
    import entrypoint
    import mango_history as history
    import mango_recovery as recovery
    import mango_scope
    unittest.main(argv=[sys.argv[0], *remaining])
