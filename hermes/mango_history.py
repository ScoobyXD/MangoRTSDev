"""Persist supported native observations before delivering them to Mango.

The queue belongs to the already-bound Hermes home. It contains user-visible
messages and allowlisted event metadata, never transport credentials or raw model/tool
payloads. Delivery does not depend on an SSE subscriber.
"""

from datetime import datetime, timezone
from contextlib import contextmanager
import json
import logging
import math
import os
from pathlib import Path
import re
import sqlite3
import threading
import time
from urllib.parse import urlsplit, urlunsplit

logger = logging.getLogger(__name__)
_outboxes = {}
_native_dbs = {}
_lock = threading.RLock()
_outputs = {}
_model_starts = set()
_MAX_BATCH_BYTES = 850_000
_MAX_MESSAGE_BYTES = 1_800_000


def timestamp(value=None):
    return datetime.fromtimestamp(time.time() if value is None else float(value), timezone.utc).isoformat().replace("+00:00", "Z")


def native_context(session_id):
    from gateway.session_context import get_session_env

    run_id = get_session_env("HERMES_SESSION_KEY")
    if (get_session_env("HERMES_SESSION_PLATFORM") != "api_server"
            or not re.fullmatch(r"run_[0-9a-f]{32}", run_id or "")
            or not session_id or session_id != get_session_env("HERMES_SESSION_ID")):
        return None
    return run_id, session_id


def callback_configuration(home=None):
    from hermes_constants import get_hermes_home
    from mango_scope import callback_key

    url = urlsplit(os.environ.get("MANGO_CALLBACK_URL", ""))
    try:
        key = callback_key(get_hermes_home() if home is None else home)
    except (KeyError, ValueError, OSError):
        return None
    if (url.scheme not in {"http", "https"} or not url.hostname or url.username
            or url.password or url.query or url.fragment
            or url.path != "/internal/hermes/actions" or len(key) < 32):
        return None
    return urlunsplit((url.scheme, url.netloc, "/internal/hermes/history", "", "")), key


class HistoryOutbox:
    """One small durable FIFO; a lost acknowledgement safely resends the same ID."""

    def __init__(self, home, *, start_worker=True):
        self.path = Path(home) / "mango_history_outbox.db"
        # Capture exact profile credentials before crossing into a delivery
        # thread. Retried callbacks never consult that thread's ambient home.
        self.configuration = callback_configuration(home)
        self.wake = threading.Event()
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE, run_id TEXT NOT NULL, payload TEXT NOT NULL, rejected_status INTEGER)")
        self.path.chmod(0o600)
        if start_worker:
            threading.Thread(target=self.deliver, name="mango-history-delivery", daemon=True).start()

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        try:
            with db:
                yield db
        finally:
            db.close()

    def enqueue(self, payload):
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        with self.connect() as db:
            db.execute("INSERT INTO events(event_id,run_id,payload,rejected_status) SELECT ?,?,?,(SELECT rejected_status FROM events WHERE run_id=? AND rejected_status IS NOT NULL LIMIT 1) ON CONFLICT(event_id) DO NOTHING", (payload["event_id"], payload["run_id"], encoded, payload["run_id"]))
        self.wake.set()

    def flush_one(self):
        with self.connect() as db:
            row = db.execute("SELECT sequence,payload,run_id FROM events WHERE rejected_status IS NULL ORDER BY sequence LIMIT 1").fetchone()
        if row is None:
            return "empty"
        configuration = self.configuration
        if configuration is None:
            return "retry"
        import httpx

        endpoint, key = configuration
        try:
            with httpx.Client(timeout=10, follow_redirects=False, trust_env=False) as client:
                response = client.post(endpoint, headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"}, content=row[1].encode("utf-8"))
            if response.status_code in {400, 409, 410}:
                # Keep rejected payloads for operator inspection, and never deliver
                # their later complete-snapshot marker after a missing batch.
                with self.connect() as db:
                    db.execute("UPDATE events SET rejected_status=? WHERE run_id=?", (response.status_code, row[2]))
                logger.error("Mango history retained locally for native run %s after HTTP %d rejection.", row[2], response.status_code)
                return "rejected"
            if response.status_code != 200:
                return "retry"
        except httpx.HTTPError:
            return "retry"
        with self.connect() as db:
            db.execute("DELETE FROM events WHERE sequence=?", (row[0],))
        return "sent"

    def deliver(self):
        while True:
            self.wake.clear()
            try:
                result = self.flush_one()
            except Exception:
                # Never log payloads, network exceptions, headers or credentials.
                logger.error("Mango history delivery could not read its durable queue.")
                result = "retry"
            if result == "empty":
                self.wake.wait()
            elif result == "retry":
                self.wake.wait(5)


def outbox():
    from hermes_constants import get_hermes_home
    return profile_outbox(get_hermes_home())


def profile_outbox(home, *, start_worker=True):
    from mango_scope import bound_profile
    bound_profile(home)
    home = str(Path(home).resolve())
    with _lock:
        if home not in _outboxes:
            _outboxes[home] = HistoryOutbox(home, start_worker=start_worker)
        return _outboxes[home]


def _event(context, kind, identity, data=None, **fields):
    run_id, session_id = context
    payload = {"run_id": run_id, "session_id": session_id,
               "event_id": f"{run_id}:{identity}:{kind}", "type": kind,
               "created_at": timestamp(), "data": data or {}, **fields}
    outbox().enqueue(payload)


def _safe_event(context, kind, identity, data=None, **fields):
    try:
        _event(context, kind, identity, data, **fields)
    except Exception:
        logger.error("Mango could not persist a native history observation.")


def _visible_text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(part["text"] for part in content if isinstance(part, dict)
                       and part.get("type") in {"text", "input_text", "output_text"}
                       and isinstance(part.get("text"), str))
    return ""


def snapshot(context, identity):
    """Export the native display projection, retaining its literal integer IDs."""
    # Keep each snapshot and its complete-ID marker contiguous in the FIFO even
    # when native tools finish concurrently.
    with _lock:
        _snapshot_locked(context, identity)


def _snapshot_locked(context, identity):
    from agent.compaction_display import project_compaction_message_for_display
    from hermes_state import SessionDB
    from hermes_constants import get_hermes_home
    from mango_scope import bound_profile

    home = get_hermes_home()
    bound_profile(home)
    key = str(Path(home).resolve())
    if key not in _native_dbs:
        _native_dbs[key] = SessionDB(db_path=Path(home) / "state.db", read_only=True)
    db = _native_dbs[key]
    session = db.get_session(context[1])
    if session is None:
        raise ValueError("Native session is unavailable for transcript capture")
    messages = []
    for row in db.get_messages(context[1], include_compacted=True):
        projected = project_compaction_message_for_display(row)
        if projected is None or projected.get("display_kind") == "hidden" or projected.get("role") not in {"user", "assistant"}:
            continue
        content = _visible_text(projected.get("content"))
        if not content.strip():
            continue
        messages.append({"message_id": int(row["id"]), "role": projected["role"],
                         "content": content, "created_at": timestamp(row["timestamp"]),
                         "current_run": False})
    fields = {}
    if isinstance(session.get("title"), str) and session["title"].strip():
        fields["chat_name"] = session["title"]
    if session.get("started_at") is not None:
        fields["chat_created_at"] = timestamp(session["started_at"])
    batch, size, batch_id = [], 0, 0
    for message in messages:
        message_size = len(json.dumps(message, ensure_ascii=False).encode("utf-8"))
        if message_size > _MAX_MESSAGE_BYTES:
            # Preserve the complete text locally for repair; never prune a partial import.
            raise ValueError("Native visible message exceeds the history callback limit")
        if batch and size + message_size > _MAX_BATCH_BYTES:
            _event(context, "messages.saved", f"{identity}:batch:{batch_id}", messages=batch, **fields)
            batch, size, batch_id = [], 0, batch_id + 1
        batch.append(message)
        size += message_size
    if batch:
        _event(context, "messages.saved", f"{identity}:batch:{batch_id}", messages=batch, **fields)
    # The complete-ID marker follows every message batch in the same durable FIFO.
    _event(context, "messages.saved", f"{identity}:snapshot", messages=[],
           messages_complete=True, message_ids=[message["message_id"] for message in messages], **fields)


def _safe_snapshot(context, identity):
    try:
        snapshot(context, identity)
        return True
    except Exception:
        logger.error("Mango could not capture the native visible transcript for run %s; saved-history completion was not confirmed.", context[0])
        return False


def on_run_start(*, session_id="", turn_id="", model="", **kwargs):
    context = native_context(session_id)
    if context:
        _safe_event(context, "run.started", turn_id or "turn", {"model": model if isinstance(model, str) else ""})


def _number(value):
    return value if type(value) in {int, float} and math.isfinite(value) and value >= 0 else 0


def on_model_start(*, session_id="", api_request_id="", api_call_count=0, model="", **kwargs):
    context = native_context(session_id)
    if context:
        _safe_event(context, "model.started", api_request_id, {"model": model if isinstance(model, str) else "", "call": _number(api_call_count)})
        with _lock:
            first = _run_key(context) not in _model_starts
            _model_starts.add(_run_key(context))
        if first:
            _safe_snapshot(context, "input")


def on_model_end(*, session_id="", api_request_id="", api_call_count=0, api_duration=0, **kwargs):
    context = native_context(session_id)
    if context:
        _safe_event(context, "model.completed", api_request_id, {"call": _number(api_call_count), "duration_seconds": _number(api_duration)})


def on_model_error(*, session_id="", api_request_id="", **kwargs):
    context = native_context(session_id)
    if context:
        _safe_event(context, "model.failed", api_request_id)


def on_reply(*, session_id="", turn_id="", assistant_response="", **kwargs):
    context = native_context(session_id)
    if context and isinstance(assistant_response, str):
        with _lock:
            _outputs[_run_key(context)] = assistant_response
        _safe_event(context, "message.completed", turn_id or "turn", {"output": assistant_response})


def on_run_end(*, session_id="", turn_id="", completed=False, failed=False, interrupted=False, **kwargs):
    context = native_context(session_id)
    if context:
        captured = _safe_snapshot(context, "finished")
        data = {"completed": bool(completed), "failed": bool(failed), "interrupted": bool(interrupted)}
        with _lock:
            output = _outputs.pop(_run_key(context), None)
            _model_starts.discard(_run_key(context))
        if output is not None:
            data["output"] = output
        # The browser treats this marker as proof the complete transcript was
        # queued. Preserve its local reply when capture failed; cleanup above
        # still runs, and the native session remains the recovery authority.
        if captured:
            _safe_event(context, "run.finished", turn_id or "turn", data)


def observe_tool(tool_name, args, next_call, session_id="", tool_call_id="", **kwargs):
    context = native_context(session_id)
    if not context or not isinstance(tool_call_id, str) or not tool_call_id:
        return next_call(args)
    data = {"tool_name": tool_name, "tool_call_id": tool_call_id}
    _safe_event(context, "tool.started", tool_call_id, data)
    succeeded = False
    try:
        result = next_call(args)
        decoded = result
        if isinstance(result, str):
            try:
                decoded = json.loads(result)
            except ValueError:
                pass
        succeeded = not (isinstance(decoded, dict) and (decoded.get("error") or decoded.get("is_error") or decoded.get("success") is False))
        return result
    finally:
        _safe_event(context, "tool.completed", tool_call_id, {**data, "succeeded": bool(succeeded)})


def _run_key(context):
    from hermes_constants import get_hermes_home
    return str(get_hermes_home()), context[0]


def register(ctx):
    ctx.register_middleware("tool_execution", observe_tool)
    for name, callback in (("pre_llm_call", on_run_start), ("pre_api_request", on_model_start),
                           ("post_api_request", on_model_end), ("api_request_error", on_model_error),
                           ("post_llm_call", on_reply), ("on_session_end", on_run_end)):
        ctx.register_hook(name, callback)
    from hermes_constants import get_hermes_home
    from mango_scope import profiles
    # Native gateway startup discovers root plugins before named profiles.
    # Restart idle queues once there; named registrations only install hooks.
    if Path(get_hermes_home()).resolve() != Path(os.environ["HERMES_HOME"]).resolve():
        return
    for name in profiles():
        home = Path(os.environ["HERMES_HOME"]) / "profiles" / name
        if callback_configuration(home) is not None:
            profile_outbox(home)
