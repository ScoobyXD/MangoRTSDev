from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = REPO_ROOT / "scripts" / "compare_schema_inventory.py"
SPEC = importlib.util.spec_from_file_location("compare_schema_inventory", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
compare_schema_inventory = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = compare_schema_inventory
SPEC.loader.exec_module(compare_schema_inventory)
PACKAGER_PATH = REPO_ROOT / "scripts" / "package_schema_inventory_export.py"
PACKAGER_SPEC = importlib.util.spec_from_file_location("package_schema_inventory_export", PACKAGER_PATH)
assert PACKAGER_SPEC is not None and PACKAGER_SPEC.loader is not None
package_schema_inventory_export = importlib.util.module_from_spec(PACKAGER_SPEC)
PACKAGER_SPEC.loader.exec_module(package_schema_inventory_export)


def item(
    name: str,
    data_type: str = "text",
    ordinal_position: int | None = None,
    not_null: bool = False,
) -> object:
    definition = {"column": name, "data_type": data_type, "not_null": not_null}
    if ordinal_position is not None:
        definition["ordinal_position"] = ordinal_position
    return compare_schema_inventory.InventoryItem(
        "column",
        f"public.widgets.{name}",
        definition,
    )


def gate_args() -> argparse.Namespace:
    return argparse.Namespace(
        require_postgres_major=17,
        require_same_commit=True,
        require_current_repository=False,
        max_export_age_hours=24,
        expected_label="dev",
        actual_label="qa",
        repo_root=str(REPO_ROOT),
        require_expected_environment=None,
        require_actual_environment=None,
    )


class SchemaInventoryComparatorTests(unittest.TestCase):
    def test_reordered_columns_compare_and_hash_equal(self) -> None:
        expected = [
            item("alpha", ordinal_position=1, not_null=True),
            item("beta", "integer", 2),
        ]
        actual = [
            item("beta", "integer", 1),
            item("alpha", ordinal_position=2, not_null=True),
        ]

        missing, extra, different = compare_schema_inventory.compare(expected, actual)

        self.assertEqual((missing, extra, different), ([], [], []))
        self.assertEqual(
            compare_schema_inventory.inventory_digest(expected),
            compare_schema_inventory.inventory_digest(actual),
        )
        self.assertEqual(
            compare_schema_inventory.inventory_digest(expected),
            "8e204427be93f462587cec286a2d73c0e21bece1957fdec2a6960e824185c5c2",
        )

    def test_missing_and_extra_columns_fail(self) -> None:
        expected = [item("alpha"), item("beta", "integer")]

        missing, extra, different = compare_schema_inventory.compare(expected, [item("alpha")])
        self.assertEqual([diff.key for diff in missing], [("column", "public.widgets.beta")])
        self.assertEqual(extra, [])
        self.assertEqual(different, [])

        missing, extra, different = compare_schema_inventory.compare(
            expected,
            [*expected, item("gamma", "boolean")],
        )
        self.assertEqual(missing, [])
        self.assertEqual([diff.key for diff in extra], [("column", "public.widgets.gamma")])
        self.assertEqual(different, [])

    def test_catalog_query_does_not_export_physical_column_order(self) -> None:
        query = (REPO_ROOT / "backend" / "db" / "schema_inventory.sql").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("ordinal_position", query.lower())

    def test_function_line_endings_compare_and_hash_equal(self) -> None:
        definition = {
            "schema": "public",
            "name": "touch_widget",
            "definition": "CREATE FUNCTION public.touch_widget()\r\n RETURNS trigger\rAS $$\r\nBEGIN\r\nEND;\r\n$$;\r\n",
        }
        expected = compare_schema_inventory.InventoryItem(
            "function", "public.touch_widget()", definition
        )
        actual = compare_schema_inventory.InventoryItem(
            "function",
            "public.touch_widget()",
            {
                **definition,
                "definition": definition["definition"]
                .replace("\r\n", "\n")
                .replace("\r", "\n"),
            },
        )

        self.assertEqual(
            compare_schema_inventory.compare([expected], [actual]),
            ([], [], []),
        )
        self.assertEqual(expected.normalized_definition(), actual.normalized_definition())
        self.assertEqual(
            compare_schema_inventory.inventory_digest([expected]),
            compare_schema_inventory.inventory_digest([actual]),
        )

    def test_catalog_query_normalizes_function_line_endings(self) -> None:
        query = (REPO_ROOT / "backend" / "db" / "schema_inventory.sql").read_text(
            encoding="utf-8"
        )
        self.assertIn("replace(pg_get_functiondef(proc.oid), E'\\r\\n', E'\\n')", query)
        self.assertIn("E'\\r',\n        E'\\n'", query)

    def test_gate_rejects_unstamped_historical_arrays(self) -> None:
        exports = compare_schema_inventory.InventoryExport([item("alpha")], {})
        errors = compare_schema_inventory.validate_export_gate(
            gate_args(),
            exports,
            exports,
        )
        self.assertTrue(any("metadata is missing" in error for error in errors))

    def test_gate_accepts_fresh_same_commit_exports(self) -> None:
        items = [item("alpha"), item("beta", "integer")]
        digest = compare_schema_inventory.inventory_digest(items)
        metadata = {
            "environment": "dev",
            "exported_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "git_commit": "0123456789abcdef",
            "repository_schema_sha256": "a" * 64,
            "schema_inventory_sha256": digest,
            "server_version_num": 170007,
        }
        export = compare_schema_inventory.InventoryExport(items, metadata)

        errors = compare_schema_inventory.validate_export_gate(gate_args(), export, export)

        self.assertEqual(errors, [])

    def test_gate_rejects_stale_export(self) -> None:
        items = [item("alpha")]
        metadata = {
            "environment": "dev",
            "exported_at_utc": (
                datetime.now(timezone.utc) - timedelta(days=2)
            ).isoformat().replace("+00:00", "Z"),
            "git_commit": "0123456789abcdef",
            "repository_schema_sha256": "a" * 64,
            "schema_inventory_sha256": compare_schema_inventory.inventory_digest(items),
            "server_version_num": 170007,
        }
        export = compare_schema_inventory.InventoryExport(items, metadata)

        errors = compare_schema_inventory.validate_export_gate(gate_args(), export, export)

        self.assertTrue(any("older than 24 hours" in error for error in errors))

    def test_gate_rejects_wrong_environment_label(self) -> None:
        items = [item("alpha")]
        metadata = {
            "environment": "qa",
            "exported_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "git_commit": "0123456789abcdef",
            "repository_schema_sha256": "a" * 64,
            "schema_inventory_sha256": compare_schema_inventory.inventory_digest(items),
            "server_version_num": 170007,
        }
        export = compare_schema_inventory.InventoryExport(items, metadata)
        args = gate_args()
        args.require_expected_environment = "dev"
        args.require_actual_environment = "dev"

        errors = compare_schema_inventory.validate_export_gate(args, export, export)

        self.assertTrue(any("expected 'dev'" in error for error in errors))

    def test_envelope_loader_preserves_metadata(self) -> None:
        raw = json.dumps(
            {
                "metadata": {"environment": "qa"},
                "schema_inventory": [
                    {
                        "object_kind": "column",
                        "object_identity": "public.widgets.alpha",
                        "definition": {"column": "alpha"},
                    }
                ],
            }
        )
        with mock.patch.object(Path, "read_text", return_value=raw):
            export = compare_schema_inventory.load_inventory_export(Path("unused.json"))

        self.assertEqual(export.metadata["environment"], "qa")
        self.assertEqual(export.items[0].object_identity, "public.widgets.alpha")

    def test_packager_builds_complete_metadata_without_manual_wrapper(self) -> None:
        items = [item("alpha")]

        envelope = package_schema_inventory_export.build_envelope(
            items,
            "dev",
            "mangorts_dev",
            "mangorts_readonly",
            "17.7",
            170007,
            REPO_ROOT,
        )

        metadata = envelope["metadata"]
        self.assertEqual(metadata["environment"], "dev")
        self.assertEqual(metadata["server_version_num"], 170007)
        self.assertEqual(metadata["schema_inventory_objects"], 1)
        self.assertEqual(
            metadata["schema_inventory_sha256"],
            compare_schema_inventory.inventory_digest(items),
        )
        self.assertRegex(metadata["repository_schema_sha256"], r"^[0-9a-f]{64}$")
        self.assertRegex(metadata["git_commit"], r"^[0-9a-f]{40}$")
        export = compare_schema_inventory.InventoryExport(items, metadata)
        args = gate_args()
        args.require_current_repository = True
        self.assertEqual(
            compare_schema_inventory.validate_export_gate(args, export, export),
            [],
        )

    def test_qa_bootstrap_uses_atomic_empty_and_commit_bound_image_guards(self) -> None:
        script = (REPO_ROOT / "scripts" / "qa_run_database_task.ps1").read_text(
            encoding="utf-8"
        )

        self.assertIn(
            '@("-mode", "schema", "-baseline-migrations", "-require-empty-database")',
            script,
        )
        self.assertIn("ExpectedGitCommit", script)
        self.assertIn("$ExpectedGitCommit-migrations", script)
        self.assertIn("DatabaseNameOverride", script)
        self.assertIn("^mangorts_qa_next_[0-9]{14}$", script)
        self.assertIn("ExpectedDatabaseName", script)
        self.assertIn('name  = "DB_NAME"', script)
        self.assertIn('"--network-configuration", "file://$networkConfigurationPath"', script)
        self.assertIn('"--overrides", "file://$overridesPath"', script)
        self.assertIn("[Text.UTF8Encoding]::new($false)", script)
        self.assertIn("Remove-Item -LiteralPath $networkConfigurationPath", script)
        self.assertIn("Remove-Item -LiteralPath $overridesPath", script)

    def test_qa_database_helper_has_no_stale_reconciliation_write_path(self) -> None:
        script = (REPO_ROOT / "scripts" / "qa_run_database_task.ps1").read_text(
            encoding="utf-8"
        )

        self.assertIn('[ValidateSet("Audit", "Bootstrap")]', script)
        self.assertIn('[ValidateSet("EmptyPreflight", "Parity")]', script)
        self.assertNotIn("Reconcile", script)
        self.assertNotIn("-mode\", \"migrate", script)
        self.assertNotIn("missing_from_ledger=1", script)

    def test_generated_schema_audit_outputs_are_ignored(self) -> None:
        ignore = (REPO_ROOT / ".gitignore").read_text(encoding="utf-8")
        self.assertIn("tmp/schema-audit-*-fresh.json", ignore)
        self.assertIn("tmp/schema-audit-*-report.md", ignore)
        self.assertIn("__pycache__/", ignore)


if __name__ == "__main__":
    unittest.main()
