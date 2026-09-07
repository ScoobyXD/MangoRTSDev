"""Configure exact Mango profiles, then exec one native Hermes gateway."""

from contextlib import closing
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
from uuid import UUID

from mango_scope import integration_secrets, profiles

OPENAI_SECRET_ID = "arn:aws:secretsmanager:us-west-1:686458136219:secret:mangorts/dev/openai-api-key-EaABNe"
DEFAULT_MODEL = "gpt-5.4-mini-2026-03-17"
OPENAI_BASE_URL = "https://api.openai.com/v1"
MAX_RUNTIME_INPUT = 262144


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
    verify_sqlite(home / "state.db")


def verify_sqlite(path):
    # Verify the actual native storage paths before upstream can fall back to
    # memory. Run admission belongs to the one listener; sessions to profiles.
    with closing(sqlite3.connect(path)) as connection:
        if connection.execute("PRAGMA quick_check").fetchone() != ("ok",):
            raise ValueError("Native Hermes run storage failed its integrity check.")
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("ROLLBACK")


def runtime_config(model, saved=None, *, profile="", served_profiles=()):
    # Preserve native user settings and learning; enforce only Mango's runtime
    # boundary. Configuration is not replaced with a fresh blank profile.
    config = deepcopy(saved or {})
    config.setdefault("model", {"default": model, "provider": "openai-api"})
    config.setdefault("agent", {}).setdefault("max_turns", 30)
    # Mango's chat is this exact native session. Native in-place compression
    # retains its identity and archived transcript without creating a new chat.
    config.setdefault("compression", {})["in_place"] = True
    config.setdefault("memory", {}).update({"memory_enabled": True, "user_profile_enabled": True, "write_approval": False})
    config.setdefault("tools", {})["tool_search"] = {"enabled": "off"}
    config.setdefault("secrets", {})["mango_runtime"] = {"enabled": True, "override_existing": True}
    config.update({
        "platform_toolsets": {"api_server": ["memory", "skills", "session_search", "mango"]},
        "plugins": {"enabled": ["mango"]},
        "gateway": {"multiplex_profiles": not bool(profile),
                    "multiplex_profile_allowlist": list(served_profiles),
                    "api_server": {"enabled": not bool(profile),
                                   "max_concurrent_runs": max(1, len(served_profiles))}},
        "multiplex_profiles": not bool(profile),
        "profile_routes": [],
    })
    if profile:
        from mango_integrations import apply_profile_integrations
        apply_profile_integrations(config, saved or {}, profile)
    else:
        config["platform_toolsets"] = {"api_server": []}
        config["mcp_servers"] = {}
    return config


def lock_native_scope(home, environment):
    managed_default = Path("/etc/hermes")
    if environment.get("HERMES_MANAGED_DIR", "").strip() or managed_default.exists() or managed_default.is_symlink():
        raise ValueError("Mango's shared runtime cannot load a managed configuration overlay.")
    for filename in ("gateway.json", ".env", ".op.env"):
        path = home / filename
        if path.exists() or path.is_symlink():
            raise ValueError(f"Mango's bound home cannot load an alternate {filename} configuration.")
    active_profile = home / "active_profile"
    if active_profile.is_symlink():
        raise ValueError("Mango's bound home cannot follow a linked active_profile.")
    if active_profile.exists() and active_profile.read_text(encoding="utf-8").strip() not in {"", "default"}:
        raise ValueError("Mango's bound home cannot select a different Hermes profile.")
    # The default home owns only the listener. Native ContextVars select each
    # named profile; sticky CLI state must never redirect the gateway.
    environment["HERMES_GATEWAY_EXTERNAL_SUPERVISOR"] = "1"
    environment["GATEWAY_MULTIPLEX_PROFILES"] = "true"


def configure_gateway(home, environment):
    served = profiles(environment)
    integration_secrets(environment)
    volumes = json.loads(environment["MANGO_HERMES_PROFILE_VOLUMES"])
    if not isinstance(volumes, dict) or set(volumes) != set(served):
        raise ValueError("Every configured profile requires its persistent volume binding.")
    for name, volume in volumes.items():
        expected = "mangorts-hermes-" + served[name]["company_id"] + "-" + served[name]["user_id"]
        if volume is not None and volume != expected:
            raise ValueError("An existing volume must name its exact company/user owner.")
    home.mkdir(mode=0o700, parents=True, exist_ok=True)
    binding = home / "mango-gateway.json"
    fingerprint = hashlib.sha256(environment["API_SERVER_KEY"].encode()).hexdigest()
    if binding.exists():
        persisted = json.loads(binding.read_text(encoding="utf-8"))
        if (not isinstance(persisted, dict) or set(persisted) != {"profile_volumes", "api_key_fingerprint"}
                or not isinstance(persisted["profile_volumes"], dict)):
            raise ValueError("Invalid gateway volume binding.")
        if persisted["api_key_fingerprint"] != fingerprint:
            raise ValueError("The gateway API credential must match its durable run storage.")
        previous = persisted["profile_volumes"]
        for name, volume in volumes.items():
            if name in previous and previous[name] != volume:
                raise ValueError("A profile cannot switch persistent volumes.")
        volumes = {**previous, **volumes}
    elif any(path.name != "profiles" for path in home.iterdir()):
        raise ValueError("The gateway requires a new shared home; private homes cannot become the listener.")
    lock_native_scope(home, environment)
    configured = {}
    for name, scope in served.items():
        profile_home = home / "profiles" / name
        if profile_home.is_symlink():
            raise ValueError("Mango profiles cannot be directory links.")
        bind_home(profile_home, **scope)
        # User settings and integrations remain native profile configuration.
        path = profile_home / "config.yaml"
        if path.is_symlink() or (profile_home / "mango-scope.json").is_symlink():
            raise ValueError("Mango profile binding and configuration cannot be links.")
        if path.exists():
            import yaml
            saved = yaml.safe_load(path.read_text(encoding="utf-8"))
            if not isinstance(saved, dict):
                raise ValueError("Profile configuration must be an object.")
        else:
            saved = {}
        for filename in ("gateway.json", ".env", ".op.env"):
            if (profile_home / filename).exists() or (profile_home / filename).is_symlink():
                raise ValueError("Mango runtime credentials must use the native secret source, not alternate environment files.")
        configured[name] = runtime_config(environment.get("MANGO_HERMES_MODEL", DEFAULT_MODEL), saved,
                                          profile=name, served_profiles=served)
    from mango_integrations import validate_profile_integrations
    validate_profile_integrations(configured)
    for name, config in configured.items():
        (home / "profiles" / name / "config.yaml").write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    saved_binding = binding.with_suffix(".tmp")
    saved_binding.write_text(json.dumps({"profile_volumes": volumes, "api_key_fingerprint": fingerprint}, indent=2) + "\n", encoding="utf-8")
    saved_binding.replace(binding)
    verify_sqlite(home / "runs_idempotency.db")
    (home / "config.yaml").write_text(json.dumps(runtime_config(
        environment.get("MANGO_HERMES_MODEL", DEFAULT_MODEL), served_profiles=served), indent=2) + "\n", encoding="utf-8")


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


def read_runtime_credentials():
    # Read one bounded line so Docker's open stdin never delays startup until EOF.
    line = sys.stdin.buffer.readline(MAX_RUNTIME_INPUT + 1)
    if len(line) > MAX_RUNTIME_INPUT or not line.endswith(b"\n"):
        raise ValueError("Runtime credentials must be one complete bounded JSON line.")
    # bytes also handles the UTF-8 BOM emitted by Windows PowerShell's stdin writer.
    credentials = json.loads(line)
    required = {"OPENAI_API_KEY", "API_SERVER_KEY", "MANGO_CALLBACK_KEY"}
    if (not isinstance(credentials, dict) or not required.issubset(credentials)
            or set(credentials) - required - {"MANGO_INTEGRATION_SECRETS", "MANGO_HERMES_HISTORY_REPAIRS"}):
        raise ValueError("Runtime input requires the three service keys and optional profile integrations or history repairs.")
    if any(not isinstance(value, str) or not value.strip() or "\x00" in value for value in credentials.values()):
        raise ValueError("Runtime credentials must be nonempty strings without null characters.")
    return credentials


def main(argv=()):
    local_runtime = list(argv) == ["--runtime-stdin"]
    if argv and not local_runtime:
        raise ValueError("Only --runtime-stdin is supported.")
    if local_runtime:
        os.environ.update(read_runtime_credentials())
    os.umask(0o077)
    home = Path(os.environ["HERMES_HOME"])
    if not home.is_absolute() or home.is_symlink():
        raise ValueError("HERMES_HOME must be one absolute private volume directory.")
    for name in ("API_SERVER_KEY", "MANGO_CALLBACK_KEY"):
        if len(os.environ.get(name, "")) < 32:
            raise ValueError(f"{name} must be supplied as a runtime secret of at least 32 characters.")
    if os.environ["API_SERVER_KEY"] == os.environ["MANGO_CALLBACK_KEY"]:
        raise ValueError("Hermes API and Mango callback credentials must be different.")
    configure_gateway(home, os.environ)
    repairs = os.environ.pop("MANGO_HERMES_HISTORY_REPAIRS", None)
    if repairs is not None:
        from mango_recovery import queue_history_repairs
        count = queue_history_repairs(repairs)
        print(f"Queued saved native history for {count} admitted runs; original execution events were not reconstructed.")
    os.environ["OPENAI_BASE_URL"] = OPENAI_BASE_URL
    if not local_runtime:
        import boto3

        session = boto3.Session(region_name="us-west-1")  # Use the narrowly scoped runtime task role in cloud.
        os.environ["OPENAI_API_KEY"] = load_openai_key(session.client("secretsmanager"), OPENAI_SECRET_ID)
    os.environ["API_SERVER_ENABLED"] = "true"
    os.environ["API_SERVER_HOST"] = "0.0.0.0"
    os.environ["API_SERVER_PORT"] = "8642"
    os.environ.pop("API_SERVER_CORS_ORIGINS", None)
    os.execvp("hermes", ["hermes", "gateway"])


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Exception as error:
        # SDK exception text may include request details. Report class only.
        print(f"Hermes startup failed ({type(error).__name__}); check required scope, runtime secret access, and volume configuration.", file=sys.stderr)
        raise SystemExit(1)
