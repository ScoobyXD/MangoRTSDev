"""Configure one immutable Mango scope, then exec the unmodified Hermes gateway."""

from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import sys
from uuid import UUID

OPENAI_SECRET_ID = "arn:aws:secretsmanager:us-west-1:686458136219:secret:mangorts/dev/openai-api-key-EaABNe"
DEFAULT_MODEL = "gpt-5.4-mini-2026-03-17"
OPENAI_BASE_URL = "https://api.openai.com/v1"


def bind_home(home, company_id, user_id):
    scope = {"company_id": str(UUID(company_id)), "user_id": str(UUID(user_id))}
    home.mkdir(mode=0o700, parents=True, exist_ok=True)
    binding = home / "mango-scope.json"
    if not binding.exists() and any(home.iterdir()):
        raise ValueError("An unbound Hermes home must be empty; existing private data cannot be adopted.")
    try:
        with binding.open("x", encoding="utf-8") as target:
            json.dump(scope, target)
    except FileExistsError:
        if json.loads(binding.read_text(encoding="utf-8")) != scope:
            raise ValueError("Persistent Hermes home belongs to a different Mango user/company.")
    # Verify disk SQLite works before upstream can fall back to an in-memory store.
    with closing(sqlite3.connect(home / "runs_idempotency.db")) as connection:
        if connection.execute("PRAGMA quick_check").fetchone() != ("ok",):
            raise ValueError("Native Hermes run storage failed its integrity check.")
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("ROLLBACK")


def runtime_config(model):
    return {
        "model": {"default": model, "provider": "openai-api"},
        "platform_toolsets": {"api_server": ["memory", "skills", "session_search", "mango"]},
        "plugins": {"enabled": ["mango"]},
        "tools": {"tool_search": {"enabled": "off"}},
        "memory": {"memory_enabled": True, "user_profile_enabled": True, "write_approval": False},
        "gateway": {"multiplex_profiles": False, "api_server": {"max_concurrent_runs": 1}},
        "multiplex_profiles": False,
        "profile_routes": [],
        "agent": {"max_turns": 30},
        "mcp_servers": {},
    }


def lock_native_scope(home, environment):
    managed_default = Path("/etc/hermes")
    if environment.get("HERMES_MANAGED_DIR", "").strip() or managed_default.exists() or managed_default.is_symlink():
        raise ValueError("Mango's dedicated runtime cannot load a managed configuration overlay.")
    for filename in ("gateway.json", ".env", ".op.env"):
        path = home / filename
        if path.exists() or path.is_symlink():
            raise ValueError(f"Mango's bound home cannot load an alternate {filename} configuration.")
    active_profile = home / "active_profile"
    if active_profile.is_symlink():
        raise ValueError("Mango's bound home cannot follow a linked active_profile.")
    if active_profile.exists() and active_profile.read_text(encoding="utf-8").strip() not in {"", "default"}:
        raise ValueError("Mango's bound home cannot select a different Hermes profile.")
    # Official supervisor mode preserves explicit HERMES_HOME instead of following
    # the interactive CLI's sticky profile. Multiplexing would expose other homes.
    environment["HERMES_GATEWAY_EXTERNAL_SUPERVISOR"] = "1"
    environment["GATEWAY_MULTIPLEX_PROFILES"] = "false"


def load_openai_key(client, secret_id):
    # Match Go's established raw / named JSON secret format without passing an
    # unknown JSON object to the provider as a credential.
    # The response stays inside application memory and is never logged or saved.
    value = client.get_secret_value(SecretId=secret_id).get("SecretString", "").strip()
    if value.startswith("{"):
        payload = json.loads(value)
        value = next((payload[name].strip() for name in ("api_key", "openai_api_key", "OPENAI_API_KEY")
                      if isinstance(payload.get(name), str) and payload[name].strip()), "")
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Authorized OpenAI secret does not contain an API key.")
    return value.strip()


def main():
    os.umask(0o077)
    home = Path(os.environ["HERMES_HOME"])
    if not home.is_absolute() or home.is_symlink():
        raise ValueError("HERMES_HOME must be one absolute private volume directory.")
    for name in ("API_SERVER_KEY", "MANGO_CALLBACK_KEY"):
        if len(os.environ.get(name, "")) < 32:
            raise ValueError(f"{name} must be supplied as a runtime secret of at least 32 characters.")
    if os.environ["API_SERVER_KEY"] == os.environ["MANGO_CALLBACK_KEY"]:
        raise ValueError("Hermes API and Mango callback credentials must be different.")
    bind_home(home, os.environ["MANGO_COMPANY_ID"], os.environ["MANGO_USER_ID"])
    lock_native_scope(home, os.environ)
    config = runtime_config(os.environ.get("MANGO_HERMES_MODEL", DEFAULT_MODEL))
    (home / "config.yaml").write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    import boto3

    session = boto3.Session(region_name="us-west-1")  # AWS_PROFILE=mangorts-dev for local SSO; task role in cloud.
    os.environ["OPENAI_BASE_URL"] = OPENAI_BASE_URL
    os.environ["OPENAI_API_KEY"] = load_openai_key(session.client("secretsmanager"), OPENAI_SECRET_ID)
    os.environ["API_SERVER_ENABLED"] = "true"
    os.environ["API_SERVER_HOST"] = "0.0.0.0"
    os.environ["API_SERVER_PORT"] = "8642"
    os.environ.pop("API_SERVER_CORS_ORIGINS", None)
    os.execvp("hermes", ["hermes", "gateway"])


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # SDK exception text may include request details. Report class only.
        print(f"Hermes startup failed ({type(error).__name__}); check required scope, runtime secret access, and volume configuration.", file=sys.stderr)
        raise SystemExit(1)
