#!/usr/bin/env python3
"""Validate and sanitize a PostgreSQL 17 plain-text schema-only dump."""

from __future__ import annotations

import argparse
import os
import re
import sys
import tempfile
from pathlib import Path


class SanitizationError(ValueError):
    """The input is not a safe schema-only pg_dump."""


META_COMMAND = re.compile(r"^\\(restrict|unrestrict)[ \t]+([A-Za-z0-9]+)[ \t]*$")
SOURCE_VERSION = re.compile(r"^-- Dumped from database version 17(?:\.|\s|$)", re.MULTILINE)
DUMP_VERSION = re.compile(r"^-- Dumped by pg_dump version 17(?:\.|\s|$)", re.MULTILINE)
PG_DUMP_EMPTY_SEARCH_PATH = "SELECT pg_catalog.set_config('search_path', '', false);"
DRIVER_SAFE_SEARCH_PATH = "SELECT pg_catalog.set_config('search_path', 'public, pg_catalog', false);"
SCHEMA_OBJECT_KINDS = {
    "AGGREGATE",
    "COLLATION",
    "CONSTRAINT",
    "DOMAIN",
    "EXTENSION",
    "FUNCTION",
    "INDEX",
    "MATERIALIZED",
    "PROCEDURE",
    "SCHEMA",
    "SEQUENCE",
    "TABLE",
    "TRIGGER",
    "TYPE",
    "VIEW",
}


def _comments_and_whitespace_only(text: str) -> bool:
    index = 0
    block_depth = 0
    while index < len(text):
        if block_depth:
            if text.startswith("/*", index):
                block_depth += 1
                index += 2
            elif text.startswith("*/", index):
                block_depth -= 1
                index += 2
            else:
                index += 1
            continue
        if text.startswith("--", index):
            newline = text.find("\n", index + 2)
            index = len(text) if newline < 0 else newline + 1
        elif text.startswith("/*", index):
            block_depth = 1
            index += 2
        elif text[index].isspace():
            index += 1
        else:
            return False
    return block_depth == 0


def _validate_statement(tokens: list[tuple[str, bool]]) -> bool:
    if not tokens:
        return False

    words = [value.upper() for value, quoted in tokens if not quoted]
    first = words[0] if words else ""
    if first in {"COPY", "INSERT", "UPDATE", "DELETE", "TRUNCATE"}:
        raise SanitizationError(f"data statement is forbidden: {first}")
    if len(words) >= 2 and first in {"CREATE", "ALTER"} and words[1] == "DATABASE":
        raise SanitizationError(f"{first} DATABASE is forbidden")

    forbidden_keywords = {"AUTHORIZATION", "BEGIN", "COMMIT", "GRANT", "REVOKE", "TABLESPACE"}
    found = forbidden_keywords.intersection(words)
    if found:
        raise SanitizationError(f"forbidden SQL keyword: {sorted(found)[0]}")
    if any(words[index : index + 2] == ["OWNER", "TO"] for index in range(len(words) - 1)):
        raise SanitizationError("ownership changes are forbidden")
    if any(value.casefold() == "schema_migrations" for value, _quoted in tokens):
        raise SanitizationError("schema_migrations references are forbidden")

    if first == "SET":
        allowed_settings = {
            "CHECK_FUNCTION_BODIES",
            "CLIENT_ENCODING",
            "CLIENT_MIN_MESSAGES",
            "IDLE_IN_TRANSACTION_SESSION_TIMEOUT",
            "LOCK_TIMEOUT",
            "ROW_SECURITY",
            "STANDARD_CONFORMING_STRINGS",
            "STATEMENT_TIMEOUT",
            "TRANSACTION_TIMEOUT",
            "XMLOPTION",
        }
        if len(words) < 2 or words[1] not in allowed_settings:
            raise SanitizationError("unexpected SET statement")
        return False
    if first == "SELECT":
        if len(words) < 3 or words[1:3] != ["PG_CATALOG", "SET_CONFIG"]:
            raise SanitizationError("unexpected SELECT statement")
        return False
    if first == "ALTER":
        if len(words) < 2 or words[1] not in {"SEQUENCE", "TABLE"}:
            raise SanitizationError("unexpected ALTER statement")
        return False
    if first != "CREATE":
        raise SanitizationError(f"unexpected top-level SQL statement: {first or 'unknown'}")
        return False
    object_words = words[1:5]
    if object_words[:2] == ["OR", "REPLACE"]:
        object_words = object_words[2:]
    if object_words and object_words[0] == "UNIQUE":
        object_words = object_words[1:]
    if not object_words or object_words[0] not in SCHEMA_OBJECT_KINDS:
        raise SanitizationError("unexpected CREATE statement")
    return True


def _validate_sql(text: str) -> None:
    tokens: list[tuple[str, bool]] = []
    bare: list[str] = []
    quoted_identifier: list[str] = []
    state = "normal"
    block_depth = 0
    dollar_delimiter = ""
    escape_string = False
    statement_has_code = False
    recognizable_objects = 0
    index = 0

    def finish_bare() -> None:
        if bare:
            tokens.append(("".join(bare), False))
            bare.clear()

    while index < len(text):
        char = text[index]
        if state == "line_comment":
            if char == "\n":
                state = "normal"
            index += 1
            continue
        if state == "block_comment":
            if text.startswith("/*", index):
                block_depth += 1
                index += 2
            elif text.startswith("*/", index):
                block_depth -= 1
                index += 2
                if block_depth == 0:
                    state = "normal"
            else:
                index += 1
            continue
        if state == "single_quote":
            if escape_string and char == "\\":
                index += 2
            elif char == "'" and index + 1 < len(text) and text[index + 1] == "'":
                index += 2
            elif char == "'":
                state = "normal"
                index += 1
            else:
                index += 1
            continue
        if state == "double_quote":
            if char == '"' and index + 1 < len(text) and text[index + 1] == '"':
                quoted_identifier.append('"')
                index += 2
            elif char == '"':
                tokens.append(("".join(quoted_identifier), True))
                quoted_identifier.clear()
                state = "normal"
                index += 1
            else:
                quoted_identifier.append(char)
                index += 1
            continue
        if state == "dollar_quote":
            closing = text.find(dollar_delimiter, index)
            if closing < 0:
                raise SanitizationError("unterminated dollar-quoted body")
            index = closing + len(dollar_delimiter)
            state = "normal"
            continue

        if text.startswith("--", index):
            finish_bare()
            state = "line_comment"
            index += 2
        elif text.startswith("/*", index):
            finish_bare()
            state = "block_comment"
            block_depth = 1
            index += 2
        elif char == "'":
            prefix = "".join(bare)
            finish_bare()
            escape_string = prefix.casefold() == "e"
            state = "single_quote"
            statement_has_code = True
            index += 1
        elif char == '"':
            finish_bare()
            state = "double_quote"
            statement_has_code = True
            index += 1
        elif char == "$":
            match = re.match(r"\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$", text[index:])
            if match:
                finish_bare()
                dollar_delimiter = match.group(0)
                state = "dollar_quote"
                statement_has_code = True
                index += len(dollar_delimiter)
            else:
                bare.append(char)
                statement_has_code = True
                index += 1
        elif char == "\\":
            raise SanitizationError("psql backslash commands are forbidden")
        elif char == ";":
            finish_bare()
            if statement_has_code or tokens:
                recognizable_objects += int(_validate_statement(tokens))
            tokens.clear()
            statement_has_code = False
            index += 1
        elif char.isalnum() or char in {"_", "$"}:
            bare.append(char)
            statement_has_code = True
            index += 1
        else:
            finish_bare()
            if not char.isspace():
                statement_has_code = True
            index += 1

    finish_bare()
    if state == "block_comment":
        raise SanitizationError("unterminated block comment")
    if state in {"single_quote", "double_quote"}:
        raise SanitizationError("unterminated quoted value")
    if statement_has_code or tokens:
        raise SanitizationError("SQL statement is missing its terminating semicolon")
    if recognizable_objects == 0:
        raise SanitizationError("dump contains no recognizable schema objects")


def validate_sanitized_dump_text(text: str) -> None:
    if text.startswith("\ufeff"):
        raise SanitizationError("UTF-8 BOM is forbidden")
    if "\r" in text:
        raise SanitizationError("sanitized output must use LF line endings")
    if "\x00" in text:
        raise SanitizationError("NUL bytes are forbidden")
    if "-- PostgreSQL database dump" not in text:
        raise SanitizationError("pg_dump header is missing")
    if not SOURCE_VERSION.search(text):
        raise SanitizationError("source must be PostgreSQL 17")
    if not DUMP_VERSION.search(text):
        raise SanitizationError("dump must be generated by PostgreSQL 17 pg_dump")
    if "-- PostgreSQL database dump complete" not in text:
        raise SanitizationError("pg_dump completion marker is missing")
    if PG_DUMP_EMPTY_SEARCH_PATH in text or text.count(DRIVER_SAFE_SEARCH_PATH) != 1:
        raise SanitizationError("driver-safe public search_path statement is missing")
    _validate_sql(text)


def sanitize_dump_text(text: str) -> str:
    if "\x00" in text:
        raise SanitizationError("NUL bytes are forbidden")
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = normalized.splitlines(keepends=True)
    commands: list[tuple[int, int, str, str]] = []
    offset = 0
    for line in lines:
        body = line[:-1] if line.endswith("\n") else line
        if body.lstrip(" \t").startswith("\\"):
            match = META_COMMAND.fullmatch(body)
            if not match:
                raise SanitizationError("unexpected psql backslash command")
            commands.append((offset, offset + len(line), match.group(1), match.group(2)))
        offset += len(line)

    if len(commands) != 2:
        raise SanitizationError("dump must contain exactly one restrict/unrestrict pair")
    restrict, unrestrict = commands
    if restrict[2] != "restrict" or unrestrict[2] != "unrestrict":
        raise SanitizationError("restrict/unrestrict commands are out of order")
    if restrict[3] != unrestrict[3]:
        raise SanitizationError("restrict/unrestrict tokens do not match")
    if not _comments_and_whitespace_only(normalized[: restrict[0]]):
        raise SanitizationError("restrict command must precede all SQL")
    if not _comments_and_whitespace_only(normalized[unrestrict[1] :]):
        raise SanitizationError("unrestrict command must follow all SQL")

    output = normalized[: restrict[0]] + normalized[restrict[1] : unrestrict[0]] + normalized[unrestrict[1] :]
    if output.count(PG_DUMP_EMPTY_SEARCH_PATH) != 1:
        raise SanitizationError("expected one pg_dump empty search_path statement")
    output = output.replace(PG_DUMP_EMPTY_SEARCH_PATH, DRIVER_SAFE_SEARCH_PATH)
    output = output.rstrip("\n") + "\n"
    validate_sanitized_dump_text(output)
    return output


def sanitize_dump_file(input_path: Path, output_path: Path) -> None:
    source = input_path.resolve()
    destination = output_path.resolve()
    if os.path.normcase(str(source)) == os.path.normcase(str(destination)):
        raise SanitizationError("input and output paths must differ")
    if destination.exists() and source.exists() and os.path.samefile(source, destination):
        raise SanitizationError("input and output paths must differ")
    if not source.is_file():
        raise SanitizationError(f"input file does not exist: {source}")

    try:
        text = source.read_bytes().decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise SanitizationError("input is not valid UTF-8") from exc
    sanitized = sanitize_dump_text(text)
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{destination.name}.", dir=destination.parent)
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as temporary:
            temporary.write(sanitized.encode("utf-8"))
        os.replace(temporary_path, destination)
    finally:
        temporary_path.unlink(missing_ok=True)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="PostgreSQL 17 plain-text schema-only dump")
    parser.add_argument("--output", required=True, type=Path, help="Sanitized SQL output path")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        sanitize_dump_file(args.input, args.output)
    except (OSError, SanitizationError) as exc:
        print(f"STOP: {exc}", file=sys.stderr)
        return 2
    print(f"Sanitized schema-only dump: {args.output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
