#!/usr/bin/env python3
"""Stamp a read-only schema inventory with freshness and repository metadata."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from compare_schema_inventory import (
    current_git_commit,
    default_filtered_items,
    inventory_digest,
    load_inventory,
    repository_schema_fingerprint,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inventory", required=True, help="Raw schema_inventory.sql JSON output")
    parser.add_argument("--output", required=True, help="Stamped JSON envelope path")
    parser.add_argument("--environment", required=True, help="Source environment label")
    parser.add_argument("--database", required=True, help="Connected database name")
    parser.add_argument("--user", required=True, help="Connected database user")
    parser.add_argument("--server-version", required=True, help="Readable PostgreSQL version")
    parser.add_argument("--server-version-num", required=True, type=int)
    parser.add_argument(
        "--repo-root",
        default=str(Path(__file__).resolve().parents[1]),
        help="MangoRTS repository root",
    )
    return parser.parse_args()


def build_envelope(
    inventory_items: list[Any],
    environment: str,
    database: str,
    user: str,
    server_version: str,
    server_version_num: int,
    repo_root: Path,
) -> dict[str, Any]:
    compared_items = default_filtered_items(inventory_items)
    rows = [
        {
            "object_kind": item.object_kind,
            "object_identity": item.object_identity,
            "definition": item.definition,
        }
        for item in inventory_items
    ]
    return {
        "metadata": {
            "environment": environment,
            "exported_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "git_commit": current_git_commit(repo_root),
            "repository_schema_sha256": repository_schema_fingerprint(repo_root),
            "schema_inventory_sha256": inventory_digest(compared_items),
            "schema_inventory_objects": len(compared_items),
            "server_version": server_version,
            "server_version_num": server_version_num,
            "database": database,
            "user": user,
            "default_exclusions": {
                "object_kinds": ["grant"],
                "identity_contains": ["schema_migrations"],
            },
        },
        "schema_inventory": rows,
    }


def main() -> int:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    inventory_items = load_inventory(Path(args.inventory))
    envelope = build_envelope(
        inventory_items,
        args.environment,
        args.database,
        args.user,
        args.server_version,
        args.server_version_num,
        repo_root,
    )
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = output_path.with_suffix(output_path.suffix + ".tmp")
    temporary_path.write_text(
        json.dumps(envelope, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    temporary_path.replace(output_path)
    print(f"Wrote stamped schema inventory: {output_path}")
    print(f"Compared objects: {envelope['metadata']['schema_inventory_objects']}")
    print(f"Schema inventory SHA-256: {envelope['metadata']['schema_inventory_sha256']}")
    print(f"Repository schema SHA-256: {envelope['metadata']['repository_schema_sha256']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
