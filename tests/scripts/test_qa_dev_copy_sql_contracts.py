from __future__ import annotations

import os
import re
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PREFLIGHT = ROOT / "scripts" / "qa_dev_copy_preflight.sql"
SANITIZER = ROOT / "scripts" / "qa_dev_copy_sanitize.sql"
VERIFY = ROOT / "scripts" / "qa_dev_copy_verify.sql"
RUNBOOK = ROOT / "docs" / "infra" / "mangorts-qa-environment-runbook.md"

ROOT_NAMES = (
    "sidebar huddles private",
    "tk",
    "finance 1",
    "finance 1.5",
    "finance 2",
    "hr 1",
    "hr 1.5",
    "hr 2",
    "legal",
    "fo",
)


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8").lower()


class QADevCopySQLContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.preflight = read(PREFLIGHT)
        cls.sanitizer = read(SANITIZER)
        cls.verify = read(VERIFY)
        cls.runbook = read(RUNBOOK)

    def test_scripts_are_plain_postgresql_not_psql_templates(self) -> None:
        for path, sql in (
            (PREFLIGHT, self.preflight),
            (SANITIZER, self.sanitizer),
            (VERIFY, self.verify),
        ):
            with self.subTest(path=path.name):
                self.assertNotRegex(sql, r"(?m)^\s*\\(?:set|copy|i|echo)\b")
                self.assertNotRegex(sql.replace("[:space:]", ""), r"(?<!:):[a-z_][a-z0-9_]*")

    def test_all_scripts_require_postgresql_17(self) -> None:
        for path, sql in (
            (PREFLIGHT, self.preflight),
            (SANITIZER, self.sanitizer),
            (VERIFY, self.verify),
        ):
            with self.subTest(path=path.name):
                self.assertIn("server_version_num", sql)
                self.assertIn("170000", sql)
                self.assertIn("180000", sql)

    def test_preflight_and_sanitizer_are_raw_database_only(self) -> None:
        raw_guard = "^mangorts_qa_raw_[0-9]{8}(_[a-z0-9]+)*$"
        self.assertIn(raw_guard, self.preflight)
        self.assertIn(raw_guard, self.sanitizer)
        self.assertIn("lower(current_database()) ~ '(dev|prod)'", self.preflight)
        self.assertIn("lower(current_database()) ~ '(dev|prod)'", self.sanitizer)

    def test_preflight_pins_the_audited_empty_base_entity_source(self) -> None:
        self.assertIn("raw qa source is not the audited empty base entity schema", self.preflight)
        self.assertIn("select * from expected except select * from actual", self.preflight)
        self.assertIn("select * from actual except select * from expected", self.preflight)
        for retired_or_not_yet_applied_table in (
            "action_item_huddle_relationships",
            "entity_relationships",
        ):
            self.assertIn(
                f"to_regclass('public.{retired_or_not_yet_applied_table}') is not null",
                self.preflight,
            )
        self.assertIn("select count(*) from public.entities", self.preflight)
        self.assertIn("'20260827_entities.sql'", self.preflight)
        self.assertIn("'20260828_action_items.sql'", self.preflight)
        self.assertIn("'20260828_entity_relationships.sql'", self.preflight)
        self.assertNotIn(
            "to_regclass('public.action_item_huddle_relationships') is null",
            self.sanitizer,
        )

    def test_runbook_bridges_raw_entity_schema_before_verification_and_export(self) -> None:
        sanitizer = self.runbook.index("qa_dev_copy_sanitize.sql")
        action_items = self.runbook.index("20260828_action_items.sql")
        entity_relationships = self.runbook.index("20260828_entity_relationships.sql")
        verifier = self.runbook.index("qa_dev_copy_verify.sql", sanitizer)
        export = self.runbook.index("--data-only", verifier)
        self.assertLess(sanitizer, action_items)
        self.assertLess(action_items, entity_relationships)
        self.assertLess(entity_relationships, verifier)
        self.assertLess(verifier, export)
        self.assertIn("-auditpurpose canonicalbaseline", self.runbook)
        self.assertIn("canonical_schema_inventory_sha256=", self.runbook)

    def test_verify_allows_only_guarded_qa_database_names(self) -> None:
        self.assertIn("mangorts_qa_raw_[0-9]{8}", self.verify)
        self.assertIn("mangorts_qa_next_[0-9]{14}", self.verify)
        self.assertIn("|mangorts_qa)$", self.verify)
        self.assertIn("lower(current_database()) ~ '(dev|prod)'", self.verify)

    def test_preflight_and_verify_are_explicitly_read_only(self) -> None:
        for path, sql in ((PREFLIGHT, self.preflight), (VERIFY, self.verify)):
            with self.subTest(path=path.name):
                self.assertIn("transaction isolation level repeatable read read only", sql)
                self.assertIn("transaction_read_only", sql)
                for mutation in (
                    "delete from public.",
                    "update public.",
                    "insert into public.",
                    "truncate ",
                    "alter table ",
                    "drop table ",
                ):
                    self.assertNotIn(mutation, sql)

    def test_all_excluded_root_names_are_built_into_each_script(self) -> None:
        for root_name in ROOT_NAMES:
            for path, sql in (
                (PREFLIGHT, self.preflight),
                (SANITIZER, self.sanitizer),
                (VERIFY, self.verify),
            ):
                with self.subTest(path=path.name, root_name=root_name):
                    self.assertIn(f"'{root_name}'", sql)

    def test_sanitizer_uses_recursive_both_explorer_ownership_closure(self) -> None:
        required_fragments = (
            "with recursive",
            "company_explorer_folder",
            "huddle_explorer_folder",
            "resource_huddle_resource_id",
            "from public.node_logic_gate_assignments",
            "from public.huddle_nodes",
            "from public.kpis",
            "from public.scorecards",
            "qa_excluded_resources",
        )
        for fragment in required_fragments:
            self.assertIn(fragment, self.sanitizer)

        for sql in (self.preflight, self.sanitizer):
            edges = sql.split("), edges(", 1)[1].split("), excluded_resources", 1)[0]
            for non_owning_relationship in (
                "from public.project_relationships",
                "from public.node_relationships",
                "from public.huddle_logic_gate_relationships",
                "from public.huddle_node_logic_gate_relationships",
                "from public.resource_operational_relationships",
            ):
                with self.subTest(non_owning_relationship=non_owning_relationship):
                    self.assertNotIn(non_owning_relationship, edges)

    def test_entity_link_cleanup_matches_exact_company_type_and_id(self) -> None:
        self.assertIn("qa_clean_imported_json(p_company_id uuid, p_input jsonb)", self.sanitizer)
        for endpoint in (
            "endpoint.company_id = p_company_id",
            "endpoint.node_id::text = linked_id",
            "endpoint.project_id::text = linked_id",
            "endpoint.logic_gate_id::text = linked_id",
            "endpoint.entity_id::text = linked_id",
            "message.company_id = p_company_id",
            "message.email_message_id::text = linked_id",
        ):
            self.assertIn(endpoint, self.sanitizer)
        self.assertIn("p_input ->> 'entity_type'", self.sanitizer)
        self.assertIn("p_input ->> 'entity_id'", self.sanitizer)
        self.assertIn("linked_thread_id is null or message.email_thread_id::text = linked_thread_id", self.sanitizer)
        self.assertIn("qa_clean_imported_json(company_id, body_json)", self.sanitizer)
        self.assertIn("qa_clean_imported_json(company_id, entity_links)", self.sanitizer)
        self.assertIn("update public.entities", self.sanitizer)
        self.assertIn("update public.entity_fields field", self.sanitizer)
        self.assertIn("membership.company_id = field.company_id", self.sanitizer)
        self.assertNotIn("public.entity_field_assignments", self.sanitizer)

    def test_inline_email_references_participate_in_thread_retention(self) -> None:
        self.assertIn("qa_imported_email_links", self.sanitizer)
        self.assertIn("owner_resource_type", self.sanitizer)
        self.assertIn("owner_resource_id", self.sanitizer)
        self.assertIn("source_kind = 'chat'", self.sanitizer)
        self.assertIn("link.email_thread_id = message.email_thread_id::text", self.sanitizer)
        self.assertIn("join qa_excluded_resources excluded", self.sanitizer)
        self.assertIn("not exists (\n    select 1 from qa_excluded_email_threads", self.sanitizer)

    def test_ownership_edges_detach_before_excluded_policy_rows_are_removed(self) -> None:
        policy_delete = self.sanitizer.index("delete from public.resource_gvic_settings")
        self.assertLess(self.sanitizer.index("delete from public.company_explorer_items"), policy_delete)
        self.assertLess(self.sanitizer.index("delete from public.huddle_explorer_items"), policy_delete)
        self.assertLess(self.sanitizer.index("delete from public.node_logic_gate_assignments"), policy_delete)

    def test_sanitizer_omits_all_attachment_database_state(self) -> None:
        for table in (
            "attachment_upload_parts",
            "attachment_upload_jobs",
            "attachment_relationships",
            "attachment_previews",
            "attachments",
        ):
            self.assertRegex(self.sanitizer, rf"delete from public\.{table}\s*;")
            self.assertIn(f"public.{table}", self.verify)
        self.assertIn("qa_clean_imported_json", self.sanitizer)
        self.assertIn("mangoattachmentimage", self.sanitizer)
        self.assertIn("attachment_metadata = '[]'::jsonb", self.sanitizer)
        self.assertIn("folder_id_snapshot = '[]'::jsonb", self.sanitizer)

    def test_sanitizer_disables_imported_identity_and_provider_state(self) -> None:
        self.assertIn("cognito_subject = 'qa-disabled:' || user_id::text", self.sanitizer)
        self.assertIn("grant_id = 'qa-disabled:' || email_connection_id::text", self.sanitizer)
        self.assertIn("status = 'configuration_required'", self.sanitizer)
        self.assertIn("provider_thread_key = 'qa-copy-thread:' || email_thread_id::text", self.sanitizer)
        self.assertIn("provider_message_id = 'qa-copy-message:' || email_message_id::text", self.sanitizer)
        for table in (
            "auth_external_identity_deletions",
            "invitations",
            "email_ingestion_jobs",
            "communications_email_archive_job_items",
            "communications_email_archive_jobs",
            "communications_message_read_receipt_signals",
            "communications_message_read_receipt_summaries",
            "communications_triage_items",
            "email_drafts",
            "email_signatures",
            "notifications",
            "realtime_outbox",
            "domain_events",
            "recycle_bin_items",
        ):
            self.assertIn(f"delete from public.{table};", self.sanitizer)

    def test_sanitizer_preserves_repository_migration_ownership(self) -> None:
        self.assertIn("delete from public.schema_migrations", self.sanitizer)
        self.assertNotIn("migration_count <> 227", self.verify)
        self.assertIn("migration_count = 0", self.verify)
        self.assertIn("migration_count <> 0", self.verify)

    def test_verify_allows_only_jonat_binding_outside_raw_scratch(self) -> None:
        self.assertIn("current_database() ~ '^mangorts_qa_raw_' and non_inert_user_count <> 0", self.verify)
        self.assertIn("current_database() !~ '^mangorts_qa_raw_'", self.verify)
        self.assertIn("lower(btrim(email)) <> 'jonathankim829@gmail.com'", self.verify)

    def test_verify_anti_joins_real_rows_for_every_public_foreign_key(self) -> None:
        for fragment in (
            "unnest(constraint_row.conkey, constraint_row.confkey)",
            "child_namespace.nspname = 'public'",
            "parent.%i = child.%i",
            "execute format(",
            "foreign_key_has_orphan",
            "foreign_key_count = 0",
            "has orphaned child data",
        ):
            self.assertIn(fragment, self.verify)

    def test_verify_checks_generic_typed_references_and_principals(self) -> None:
        for table in (
            "public.resource_gvic_assignments",
            "public.resource_gvic_settings",
            "public.resource_permissions",
            "public.resource_permission_settings",
            "public.pins",
            "public.process_map_placements",
            "public.resource_operational_relationships",
        ):
            self.assertIn(table, self.verify)
        for endpoint in (
            "public.nodes endpoint",
            "public.logic_gates endpoint",
            "public.projects endpoint",
            "public.company_explorer_folders endpoint",
            "public.shared_inbox_folders endpoint",
            "public.shared_inboxes endpoint",
            "public.huddle_logic_gates endpoint",
            "public.huddle_nodes endpoint",
            "public.email_messages endpoint",
            "public.entities endpoint",
        ):
            self.assertIn(endpoint, self.verify)
        self.assertIn("generic permission/gvic principal", self.verify)

    def test_verify_checks_current_entity_and_action_item_relationships(self) -> None:
        for fragment in (
            "from public.entity_fields field",
            "field.field_type = 'person'",
            "from public.company_memberships membership",
            "entity person field has no exact same-company membership",
            "from public.entity_relationships relationship",
            "left join public.huddle_nodes huddle_node",
            "entity relationship has a missing entity or unsupported or missing exact resource",
            "a company is missing its exact required action item entity type",
            "a company is missing an exact required action item field template",
            "an action item entity is missing a required linked field",
            "person_in_charge",
            "analysis_due_date",
            "completion_due_date",
            "in_progress",
            "pending",
            "done",
            "yellow",
            "red",
        ):
            self.assertIn(fragment, self.verify)
        self.assertIn("select company_id, 'editor', body_json from public.entities", self.verify)
        self.assertIn("select company_id, 'entity', entity_id, 'editor', body_json", self.sanitizer)
        self.assertIn("select * from expected except select * from actual", self.verify)
        self.assertIn("select * from actual except select * from expected", self.verify)

    def test_verify_recursively_checks_tiptap_and_chat_entity_links(self) -> None:
        for fragment in (
            "with recursive",
            "imported_json_sources",
            "imported_json_walk",
            "mangoentitylink",
            "walk.object_value ->> 'entity_type'",
            "walk.object_value ->> 'entity_id'",
            "link.source_kind = 'editor'",
            "message.company_id = link.company_id",
            "message.email_message_id::text = link.entity_id",
            "retained tiptap/chat entity link",
        ):
            self.assertIn(fragment, self.verify)

    def test_sanitizer_and_verify_report_surviving_company_ids(self) -> None:
        for path, sql in ((SANITIZER, self.sanitizer), (VERIFY, self.verify)):
            with self.subTest(path=path.name):
                self.assertIn("company.company_id", sql)
                self.assertIn("membership_count", sql)
                self.assertIn("project_count", sql)
                self.assertIn("logic_gate_count", sql)
                self.assertIn("node_count", sql)
                self.assertIn("not exists (select 1 from public.companies)", sql)

    def test_allowed_hot_read_projections_and_versions_are_preserved(self) -> None:
        for table in (
            "kanban_board_projection",
            "project_relationship_projection",
            "project_management_timeline_projection",
            "node_view_user_versions",
            "node_view_versions",
            "logic_gate_work_versions",
        ):
            self.assertNotIn(f"delete from public.{table};", self.sanitizer)

    def test_sanitizer_is_one_transaction_with_commit_time_stops(self) -> None:
        self.assertIsNotNone(re.search(r"\bbegin;.*\bcommit;\s*\Z", self.sanitizer, re.DOTALL))
        self.assertIn("$verify_before_commit$", self.sanitizer)
        self.assertGreaterEqual(self.sanitizer.count("raise exception 'stop:"), 8)

class QADevCopyPostgresIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.dsn = os.environ.get("MANGORTS_QA_COPY_TEST_DSN", "").strip()
        if not cls.dsn:
            raise unittest.SkipTest("set MANGORTS_QA_COPY_TEST_DSN for the disposable PostgreSQL integration")
        cls.psql = os.environ.get("MANGORTS_QA_COPY_TEST_PSQL", "psql").strip()

    def run_sql(self, sql: str) -> str:
        completed = subprocess.run(
            [
                self.psql,
                "--no-psqlrc",
                "--set",
                "ON_ERROR_STOP=1",
                "--no-align",
                "--tuples-only",
                "--field-separator=|",
                "--dbname",
                self.dsn,
            ],
            input=sql,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return completed.stdout.strip()

    def run_sql_failure(self, sql: str) -> str:
        completed = subprocess.run(
            [
                self.psql,
                "--no-psqlrc",
                "--set",
                "ON_ERROR_STOP=1",
                "--no-align",
                "--tuples-only",
                "--field-separator=|",
                "--dbname",
                self.dsn,
            ],
            input=sql,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertNotEqual(completed.returncode, 0, completed.stdout)
        return completed.stderr.lower()

    @staticmethod
    def script_sql(path: Path) -> str:
        sql = path.read_text(encoding="utf-8")
        if os.environ.get("MANGORTS_QA_COPY_TEST_ALLOW_PG18") == "1":
            sql = sql.replace(">= 180000", ">= 190000")
        return sql

    @classmethod
    def verifier_sql(cls) -> str:
        return cls.script_sql(VERIFY)

    def test_audited_base_entity_schema_bridge_to_current_schema(self) -> None:
        bridge_company = "90000000-0000-4000-8000-000000000001"
        self.run_sql(
            """
            drop trigger if exists trg_clear_entity_person_fields_for_membership
              on public.company_memberships;
            drop table public.entity_relationships;
            drop table public.entity_fields,public.entities,public.entity_field_types,
              public.entity_folders,public.entity_types cascade;
            create table public.entity_field_assignments(placeholder integer);
            create table public.entity_fields(placeholder integer);
            """
        )
        self.run_sql(
            (ROOT / "backend" / "db" / "migrations" / "20260827_entities.sql").read_text(
                encoding="utf-8"
            )
        )
        self.run_sql(
            f"""
            insert into public.companies(company_id,name)
            values ('{bridge_company}','Base Entity Bridge Fixture');
            insert into public.company_explorer_folders(
              company_id,folder_id,parent_folder_id,name
            )
            select '{bridge_company}',gen_random_uuid(),null,root_name
            from (values
              ('Sidebar Huddles Private'),('TK'),('Finance 1'),('Finance 1.5'),
              ('Finance 2'),('HR 1'),('HR 1.5'),('HR 2'),('Legal'),('FO')
            ) roots(root_name);
            """
        )

        self.run_sql(self.script_sql(PREFLIGHT))
        self.run_sql(self.script_sql(SANITIZER))
        self.run_sql(
            (ROOT / "backend" / "db" / "migrations" / "20260828_action_items.sql").read_text(
                encoding="utf-8"
            )
        )
        self.run_sql(
            (
                ROOT
                / "backend"
                / "db"
                / "migrations"
                / "20260828_entity_relationships.sql"
            ).read_text(encoding="utf-8")
        )
        self.run_sql(self.verifier_sql())

        result = self.run_sql(
            f"""
            select
              to_regclass('public.entity_relationships') is not null,
              to_regclass('public.action_item_huddle_relationships') is null,
              (select count(*) from information_schema.columns
               where table_schema='public' and table_name='entity_relationships'),
              not exists(
                select 1 from information_schema.columns
                where table_schema='public' and table_name='entity_relationships'
                  and column_name='entity_type_id'
              ),
              (select count(*) from public.entity_types
               where company_id='{bridge_company}' and system_key='action_item'),
              (select count(*) from public.entity_field_types
               where company_id='{bridge_company}'
                 and entity_type_id='a17e0000-0000-4000-8000-000000000001'),
              (select count(*) from public.entities where company_id='{bridge_company}'),
              (select count(*) from public.schema_migrations);
            """
        )
        self.assertEqual(
            result.split("|"), ["t", "t", "5", "t", "1", "5", "0", "0"]
        )

    def test_non_owning_boundary_and_typed_entity_link_collisions(self) -> None:
        company_a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        company_b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        shared_id = "10000000-0000-4000-8000-000000000001"
        textbox_id = "20000000-0000-4000-8000-000000000001"
        connection_a = "30000000-0000-4000-8000-000000000001"
        connection_b = "30000000-0000-4000-8000-000000000002"
        allowed_editor_thread = "40000000-0000-4000-8000-000000000001"
        excluded_wins_thread = "40000000-0000-4000-8000-000000000002"
        excluded_only_thread = "40000000-0000-4000-8000-000000000003"
        allowed_chat_thread = "40000000-0000-4000-8000-000000000004"
        other_company_thread = "40000000-0000-4000-8000-000000000005"
        allowed_editor_message = "50000000-0000-4000-8000-000000000001"
        excluded_wins_message = "50000000-0000-4000-8000-000000000002"
        excluded_only_message = "50000000-0000-4000-8000-000000000003"
        allowed_chat_message = "50000000-0000-4000-8000-000000000004"
        other_company_message = "50000000-0000-4000-8000-000000000005"
        dangling_message = "50000000-0000-4000-8000-000000000099"
        dangling_thread = "40000000-0000-4000-8000-000000000099"
        user_a = "81000000-0000-4000-8000-000000000001"
        user_b = "81000000-0000-4000-8000-000000000002"
        ordinary_type_a = "82000000-0000-4000-8000-000000000001"
        ordinary_type_b = "82000000-0000-4000-8000-000000000002"
        allowed_entity = "83000000-0000-4000-8000-000000000001"
        other_company_entity = "83000000-0000-4000-8000-000000000002"
        action_entity = "83000000-0000-4000-8000-000000000010"
        dangling_entity = "83000000-0000-4000-8000-000000000099"
        valid_person_field = "84000000-0000-4000-8000-000000000001"
        invalid_person_field = "84000000-0000-4000-8000-000000000002"
        huddle_root = "85000000-0000-4000-8000-000000000001"
        excluded_huddle = "86000000-0000-4000-8000-000000000001"
        surviving_huddle = "86000000-0000-4000-8000-000000000002"
        excluded_huddle_node = "86000000-0000-4000-8000-000000000011"
        surviving_huddle_node = "86000000-0000-4000-8000-000000000012"
        missing_huddle_node = "86000000-0000-4000-8000-000000000099"
        huddle_item = "87000000-0000-4000-8000-000000000001"

        self.run_sql(
            f"""
            insert into public.companies(company_id,name) values
              ('{company_a}','Fixture A'),
              ('{company_b}','Fixture B');

            insert into public.users(user_id,cognito_subject,email,display_name) values
              ('{user_a}','dev-fixture-user-a','fixture-user-a@example.test','Fixture User A'),
              ('{user_b}','dev-fixture-user-b','fixture-user-b@example.test','Fixture User B');

            insert into public.company_memberships(company_id,user_id,role) values
              ('{company_a}','{user_a}','company_user'),
              ('{company_b}','{user_b}','company_user');

            insert into public.entity_types(company_id,entity_type_id,name) values
              ('{company_a}','{ordinary_type_a}','Fixture Entity Type A'),
              ('{company_b}','{ordinary_type_b}','Fixture Entity Type B');

            insert into public.entity_types(company_id,entity_type_id,name,system_key)
            select company_id,'a17e0000-0000-4000-8000-000000000001','Action Item','action_item'
            from public.companies
            where company_id in ('{company_a}','{company_b}');

            insert into public.entity_field_types(
              company_id,entity_field_type_id,entity_type_id,entity_folder_id,
              name,field_type,system_key,config_jsonb,position
            )
            select company.company_id,definition.entity_field_type_id,
                   'a17e0000-0000-4000-8000-000000000001',null,
                   definition.name,definition.field_type,definition.system_key,
                   definition.config_jsonb,definition.position
            from public.companies company
            cross join (values
              ('a17e0000-0000-4000-8000-000000000101'::uuid,'Person in charge','person','person_in_charge','{{}}'::jsonb,0),
              ('a17e0000-0000-4000-8000-000000000102'::uuid,'Analysis due date','date','analysis_due_date','{{}}'::jsonb,1),
              ('a17e0000-0000-4000-8000-000000000103'::uuid,'Completion due date','date','completion_due_date','{{}}'::jsonb,2),
              ('a17e0000-0000-4000-8000-000000000104'::uuid,'Status','choice','status',
               '{{"default":"in_progress","options":[{{"key":"in_progress","label":"In progress"}},{{"key":"pending","label":"Pending"}},{{"key":"done","label":"Done"}}]}}'::jsonb,3),
              ('a17e0000-0000-4000-8000-000000000105'::uuid,'Color','color','color',
               '{{"default":null,"options":[{{"key":"yellow","label":"Yellow","color":"#facc15"}},{{"key":"red","label":"Red","color":"#ef4444"}}]}}'::jsonb,4)
            ) definition(entity_field_type_id,name,field_type,system_key,config_jsonb,position)
            where company.company_id in ('{company_a}','{company_b}');

            insert into public.entities(company_id,entity_id,entity_type_id,name,body_json) values
              ('{company_a}','{allowed_entity}','{ordinary_type_a}','Allowed Entity',
               '{{
                 "format":"mango-tiptap-json","schema_version":1,"annotations":[],
                 "document":{{"type":"doc","content":[{{"type":"paragraph","content":[
                   {{"type":"mangoEntityLink","attrs":{{"entityType":"entity","entityId":"{allowed_entity}","label":"Allowed entity"}}}},
                   {{"type":"mangoEntityLink","attrs":{{"entityType":"entity","entityId":"{other_company_entity}","label":"Wrong company entity"}}}},
                   {{"type":"mangoEntityLink","attrs":{{"entityType":"entity","entityId":"{dangling_entity}","label":"Dangling entity"}}}},
                   {{"type":"mangoAttachmentImage","attrs":{{"attachmentId":"88000000-0000-4000-8000-000000000001"}}}}
                 ]}}]}}
               }}'::jsonb),
              ('{company_b}','{other_company_entity}','{ordinary_type_b}','Other Company Entity',default),
              ('{company_a}','{action_entity}','a17e0000-0000-4000-8000-000000000001','Excluded Huddle Action',default);

            insert into public.entity_fields(
              company_id,entity_field_id,entity_id,entity_field_type_id,
              name,field_type,value_jsonb,position
            )
            select '{company_a}',gen_random_uuid(),'{action_entity}',
                   template.entity_field_type_id,template.name,template.field_type,
                   case when template.system_key='status' then template.config_jsonb->'default' else null end,
                   template.position
            from public.entity_field_types template
            where template.company_id='{company_a}'
              and template.entity_type_id='a17e0000-0000-4000-8000-000000000001';

            insert into public.entity_fields(
              company_id,entity_field_id,entity_id,name,field_type,value_jsonb
            ) values (
              '{company_a}','{valid_person_field}','{allowed_entity}','Valid Person','person',to_jsonb('{user_a}'::text)
            );

            set session_replication_role = replica;
            insert into public.entity_fields(
              company_id,entity_field_id,entity_id,name,field_type,value_jsonb
            ) values (
              '{company_a}','{invalid_person_field}','{allowed_entity}','Wrong Company Person','person',to_jsonb('{user_b}'::text)
            );
            set session_replication_role = origin;

            insert into public.huddle_explorer_folders(company_id,folder_id,parent_folder_id,name)
            values ('{company_a}','{huddle_root}',null,'TK');

            insert into public.huddle_logic_gates(company_id,huddle_logic_gate_id,header)
            values ('{company_a}','{excluded_huddle}','Excluded Fixture Huddle');

            insert into public.huddle_nodes(
              company_id,huddle_node_id,huddle_logic_gate_id,name
            ) values (
              '{company_a}','{excluded_huddle_node}','{excluded_huddle}',
              'Excluded Fixture Huddle Node'
            );

            insert into public.huddle_explorer_items(
              company_id,huddle_explorer_item_id,resource_huddle_resource_id,huddle_type,parent_folder_id
            ) values (
              '{company_a}','{huddle_item}','{excluded_huddle}','huddle_logic_gate','{huddle_root}'
            );

            insert into public.entity_relationships(
              company_id,entity_id,resource_type,resource_id
            ) values (
              '{company_a}','{action_entity}','huddle_node','{excluded_huddle_node}'
            );

            insert into public.company_explorer_folders(company_id,folder_id,parent_folder_id,name)
            select '{company_a}'::uuid, gen_random_uuid(), null, root_name
            from (values
              ('Sidebar Huddles Private'),('TK'),('Finance 1'),('Finance 1.5'),
              ('Finance 2'),('HR 1'),('HR 1.5'),('HR 2'),('Legal'),('FO')
            ) roots(root_name);

            insert into public.projects(company_id,project_id,name)
            values
              ('{company_a}','{shared_id}','Excluded Project'),
              ('{company_b}','{shared_id}','Allowed Other Company Project');

            insert into public.nodes(company_id,node_id,name,created_timestamp)
            values ('{company_a}','{shared_id}','Allowed Same-ID Node',now());

            insert into public.email_connections(
              email_connection_id,company_id,provider,account_email,grant_id,connection_type
            ) values
              ('{connection_a}','{company_a}','google','fixture-a@example.test','dev-fixture-a','shared'),
              ('{connection_b}','{company_b}','google','fixture-b@example.test','dev-fixture-b','shared');

            insert into public.email_threads(
              company_id,email_thread_id,provider_thread_key,root_provider_message_id,email_connection_id
            ) values
              ('{company_a}','{allowed_editor_thread}','provider-thread-a1','provider-message-a1','{connection_a}'),
              ('{company_a}','{excluded_wins_thread}','provider-thread-a2','provider-message-a2','{connection_a}'),
              ('{company_a}','{excluded_only_thread}','provider-thread-a3','provider-message-a3','{connection_a}'),
              ('{company_a}','{allowed_chat_thread}','provider-thread-a4','provider-message-a4','{connection_a}'),
              ('{company_b}','{other_company_thread}','provider-thread-b1','provider-message-b1','{connection_b}');

            insert into public.email_messages(
              company_id,email_message_id,email_thread_id,provider_message_id,message_order
            ) values
              ('{company_a}','{allowed_editor_message}','{allowed_editor_thread}','provider-message-a1',0),
              ('{company_a}','{excluded_wins_message}','{excluded_wins_thread}','provider-message-a2',0),
              ('{company_a}','{excluded_only_message}','{excluded_only_thread}','provider-message-a3',0),
              ('{company_a}','{allowed_chat_message}','{allowed_chat_thread}','provider-message-a4',0),
              ('{company_b}','{other_company_message}','{other_company_thread}','provider-message-b1',0);

            insert into public.company_explorer_items(
              company_id,item_id,parent_folder_id,target_type,target_id
            )
            select '{company_a}',gen_random_uuid(),folder_id,'project','{shared_id}'
            from public.company_explorer_folders
            where company_id='{company_a}' and parent_folder_id is null and name='Finance 1';

            insert into public.project_relationships(
              company_id,relationship_id,project_id,resource_type,resource_id
            ) values (
              '{company_a}',gen_random_uuid(),'{shared_id}','node','{shared_id}'
            );

            insert into public.node_textboxes(
              company_id,node_id,textbox_id,body_json
            ) values (
              '{company_a}','{shared_id}','{textbox_id}',
              '{{
                "format":"mango-tiptap-json","schema_version":1,"annotations":[],
                "document":{{"type":"doc","content":[{{"type":"paragraph","content":[
                  {{"type":"mangoEntityLink","attrs":{{"entityType":"node","entityId":"{shared_id}","label":"Allowed typed collision"}}}},
                  {{"type":"mangoEntityLink","attrs":{{"entityType":"project","entityId":"{shared_id}","label":"Excluded exact target"}}}},
                  {{"type":"mangoEntityLink","attrs":{{"entityType":"email_message","entityId":"{allowed_editor_message}","label":"Allowed editor email","emailMessageId":"{allowed_editor_message}","emailThreadId":"{allowed_editor_thread}","emailAccountEmail":"fixture-a@example.test"}}}},
                  {{"type":"mangoEntityLink","attrs":{{"entityType":"email_message","entityId":"{excluded_wins_message}","label":"Excluded wins email","emailMessageId":"{excluded_wins_message}","emailThreadId":"{excluded_wins_thread}","emailAccountEmail":"fixture-a@example.test"}}}},
                  {{"type":"mangoEntityLink","attrs":{{"entityType":"email_message","entityId":"{dangling_message}","label":"Dangling editor email","emailMessageId":"{dangling_message}","emailThreadId":"{dangling_thread}","emailAccountEmail":"fixture-a@example.test"}}}},
                  {{"type":"mangoEntityLink","attrs":{{"entityType":"email_message","entityId":"{other_company_message}","label":"Wrong company editor email","emailMessageId":"{other_company_message}","emailThreadId":"{other_company_thread}","emailAccountEmail":"fixture-a@example.test"}}}}
                ]}}]}}
              }}'::jsonb
            );

            insert into public.project_textboxes(
              company_id,project_id,textbox_id,body_json
            ) values (
              '{company_a}','{shared_id}','excluded-email-links',
              '{{
                "format":"mango-tiptap-json","schema_version":1,"annotations":[],
                "document":{{"type":"doc","content":[{{"type":"paragraph","content":[
                  {{"type":"mangoEntityLink","attrs":{{"entityType":"email_message","entityId":"{excluded_only_message}","label":"Excluded owner email","emailMessageId":"{excluded_only_message}","emailThreadId":"{excluded_only_thread}","emailAccountEmail":"fixture-a@example.test"}}}}
                ]}}]}}
              }}'::jsonb
            );

            insert into public.project_textboxes(
              company_id,project_id,textbox_id,body_json
            ) values (
              '{company_b}','{shared_id}','other-company-link',
              '{{
                "format":"mango-tiptap-json","schema_version":1,"annotations":[],
                "document":{{"type":"doc","content":[{{"type":"paragraph","content":[
                  {{"type":"mangoEntityLink","attrs":{{"entityType":"project","entityId":"{shared_id}","label":"Allowed company collision"}}}},
                  {{"type":"mangoEntityLink","attrs":{{"entityType":"email_message","entityId":"{other_company_message}","label":"Allowed other-company email","emailMessageId":"{other_company_message}","emailThreadId":"{other_company_thread}","emailAccountEmail":"fixture-b@example.test"}}}}
                ]}}]}}
              }}'::jsonb
            );

            insert into public.node_textbox_chats(
              company_id,chat_id,node_id,textbox_id,message,entity_links
            ) values (
              '{company_a}','60000000-0000-4000-8000-000000000001','{shared_id}','{textbox_id}',
              '#Allowed chat email #Dangling chat email #Wrong company chat email',
              '[
                {{"start":0,"end":19,"entity_type":"email_message","entity_id":"{allowed_chat_message}","label":"Allowed chat email"}},
                {{"start":20,"end":40,"entity_type":"email_message","entity_id":"{dangling_message}","label":"Dangling chat email"}},
                {{"start":41,"end":66,"entity_type":"email_message","entity_id":"{other_company_message}","label":"Wrong company chat email"}}
              ]'::jsonb
            );

            insert into public.node_textbox_chats(
              company_id,chat_id,node_id,textbox_id,message,entity_links
            ) values (
              '{company_a}','60000000-0000-4000-8000-000000000003','{shared_id}','{textbox_id}',
              '#Allowed-only chat email',
              '[{{"start":0,"end":24,"entity_type":"email_message","entity_id":"{allowed_chat_message}","label":"Allowed-only chat email"}}]'::jsonb
            );

            insert into public.project_textbox_chats(
              company_id,chat_id,project_id,textbox_id,message,entity_links
            ) values (
              '{company_a}','60000000-0000-4000-8000-000000000002','{shared_id}','excluded-email-links',
              '#Excluded chat wins',
              '[{{"start":0,"end":19,"entity_type":"email_message","entity_id":"{excluded_wins_message}","label":"Excluded chat wins"}}]'::jsonb
            );
            """
        )

        self.run_sql(self.script_sql(SANITIZER))

        result = self.run_sql(
            f"""
            select
              (select count(*) from public.projects where company_id='{company_a}' and project_id='{shared_id}'),
              (select count(*) from public.nodes where company_id='{company_a}' and node_id='{shared_id}'),
              (select count(*) from public.project_relationships where company_id='{company_a}'),
              (select count(*) from public.projects where company_id='{company_b}' and project_id='{shared_id}'),
              (select position('Allowed typed collision' in body_json::text) > 0
                 from public.node_textboxes where company_id='{company_a}' and node_id='{shared_id}'),
              (select position('Excluded exact target' in body_json::text) > 0
                 from public.node_textboxes where company_id='{company_a}' and node_id='{shared_id}'),
              (select position('Allowed company collision' in body_json::text) > 0
                 from public.project_textboxes where company_id='{company_b}' and project_id='{shared_id}'),
              (select count(*) from public.email_threads where company_id='{company_a}' and email_thread_id='{allowed_editor_thread}'),
              (select count(*) from public.email_threads where company_id='{company_a}' and email_thread_id='{excluded_wins_thread}'),
              (select count(*) from public.email_threads where company_id='{company_a}' and email_thread_id='{excluded_only_thread}'),
              (select count(*) from public.email_threads where company_id='{company_a}' and email_thread_id='{allowed_chat_thread}'),
              (select count(*) from public.email_threads where company_id='{company_b}' and email_thread_id='{other_company_thread}'),
              (select position('Allowed editor email' in body_json::text) > 0
                 from public.node_textboxes where company_id='{company_a}' and node_id='{shared_id}'),
              (select position('Excluded wins email' in body_json::text) > 0
                 from public.node_textboxes where company_id='{company_a}' and node_id='{shared_id}'),
              (select position('Dangling editor email' in body_json::text) > 0
                 from public.node_textboxes where company_id='{company_a}' and node_id='{shared_id}'),
              (select position('Wrong company editor email' in body_json::text) > 0
                 from public.node_textboxes where company_id='{company_a}' and node_id='{shared_id}'),
              (select count(*) from public.node_textbox_chats
                 where company_id='{company_a}' and chat_id='60000000-0000-4000-8000-000000000001'),
              (select count(*) from public.node_textbox_chats
                 where company_id='{company_a}' and chat_id='60000000-0000-4000-8000-000000000003'
                   and position('Allowed-only chat email' in message) > 0
                   and position('Allowed-only chat email' in entity_links::text) > 0),
              (select count(*) from public.node_textbox_chats
                 where company_id='{company_a}'
                   and (message like '%Dangling chat email%'
                     or message like '%Wrong company chat email%'
                     or entity_links::text like '%Dangling chat email%'
                     or entity_links::text like '%Wrong company chat email%')),
              (select position('Allowed other-company email' in body_json::text) > 0
                 from public.project_textboxes where company_id='{company_b}' and project_id='{shared_id}'),
              (select position('Allowed entity' in body_json::text) > 0
                 from public.entities where company_id='{company_a}' and entity_id='{allowed_entity}'),
              (select position('Wrong company entity' in body_json::text) > 0
                 from public.entities where company_id='{company_a}' and entity_id='{allowed_entity}'),
              (select position('Dangling entity' in body_json::text) > 0
                 from public.entities where company_id='{company_a}' and entity_id='{allowed_entity}'),
              (select body_json::text ~ 'mangoAttachmentImage|attachmentId|attachment_id'
                 from public.entities where company_id='{company_a}' and entity_id='{allowed_entity}'),
              (select value_jsonb = to_jsonb('{user_a}'::text)
                 from public.entity_fields where company_id='{company_a}' and entity_field_id='{valid_person_field}'),
              (select value_jsonb is null
                 from public.entity_fields where company_id='{company_a}' and entity_field_id='{invalid_person_field}'),
              (select count(*) from public.huddle_logic_gates
                 where company_id='{company_a}' and huddle_logic_gate_id='{excluded_huddle}'),
              (select count(*) from public.entity_relationships
                 where company_id='{company_a}' and entity_id='{action_entity}'),
              (select count(*) from public.entities
                 where company_id='{company_a}' and entity_id='{action_entity}');
            """
        )
        self.assertEqual(
            result.split("|"),
            [
                "0", "1", "0", "1", "t", "f", "t",
                "1", "0", "0", "1", "1",
                "t", "f", "f", "f", "0", "1", "0", "t",
                "t", "f", "f", "f", "t", "t", "0", "0", "1",
            ],
        )

        verifier = self.verifier_sql()
        self.run_sql(verifier)

        self.run_sql(
            """
            create table public.qa_verify_fk_parent(parent_id uuid primary key);
            create table public.qa_verify_fk_child(
              child_id uuid primary key,
              parent_id uuid not null,
              constraint qa_verify_fk_child_parent_fkey
                foreign key(parent_id) references public.qa_verify_fk_parent(parent_id)
            );
            alter table public.qa_verify_fk_child disable trigger all;
            insert into public.qa_verify_fk_child(child_id,parent_id)
            values (
              '70000000-0000-4000-8000-000000000001',
              '70000000-0000-4000-8000-000000000099'
            );
            alter table public.qa_verify_fk_child enable trigger all;
            """
        )
        fk_error = self.run_sql_failure(verifier)
        self.assertIn("qa_verify_fk_child_parent_fkey", fk_error)
        self.assertIn("has orphaned child data", fk_error)
        self.run_sql(
            """
            drop table public.qa_verify_fk_child;
            drop table public.qa_verify_fk_parent;
            """
        )

        self.run_sql(
            f"""
            set session_replication_role = replica;
            insert into public.process_map_placements(
              company_id,resource_type,resource_id,grid_x,grid_y
            ) values (
              '{company_a}','logic_gate','70000000-0000-4000-8000-000000000099',0,0
            );
            set session_replication_role = origin;
            """
        )
        generic_error = self.run_sql_failure(verifier)
        self.assertIn("generic policy/gvic, pin, process-map, or operational row", generic_error)
        self.run_sql(
            f"""
            delete from public.process_map_placements
            where company_id='{company_a}'
              and resource_type='logic_gate'
              and resource_id='70000000-0000-4000-8000-000000000099';
            """
        )

        self.run_sql(
            f"""
            update public.node_textboxes
            set body_json = jsonb_insert(
              body_json,
              '{{document,content,0,content,-1}}',
              '{{"type":"mangoEntityLink","attrs":{{"entityType":"email_message","entityId":"{dangling_message}","label":"Verifier dangling editor","emailMessageId":"{dangling_message}","emailThreadId":"{dangling_thread}","emailAccountEmail":"fixture-a@example.test"}}}}'::jsonb,
              true
            )
            where company_id='{company_a}' and node_id='{shared_id}';
            """
        )
        tiptap_error = self.run_sql_failure(verifier)
        self.assertIn("retained tiptap/chat entity link", tiptap_error)
        self.run_sql(
            f"""
            update public.node_textboxes
            set body_json = jsonb_set(
              body_json,
              '{{document,content,0,content}}',
              (body_json #> '{{document,content,0,content}}')
                - (jsonb_array_length(body_json #> '{{document,content,0,content}}') - 1)
            )
            where company_id='{company_a}' and node_id='{shared_id}';
            """
        )

        self.run_sql(
            f"""
            update public.node_textbox_chats
            set entity_links = entity_links ||
              '[{{"start":20,"end":43,"entity_type":"email_message","entity_id":"{dangling_message}","label":"Verifier dangling chat"}}]'::jsonb
            where company_id='{company_a}' and node_id='{shared_id}';
            """
        )
        chat_error = self.run_sql_failure(verifier)
        self.assertIn("retained tiptap/chat entity link", chat_error)
        self.run_sql(
            f"""
            update public.node_textbox_chats
            set entity_links = entity_links - (jsonb_array_length(entity_links) - 1)
            where company_id='{company_a}' and node_id='{shared_id}';
            """
        )

        self.run_sql(
            f"""
            update public.entities
            set body_json = jsonb_insert(
              body_json,
              '{{document,content,0,content,-1}}',
              '{{"type":"mangoEntityLink","attrs":{{"entityType":"entity","entityId":"{dangling_entity}","label":"Verifier dangling Entity"}}}}'::jsonb,
              true
            )
            where company_id='{company_a}' and entity_id='{allowed_entity}';
            """
        )
        entity_link_error = self.run_sql_failure(verifier)
        self.assertIn("retained tiptap/chat entity link", entity_link_error)
        self.run_sql(
            f"""
            update public.entities
            set body_json = jsonb_set(
              body_json,
              '{{document,content,0,content}}',
              (body_json #> '{{document,content,0,content}}')
                - (jsonb_array_length(body_json #> '{{document,content,0,content}}') - 1)
            )
            where company_id='{company_a}' and entity_id='{allowed_entity}';
            """
        )

        self.run_sql(
            f"""
            set session_replication_role = replica;
            update public.entity_fields
            set value_jsonb=to_jsonb('{user_b}'::text)
            where company_id='{company_a}' and entity_field_id='{invalid_person_field}';
            set session_replication_role = origin;
            """
        )
        person_error = self.run_sql_failure(verifier)
        self.assertIn("entity person field has no exact same-company membership", person_error)
        self.run_sql(
            f"""
            update public.entity_fields
            set value_jsonb=null
            where company_id='{company_a}' and entity_field_id='{invalid_person_field}';
            """
        )

        self.run_sql(
            f"""
            insert into public.huddle_logic_gates(company_id,huddle_logic_gate_id,header)
            values ('{company_a}','{surviving_huddle}','Surviving Fixture Huddle');

            insert into public.huddle_nodes(
              company_id,huddle_node_id,huddle_logic_gate_id,name
            ) values (
              '{company_a}','{surviving_huddle_node}','{surviving_huddle}',
              'Surviving Fixture Huddle Node'
            );

            insert into public.entity_relationships(
              company_id,entity_id,resource_type,resource_id
            ) values (
              '{company_a}','{allowed_entity}','huddle_node','{surviving_huddle_node}'
            );
            """
        )
        self.run_sql(verifier)
        self.run_sql(
            f"""
            set session_replication_role = replica;
            insert into public.entity_relationships(
              company_id,entity_id,resource_type,resource_id
            ) values (
              '{company_a}','{action_entity}','huddle_node','{missing_huddle_node}'
            );
            set session_replication_role = origin;
            """
        )
        entity_edge_error = self.run_sql_failure(verifier)
        self.assertIn("entity_relationships_huddle_node_fkey", entity_edge_error)
        self.assertIn("orphaned child data", entity_edge_error)
        self.run_sql(
            f"""
            delete from public.entity_relationships
            where company_id='{company_a}'
              and resource_id in ('{surviving_huddle_node}','{missing_huddle_node}');
            delete from public.huddle_nodes
            where company_id='{company_a}' and huddle_node_id='{surviving_huddle_node}';
            delete from public.huddle_logic_gates
            where company_id='{company_a}' and huddle_logic_gate_id='{surviving_huddle}';
            """
        )

        self.run_sql(
            f"""
            set session_replication_role = replica;
            delete from public.entity_fields
            where company_id='{company_a}'
              and entity_id='{action_entity}'
              and entity_field_type_id='a17e0000-0000-4000-8000-000000000104';
            set session_replication_role = origin;
            """
        )
        required_field_error = self.run_sql_failure(verifier)
        self.assertIn("action item entity is missing a required linked field", required_field_error)
        self.run_sql(
            f"""
            insert into public.entity_fields(
              company_id,entity_field_id,entity_id,entity_field_type_id,
              name,field_type,value_jsonb,position
            ) values (
              '{company_a}',gen_random_uuid(),'{action_entity}',
              'a17e0000-0000-4000-8000-000000000104',
              'Status','choice','"in_progress"'::jsonb,3
            );
            """
        )

        self.run_sql(verifier)


if __name__ == "__main__":
    unittest.main()
