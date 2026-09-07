"""Exercise the pinned, unmodified HTTP gateway with loopback provider/callback fixtures.

Run with a Python environment containing the pinned upstream dependencies:
  python hermes/tests/native_smoke.py --source /path/to/reviewed/hermes-agent
No AWS or real model access; child processes inherit no provider credentials.
"""
import argparse
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import sys
import tempfile
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from entrypoint import bind_home, lock_native_scope, runtime_config

REVISION = "693641aa8b4359c602283bdbbc14041e03bc47bc"
UUID_A = "11111111-1111-4111-8111-111111111111"
UUID_B = "22222222-2222-4222-8222-222222222222"
CALLBACKS = []
HISTORY = []
HISTORY_CHANGED = threading.Condition()
HISTORY_RETRIES_REMAINING = 2
PROVIDER_REQUESTS = []
PROVIDER_PATHS = []
STOP_STARTED = threading.Event()
STOP_RELEASE = threading.Event()


class FixtureServer(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        self.send_json({"object": "list", "data": []})

    def send_json(self, payload, status=200):
        encoded = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_POST(self):
        global HISTORY_RETRIES_REMAINING
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.path == "/internal/hermes/history":
            with HISTORY_CHANGED:
                if HISTORY_RETRIES_REMAINING:
                    HISTORY_RETRIES_REMAINING -= 1
                    return self.send_json({"error": "fixture_admission_not_bound_yet"}, status=503)
                HISTORY.append(payload)
                HISTORY_CHANGED.notify_all()
            return self.send_json({"saved": True})
        if self.path == "/internal/hermes/actions":
            CALLBACKS.append(payload)
            return self.send_json({"node_id": UUID_A, "created": True})
        PROVIDER_PATHS.append(self.path)
        if self.path != "/v1/responses":
            self.send_error(404)
            return
        PROVIDER_REQUESTS.append(payload)
        content = payload.get("input", [])
        process_match = re.search(r"MANGO_PROCESS_ID=([0-9a-f-]{36})", json.dumps(content))
        step_match = re.search(r"MANGO_STEP_ID=([0-9a-f-]{36})", json.dumps(content))
        if "fixture stop" in json.dumps(content):
            STOP_STARTED.set()
            STOP_RELEASE.wait(timeout=20)
        action = "fixture action" in json.dumps(content) and not any(
            item.get("type") == "function_call_output" for item in content if isinstance(item, dict))
        if action:
            output = [{"type": "function_call", "id": "fc_mango", "call_id": "call_mango_fixture",
                "name": "mango_create_node", "status": "completed", "arguments": json.dumps({
                    "logic_gate_id": process_match[1] if process_match else UUID_A,
                    "process_step_id": step_match[1] if step_match else UUID_B, "title": "Fixture Node"})},
                {"type": "function_call", "id": "fc_memory", "call_id": "call_memory_fixture",
                "name": "memory", "status": "completed", "arguments": json.dumps({"operations": [{
                    "action": "add", "target": "memory", "content": "Tenant A prefers green process diagrams."}]})},
                {"type": "function_call", "id": "fc_skill", "call_id": "call_skill_fixture",
                "name": "skill_manage", "status": "completed", "arguments": json.dumps({"operations": [{
                    "action": "create", "name": "fixture-learning", "content":
                    "---\nname: fixture-learning\ndescription: Use when checking fixture workflows.\n---\n"
                    "Keep these process notes in the current tenant home.\n"}]})}]
        elif process_match and not any(item.get("call_id") == "call_mango_retry" for item in content if isinstance(item, dict)):
            # Native Hermes removes duplicate calls in a single model turn. A
            # later turn reaches Go again and proves its durable receipt check.
            output = [{"type": "function_call", "id": "fc_mango_retry", "call_id": "call_mango_retry",
                "name": "mango_create_node", "status": "completed", "arguments": json.dumps({
                    "logic_gate_id": process_match[1], "process_step_id": step_match[1], "title": "Fixture Node"})}]
        else:
            output = [{"type": "message", "id": "msg_fixture", "role": "assistant", "status": "completed",
                "content": [{"type": "output_text", "text": "Fixture reply complete.", "annotations": []}]}]
        response = {"id": "resp_" + secrets.token_hex(8), "object": "response", "created_at": int(time.time()),
            "model": payload.get("model"), "status": "completed", "output": output,
            "usage": {"input_tokens": 100, "output_tokens": 20, "total_tokens": 120}}
        if not payload.get("stream"):
            return self.send_json(response)
        events = [{"type": "response.created", "response": {**response, "status": "in_progress", "output": []}}]
        for index, item in enumerate(output):
            events.append({"type": "response.output_item.added", "output_index": index, "item": item})
            if item["type"] == "message":
                events.append({"type": "response.output_text.delta", "item_id": item["id"],
                    "output_index": index, "content_index": 0, "delta": item["content"][0]["text"]})
            events.append({"type": "response.output_item.done", "output_index": index, "item": item})
        events.append({"type": "response.completed", "response": response})
        encoded = "".join("event: " + event["type"] + "\ndata: " + json.dumps(event) + "\n\n" for event in events).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_history(run_id, event_type):
    with HISTORY_CHANGED:
        ready = HISTORY_CHANGED.wait_for(lambda: any(
            event.get("run_id") == run_id and event.get("type") == event_type for event in HISTORY), timeout=20)
        assert ready, f"No durable {event_type} callback arrived for {run_id}"
        return [event for event in HISTORY if event.get("run_id") == run_id]


def request(port, key, path, body=None, idempotency=None, host="127.0.0.1"):
    headers = {"Authorization": "Bearer " + key}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if idempotency:
        headers["Idempotency-Key"] = idempotency
    with build_opener(ProxyHandler({})).open(Request(f"http://{host}:{port}" + path,
            data=None if body is None else json.dumps(body).encode(), headers=headers), timeout=50) as response:
        raw = response.read().decode()
        if path.endswith("/events"):
            return [json.loads(line[6:]) for line in raw.splitlines() if line.startswith("data: ")]
        return json.loads(raw)


@contextmanager
def native_gateway(source, home, fixture_port, key, root, *, host="127.0.0.1", callback_url=None, callback_key=None, port=None):
    port = port or free_port()
    env = {name: os.environ[name] for name in ("PATH", "SystemRoot", "WINDIR", "TEMP", "TMP") if name in os.environ}
    env.update({"PYTHONPATH": os.pathsep.join([str(root / "guard"), str(source)]),
        "HERMES_HOME": str(home), "HOME": str(home), "USERPROFILE": str(home), "LOCALAPPDATA": str(home),
        "HERMES_TEST_ISOLATION": "1", "PYTHONDONTWRITEBYTECODE": "1", "PYTHONUNBUFFERED": "1",
        "API_SERVER_ENABLED": "true", "API_SERVER_HOST": host, "API_SERVER_PORT": str(port),
        "API_SERVER_KEY": key, "OPENAI_API_KEY": secrets.token_hex(24),
        "OPENAI_BASE_URL": f"http://127.0.0.1:{fixture_port}/v1",
        "MANGO_CALLBACK_URL": callback_url or f"http://127.0.0.1:{fixture_port}/internal/hermes/actions",
        "MANGO_CALLBACK_KEY": callback_key or secrets.token_hex(24), "NO_PROXY": "*"})
    lock_native_scope(home, env)
    log_path = root / (home.name + "-gateway.log")
    with log_path.open("w", encoding="utf-8") as log:
        process = subprocess.Popen([sys.executable, "-m", "hermes_cli.main", "gateway"], cwd=source, env=env,
            stdout=log, stderr=subprocess.STDOUT, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        try:
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError("Native gateway exited:\n" + log_path.read_text(encoding="utf-8")[-9000:])
                try:
                    request(port, key, "/health", host=host)
                    break
                except (URLError, ConnectionError, TimeoutError):
                    time.sleep(0.2)
            else:
                raise RuntimeError("Native gateway not ready:\n" + log_path.read_text(encoding="utf-8")[-9000:])
            yield port
        finally:
            process.terminate()
            try:
                process.wait(timeout=12)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


def prepare_home(home, company, user):
    bind_home(home, company, user)
    (home / "config.yaml").write_text(json.dumps(runtime_config("gpt-5.4-mini-2026-03-17")), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--go-integration", action="store_true", help="Prove the real Go Node command through a WSL fixture test.")
    args = parser.parse_args()
    source = args.source.resolve()
    revision = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    assert revision == REVISION, "Use the reviewed pinned upstream source."
    fixture = ThreadingHTTPServer(("127.0.0.1", 0), FixtureServer)
    threading.Thread(target=fixture.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix="mango-hermes-smoke-") as directory:
        root = Path(directory)
        guard = root / "guard"
        guard.mkdir()
        if args.go_integration and os.name == "nt":
            raise RuntimeError("Run inside WSL Ubuntu with the pinned Python environment.")
        allowed_hosts = ("127.0.0.1", "localhost", "::1", None)
        (guard / "sitecustomize.py").write_text(
            "import socket\n_original=socket.getaddrinfo\ndef _local(host,*args,**kwargs):\n"
            f" if host not in {allowed_hosts!r}: raise OSError('Non-fixture network disabled in Hermes smoke test')\n"
            " return _original(host,*args,**kwargs)\nsocket.getaddrinfo=_local\n", encoding="utf-8")
        for name, company, user in (("tenant-a", UUID_A, UUID_B), ("tenant-b", UUID_B, UUID_A)):
            prepare_home(root / name, company, user)
        key = secrets.token_hex(24)
        if args.go_integration:
            callback_port, callback_key, port = free_port(), secrets.token_hex(24), free_port()
            scope_file = root / "go-scope.json"
            assignments = [f"HERMES_NATIVE_URL=http://127.0.0.1:{port}", f"HERMES_NATIVE_KEY={key}",
                f"MANGO_NATIVE_CALLBACK_PORT={callback_port}", f"MANGO_NATIVE_CALLBACK_KEY={callback_key}",
                f"MANGO_NATIVE_SCOPE_FILE={scope_file}"]
            backend = Path(__file__).resolve().parents[2] / "backend"
            go_args = ["/usr/local/go/bin/go", "test", "./internal/http", "-run",
                       "^TestAINativeRuntimeIntegration$", "-count=1", "-timeout=180s", "-v"]
            command = ["env"] + assignments + go_args
            process = subprocess.Popen(command, cwd=backend, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            try:
                deadline = time.monotonic() + 75
                while not scope_file.exists():
                    if process.poll() is not None or time.monotonic() >= deadline:
                        process.terminate()
                        output, _ = process.communicate(timeout=15)
                        raise RuntimeError("Go fixture did not provide its scope:\n" + output)
                    time.sleep(0.2)
                scope = json.loads(scope_file.read_text(encoding="utf-8"))
                prepare_home(root / "go-tenant", scope["company_id"], scope["user_id"])
                with native_gateway(source, root / "go-tenant", fixture.server_port, key, root,
                        callback_url=f"http://127.0.0.1:{callback_port}/internal/hermes/actions",
                        callback_key=callback_key, port=port):
                    output, _ = process.communicate(timeout=180)
                    assert process.returncode == 0, output + "\nProvider paths: " + str(PROVIDER_PATHS) + "\nProvider request shapes: " + str([
                        {"keys": list(payload), "stream": payload.get("stream"),
                         "input_types": [item.get("type") for item in payload.get("input", []) if isinstance(item, dict)]}
                        for payload in PROVIDER_REQUESTS])
                    assert "--- PASS: TestAINativeRuntimeIntegration" in output, output
                    print(output)
            finally:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=15)
            fixture.shutdown()
            fixture.server_close()
            print("Native Hermes -> authenticated Go -> existing Node command smoke passed.")
            return
        body = {"input": "fixture action", "session_id": "mango-smoke-session", "provider": "openai-api"}
        with native_gateway(source, root / "tenant-a", fixture.server_port, key, root) as port:
            capabilities = request(port, key, "/v1/capabilities")
            assert capabilities["features"]["runs_idempotency"]["durable"] is True
            tools = request(port, key, "/v1/toolsets")
            assert "mango_create_node" in json.dumps(tools), tools
            started = request(port, key, "/v1/runs", body, "mango-smoke-request")
            run_id = started["run_id"]
            events = request(port, key, f"/v1/runs/{run_id}/events")
            status = request(port, key, f"/v1/runs/{run_id}")
            assert status["status"] == "completed", status
            assert any(event["event"] == "message.delta" for event in events), events
            assert any(event["event"] == "run.completed" for event in events), events
            assert len(CALLBACKS) == 1, {"callbacks": CALLBACKS, "events": events,
                "messages": request(port, key, "/api/sessions/mango-smoke-session/messages")}
            assert CALLBACKS[0]["run_id"] == run_id
            assert CALLBACKS[0]["session_id"] == body["session_id"]
            assert CALLBACKS[0]["tool_call_id"] == "call_mango_fixture"
            assert "company_id" not in CALLBACKS[0]["arguments"]
            history = wait_history(run_id, "run.finished")
            assert {event["data"].get("tool_name") for event in history if event["type"] == "tool.completed"} >= {"mango_create_node", "memory", "skill_manage"}, history
            assert history[-1]["data"].get("output") == "Fixture reply complete.", history
            snapshots = [event for event in history if event.get("messages_complete")]
            assert snapshots and snapshots[-1]["message_ids"], history
            assert snapshots[-1]["chat_created_at"], snapshots[-1]
            native_messages = [message for event in history for message in event.get("messages", [])]
            assert all(isinstance(message["message_id"], int) for message in native_messages)
            assert any(message["role"] == "assistant" and message["content"] == "Fixture reply complete." for message in native_messages), native_messages
            assert request(port, key, "/v1/runs", body, "mango-smoke-request")["run_id"] == run_id
            messages = request(port, key, "/api/sessions/mango-smoke-session/messages")
            assert any(message["role"] == "assistant" for message in messages["data"]), messages
            memory = root / "tenant-a" / "memories" / "MEMORY.md"
            assert "Tenant A prefers green" in memory.read_text(encoding="utf-8")
            skill = root / "tenant-a" / "skills" / "fixture-learning" / "SKILL.md"
            assert "current tenant home" in skill.read_text(encoding="utf-8")
            detached = request(port, key, "/v1/runs", {"input": "fixture history without browser",
                "session_id": "mango-detached-session", "provider": "openai-api"}, "mango-detached-request")
            detached_history = wait_history(detached["run_id"], "run.finished")
            assert detached_history[-1]["data"].get("output") == "Fixture reply complete."
            assert any(event.get("messages_complete") and event["message_ids"] for event in detached_history)
            stopped = request(port, key, "/v1/runs", {"input": "fixture stop",
                "session_id": "mango-stop-session", "provider": "openai-api"}, "mango-stop-request")
            assert STOP_STARTED.wait(timeout=15), "Fake provider never saw the stop-test run."
            try:
                stop = request(port, key, f"/v1/runs/{stopped['run_id']}/stop", {})
                assert stop["status"] in {"stopping", "cancelled"}, stop
            finally:
                STOP_RELEASE.set()
            stopped_events = request(port, key, f"/v1/runs/{stopped['run_id']}/events")
            assert any(event["event"] == "run.cancelled" for event in stopped_events), stopped_events
        with native_gateway(source, root / "tenant-a", fixture.server_port, key, root) as port:
            assert request(port, key, "/v1/runs", body, "mango-smoke-request")["run_id"] == run_id
            assert request(port, key, "/api/sessions/mango-smoke-session/messages")["data"]
            assert len(CALLBACKS) == 1
        second_key = secrets.token_hex(24)
        with native_gateway(source, root / "tenant-b", fixture.server_port, second_key, root) as port:
            assert request(port, second_key, "/api/sessions")["data"] == []
            assert not (root / "tenant-b" / "memories" / "MEMORY.md").exists()
            assert not (root / "tenant-b" / "skills" / "fixture-learning").exists()
            try:
                request(port, second_key, "/api/sessions/mango-smoke-session/messages")
            except HTTPError as error:
                assert error.code == 404
            else:
                raise AssertionError("Second tenant read first tenant's transcript.")
            before = len(PROVIDER_REQUESTS)
            second = request(port, second_key, "/v1/runs", {"input": "fixture second tenant",
                "session_id": "mango-other-session", "provider": "openai-api"}, "mango-other-request")
            request(port, second_key, f"/v1/runs/{second['run_id']}/events")
            assert "Tenant A prefers green" not in json.dumps(PROVIDER_REQUESTS[before:])
        expected = {"memory", "skills_list", "skill_view", "skill_manage", "session_search",
                    "mango_list_processes", "mango_get_process", "mango_create_node"}
        actual = {tool.get("name") for payload in PROVIDER_REQUESTS for tool in payload.get("tools", [])}
        assert actual <= expected, actual
    fixture.shutdown()
    fixture.server_close()
    print("Pinned native HTTP smoke passed: streamed reply, trusted action callback, durable history without a browser, native message IDs, memory/skills, transcript, cancellation, restart replay, separate homes.")


if __name__ == "__main__":
    main()
