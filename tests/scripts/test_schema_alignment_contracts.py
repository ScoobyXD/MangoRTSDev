from __future__ import annotations

import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


class SchemaAlignmentContractTests(unittest.TestCase):
    def test_qa_reconciliation_is_runner_transactional_and_fail_closed(self) -> None:
        migration = (
            REPO_ROOT
            / "backend"
            / "db"
            / "migrations"
            / "20260825_canonical_schema_reconciliation.sql"
        ).read_text(encoding="utf-8")
        lowered = migration.lower()

        self.assertNotRegex(lowered, r"(?m)^\s*(begin|commit)\s*;")
        self.assertNotRegex(lowered, r"drop\s+[^;]+\s+cascade\s*;")
        self.assertIn("set local lock_timeout", lowered)
        self.assertIn("set local statement_timeout", lowered)
        self.assertIn("server_version_num", lowered)
        self.assertIn("present_count not in (0, cardinality(retired_tables))", lowered)
        self.assertIn("contains rows", lowered)

        retired_tables = (
            "company_user_group_closure",
            "resource_gvic_assignments_step2_legacy",
            "resource_gvic_effective_assignments",
            "resource_gvic_policy_revisions",
            "resource_gvic_subtree_applications",
            "resource_permission_policy_revisions",
            "resource_permission_subtree_applications",
            "resource_permissions_step2_legacy",
        )
        for table in retired_tables:
            self.assertIn(f"drop table if exists public.{table};", lowered)

        for trigger in (
            "trg_logic_gate_work_version_gvic",
            "trg_logic_gate_work_version_permissions",
        ):
            self.assertIn(f"create trigger {trigger}", lowered)
        self.assertIn("communications_message_read_receipt_summaries_scope_chk", lowered)

    def test_dev_operator_scripts_are_plain_guarded_postgresql(self) -> None:
        preflight = (REPO_ROOT / "scripts" / "dev_canonical_schema_alignment_preflight.sql").read_text(
            encoding="utf-8"
        )
        write = (REPO_ROOT / "scripts" / "dev_canonical_schema_alignment.sql").read_text(
            encoding="utf-8"
        )
        verification = (
            REPO_ROOT / "scripts" / "dev_canonical_schema_alignment_verification.sql"
        ).read_text(encoding="utf-8")

        for read_only in (preflight, verification):
            lowered = read_only.lower()
            self.assertIn("begin transaction isolation level repeatable read read only;", lowered)
            self.assertIn("server_version_num", lowered)
            self.assertIn("miraertsdevdatabase", lowered)
            self.assertIn("exact_unordered_column", lowered)
            self.assertTrue(lowered.rstrip().endswith("rollback;"))
            self.assertNotRegex(read_only, r"(?m)^\s*\\")

        lowered_write = write.lower()
        self.assertTrue(lowered_write.lstrip().startswith("-- one-time"))
        self.assertRegex(lowered_write, r"(?m)^begin;$")
        self.assertTrue(lowered_write.rstrip().endswith("commit;"))
        self.assertIn("current_database() <> 'miraertsdevdatabase'", lowered_write)
        self.assertIn("server_version_num", lowered_write)
        self.assertIn("lock_timeout", lowered_write)
        self.assertIn("email_drafts_company_id_fkey", lowered_write)
        self.assertIn("mangorts_validate_attachment_relationship_owner", lowered_write)
        self.assertIn("trg_logic_gate_work_version_gvic", lowered_write)
        self.assertIn("trg_logic_gate_work_version_permissions", lowered_write)
        self.assertNotIn("schema_migrations", lowered_write)
        self.assertNotRegex(lowered_write, r"drop\s+[^;]+\s+cascade\s*;")
        self.assertNotRegex(write, r"(?m)^\s*\\")

    def test_generated_schema_is_pinned_to_lf(self) -> None:
        attributes = (REPO_ROOT / ".gitattributes").read_text(encoding="utf-8")
        self.assertIn("backend/db/schema.sql text eol=lf", attributes)


if __name__ == "__main__":
    unittest.main()
