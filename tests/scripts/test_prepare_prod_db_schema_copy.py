from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = REPO_ROOT / "scripts" / "prepare_prod_db_schema_copy.py"
SPEC = importlib.util.spec_from_file_location("prepare_prod_db_schema_copy", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
prepare_prod_db_schema_copy = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = prepare_prod_db_schema_copy
SPEC.loader.exec_module(prepare_prod_db_schema_copy)


class PrepareProdDBSchemaCopyTests(unittest.TestCase):
    def test_pg_dump_qualified_objects_are_counted_without_public_prefix(self) -> None:
        schema = """
CREATE TABLE public.widgets (id bigint NOT NULL);
CREATE FUNCTION public.touch_widget() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE INDEX idx_widgets_id ON public.widgets USING btree (id);
CREATE TRIGGER trg_widgets_touch BEFORE UPDATE ON public.widgets FOR EACH ROW EXECUTE FUNCTION public.touch_widget();
CREATE TYPE public.widget_state AS ENUM ('ready');
"""
        self.assertEqual(
            prepare_prod_db_schema_copy.object_names(
                prepare_prod_db_schema_copy.TABLE_PATTERN, schema
            ),
            ["widgets"],
        )
        self.assertEqual(
            prepare_prod_db_schema_copy.object_names(
                prepare_prod_db_schema_copy.FUNCTION_PATTERN, schema
            ),
            ["touch_widget"],
        )
        self.assertEqual(
            prepare_prod_db_schema_copy.object_names(
                prepare_prod_db_schema_copy.INDEX_PATTERN, schema
            ),
            ["idx_widgets_id"],
        )
        self.assertEqual(
            prepare_prod_db_schema_copy.object_names(
                prepare_prod_db_schema_copy.TRIGGER_PATTERN, schema
            ),
            ["trg_widgets_touch"],
        )
        self.assertEqual(
            prepare_prod_db_schema_copy.object_names(
                prepare_prod_db_schema_copy.TYPE_PATTERN, schema
            ),
            ["widget_state"],
        )

    def test_repository_generated_schema_manifest_is_complete(self) -> None:
        manifest = prepare_prod_db_schema_copy.build_manifest(REPO_ROOT)

        self.assertGreater(manifest.table_count, 0)
        self.assertGreater(manifest.function_count, 0)
        self.assertGreater(manifest.index_count, 0)
        self.assertTrue(all("." not in table for table in manifest.tables))


if __name__ == "__main__":
    unittest.main()
