"""Real pinned Hermes MCP discovery/execution against two disposable HTTP accounts.

Run with the image's Python and --source /opt/hermes. No provider, OAuth token,
live database, real home, or external write is used by this test.
"""

import argparse
import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
import subprocess
import tempfile
import threading
from uuid import UUID


class Fixture(BaseHTTPRequestHandler):
    calls = []
    lock = threading.Lock()

    def log_message(self, *args):
        pass

    def do_GET(self):
        self.send_response(405)
        self.end_headers()

    def do_DELETE(self):
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        method = request["method"]
        if "id" not in request:
            self.send_response(202)
            self.end_headers()
            return
        if method == "initialize":
            result = {"protocolVersion": request["params"]["protocolVersion"],
                      "capabilities": {"tools": {}}, "serverInfo": {"name": "mango-fixture", "version": "1"}}
        elif method == "tools/list":
            result = {"tools": [{"name": "get_account", "description": "Read the fixture account.",
                                 "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
                                 "annotations": {"readOnlyHint": True}},
                                {"name": "delete_account", "description": "Excluded fixture tool.",
                                 "inputSchema": {"type": "object", "properties": {}}}]}
        elif method == "tools/call":
            account = self.headers.get("Authorization")
            if account not in {"Bearer fixture-a", "Bearer fixture-b"}:
                self.send_response(401)
                self.end_headers()
                return
            with self.lock:
                self.calls.append((account, request["params"]["name"]))
            result = {"content": [{"type": "text", "text": json.dumps({"account": account[-1]})}], "isError": False}
        else:
            result = {}
        body = json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": result}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--installed", action="store_true", help="Use the installed Mango module, matching the operator CLI.")
    args = parser.parse_args()
    sys.path[:0] = [str(args.source)] if args.installed else [str(Path(__file__).resolve().parents[1]), str(args.source)]
    import mango_integrations
    from agent.secret_scope import set_multiplex_active, set_secret_scope, reset_secret_scope
    from hermes_constants import set_hermes_home_override, reset_hermes_home_override
    from tools.mcp_tool_discovery import discover_mcp_tools, get_mcp_status
    from tools.mcp_tool_lifecycle import shutdown_mcp_servers
    from tools.mcp_tool_schema import mcp_prefixed_tool_name
    from tools.mcp_oauth import HermesTokenStorage, _sdk_class
    from tools.registry import registry

    @contextmanager
    def scope(home, account):
        home_token = set_hermes_home_override(home)
        secret_token = set_secret_scope({"FIXTURE_TOKEN": "fixture-" + account})
        try:
            yield
        finally:
            reset_secret_scope(secret_token)
            reset_hermes_home_override(home_token)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    with tempfile.TemporaryDirectory(prefix="mango-mcp-fixture-") as temporary:
        root = Path(temporary)
        os.environ["HERMES_HOME"] = str(root)
        os.environ["HERMES_SAFE_MODE"] = "false"
        homes = [root / "profiles" / ("a" * 64), root / "profiles" / ("b" * 64)]
        names = [mango_integrations.server_name("linear", home.name) for home in homes]
        for home, name in zip(homes, names):
            home.mkdir(parents=True)
            (home / "mango-scope.json").write_text(json.dumps({
                "company_id": str(UUID(home.name[:32])), "user_id": str(UUID(home.name[32:])),
            }))
            (home / "config.yaml").write_text(json.dumps({"secrets": {"sources": ["mango_runtime"], "mango_runtime": {"enabled": True}}}))
            environment = {**os.environ, "HERMES_HOME": str(home)}
            assert not any(environment.get(key) for key in ("API_SERVER_KEY", "MANGO_CALLBACK_KEY", "OPENAI_API_KEY"))
            if args.installed:
                result = subprocess.run([sys.executable, "-m", "mango_integrations", "configure", "linear"],
                                        env=environment, capture_output=True, text=True, check=True, timeout=30)
                assert json.loads(result.stdout)["server_name"] == name
                result = subprocess.run(["hermes", "mcp", "list"], env=environment,
                                        capture_output=True, text=True, check=True, timeout=30)
                assert name in result.stdout and "disabled" in result.stdout.lower(), result.stdout
                result = subprocess.run([sys.executable, "-m", "mango_integrations", "discover", "linear"],
                                        env=environment, capture_output=True, text=True, timeout=30)
                assert result.returncode != 0 and "Complete native OAuth login" in result.stderr, result
                subprocess.run([sys.executable, "-m", "mango_integrations", "configure", "docs", "--client-id", "fixture-client",
                                "--client-secret-env", "MANGO_INTEGRATION_GOOGLE_CLIENT_SECRET"],
                               env=environment, capture_output=True, text=True, check=True, timeout=30)
                # The native login probe follows this exact config/env resolver.
                # A separate human CLI receives only its one named client secret.
                result = subprocess.run([sys.executable, "-c", """
import os
from pathlib import Path
import yaml
from hermes_constants import get_default_hermes_root
from hermes_cli.mcp_config import _get_mcp_servers, _resolve_mcp_server_config
assert get_default_hermes_root().resolve() == Path(os.environ['HERMES_HOME']).parent.parent.resolve()
saved = yaml.safe_load((Path(os.environ['HERMES_HOME']) / 'config.yaml').read_text())
configured = next(value for key, value in saved['mcp_servers'].items() if key.startswith('docs-'))
assert configured['oauth']['client_secret'] == '${MANGO_INTEGRATION_GOOGLE_CLIENT_SECRET}'
server = next(value for key, value in _get_mcp_servers().items() if key.startswith('docs-'))
assert _resolve_mcp_server_config(server)['oauth']['client_secret'] == 'fixture-client-only'
"""], env={**environment, "MANGO_INTEGRATION_GOOGLE_CLIENT_SECRET": "fixture-client-only"},
                               capture_output=True, text=True, timeout=30)
                assert result.returncode == 0, result.stderr
            with scope(home, "a"):
                if not args.installed:
                    configured = mango_integrations.configure(home, "linear")
                    assert configured["server_name"] == name
                assert not mango_integrations._read_config(home)["mcp_servers"][name]["enabled"]
                storage = HermesTokenStorage(name)
                asyncio.run(storage.set_tokens(_sdk_class("OAuthToken")(access_token="fixture-only", token_type="Bearer", expires_in=3600)))
                assert HermesTokenStorage(name, hermes_home=home).has_cached_tokens()
                assert not HermesTokenStorage(name, hermes_home=homes[1] if home == homes[0] else homes[0]).has_cached_tokens()
                assert storage._tokens_path().is_relative_to(home)
                assert storage._tokens_path().stat().st_mode & 0o777 == 0o600
                assert asyncio.run(HermesTokenStorage(name, hermes_home=home).get_tokens()).access_token == "fixture-only"
            # Only this test fixture bypasses the product's supported HTTPS/OAuth
            # setup validation. Actual network IO, scoped header resolution,
            # schema filtering and dispatch all use the unmodified native client.
            (home / "config.yaml").write_text(json.dumps({"mcp_servers": {name: {
                "url": f"http://127.0.0.1:{server.server_port}/mcp", "enabled": True,
                "headers": {"Authorization": "Bearer ${FIXTURE_TOKEN}"},
                "tools": {"include": ["get_account"], "resources": False, "prompts": False},
            }}}), encoding="utf-8")
        set_multiplex_active(True)
        try:
            for home, name, account in zip(homes, names, "ab"):
                with scope(home, account):
                    discovered = discover_mcp_tools()
                    expected = mcp_prefixed_tool_name(name, "get_account")
                    assert expected in discovered, discovered
                    assert len(expected) <= 64
                    assert registry.get_entry(mcp_prefixed_tool_name(name, "delete_account")) is None
            def execute(index):
                with scope(homes[index], "ab"[index]):
                    other = mcp_prefixed_tool_name(names[1-index], "get_account")
                    assert registry.get_entry(other) is None, "other profile's tool leaked"
                    assert "Unknown tool" in registry.dispatch(other, {})
                    states = get_mcp_status()
                    assert len(states) == 1 and states[0]["connected"], states
                    result = registry.dispatch(mcp_prefixed_tool_name(names[index], "get_account"), {})
                    assert json.loads(json.loads(result)["result"]) == {"account": "ab"[index]}, result
                    return "ab"[index]
            with ThreadPoolExecutor(max_workers=2) as pool:
                assert list(pool.map(execute, [0, 1])) == ["a", "b"]
            assert sorted(Fixture.calls) == [("Bearer fixture-a", "get_account"), ("Bearer fixture-b", "get_account")]
            print("PASS: native profile setup/config persistence, private profile OAuth persistence, real HTTP MCP discovery, execution, scoped credentials, concurrent profiles, rejected cross-profile calls, excluded deletion tool, <=64-character tool names.")
            if args.installed:
                print("PASS: installed integration CLI configure/discover, native hermes mcp list and native OAuth client-secret resolution work in named homes without gateway credentials; OAuth-less discovery stays unavailable.")
        finally:
            shutdown_mcp_servers()
            set_multiplex_active(False)
    server.shutdown()
    server.server_close()
    thread.join(timeout=3)


if __name__ == "__main__":
    main()
