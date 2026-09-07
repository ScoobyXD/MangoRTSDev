"""Exact Mango profile bindings and native in-memory runtime secret source."""

import hashlib
import hmac
import json
import os
import re
from pathlib import Path
from uuid import UUID


def profile_name(company_id, user_id):
    return UUID(company_id).hex + UUID(user_id).hex


def profiles(environment=None):
    environment = os.environ if environment is None else environment
    values = json.loads(environment["MANGO_HERMES_PROFILES"])
    if not isinstance(values, list) or not values:
        raise ValueError("At least one exact Mango company/user profile is required.")
    result = {}
    for value in values:
        if not isinstance(value, dict) or set(value) != {"company_id", "user_id"}:
            raise ValueError("A profile must contain only company_id and user_id.")
        scope = {key: str(UUID(item)) for key, item in value.items()}
        if value != scope:
            raise ValueError("Profile identities must be canonical UUIDs.")
        name = profile_name(**scope)
        if name in result:
            raise ValueError("Duplicate Mango profile.")
        result[name] = scope
    return result


def derive_key(seed, purpose, name):
    if not isinstance(seed, str) or len(seed) < 32:
        raise ValueError("Missing injected runtime credential.")
    return hmac.new(seed.encode(), f"mango-hermes-{purpose}:{name}".encode(), hashlib.sha256).hexdigest()


def bound_profile(home):
    root = Path(os.environ["HERMES_HOME"]).resolve()
    home = Path(home)
    name = home.name
    scope = profiles().get(name)
    if (scope is None or home.is_symlink() or home.resolve() != root / "profiles" / name
            or json.loads((home / "mango-scope.json").read_text(encoding="utf-8")) != scope):
        raise ValueError("No authorized Mango profile is active.")
    return name


def runtime_secrets(home):
    root = Path(os.environ["HERMES_HOME"]).resolve()
    if Path(home).resolve() == root:
        return {"API_SERVER_KEY": os.environ["API_SERVER_KEY"],
                "OPENAI_API_KEY": os.environ["OPENAI_API_KEY"],
                "OPENAI_BASE_URL": os.environ["OPENAI_BASE_URL"]}
    name = bound_profile(home)
    return {**integration_secrets().get(name, {}),
            "API_SERVER_KEY": derive_key(os.environ["API_SERVER_KEY"], "api", name),
            "MANGO_CALLBACK_KEY": derive_key(os.environ["MANGO_CALLBACK_KEY"], "callback", name),
            "OPENAI_API_KEY": os.environ["OPENAI_API_KEY"],
            "OPENAI_BASE_URL": os.environ["OPENAI_BASE_URL"]}


def integration_secrets(environment=None):
    environment = os.environ if environment is None else environment
    values = json.loads(environment.get("MANGO_INTEGRATION_SECRETS", "{}"))
    served = profiles(environment)
    if not isinstance(values, dict) or not set(values).issubset(served):
        raise ValueError("Integration credentials must name exact configured profiles.")
    for secrets in values.values():
        if not isinstance(secrets, dict):
            raise ValueError("Profile integration credentials must be an object.")
        for name, value in secrets.items():
            # Only purpose-named integration references can enter native scope;
            # they cannot override gateway, callback, model, or tenant routing.
            if (not isinstance(name, str) or not re.fullmatch(r"MANGO_INTEGRATION_[A-Z0-9_]+", name)
                    or not isinstance(value, str) or not value.strip() or "\x00" in value):
                raise ValueError("Invalid profile integration credential reference.")
    return values


def callback_key(home):
    return derive_key(os.environ["MANGO_CALLBACK_KEY"], "callback", bound_profile(home))


def register_secret_source():
    # Native public registry: register globally so a named profile's very first
    # authenticated request can resolve its key before its plugins are loaded.
    from agent.secret_sources.base import ErrorKind, FetchResult, SecretSource
    from agent.secret_sources.registry import get_source, register_source

    if get_source("mango_runtime") is not None:
        return

    class MangoRuntimeSource(SecretSource):
        name = "mango_runtime"
        label = "Mango runtime"
        shape = "bulk"
        override_existing_default = True

        def fetch(self, cfg, home_path):
            try:
                return FetchResult(secrets=runtime_secrets(home_path))
            except (KeyError, ValueError, OSError):
                return FetchResult().fail("Mango runtime profile is unavailable.", ErrorKind.NOT_CONFIGURED)

    if not register_source(MangoRuntimeSource()):
        raise ValueError("Could not register Mango runtime credentials.")
