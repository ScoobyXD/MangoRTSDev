#!/usr/bin/env python3
"""Verify the current agent session lacks direct DB-write-enabling AWS access.

This script intentionally does not retrieve secret values and does not connect to a
database. It checks the current shell/session for obvious AWS access paths that
would let an agent retrieve writer secrets or mutate prod/dev infrastructure.
"""

from __future__ import annotations

import configparser
import json
import os
import subprocess
import sys
from pathlib import Path

ADMIN_PROFILES = ("mangorts-prod", "mangorts-dev")
ALLOWED_READONLY_PROFILES = ("mangorts-prod-agent-readonly", "mangorts-dev-agent-readonly")
AWS_SECRET_ENV_KEYS = (
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_SECURITY_TOKEN",
)


def run_aws_identity(profile: str) -> tuple[bool, str]:
    env = os.environ.copy()
    env["AWS_PROFILE"] = profile
    env["AWS_SDK_LOAD_CONFIG"] = "1"
    result = subprocess.run(
        ["aws", "sts", "get-caller-identity", "--output", "json"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env=env,
        timeout=30,
    )
    if result.returncode != 0:
        return False, result.stdout.strip().splitlines()[-1] if result.stdout.strip() else "no identity"
    try:
        identity = json.loads(result.stdout)
    except json.JSONDecodeError:
        return True, "identity returned but JSON parse failed"
    return True, f"Account={identity.get('Account')} Arn={identity.get('Arn')}"


def configured_static_profiles() -> list[str]:
    candidates = []
    explicit = os.environ.get("AWS_SHARED_CREDENTIALS_FILE")
    if explicit:
        candidates.append(Path(explicit))
    candidates.append(Path.home() / ".aws" / "credentials")

    found: list[str] = []
    for path in candidates:
        if not path.exists():
            continue
        parser = configparser.ConfigParser()
        try:
            parser.read(path, encoding="utf-8")
        except Exception:
            continue
        for profile in ADMIN_PROFILES:
            if parser.has_section(profile) and parser.has_option(profile, "aws_access_key_id"):
                found.append(profile)
    return sorted(set(found))


def main() -> int:
    failures: list[str] = []
    warnings: list[str] = []

    active_env_keys = [key for key in AWS_SECRET_ENV_KEYS if os.environ.get(key)]
    if active_env_keys:
        failures.append(f"AWS secret/session environment variables are set: {', '.join(active_env_keys)}")

    current_profile = os.environ.get("AWS_PROFILE", "").strip()
    if current_profile in ADMIN_PROFILES:
        failures.append(f"AWS_PROFILE is set to human/admin profile {current_profile!r}")

    static_profiles = configured_static_profiles()
    if static_profiles:
        failures.append(
            "Static AWS access keys appear configured for human/admin profile(s): "
            + ", ".join(static_profiles)
        )

    for profile in ADMIN_PROFILES:
        ok, detail = run_aws_identity(profile)
        if ok:
            failures.append(f"Human/admin AWS profile {profile!r} is active in this session: {detail}")
        else:
            print(f"BOUNDARY_OK admin profile {profile!r} not active: {detail}")

    for profile in ALLOWED_READONLY_PROFILES:
        ok, detail = run_aws_identity(profile)
        if ok:
            print(f"BOUNDARY_INFO readonly profile {profile!r} active: {detail}")
        else:
            print(f"BOUNDARY_INFO readonly profile {profile!r} not active/configured: {detail}")

    repo = Path(__file__).resolve().parents[1]
    for rel in ("infra/aws-prod/terraform.tfvars", "infra/aws-dev/terraform.tfvars"):
        if (repo / rel).exists():
            warnings.append(
                f"Sensitive local config exists in workspace: {rel}. "
                "Do not read it from agent sessions unless the user explicitly approves. "
                "For hard separation, move human-only prod config outside the Hermes workspace."
            )

    for warning in warnings:
        print(f"BOUNDARY_WARNING {warning}")

    if failures:
        for failure in failures:
            print(f"BOUNDARY_FAIL {failure}")
        print("BOUNDARY_RESULT FAIL current session has direct admin/write-enabling access paths")
        return 1

    print("BOUNDARY_RESULT PASS current session lacks active human/admin AWS profiles and static AWS env credentials")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
