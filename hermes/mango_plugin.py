"""Supported Hermes plugin; every Mango action is authorized again by Go."""

from contextvars import ContextVar
from dataclasses import dataclass
import json
import os
import re
from urllib.parse import urlsplit
from uuid import UUID


@dataclass(frozen=True)
class ToolContext:
    run_id: str
    session_id: str
    tool_call_id: str


_context = ContextVar("mango_tool_context", default=None)
_ACTIONS = {
    "mango_list_processes": (),
    "mango_get_process": ("logic_gate_id",),
    "mango_create_node": ("logic_gate_id", "process_step_id", "title"),
}


def _error(message):
    return json.dumps({"error": message})


def bind_tool_context(tool_name, args, next_call, session_id="", tool_call_id="", **kwargs):
    """Capture runtime metadata outside model arguments for exactly one tool call.

    Hermes may skip a failing middleware. The handler therefore requires this
    context itself and cannot call Go when this binding failed or was skipped.
    """
    if tool_name not in _ACTIONS:
        return next_call(args)
    from gateway.session_context import get_session_env

    run_id = get_session_env("HERMES_SESSION_KEY")
    native_session = get_session_env("HERMES_SESSION_ID")
    if (get_session_env("HERMES_SESSION_PLATFORM") != "api_server"
            or not re.fullmatch(r"run_[0-9a-f]{32}", run_id)
            or not session_id or native_session != session_id
            or not isinstance(tool_call_id, str) or not tool_call_id
            or len(tool_call_id) > 256):
        return _error("Mango actions require an active authenticated Mango run.")
    token = _context.set(ToolContext(run_id, session_id, tool_call_id))
    try:
        return next_call(args)
    finally:
        _context.reset(token)


def _validate_arguments(action, args):
    if not isinstance(args, dict) or set(args) != set(_ACTIONS[action]):
        return False
    for field in _ACTIONS[action]:
        value = args[field]
        if not isinstance(value, str):
            return False
        if field == "title":
            if not value.strip() or len(value) > 500:
                return False
        else:
            try:
                if str(UUID(value)) != value.lower():
                    return False
            except ValueError:
                return False
    return True


def _call(action, args, session_id=""):
    context = _context.get()
    if context is None or not session_id or session_id != context.session_id:
        return _error("Mango action context is unavailable; no action was submitted.")
    if not _validate_arguments(action, args):
        return _error("Invalid Mango tool arguments.")
    endpoint = os.environ.get("MANGO_CALLBACK_URL", "")
    key = os.environ.get("MANGO_CALLBACK_KEY", "")
    url = urlsplit(endpoint)
    if (url.scheme not in {"https", "http"} or not url.hostname or url.username
            or url.password or url.query or url.fragment
            or url.path != "/internal/hermes/actions" or len(key) < 32):
        return _error("Mango actions are not configured on this service.")

    import httpx

    try:
        # No retries here: Go owns durable deduplication and returns saved results.
        # Ignore process proxy variables and never redirect a callback credential.
        with httpx.Client(timeout=30, follow_redirects=False, trust_env=False) as client:
            response = client.post(endpoint, headers={"Authorization": "Bearer " + key}, json={
                "run_id": context.run_id,
                "session_id": context.session_id,
                "tool_call_id": context.tool_call_id,
                "action": action,
                "arguments": args,
            })
        if response.status_code != 200:
            # Do not propagate headers, transport exceptions, or arbitrary HTML.
            return _error(f"Mango rejected the action (HTTP {response.status_code}). No success was confirmed.")
        if len(response.content) > 2_000_000:
            return _error("Mango returned too much data. Narrow the requested Process.")
        result = response.json()
        if not isinstance(result, (dict, list)):
            return _error("Mango returned an invalid action result.")
        return json.dumps(result, ensure_ascii=False)
    except (httpx.HTTPError, ValueError):
        return _error("Mango did not confirm the action. Check the saved result before trying again.")


def list_processes(args, session_id="", **kwargs):
    return _call("mango_list_processes", args, session_id)


def get_process(args, session_id="", **kwargs):
    return _call("mango_get_process", args, session_id)


def create_node(args, session_id="", **kwargs):
    return _call("mango_create_node", args, session_id)


def register(ctx):
    import mango_history
    mango_history.register(ctx)
    ctx.register_middleware("tool_execution", bind_tool_context)
    process_id = {"type": "string", "description": "Exact existing Mango Process (logic_gate_id) UUID."}
    ctx.register_tool(name="mango_list_processes", toolset="mango", handler=list_processes, schema={
        "description": "List Mango Processes the current user can view in the selected company.",
        "parameters": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
    })
    ctx.register_tool(name="mango_get_process", toolset="mango", handler=get_process, schema={
        "description": "Read an existing Mango Process, its Steps, and permitted Nodes. Use exact IDs returned here.",
        "parameters": {"type": "object", "properties": {"logic_gate_id": process_id},
                       "required": ["logic_gate_id"], "additionalProperties": False},
    })
    ctx.register_tool(name="mango_create_node", toolset="mango", handler=create_node, schema={
        "description": "Create a Node in an existing Process Step when the user requests it. Mango checks current permissions and saves the result. Report success only from a successful tool result. Identical creation in one run reuses its saved Node.",
        "parameters": {"type": "object", "properties": {
            "logic_gate_id": process_id,
            "process_step_id": {"type": "string", "description": "Exact existing Step UUID from that Process."},
            "title": {"type": "string", "minLength": 1, "maxLength": 500},
        }, "required": ["logic_gate_id", "process_step_id", "title"], "additionalProperties": False},
    })
