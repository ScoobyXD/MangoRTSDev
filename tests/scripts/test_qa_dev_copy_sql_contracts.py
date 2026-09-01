from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ENTRYPOINT = ROOT / "scripts" / "qa_fargate_copy_entrypoint.sh"
COPY_DOCKERFILE = ROOT / "backend" / "Dockerfile.qa-copy"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class QADevCopyContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.entrypoint = read(ENTRYPOINT)
        cls.copy_dockerfile = read(COPY_DOCKERFILE)

    def test_obsolete_copy_programs_are_removed(self) -> None:
        for relative_path in (
            "scripts/qa_dev_copy_preflight.sql",
            "scripts/qa_dev_copy_sanitize.sql",
            "scripts/qa_dev_copy_verify.sql",
            "scripts/qa_run_data_copy_task.ps1",
            "scripts/test_qa_dev_copy_postgres.mjs",
            "tests/scripts/qa_run_data_copy_task_contract.ps1",
            "tests/scripts/qa_copy_aws_argv_probe.py",
        ):
            self.assertFalse((ROOT / relative_path).exists(), relative_path)

    def test_copy_image_contains_only_postgresql_and_the_entrypoint(self) -> None:
        self.assertIn("FROM postgres:17.11-bookworm", self.copy_dockerfile)
        self.assertIn("USER postgres", self.copy_dockerfile)
        self.assertIn('ENTRYPOINT ["/usr/local/bin/mangorts-qa-copy"]', self.copy_dockerfile)
        for forbidden in (
            "FROM golang",
            "miraeopus-migrate",
            "backend/db",
            "qa_dev_copy_preflight.sql",
            "qa_dev_copy_sanitize.sql",
            "qa_dev_copy_verify.sql",
        ):
            self.assertNotIn(forbidden, self.copy_dockerfile)

    def test_entrypoint_uses_only_injected_database_connections(self) -> None:
        for name in (
            "DEV_DB_HOST",
            "DEV_DB_PORT",
            "DEV_DB_NAME",
            "DEV_DB_USER",
            "DEV_DB_PASSWORD",
            "QA_DB_HOST",
            "QA_DB_PORT",
            "QA_DB_USER",
            "QA_DB_PASSWORD",
        ):
            self.assertIn(f"require_env {name}", self.entrypoint)
        self.assertIn("PGSSLMODE=require", self.entrypoint)
        self.assertIn("default_transaction_read_only=on", self.entrypoint)

    def test_copy_is_one_full_dump_then_create_then_full_restore(self) -> None:
        self.assertEqual(self.entrypoint.count("pg_dump \\"), 1)
        self.assertEqual(self.entrypoint.count("createdb \\"), 1)
        self.assertEqual(self.entrypoint.count("pg_restore \\"), 1)
        dump = self.entrypoint.index("pg_dump \\")
        create = self.entrypoint.index("createdb \\", dump)
        restore = self.entrypoint.index("pg_restore \\", create)
        self.assertLess(dump, create)
        self.assertLess(create, restore)

        dump_block = self.entrypoint[dump:create]
        self.assertIn("--format custom", dump_block)
        self.assertIn('--dbname "$DEV_DB_NAME"', dump_block)
        for forbidden in (
            "--data-only",
            "--schema-only",
            "--table",
            "--exclude",
            "--section",
            "--create",
            "--no-owner",
            "--no-privileges",
        ):
            self.assertNotIn(forbidden, dump_block)

        create_block = self.entrypoint[create:restore]
        self.assertIn("--maintenance-db postgres", create_block)
        self.assertIn("--template template0", create_block)
        self.assertIn('"$restored_database"', create_block)

        restore_block = self.entrypoint[restore:]
        for required in (
            "--single-transaction",
            "--exit-on-error",
            "--no-owner",
            "--no-privileges",
            '--dbname "$restored_database"',
        ):
            self.assertIn(required, restore_block)
        for forbidden in ("--data-only", "--schema-only", "--table", "--exclude", "--section"):
            self.assertNotIn(forbidden, restore_block)

    def test_target_is_fresh_timestamped_and_stable_qa_is_never_addressed(self) -> None:
        self.assertRegex(
            self.entrypoint,
            re.compile(r'readonly restored_database="mangorts_qa_copy_\$\(date -u \+%Y%m%d%H%M%S\)"'),
        )
        self.assertNotIn("QA_STABLE_DATABASE", self.entrypoint)
        self.assertNotRegex(self.entrypoint, r'mangorts_qa["\']')
        for forbidden in ("dropdb", "drop database", "alter database", "rename to"):
            self.assertNotIn(forbidden, self.entrypoint.lower())

    def test_copy_has_no_sanitizer_verification_identity_or_cutover_phase(self) -> None:
        for forbidden in (
            "sanitize",
            "verify",
            "checksum",
            "schema_inventory",
            "schema_migrations",
            "cognito",
            "jonat",
            "identity",
            "miraeopus-migrate",
            "cutover",
            "rollback",
            "snapshot",
            "smoke",
            "psql",
        ):
            self.assertNotIn(forbidden, self.entrypoint.lower())
        self.assertNotRegex(self.entrypoint, r"\b(?:for|while|until)\b")

    def test_success_reports_only_the_restored_database_name(self) -> None:
        self.assertEqual(self.entrypoint.count("QA_COPY_RESTORED_DATABASE="), 1)
        self.assertIn(
            "printf 'QA_COPY_RESTORED_DATABASE=%s\\n' \"$restored_database\"",
            self.entrypoint,
        )


if __name__ == "__main__":
    unittest.main()
