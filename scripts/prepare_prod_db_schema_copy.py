#!/usr/bin/env python3
"""Prepare a no-apply MangoRTS prod DB schema-copy manifest.

This script intentionally does not connect to or modify any database. It reads the
repo's canonical schema and migration files, then emits a manifest that separates
schema objects from table data so a prod DB copy can be reviewed before any apply.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable


TENANT_ROW_MARKERS = (
    "company_id",
    "user_id",
    "email",
    "node_id",
    "logic_gate_id",
    "project_id",
    "message_id",
    "invitation",
    "connection",
    "notification",
)

# Tables whose rows may be considered metadata, not customer/work data. This list
# is deliberately tiny; everything else needs a human review before copying.
METADATA_TABLE_ALLOWLIST = {"schema_migrations"}


@dataclass(frozen=True)
class SchemaManifest:
    schema_sha256: str
    migration_count: int
    latest_migration: str | None
    table_count: int
    index_count: int
    function_count: int
    trigger_count: int
    type_count: int
    insert_statement_count: int
    tables: list[str]
    metadata_row_tables: list[str]
    data_row_tables_excluded_by_default: list[str]
    migration_files: list[str]
    notes: list[str]


def repo_root_from_script() -> Path:
    return Path(__file__).resolve().parents[1]


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def stable_unique(items: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for item in items:
        clean = item.strip().strip('"').lower()
        if clean and clean not in seen:
            seen.add(clean)
            output.append(clean)
    return output


def object_names(pattern: str, sql: str) -> list[str]:
    return stable_unique(match.group(1) for match in re.finditer(pattern, sql, flags=re.IGNORECASE | re.MULTILINE))


def build_manifest(repo_root: Path) -> SchemaManifest:
    schema_path = repo_root / "backend" / "db" / "schema.sql"
    migrations_dir = repo_root / "backend" / "db" / "migrations"
    if not schema_path.exists():
        raise FileNotFoundError(f"missing canonical schema: {schema_path}")
    if not migrations_dir.exists():
        raise FileNotFoundError(f"missing migrations directory: {migrations_dir}")

    schema_sql = read_text(schema_path)
    migration_files = sorted(path.name for path in migrations_dir.glob("*.sql"))

    tables = object_names(r"create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z_][\w.]*)", schema_sql)
    indexes = object_names(r"create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?([a-zA-Z_][\w.]*)", schema_sql)
    functions = object_names(r"create\s+or\s+replace\s+function\s+([a-zA-Z_][\w.]*)", schema_sql)
    triggers = object_names(r"create\s+trigger\s+([a-zA-Z_][\w.]*)", schema_sql)
    types = object_names(r"create\s+type\s+([a-zA-Z_][\w.]*)", schema_sql)
    insert_statements = re.findall(r"\binsert\s+into\b", schema_sql, flags=re.IGNORECASE)

    metadata_tables = sorted(METADATA_TABLE_ALLOWLIST)
    excluded_tables = [table for table in tables if table not in METADATA_TABLE_ALLOWLIST]

    risky_metadata = [table for table in metadata_tables if any(marker in table for marker in TENANT_ROW_MARKERS)]
    if risky_metadata:
        raise ValueError(f"metadata allowlist contains tenant-looking tables: {risky_metadata}")

    notes = [
        "This manifest is prepare-only; it does not connect to dev or prod and does not apply SQL.",
        "Use backend/db/schema.sql as the canonical schema source unless a live dev pg_dump diff proves drift.",
        "Copy schema objects: tables, indexes, enum types, functions, triggers, constraints, and column defaults.",
        "Do not bulk-copy tenant/user/work rows from dev into prod.",
        "Do not copy company UUIDs from dev; prod company IDs must remain prod-specific.",
        "schema_migrations is metadata only; after a reviewed canonical-schema bootstrap it may be marked deliberately, not blindly imported from dev.",
        "Company-specific default folders, projections, permissions, and workspace versions should be generated against the prod company UUID by app/bootstrap logic or reviewed idempotent SQL, not dumped from dev rows.",
    ]

    return SchemaManifest(
        schema_sha256=hashlib.sha256(schema_sql.encode("utf-8")).hexdigest(),
        migration_count=len(migration_files),
        latest_migration=migration_files[-1] if migration_files else None,
        table_count=len(tables),
        index_count=len(indexes),
        function_count=len(functions),
        trigger_count=len(triggers),
        type_count=len(types),
        insert_statement_count=len(insert_statements),
        tables=tables,
        metadata_row_tables=metadata_tables,
        data_row_tables_excluded_by_default=excluded_tables,
        migration_files=migration_files,
        notes=notes,
    )


def render_markdown(manifest: SchemaManifest) -> str:
    excluded_preview = "\n".join(f"- `{table}`" for table in manifest.data_row_tables_excluded_by_default)
    migrations_preview = "\n".join(f"- `{name}`" for name in manifest.migration_files)
    notes = "\n".join(f"- {note}" for note in manifest.notes)
    return f"""# MangoRTS prod DB schema copy preparation manifest

This is a prepare-only manifest. It does not apply SQL to prod.

## Canonical schema summary

- Schema SHA-256: `{manifest.schema_sha256}`
- Tables: {manifest.table_count}
- Indexes: {manifest.index_count}
- Functions/procedures: {manifest.function_count}
- Triggers: {manifest.trigger_count}
- Enum/custom types: {manifest.type_count}
- Insert statements inside canonical schema: {manifest.insert_statement_count}
- Migration files: {manifest.migration_count}
- Latest migration: `{manifest.latest_migration}`

## Row-copy rule

Only these metadata tables are eligible for row-level handling by default:

{chr(10).join(f"- `{table}`" for table in manifest.metadata_row_tables) or "- None"}

All other tables are excluded from dev-to-prod row copying by default:

{excluded_preview}

## Notes

{notes}

## Migration manifest

{migrations_preview}
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare a no-apply prod DB schema-copy manifest.")
    parser.add_argument("--repo-root", default=str(repo_root_from_script()), help="MangoRTS repo root")
    parser.add_argument("--output-json", help="Optional path to write manifest JSON")
    parser.add_argument("--output-md", help="Optional path to write manifest Markdown")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    manifest = build_manifest(repo_root)

    if manifest.table_count == 0 or manifest.function_count == 0 or manifest.index_count == 0:
        raise RuntimeError("canonical schema manifest looks incomplete")

    if args.output_json:
        output_json = Path(args.output_json)
        output_json.parent.mkdir(parents=True, exist_ok=True)
        output_json.write_text(json.dumps(asdict(manifest), indent=2) + "\n", encoding="utf-8")
    if args.output_md:
        output_md = Path(args.output_md)
        output_md.parent.mkdir(parents=True, exist_ok=True)
        output_md.write_text(render_markdown(manifest), encoding="utf-8")

    print(json.dumps({
        "schema_sha256": manifest.schema_sha256,
        "tables": manifest.table_count,
        "indexes": manifest.index_count,
        "functions": manifest.function_count,
        "triggers": manifest.trigger_count,
        "types": manifest.type_count,
        "migrations": manifest.migration_count,
        "latest_migration": manifest.latest_migration,
        "metadata_row_tables": manifest.metadata_row_tables,
        "excluded_data_row_table_count": len(manifest.data_row_tables_excluded_by_default),
        "prepare_only": True,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
