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
from entrypoint import configure_gateway
from mango_scope import profile_name, derive_key
from concurrent.futures import ThreadPoolExecutor

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
                HISTORY.append({**payload, "credential": self.headers.get("Authorization")})
                HISTORY_CHANGED.notify_all()
            return self.send_json({"saved": True})
        if self.path == "/internal/hermes/actions":
            CALLBACKS.append({**payload, "credential": self.headers.get("Authorization")})
            if payload["action"] == "mango_list_processes":
                return self.send_json({"processes": [{"logic_gate_id": UUID_A, "name": "Fixture Process"}]})
            return self.send_json({"node_id": UUID_A, "created": True})
        PROVIDER_PATHS.append(self.path)
        if self.path != "/v1/responses":
            self.send_error(404)
            return
        PROVIDER_REQUESTS.append(payload)
        content = payload.get("input", [])
        process_match = re.search(r"MANGO_PROCESS_ID=([0-9a-f-]{36})", json.dumps(content))
        step_match = re.search(r"MANGO_STEP_ID=([0-9a-f-]{36})", json.dumps(content))
        if process_match:
            for item in content:
                if isinstance(item, dict) and item.get("type") == "function_call_output" and item.get("call_id") == "call_process_list":
                    assert process_match[1] in str(item.get("output")), "The real Mango process listing did not return its permitted Process."
        if "fixture stop" in json.dumps(content):
            STOP_STARTED.set()
            STOP_RELEASE.wait(timeout=20)
        action = "fixture action" in json.dumps(content) and not any(
            item.get("type") == "function_call_output" for item in content if isinstance(item, dict))
        if action:
            output = [{"type": "function_call", "id": "fc_list", "call_id": "call_process_list",
                "name": "mango_list_processes", "status": "completed", "arguments": "{}"},
                {"type": "function_call", "id": "fc_mango", "call_id": "call_mango_fixture",
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
def native_gateway(source, home, fixture_port, key, root, *, pairs, callback_url=None, callback_key=None, port=None):
    port = port or free_port()
    env = {name: os.environ[name] for name in ("PATH", "SystemRoot", "WINDIR", "TEMP", "TMP") if name in os.environ}
    env.update({"PYTHONPATH": os.pathsep.join([str(root / "guard"), str(Path(__file__).resolve().parents[1]), str(source)]),
        "HERMES_HOME": str(home), "HOME": str(home), "USERPROFILE": str(home), "LOCALAPPDATA": str(home),
        "HERMES_TEST_ISOLATION": "1", "PYTHONDONTWRITEBYTECODE": "1", "PYTHONUNBUFFERED": "1",
        "API_SERVER_ENABLED": "true", "API_SERVER_HOST": "127.0.0.1", "API_SERVER_PORT": str(port),
        "API_SERVER_KEY": key, "OPENAI_API_KEY": secrets.token_hex(24),
        "OPENAI_BASE_URL": f"http://127.0.0.1:{fixture_port}/v1",
        "MANGO_CALLBACK_URL": callback_url or f"http://127.0.0.1:{fixture_port}/internal/hermes/actions",
        "MANGO_CALLBACK_KEY": callback_key or secrets.token_hex(24), "NO_PROXY": "*",
        "MANGO_HERMES_PROFILES": json.dumps(pairs),
        "MANGO_HERMES_PROFILE_VOLUMES": json.dumps({profile_name(**pair): None for pair in pairs})})
    configure_gateway(home, env)
    log_path = root / "gateway.log"
    with log_path.open("w", encoding="utf-8") as log:
        process = subprocess.Popen([sys.executable, "-m", "hermes_cli.main", "gateway"], cwd=source, env=env,
            stdout=log, stderr=subprocess.STDOUT, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        try:
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError("Native gateway exited:\n" + log_path.read_text(encoding="utf-8")[-10000:])
                try:
                    request(port, key, "/health")
                    break
                except (URLError, ConnectionError, TimeoutError):
                    time.sleep(0.2)
            else:
                raise RuntimeError("Native gateway not ready:\n" + log_path.read_text(encoding="utf-8")[-10000:])
            try:
                yield port
            except Exception:
                print(log_path.read_text(encoding="utf-8")[-10000:])
                raise
        finally:
            process.terminate()
            try:
                process.wait(timeout=12)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--go-integration", action="store_true")
    parser.add_argument("--go-test-binary", type=Path, help="Optional isolated Linux Go HTTP test binary, built with go test -c.")
    args = parser.parse_args()
    source = args.source.resolve()
    revision = subprocess.check_output(["git", "-c", "safe.directory=" + str(source), "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    assert revision == REVISION, "Use the reviewed pinned upstream source."
    fixture = ThreadingHTTPServer(("127.0.0.1", 0), FixtureServer)
    threading.Thread(target=fixture.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix="mango-hermes-smoke-") as directory:
        root = Path(directory)
        guard = root / "guard"
        guard.mkdir()
        allowed_hosts = ("127.0.0.1", "localhost", "::1", None)
        (guard / "sitecustomize.py").write_text(
            "import socket\n_original=socket.getaddrinfo\ndef _local(host,*args,**kwargs):\n"
            f" if host not in {allowed_hosts!r}: raise OSError('Non-fixture network disabled in Hermes smoke test')\n"
            " return _original(host,*args,**kwargs)\nsocket.getaddrinfo=_local\n", encoding="utf-8")
        key, callback_key = secrets.token_hex(24), secrets.token_hex(24)
        home = root / "gateway"
        if args.go_integration:
            if os.name == "nt":
                raise RuntimeError("Run the Go fixture inside WSL or the isolated test container.")
            callback_port, port = free_port(), free_port()
            scope_file = root / "go-scope.json"
            env = dict(os.environ, HERMES_NATIVE_URL=f"http://127.0.0.1:{port}", HERMES_NATIVE_KEY=key,
                MANGO_NATIVE_CALLBACK_PORT=str(callback_port), MANGO_NATIVE_CALLBACK_KEY=callback_key,
                MANGO_NATIVE_SCOPE_FILE=str(scope_file))
            command = ([str(args.go_test_binary), "-test.run=^TestAINativeRuntimeIntegration$", "-test.timeout=180s", "-test.v"]
                if args.go_test_binary else ["/usr/local/go/bin/go", "test", "./internal/http", "-run", "^TestAINativeRuntimeIntegration$", "-count=1", "-timeout=180s", "-v"])
            backend = Path(__file__).resolve().parents[2] / "backend"
            process = subprocess.Popen(command, cwd=backend if backend.exists() else root, env=env,
                text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            try:
                deadline = time.monotonic() + 75
                while not scope_file.exists():
                    if process.poll() is not None or time.monotonic() >= deadline:
                        process.terminate()
                        output, _ = process.communicate(timeout=15)
                        raise RuntimeError("Go fixture did not provide scope:\n" + output)
                    time.sleep(0.2)
                pair = json.loads(scope_file.read_text())
                with native_gateway(source, home, fixture.server_port, key, root, pairs=[pair],
                        callback_url=f"http://127.0.0.1:{callback_port}/internal/hermes/actions", callback_key=callback_key, port=port):
                    output, _ = process.communicate(timeout=180)
                    assert process.returncode == 0, output
                    assert "--- PASS: TestAINativeRuntimeIntegration" in output, output
                    print(output)
            finally:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=15)
            fixture.shutdown()
            fixture.server_close()
            print("Native shared Hermes -> authenticated Go -> canonical Node command passed.")
            return
        pairs = [{"company_id": UUID_A, "user_id": UUID_B}, {"company_id": UUID_B, "user_id": UUID_B}]
        names = [profile_name(**pair) for pair in pairs]
        api_keys = [derive_key(key, "api", name) for name in names]
        callback_keys = [derive_key(callback_key, "callback", name) for name in names]
        body = {"input": "fixture action", "session_id": "mango-shared-session", "provider": "openai-api"}
        def scoped(port, index, path, payload=None, identity=None):
            return request(port, api_keys[index], "/p/" + names[index] + path, payload, identity)
        with native_gateway(source, home, fixture.server_port, key, root, pairs=pairs, callback_key=callback_key) as port:
            for index in range(2):
                capabilities = scoped(port, index, "/v1/capabilities")
                assert capabilities["features"]["runs_idempotency"]["durable"] is True
                try:
                    request(port, api_keys[1-index], "/p/" + names[index] + "/v1/capabilities")
                except HTTPError as error:
                    assert error.code == 401
                else:
                    raise AssertionError("A sibling key authorized another profile.")
            # Same session and idempotency keys, one gateway and overlapping runs.
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(scoped, port, i, "/v1/runs",
                    body if i == 0 else {**body, "input": "fixture second tenant"}, "same-admission") for i in range(2)]
                runs = [future.result()["run_id"] for future in futures]
            assert runs[0] != runs[1]
            for index, run_id in enumerate(runs):
                events = scoped(port, index, f"/v1/runs/{run_id}/events")
                assert any(event["event"] == "run.completed" for event in events), events
                saved = wait_history(run_id, "run.finished")
                assert {item["credential"] for item in saved} == {"Bearer " + callback_keys[index]}
                assert any(item.get("messages_complete") and item["message_ids"] for item in saved), saved
                assert saved[-1]["data"].get("output") == "Fixture reply complete.", saved
                try:
                    scoped(port, 1-index, f"/v1/runs/{run_id}")
                except HTTPError as error:
                    assert error.code == 404
                else:
                    raise AssertionError("Cross-profile run access succeeded.")
            assert len(CALLBACKS) == 2, CALLBACKS
            assert CALLBACKS[0]["credential"] == "Bearer " + callback_keys[0]
            assert CALLBACKS[0]["run_id"] == runs[0]
            first_home, second_home = [home / "profiles" / name for name in names]
            assert "Tenant A prefers green" in (first_home / "memories" / "MEMORY.md").read_text()
            assert "current tenant home" in (first_home / "skills" / "fixture-learning" / "SKILL.md").read_text()
            assert not (second_home / "memories" / "MEMORY.md").exists()
            assert not (second_home / "skills" / "fixture-learning").exists()
            detached = scoped(port, 1, "/v1/runs", {"input": "fixture without browser", "session_id": "detached"}, "detached")
            assert wait_history(detached["run_id"], "run.finished")[-1]["data"]["output"] == "Fixture reply complete."
            stopped = scoped(port, 0, "/v1/runs", {"input": "fixture stop", "session_id": "stopped"}, "stopped")
            assert STOP_STARTED.wait(timeout=15)
            try:
                scoped(port, 0, f"/v1/runs/{stopped['run_id']}/stop", {})
            finally:
                STOP_RELEASE.set()
            assert any(event["event"] == "run.cancelled" for event in scoped(port, 0, f"/v1/runs/{stopped['run_id']}/events"))
        with native_gateway(source, home, fixture.server_port, key, root, pairs=pairs, callback_key=callback_key) as port:
            assert scoped(port, 0, "/v1/runs", body, "same-admission")["run_id"] == runs[0]
            assert scoped(port, 0, "/api/sessions/mango-shared-session/messages")["data"]
            assert len(CALLBACKS) == 2
    fixture.shutdown()
    fixture.server_close()
    print("Native shared gateway passed: concurrent profile auth/runs, isolated tools/history/memory/skills, detached delivery, Stop and restart replay.")


if __name__ == "__main__":
    main()
