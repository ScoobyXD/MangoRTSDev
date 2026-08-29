from __future__ import annotations

import json
import os
import sys
from pathlib import Path


EXPECTED_EMAIL = "jonathankim829@gmail.com"
EXPECTED_POOL_ID = "us-west-1_jFVZMkFdN"
EXPECTED_SUBJECT = "f939d90e-9061-70de-560f-661b450c2920"


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(2)


def append_log(entry: dict[str, object]) -> None:
    log_path = os.environ.get("MANGORTS_QA_COPY_PROBE_LOG", "")
    if not log_path:
        fail("Missing MANGORTS_QA_COPY_PROBE_LOG.")
    with Path(log_path).open("a", encoding="utf-8") as log:
        log.write(json.dumps(entry, separators=(",", ":")) + "\n")


def cognito_user() -> dict[str, object]:
    return {
        "Username": EXPECTED_SUBJECT,
        "UserStatus": "FORCE_CHANGE_PASSWORD",
        "Enabled": True,
        "Attributes": [
            {"Name": "email", "Value": EXPECTED_EMAIL},
            {"Name": "sub", "Value": EXPECTED_SUBJECT},
        ],
    }


def main() -> None:
    arguments = sys.argv[1:]
    shape = os.environ.get("MANGORTS_QA_COPY_LIST_SHAPE", "")

    if arguments[:2] == ["cognito-idp", "list-users"]:
        if len(arguments) != 4 or arguments[2] != "--cli-input-json":
            fail(f"list-users did not use one file-backed --cli-input-json argument: {arguments!r}")
        input_reference = arguments[3]
        if not input_reference.startswith("file://"):
            fail(f"list-users input was not file-backed: {input_reference!r}")
        input_path = Path(input_reference.removeprefix("file://"))
        try:
            request = json.loads(input_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            fail(f"Could not read the structured list-users input: {error}")
        expected_request = {
            "UserPoolId": EXPECTED_POOL_ID,
            "Filter": f'email = "{EXPECTED_EMAIL}"',
            "Limit": 2,
        }
        if request != expected_request:
            fail(f"Unexpected structured list-users input: {request!r}")
        append_log(
            {
                "command": "list-users",
                "input_path": str(input_path),
                "request": request,
                "shape": shape,
            }
        )
        if shape == "one":
            response = {"Users": [cognito_user()]}
        elif shape == "empty":
            response = {"Users": []}
        elif shape == "missing":
            response = {}
        else:
            fail(f"Unsupported list-users fixture shape: {shape!r}")
        print(json.dumps(response, separators=(",", ":")))
        return

    if arguments[:2] == ["cognito-idp", "admin-create-user"]:
        expected_arguments = [
            "cognito-idp",
            "admin-create-user",
            "--user-pool-id",
            EXPECTED_POOL_ID,
            "--username",
            EXPECTED_EMAIL,
            "--user-attributes",
            f"Name=email,Value={EXPECTED_EMAIL}",
            "Name=email_verified,Value=true",
        ]
        if arguments != expected_arguments:
            fail(f"Unexpected fake admin-create-user arguments: {arguments!r}")
        if shape not in {"empty", "missing"}:
            fail(f"admin-create-user was called for list shape {shape!r}")
        append_log({"command": "admin-create-user", "shape": shape})
        print(json.dumps({"User": cognito_user()}, separators=(",", ":")))
        return

    fail(f"Unexpected fake AWS command: {arguments!r}")


if __name__ == "__main__":
    main()
