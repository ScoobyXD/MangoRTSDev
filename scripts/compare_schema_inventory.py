#!/usr/bin/env python3
"""Compare two MangoRTS PostgreSQL schema inventory exports.

The inventory exports should be produced by backend/db/schema_inventory.sql.
The script is offline: it does not connect to any database.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
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

    def normalized_definition(self) -> str:
        return json.dumps(self.definition, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


@dataclass(frozen=True)
class Difference:
    key: tuple[str, str]
    expected: InventoryItem | None
    actual: InventoryItem | None


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
    return parser.parse_args()


def load_inventory(path: Path) -> list[InventoryItem]:
    raw = path.read_text(encoding="utf-8-sig").strip()
    if not raw:
        raise ValueError(f"{path} is empty")

    data = parse_json_export(raw)
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
    return items


def parse_json_export(raw: str) -> Any:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return parse_json_lines_export(raw)
    return unwrap_inventory_export(parsed)


def parse_json_lines_export(raw: str) -> Any:
    rows = [json.loads(line) for line in raw.splitlines() if line.strip()]
    return unwrap_inventory_export(rows)


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
    missing: list[Difference],
    extra: list[Difference],
    different: list[Difference],
) -> str:
    status = "PASS" if not missing and not extra and not different else "FAIL"
    lines = [
        "# Schema Inventory Diff",
        "",
        f"- Status: {status}",
        f"- Expected inventory: `{args.expected_label}` ({expected_count} compared objects)",
        f"- Actual inventory: `{args.actual_label}` ({actual_count} compared objects)",
        f"- Missing in actual: {len(missing)}",
        f"- Extra in actual: {len(extra)}",
        f"- Different definitions: {len(different)}",
        f"- Grants compared: {'yes' if args.include_grants else 'no'}",
        f"- schema_migrations compared: {'yes' if args.include_schema_migrations else 'no'}",
        "",
    ]
    lines.extend(render_section("Missing In Actual", missing, args.max_details))
    lines.extend(render_section("Extra In Actual", extra, args.max_details))
    lines.extend(render_different_section(different, args.max_details))
    return "\n".join(lines).rstrip() + "\n"


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
            json.dumps(diff.expected.definition, indent=2, sort_keys=True, ensure_ascii=False),
            "```",
            "",
            "Actual:",
            "",
            "```json",
            json.dumps(diff.actual.definition, indent=2, sort_keys=True, ensure_ascii=False),
            "```",
            "",
        ])
    if len(differences) > max_details:
        lines.extend([f"... {len(differences) - max_details} more different definitions omitted.", ""])
    return lines


def main() -> int:
    args = parse_args()
    expected_items = filter_items(load_inventory(Path(args.expected)), args)
    actual_items = filter_items(load_inventory(Path(args.actual)), args)

    missing, extra, different = compare(expected_items, actual_items)
    report = render_summary(args, len(expected_items), len(actual_items), missing, extra, different)

    if args.output_md:
        output_path = Path(args.output_md)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(report, encoding="utf-8")

    sys.stdout.write(report)
    return 0 if not missing and not extra and not different else 1


if __name__ == "__main__":
    raise SystemExit(main())
