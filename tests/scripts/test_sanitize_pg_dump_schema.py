from __future__ import annotations

import importlib.util
import sys
import unittest
import uuid
from contextlib import contextmanager
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = REPO_ROOT / "scripts" / "sanitize_pg_dump_schema.py"
SPEC = importlib.util.spec_from_file_location("sanitize_pg_dump_schema", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
sanitize_pg_dump_schema = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = sanitize_pg_dump_schema
SPEC.loader.exec_module(sanitize_pg_dump_schema)


@contextmanager
def temporary_paths(*names: str):
    prefix = f"sanitizer-test-{uuid.uuid4().hex}"
    paths = tuple(REPO_ROOT / "tmp" / f"{prefix}-{name}" for name in names)
    try:
        yield paths
    finally:
        for path in paths:
            path.unlink(missing_ok=True)


def dump_with(statement: str) -> str:
    return (
        "--\n"
        "-- PostgreSQL database dump\n"
        "--\n\n"
        "\\restrict SafeToken123\n\n"
        "-- Dumped from database version 17.7\n"
        "-- Dumped by pg_dump version 17.11\n\n"
        "SELECT pg_catalog.set_config('search_path', '', false);\n\n"
        f"{statement}\n\n"
        "-- PostgreSQL database dump complete\n\n"
        "\\unrestrict SafeToken123\n"
    )


class SanitizePgDumpSchemaTests(unittest.TestCase):
    def test_repository_schema_is_safe_sanitized_output(self) -> None:
        schema_path = REPO_ROOT / "backend" / "db" / "schema.sql"
        raw = schema_path.read_bytes()
        self.assertFalse(raw.startswith(b"\xef\xbb\xbf"))
        self.assertNotIn(b"\r", raw)

        sanitize_pg_dump_schema.validate_sanitized_dump_text(raw.decode("utf-8"))

    def test_valid_dump_strips_only_pair_and_writes_utf8_lf_without_bom(self) -> None:
        original = dump_with("CREATE TABLE public.widgets (id bigint PRIMARY KEY);")
        with temporary_paths("input.sql", "output.sql") as (input_path, output_path):
            input_path.write_bytes(b"\xef\xbb\xbf" + original.replace("\n", "\r\n").encode("utf-8"))

            sanitize_pg_dump_schema.sanitize_dump_file(input_path, output_path)

            output = output_path.read_bytes()
            self.assertFalse(output.startswith(b"\xef\xbb\xbf"))
            self.assertNotIn(b"\r", output)
            self.assertEqual(
                output.decode("utf-8"),
                original.replace("\\restrict SafeToken123\n", "").replace(
                    "\\unrestrict SafeToken123\n", ""
                ).replace(
                    sanitize_pg_dump_schema.PG_DUMP_EMPTY_SEARCH_PATH,
                    sanitize_pg_dump_schema.DRIVER_SAFE_SEARCH_PATH,
                ).rstrip("\n")
                + "\n",
            )

    def test_dml_inside_dollar_quoted_function_body_is_schema_not_dump_data(self) -> None:
        sql = dump_with(
            "CREATE FUNCTION public.touch_widget() RETURNS trigger LANGUAGE plpgsql AS $$\n"
            "BEGIN\nUPDATE public.widgets SET id = id;\nRETURN NEW;\nEND;\n$$;"
        )

        output = sanitize_pg_dump_schema.sanitize_dump_text(sql)

        self.assertIn("UPDATE public.widgets", output)

    def test_rejects_forbidden_sql(self) -> None:
        forbidden = (
            "COPY public.widgets (id) FROM stdin;",
            "INSERT INTO public.widgets VALUES (1);",
            "UPDATE public.widgets SET id = 1;",
            "DELETE FROM public.widgets;",
            "TRUNCATE public.widgets;",
            "CREATE DATABASE forbidden;",
            "ALTER DATABASE forbidden OWNER TO attacker;",
            "ALTER TABLE public.widgets OWNER TO attacker;",
            "SET SESSION AUTHORIZATION attacker;",
            "GRANT SELECT ON public.widgets TO attacker;",
            "REVOKE SELECT ON public.widgets FROM attacker;",
            "CREATE TABLE public.schema_migrations (version text);",
            'CREATE TABLE public."schema_migrations" (version text);',
            "BEGIN; CREATE TABLE public.widgets (id bigint); COMMIT;",
            "CREATE TABLE public.widgets (id bigint) TABLESPACE unsafe;",
        )
        for statement in forbidden:
            with self.subTest(statement=statement):
                with self.assertRaises(sanitize_pg_dump_schema.SanitizationError):
                    sanitize_pg_dump_schema.sanitize_dump_text(dump_with(statement))

    def test_rejects_bad_or_additional_psql_commands(self) -> None:
        cases = (
            dump_with("CREATE TABLE public.widgets (id bigint);").replace("SafeToken123\n", "OtherToken\n", 1),
            dump_with("CREATE TABLE public.widgets (id bigint);").replace("\\restrict", "\\connect"),
            dump_with("CREATE TABLE public.widgets (id bigint);").replace(
                "CREATE TABLE", "\\echo unsafe\nCREATE TABLE"
            ),
            dump_with("CREATE TABLE public.widgets (id bigint);").replace(
                "\\restrict SafeToken123", "SELECT 1;\n\\restrict SafeToken123"
            ),
        )
        for value in cases:
            with self.subTest(value=value[:80]):
                with self.assertRaises(sanitize_pg_dump_schema.SanitizationError):
                    sanitize_pg_dump_schema.sanitize_dump_text(value)

    def test_rejects_non_pg17_non_schema_and_unterminated_sql(self) -> None:
        cases = (
            dump_with("CREATE TABLE public.widgets (id bigint);").replace("version 17.7", "version 18.1"),
            dump_with("CREATE TABLE public.widgets (id bigint);").replace(
                "pg_dump version 17.11", "pg_dump version 18.4"
            ),
            dump_with("SET statement_timeout = 0;"),
            dump_with("CREATE TABLE public.widgets (id bigint)"),
        )
        for value in cases:
            with self.subTest(value=value[:80]):
                with self.assertRaises(sanitize_pg_dump_schema.SanitizationError):
                    sanitize_pg_dump_schema.sanitize_dump_text(value)

    def test_rejects_unexpected_top_level_sql(self) -> None:
        cases = (
            "SELECT pg_catalog.pg_read_file('/etc/passwd'); CREATE TABLE public.widgets (id bigint);",
            "SET ROLE attacker; CREATE TABLE public.widgets (id bigint);",
            "DO $$ BEGIN NULL; END $$; CREATE TABLE public.widgets (id bigint);",
            "DROP TABLE public.widgets; CREATE TABLE public.safe_widgets (id bigint);",
        )
        for statement in cases:
            with self.subTest(statement=statement):
                with self.assertRaises(sanitize_pg_dump_schema.SanitizationError):
                    sanitize_pg_dump_schema.sanitize_dump_text(dump_with(statement))

    def test_refuses_same_input_and_output_path(self) -> None:
        with temporary_paths("dump.sql") as (path,):
            path.write_text(dump_with("CREATE TABLE public.widgets (id bigint);"), encoding="utf-8")

            with self.assertRaises(sanitize_pg_dump_schema.SanitizationError):
                sanitize_pg_dump_schema.sanitize_dump_file(path, path)

    def test_invalid_input_does_not_replace_existing_output(self) -> None:
        with temporary_paths("input.sql", "output.sql") as (input_path, output_path):
            input_path.write_text(dump_with("INSERT INTO public.widgets VALUES (1);"), encoding="utf-8")
            output_path.write_text("keep me", encoding="utf-8")

            with self.assertRaises(sanitize_pg_dump_schema.SanitizationError):
                sanitize_pg_dump_schema.sanitize_dump_file(input_path, output_path)

            self.assertEqual(output_path.read_text(encoding="utf-8"), "keep me")


if __name__ == "__main__":
    unittest.main()
