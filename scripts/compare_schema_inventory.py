#!/usr/bin/env python3
"""Compare two MangoRTS PostgreSQL schema inventory exports.

The inventory exports should be produced by backend/db/schema_inventory.sql.
The script is offline: it does not connect to any database.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


DEFAULT_IGNORED_IDENTITY_PARTS = ("schema_migrations",)
DEFAULT_IGNORED_KINDS = ("grant",)


@dataclass(frozen=True)
class InventoryItem:
    object_kind: str
    object_identity: str
    definition: Any

    @property
    def key(self) -> tuple[str, str]:
        return (self.object_kind, self.object_identity)

    def normalized_definition_value(self) -> Any:
        if self.object_kind == "column" and isinstance(self.definition, dict):
            normalized = dict(self.definition)
            normalized.pop("ordinal_position", None)
            return normalized
        return self.definition

    def normalized_definition(self) -> str:
        return json.dumps(
            self.normalized_definition_value(),
            sort_keys=True,
            ensure_ascii=False,
            separators=(",", ":"),
        )


@dataclass(frozen=True)
class Difference:
    key: tuple[str, str]
    expected: InventoryItem | None
    actual: InventoryItem | None


@dataclass(frozen=True)
class InventoryExport:
    items: list[InventoryItem]
    metadata: dict[str, Any]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compare two schema_inventory.sql JSON exports.")
    parser.add_argument("--expected", required=True, help="Canonical/expected inventory JSON file")
    parser.add_argument("--actual", required=True, help="Actual inventory JSON file, such as prod")
    parser.add_argument("--expected-label", default="expected", help="Label for the expected inventory")
    parser.add_argument("--actual-label", default="actual", help="Label for the actual inventory")
    parser.add_argument("--output-md", help="Optional Markdown report path")
    parser.add_argument("--include-grants", action="store_true", help="Compare grant objects too")
    parser.add_argument(
        "--include-schema-migrations",
        action="store_true",
        help="Compare schema_migrations metadata objects too",
    )
    parser.add_argument(
        "--ignore-kind",
        action="append",
        default=[],
        help="Object kind to ignore; may be repeated",
    )
    parser.add_argument(
        "--ignore-identity-contains",
        action="append",
        default=[],
        help="Ignore objects whose identity contains this text; may be repeated",
    )
    parser.add_argument("--max-details", type=int, default=25, help="Maximum detailed differences per section")
    parser.add_argument(
        "--require-postgres-major",
        type=int,
        help="Require both fresh exports to report this PostgreSQL major version",
    )
    parser.add_argument(
        "--require-same-commit",
        action="store_true",
        help="Require both export envelopes to report the same Git commit",
    )
    parser.add_argument(
        "--require-current-repository",
        action="store_true",
        help="Require both exports to match the current Git commit and repository schema fingerprint",
    )
    parser.add_argument(
        "--repo-root",
        default=str(Path(__file__).resolve().parents[1]),
        help="Repository root used by --require-current-repository",
    )
    parser.add_argument(
        "--max-export-age-hours",
        type=float,
        help="Reject export envelopes older than this many hours",
    )
    parser.add_argument(
        "--require-expected-environment",
        help="Require the expected export metadata.environment to equal this value",
    )
    parser.add_argument(
        "--require-actual-environment",
        help="Require the actual export metadata.environment to equal this value",
    )
    return parser.parse_args()


def load_inventory(path: Path) -> list[InventoryItem]:
    return load_inventory_export(path).items


def load_inventory_export(path: Path) -> InventoryExport:
    raw = path.read_text(encoding="utf-8-sig").strip()
    if not raw:
        raise ValueError(f"{path} is empty")

    parsed = parse_json_document(raw)
    metadata = parsed.get("metadata", {}) if isinstance(parsed, dict) else {}
    if not isinstance(metadata, dict):
        raise ValueError(f"{path} metadata is not an object")
    data = unwrap_inventory_export(parsed)
    if not isinstance(data, list):
        raise ValueError(f"{path} did not contain a JSON array inventory")

    items: list[InventoryItem] = []
    for index, row in enumerate(data):
        if not isinstance(row, dict):
            raise ValueError(f"{path} row {index} is not an object")
        try:
            object_kind = str(row["object_kind"]).strip()
            object_identity = str(row["object_identity"]).strip()
            definition = row["definition"]
        except KeyError as exc:
            raise ValueError(f"{path} row {index} is missing {exc.args[0]!r}") from exc
        if not object_kind or not object_identity:
            raise ValueError(f"{path} row {index} has an empty object kind or identity")
        items.append(InventoryItem(object_kind, object_identity, definition))
    return InventoryExport(items, metadata)


def parse_json_export(raw: str) -> Any:
    return unwrap_inventory_export(parse_json_document(raw))


def parse_json_document(raw: str) -> Any:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        rows = [json.loads(line) for line in raw.splitlines() if line.strip()]
        if len(rows) == 1:
            return rows[0]
        return rows


def parse_json_lines_export(raw: str) -> Any:
    return unwrap_inventory_export(parse_json_document(raw))


def unwrap_inventory_export(parsed: Any) -> Any:
    if isinstance(parsed, list):
        if all(isinstance(row, dict) and {"object_kind", "object_identity", "definition"} <= set(row) for row in parsed):
            return parsed
        if len(parsed) == 1 and isinstance(parsed[0], dict):
            return unwrap_inventory_export(parsed[0])
        return parsed

    if isinstance(parsed, dict):
        for key in ("schema_inventory_json", "schema_inventory", "inventory"):
            if key in parsed:
                value = parsed[key]
                if isinstance(value, str):
                    return unwrap_inventory_export(json.loads(value))
                return unwrap_inventory_export(value)
        if len(parsed) == 1:
            value = next(iter(parsed.values()))
            if isinstance(value, str):
                return unwrap_inventory_export(json.loads(value))
            return unwrap_inventory_export(value)

    return parsed


def filter_items(items: list[InventoryItem], args: argparse.Namespace) -> list[InventoryItem]:
    ignored_kinds = {kind.strip() for kind in args.ignore_kind if kind.strip()}
    ignored_identity_parts = [part for part in args.ignore_identity_contains if part]

    if not args.include_grants:
        ignored_kinds.update(DEFAULT_IGNORED_KINDS)
    if not args.include_schema_migrations:
        ignored_identity_parts.extend(DEFAULT_IGNORED_IDENTITY_PARTS)

    filtered = []
    for item in items:
        if item.object_kind in ignored_kinds:
            continue
        if any(part in item.object_identity for part in ignored_identity_parts):
            continue
        filtered.append(item)
    return filtered


def default_filtered_items(items: list[InventoryItem]) -> list[InventoryItem]:
    return [
        item
        for item in items
        if item.object_kind not in DEFAULT_IGNORED_KINDS
        and not any(part in item.object_identity for part in DEFAULT_IGNORED_IDENTITY_PARTS)
    ]


def index_items(items: list[InventoryItem], label: str) -> dict[tuple[str, str], InventoryItem]:
    indexed: dict[tuple[str, str], InventoryItem] = {}
    duplicates: list[tuple[str, str]] = []
    for item in items:
        if item.key in indexed:
            duplicates.append(item.key)
        indexed[item.key] = item
    if duplicates:
        rendered = ", ".join(f"{kind}:{identity}" for kind, identity in sorted(set(duplicates))[:10])
        raise ValueError(f"{label} inventory has duplicate object keys: {rendered}")
    return indexed


def inventory_digest(items: list[InventoryItem]) -> str:
    indexed = index_items(items, "digest")
    normalized = [
        {
            "definition": indexed[key].normalized_definition_value(),
            "object_identity": indexed[key].object_identity,
            "object_kind": indexed[key].object_kind,
        }
        for key in sorted(indexed)
    ]
    canonical = json.dumps(normalized, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    canonical = canonical.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def repository_schema_fingerprint(repo_root: Path) -> str:
    files = [
        ("schema.sql", repo_root / "backend" / "db" / "schema.sql"),
        ("schema_inventory.sql", repo_root / "backend" / "db" / "schema_inventory.sql"),
    ]
    migrations_dir = repo_root / "backend" / "db" / "migrations"
    files.extend(
        (f"migrations/{path.name}", path)
        for path in sorted(migrations_dir.glob("*.sql"), key=lambda path: path.name)
        if path.is_file()
    )

    digest = hashlib.sha256()
    for label, path in files:
        if not path.is_file():
            raise ValueError(f"repository schema file is missing: {path}")
        raw = path.read_bytes()
        if raw.startswith(b"\xef\xbb\xbf"):
            raw = raw[3:]
        raw = raw.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
        file_digest = hashlib.sha256(raw).hexdigest()
        digest.update(label.encode("utf-8"))
        digest.update(b"\0")
        digest.update(file_digest.encode("ascii"))
        digest.update(b"\n")
    return digest.hexdigest()


def current_git_commit(repo_root: Path) -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def parse_export_time(value: Any, label: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} metadata exported_at_utc is missing")
    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise ValueError(f"{label} metadata exported_at_utc is invalid: {value!r}") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{label} metadata exported_at_utc must include a UTC offset")
    return parsed.astimezone(timezone.utc)


def validate_export_gate(
    args: argparse.Namespace,
    expected_export: InventoryExport,
    actual_export: InventoryExport,
) -> list[str]:
    gate_enabled = bool(
        args.require_postgres_major is not None
        or args.require_same_commit
        or args.require_current_repository
        or args.max_export_age_hours is not None
        or args.require_expected_environment is not None
        or args.require_actual_environment is not None
    )
    if not gate_enabled:
        return []

    errors: list[str] = []
    exports = (
        (args.expected_label, expected_export),
        (args.actual_label, actual_export),
    )
    required_fields = (
        "exported_at_utc",
        "git_commit",
        "repository_schema_sha256",
        "schema_inventory_sha256",
        "server_version_num",
        "environment",
    )
    for label, export in exports:
        missing_fields = [field for field in required_fields if not export.metadata.get(field)]
        if missing_fields:
            errors.append(f"{label} export metadata is missing: {', '.join(missing_fields)}")
            continue
        embedded_digest = str(export.metadata["schema_inventory_sha256"]).lower()
        actual_digest = inventory_digest(default_filtered_items(export.items))
        if embedded_digest != actual_digest:
            errors.append(
                f"{label} embedded schema_inventory_sha256 does not match its filtered inventory"
            )

        if args.require_postgres_major is not None:
            try:
                version_num = int(export.metadata["server_version_num"])
            except (TypeError, ValueError):
                errors.append(f"{label} server_version_num is not an integer")
            else:
                if version_num // 10000 != args.require_postgres_major:
                    errors.append(
                        f"{label} PostgreSQL major is {version_num // 10000}; expected {args.require_postgres_major}"
                    )

        if args.max_export_age_hours is not None:
            if args.max_export_age_hours <= 0:
                errors.append("--max-export-age-hours must be greater than zero")
            else:
                try:
                    exported_at = parse_export_time(export.metadata["exported_at_utc"], label)
                except ValueError as exc:
                    errors.append(str(exc))
                else:
                    now = datetime.now(timezone.utc)
                    if exported_at > now + timedelta(minutes=5):
                        errors.append(f"{label} export time is in the future")
                    elif now - exported_at > timedelta(hours=args.max_export_age_hours):
                        errors.append(
                            f"{label} export is older than {args.max_export_age_hours:g} hours"
                        )

    expected_commit = str(expected_export.metadata.get("git_commit", ""))
    actual_commit = str(actual_export.metadata.get("git_commit", ""))
    expected_repo_digest = str(expected_export.metadata.get("repository_schema_sha256", "")).lower()
    actual_repo_digest = str(actual_export.metadata.get("repository_schema_sha256", "")).lower()
    if args.require_expected_environment is not None:
        expected_environment = str(expected_export.metadata.get("environment", ""))
        if expected_environment != args.require_expected_environment:
            errors.append(
                f"{args.expected_label} environment is {expected_environment!r}; expected {args.require_expected_environment!r}"
            )
    if args.require_actual_environment is not None:
        actual_environment = str(actual_export.metadata.get("environment", ""))
        if actual_environment != args.require_actual_environment:
            errors.append(
                f"{args.actual_label} environment is {actual_environment!r}; expected {args.require_actual_environment!r}"
            )
    if args.require_same_commit:
        if not expected_commit or not actual_commit or expected_commit != actual_commit:
            errors.append("exports were not created from the same Git commit")
        if not expected_repo_digest or expected_repo_digest != actual_repo_digest:
            errors.append("exports do not have the same repository schema fingerprint")

    if args.require_current_repository:
        repo_root = Path(args.repo_root).resolve()
        try:
            repo_digest = repository_schema_fingerprint(repo_root)
            git_commit = current_git_commit(repo_root)
        except (OSError, ValueError, subprocess.CalledProcessError) as exc:
            errors.append(f"could not inspect current repository: {exc}")
        else:
            for label, commit, digest in (
                (args.expected_label, expected_commit, expected_repo_digest),
                (args.actual_label, actual_commit, actual_repo_digest),
            ):
                if commit != git_commit:
                    errors.append(f"{label} export Git commit does not match current HEAD")
                if digest != repo_digest:
                    errors.append(f"{label} repository schema fingerprint does not match current files")
    return errors


def compare(expected_items: list[InventoryItem], actual_items: list[InventoryItem]) -> tuple[list[Difference], list[Difference], list[Difference]]:
    expected = index_items(expected_items, "expected")
    actual = index_items(actual_items, "actual")

    expected_keys = set(expected)
    actual_keys = set(actual)

    missing = [Difference(key, expected[key], None) for key in sorted(expected_keys - actual_keys)]
    extra = [Difference(key, None, actual[key]) for key in sorted(actual_keys - expected_keys)]
    different: list[Difference] = []

    for key in sorted(expected_keys & actual_keys):
        if expected[key].normalized_definition() != actual[key].normalized_definition():
            different.append(Difference(key, expected[key], actual[key]))

    return missing, extra, different


def render_summary(
    args: argparse.Namespace,
    expected_count: int,
    actual_count: int,
    expected_digest: str,
    actual_digest: str,
    missing: list[Difference],
    extra: list[Difference],
    different: list[Difference],
    gate_errors: list[str],
) -> str:
    status = "PASS" if not missing and not extra and not different and not gate_errors else "FAIL"
    lines = [
        "# Schema Inventory Diff",
        "",
        f"- Status: {status}",
        f"- Expected inventory: `{args.expected_label}` ({expected_count} compared objects)",
        f"- Actual inventory: `{args.actual_label}` ({actual_count} compared objects)",
        f"- Expected SHA-256: `{expected_digest}`",
        f"- Actual SHA-256: `{actual_digest}`",
        f"- Missing in actual: {len(missing)}",
        f"- Extra in actual: {len(extra)}",
        f"- Different definitions: {len(different)}",
        f"- Grants compared: {'yes' if args.include_grants else 'no'}",
        f"- schema_migrations compared: {'yes' if args.include_schema_migrations else 'no'}",
        "",
    ]
    lines.extend(render_gate_section(gate_errors))
    lines.extend(render_section("Missing In Actual", missing, args.max_details))
    lines.extend(render_section("Extra In Actual", extra, args.max_details))
    lines.extend(render_different_section(different, args.max_details))
    return "\n".join(lines).rstrip() + "\n"


def render_gate_section(errors: list[str]) -> list[str]:
    lines = ["## Export Gate", ""]
    if not errors:
        return lines + ["PASS.", ""]
    return lines + [*(f"- STOP: {error}" for error in errors), ""]


def render_section(title: str, differences: list[Difference], max_details: int) -> list[str]:
    lines = [f"## {title}", ""]
    if not differences:
        lines.extend(["None.", ""])
        return lines

    for diff in differences[:max_details]:
        item = diff.expected or diff.actual
        assert item is not None
        lines.append(f"- `{item.object_kind}` `{item.object_identity}`")
    if len(differences) > max_details:
        lines.append(f"- ... {len(differences) - max_details} more")
    lines.append("")
    return lines


def render_different_section(differences: list[Difference], max_details: int) -> list[str]:
    lines = ["## Different Definitions", ""]
    if not differences:
        lines.extend(["None.", ""])
        return lines

    for diff in differences[:max_details]:
        assert diff.expected is not None
        assert diff.actual is not None
        kind, identity = diff.key
        lines.extend([
            f"### `{kind}` `{identity}`",
            "",
            "Expected:",
            "",
            "```json",
            json.dumps(diff.expected.normalized_definition_value(), indent=2, sort_keys=True, ensure_ascii=False),
            "```",
            "",
            "Actual:",
            "",
            "```json",
            json.dumps(diff.actual.normalized_definition_value(), indent=2, sort_keys=True, ensure_ascii=False),
            "```",
            "",
        ])
    if len(differences) > max_details:
        lines.extend([f"... {len(differences) - max_details} more different definitions omitted.", ""])
    return lines


def main() -> int:
    args = parse_args()
    expected_export = load_inventory_export(Path(args.expected))
    actual_export = load_inventory_export(Path(args.actual))
    expected_items = filter_items(expected_export.items, args)
    actual_items = filter_items(actual_export.items, args)

    missing, extra, different = compare(expected_items, actual_items)
    expected_digest = inventory_digest(expected_items)
    actual_digest = inventory_digest(actual_items)
    gate_errors = validate_export_gate(
        args,
        expected_export,
        actual_export,
    )
    report = render_summary(
        args,
        len(expected_items),
        len(actual_items),
        expected_digest,
        actual_digest,
        missing,
        extra,
        different,
        gate_errors,
    )

    if args.output_md:
        output_path = Path(args.output_md)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(report, encoding="utf-8")

    sys.stdout.write(report)
    if gate_errors:
        return 2
    return 0 if not missing and not extra and not different else 1


if __name__ == "__main__":
    raise SystemExit(main())
