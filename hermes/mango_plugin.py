"""Supported Hermes plugin; every Mango action is authorized again by Go."""

from contextvars import ContextVar
from dataclasses import dataclass
from functools import partial
import json
import os
import re
from urllib.parse import urlsplit


@dataclass(frozen=True)
class ToolContext:
    run_id: str
    session_id: str
    tool_call_id: str
    callback_key: str


_context = ContextVar("mango_tool_context", default=None)
_UUID = {"type": "string", "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"}
_NAME = {"type": "string", "minLength": 1, "maxLength": 500, "pattern": "\\S"}
_DOCUMENT = {"type": "object", "description":
    'Full Mango editor envelope. Plain text example: {"format":"mango-tiptap-json","schema_version":1,'
    '"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Your text"}]}]}}. '
    'For existing documents, preserve all unchanged nodes, marks and attributes from mango_get_editor.'}
_EDITOR = {
    "resource_type": {"type": "string", "enum": ["node", "logic_gate", "process_step", "project"]},
    "resource_id": _UUID,
    "document_id": {"type": "string", "minLength": 1,
                    "description": "Exact editor document ID returned by Mango. Process overview: logic-gate-overview; Step: its UUID; Node: existing textbox ID."},
}


def _schema(description, properties, required=None, **constraints):
    return {"description": description,
            "parameters": {"type": "object", "properties": properties,
                           "required": list(properties) if required is None else required,
                           "additionalProperties": False, **constraints}}


_ACTIONS = {
    "mango_list_processes": _schema("List Mango Processes the current user can view in the selected company.", {}),
    "mango_get_process": _schema("Read a Process, its Steps and permitted Nodes. Use the exact IDs returned here.", {"logic_gate_id": _UUID}),
    "mango_list_nodes": _schema("List Mango Nodes the current user can view.", {}),
    "mango_get_node": _schema("Read a Node and its editor document IDs.", {"node_id": _UUID}),
    "mango_create_node": _schema("Create a Node in an existing Process Step. Identical creation in one run reuses the saved Node. Report success only from a successful result.",
        {"logic_gate_id": _UUID, "process_step_id": _UUID, "title": _NAME}),
    "mango_update_node": _schema("Update the requested Node fields; omitted fields remain unchanged. Null clears due_date or priority.",
        {"node_id": _UUID, "name": _NAME, "status": {"type": "string"},
         "due_date": {"type": ["string", "null"], "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"},
         "priority": {"type": ["integer", "null"], "minimum": 1, "maximum": 5}}, ["node_id"], minProperties=2),
    "mango_move_node": _schema("Move a Node through the canonical Process/Step command, preserving status. Null Step means unassigned in the destination Process.",
        {"node_id": _UUID, "logic_gate_id": _UUID,
         "process_step_id": {**_UUID, "type": ["string", "null"]},
         "position": {"type": "integer", "minimum": 0}}, ["node_id", "logic_gate_id", "process_step_id"]),
    "mango_get_editor": _schema("Read an existing editor document, its annotations and revision before editing.", _EDITOR),
    "mango_create_editor": _schema("Create an editor textbox for an existing Node or Project. Mango allocates its exact document ID; use the returned document_ref to read or edit it. Identical creation in one run reuses the saved textbox.",
        {"resource_type": {"type": "string", "enum": ["node", "project"]}, "resource_id": _UUID,
         "document": _DOCUMENT, "annotations": {"type": "array", "items": {"type": "object"}, "description": "Use [] for a new document without annotations."}}),
    "mango_update_editor": _schema("Save the full mango-tiptap-json document envelope using the revision from mango_get_editor. Preserve content and annotations the user did not ask to change. Existing editor conflict rules apply; read again after saving.",
        {**_EDITOR, "base_revision": {"type": "integer", "minimum": 0},
         "document": _DOCUMENT, "annotations": {"type": "array", "items": {"type": "object"}}},
        [*_EDITOR, "base_revision", "document", "annotations"]),
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
            or not re.fullmatch(r"run_[0-9a-f]{32}", run_id or "")
            or not session_id or native_session != session_id
            or not isinstance(tool_call_id, str) or not tool_call_id
            or len(tool_call_id) > 256):
        return _error("Mango actions require an active authenticated Mango run.")
    from hermes_constants import get_hermes_home
    from mango_scope import callback_key
    try:
        key = callback_key(get_hermes_home())
    except (KeyError, ValueError, OSError):
        return _error("Mango actions require an authorized company/user profile.")
    token = _context.set(ToolContext(run_id, session_id, tool_call_id, key))
    try:
        return next_call(args)
    finally:
        _context.reset(token)


def _validate_arguments(action, args):
    from jsonschema import Draft202012Validator
    return Draft202012Validator(_ACTIONS[action]["parameters"]).is_valid(args)


def _call(action, args, session_id="", **kwargs):
    context = _context.get()
    if context is None or not session_id or session_id != context.session_id:
        return _error("Mango action context is unavailable; no action was submitted.")
    if not _validate_arguments(action, args):
        return _error("Invalid Mango tool arguments.")
    endpoint = os.environ.get("MANGO_CALLBACK_URL", "")
    key = context.callback_key
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


def register(ctx):
    import mango_history
    import mango_integrations
    from mango_scope import register_secret_source
    register_secret_source()
    mango_history.register(ctx)
    mango_integrations.register(ctx)
    ctx.register_middleware("tool_execution", bind_tool_context)
    for name, schema in _ACTIONS.items():
        ctx.register_tool(name=name, toolset="mango", handler=partial(_call, name), schema=schema)
