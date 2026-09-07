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
    "mango_search": _schema(
        "Find accessible Mango resources using the same search as Company Explorer and the universal picker. "
        "Start here when typed or transcribed speech refers to a name or partial name; matching is case-insensitive exact, prefix and substring. "
        "Use resource_types to narrow the kind (Process = logic_gate, Folder = folder, Node = node). "
        "Results contain resource_type, canonical resource_id, display_name and location_path. Keep IDs internally for subsequent tools; "
        "never invent IDs or ask the user to retrieve them or supply an exact full name. Use the request's location context to choose the match; "
        "if several matches remain genuinely ambiguous, ask using names and locations before changing anything. "
        "If the result limit is reached, narrow the name/type or increase limit before treating a result as unique. "
        "For Steps, find their Process then use mango_get_process.",
        {"query": {"type": "string", "minLength": 1, "maxLength": 500, "pattern": "\\S"},
         "resource_types": {"type": "array", "items": {"type": "string", "enum": [
             "folder", "logic_gate", "node", "project", "huddle_logic_gate", "huddle_node"]}},
         "limit": {"type": "integer", "minimum": 1, "maximum": 100}}, ["query"]),
    "mango_list_processes": _schema("List Mango Processes the current user can view in the selected company. Use mango_search for a name or partial name.", {}),
    "mango_get_process": _schema("Read a Process, its Steps and permitted Nodes. Resolve its name through mango_search, then use the exact IDs returned here for Step and Node operations.", {"logic_gate_id": _UUID}),
    "mango_create_process": _schema("Create and name a Process using Mango's normal creation command. To place it in a requested Folder, first find that Folder with mango_search and supply its resource_id as folder_id; omitting folder_id uses normal default placement. Use the returned logic_gate_id for later actions. Identical creation in one run reuses the saved Process. Report success only from a successful result.",
        {"name": _NAME, "folder_id": _UUID}, ["name"]),
    "mango_update_process": _schema("Rename an existing Process without changing its other fields. Resolve its name through mango_search first.",
        {"logic_gate_id": _UUID, "name": _NAME}),
    "mango_create_step": _schema("Create a Step in an existing Process using its normal Step command. Optional after_process_step_id identifies the preceding Step in this same Process and creates the normal incoming connection. Read mango_get_process to resolve existing Steps. Identical creation in one run reuses the saved Step.",
        {"logic_gate_id": _UUID, "name": {**_NAME, "maxLength": 200}, "after_process_step_id": _UUID}, ["logic_gate_id", "name"]),
    "mango_move_process": _schema("Place an existing Process in a Folder using Company Explorer's normal move command. Find the Process and Folder by name with mango_search and use their exact resource_ids. Null folder_id places the Process at the company root.",
        {"logic_gate_id": _UUID, "folder_id": {**_UUID, "type": ["string", "null"]}}),
    "mango_list_nodes": _schema("List Mango Nodes the current user can view. Use mango_search for a name or partial name.", {}),
    "mango_get_node": _schema("Read a Node and its editor document IDs. Resolve its name through mango_search first; use returned textbox IDs for editor and Node chat operations.", {"node_id": _UUID}),
    "mango_create_node": _schema("Create a Node in an existing Process Step. Identical creation in one run reuses the saved Node. Report success only from a successful result.",
        {"logic_gate_id": _UUID, "process_step_id": _UUID, "title": _NAME}),
    "mango_update_node": _schema("Update the requested Node fields; omitted fields remain unchanged. Null clears due_date or priority.",
        {"node_id": _UUID, "name": _NAME, "status": {"type": "string"},
         "due_date": {"type": ["string", "null"], "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"},
         "priority": {"type": ["integer", "null"], "minimum": 1, "maximum": 5}}, ["node_id"], minProperties=2),
    "mango_move_node": _schema("Move a Node through the canonical Process/Step command, preserving status. Resolve the destination Process with mango_search and Step with mango_get_process. Null Step means unassigned in the destination Process. When the user also requests a textbox for this Step visit, create it on the Node with mango_create_editor after the successful move. This performs the current workflow only; it does not install a recurring Step trigger.",
        {"node_id": _UUID, "logic_gate_id": _UUID,
         "process_step_id": {**_UUID, "type": ["string", "null"]},
         "position": {"type": "integer", "minimum": 0}}, ["node_id", "logic_gate_id", "process_step_id"]),
    "mango_get_editor": _schema("Read an existing editor document, its annotations and revision before editing.", _EDITOR),
    "mango_create_editor": _schema("Create an editor textbox for an existing Node or Project. A textbox requested during a Node's Step workflow belongs to that Node. Mango allocates its exact document ID; use the returned document_ref to read or edit it, and its document_id as textbox_id for Node chat. Identical creation in one run reuses the saved textbox. This does not install a recurring Step trigger.",
        {"resource_type": {"type": "string", "enum": ["node", "project"]}, "resource_id": _UUID,
         "document": _DOCUMENT, "annotations": {"type": "array", "items": {"type": "object"}, "description": "Use [] for a new document without annotations."}}),
    "mango_update_editor": _schema("Save the full mango-tiptap-json document envelope using the revision from mango_get_editor. Preserve content and annotations the user did not ask to change. Existing editor conflict rules apply; read again after saving.",
        {**_EDITOR, "base_revision": {"type": "integer", "minimum": 0},
         "document": _DOCUMENT, "annotations": {"type": "array", "items": {"type": "object"}}},
        [*_EDITOR, "base_revision", "document", "annotations"]),
    "mango_create_node_chat": _schema("Create a plain-text chat in an existing Node textbox on the current user's behalf. Use mango_get_node to resolve existing textbox IDs, or mango_create_editor if the requested Node has no textbox. Identical creation in one run reuses the saved chat. Report success only from a successful result.",
        {"node_id": _UUID, "textbox_id": _UUID,
         "body": {"type": "string", "minLength": 1, "maxLength": 32000, "pattern": "\\S", "description": "Plain text chat message; no editor JSON or HTML."}}),
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
