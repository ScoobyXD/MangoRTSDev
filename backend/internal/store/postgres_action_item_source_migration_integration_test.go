package store

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
)

type actionItemSourceMigrationFiles struct {
	historical string
	forward    string
}

func readActionItemSourceMigrationFile(t *testing.T, parts ...string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(parts...))
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func prepareLegacyActionItemSourceDatabase(t *testing.T) (*sql.DB, actionItemSourceMigrationFiles) {
	t.Helper()
	db := openPostgresProcessMapTestDatabase(t)
	files := actionItemSourceMigrationFiles{
		historical: readActionItemSourceMigrationFile(t, "..", "..", "db", "migrations", "20260829_action_item_delegation_source.sql"),
		forward:    readActionItemSourceMigrationFile(t, "..", "..", "db", "migrations", "20260829_z_action_item_source_entity_field.sql"),
	}
	fixture := readActionItemSourceMigrationFile(t, "testdata", "action_item_source_entity_field_transition_fixture.sql")
	if _, err := db.Exec(fixture); err != nil {
		t.Fatalf("apply Action Item Source predecessor fixture: %v", err)
	}
	if _, err := db.Exec(files.historical); err != nil {
		t.Fatalf("apply shipped table-based Action Item Source migration: %v", err)
	}
	if _, err := db.Exec(`
insert into public.schema_migrations(version)
values ('20260829_action_item_delegation_source.sql');

update public.entity_fields
set value_jsonb=to_jsonb('11000000-0000-4000-8000-000000000001'::text)
where company_id='10000000-0000-4000-8000-000000000001'
  and entity_id='20000000-0000-4000-8000-000000000001'
  and entity_field_type_id='a17e0000-0000-4000-8000-000000000106'::uuid;

insert into public.action_item_sources(company_id,entity_id,resource_type,resource_id) values
  ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','node','30000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','project','40000000-0000-4000-8000-000000000001');

insert into public.recycle_bin_items(
  company_id,recycle_bin_item_id,object_kind,object_id,object_label,restore_payload
) values (
  '10000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  'project',
  '40000000-0000-4000-8000-000000000001',
  'Recycled Source Project',
  jsonb_build_object(
    'projects',jsonb_build_array(jsonb_build_object(
      'company_id','10000000-0000-4000-8000-000000000001',
      'project_id','40000000-0000-4000-8000-000000000001',
      'name','Recycled Source Project'
    )),
    'action_item_sources',jsonb_build_array(jsonb_build_object(
      'company_id','10000000-0000-4000-8000-000000000001',
      'entity_id','20000000-0000-4000-8000-000000000002',
      'resource_type','project',
      'resource_id','40000000-0000-4000-8000-000000000001'
    ))
  )
);

delete from public.projects
where company_id='10000000-0000-4000-8000-000000000001'
  and project_id='40000000-0000-4000-8000-000000000001';`); err != nil {
		t.Fatalf("seed disposable legacy Action Item Source data: %v", err)
	}
	return db, files
}

func actionItemAssignedBySnapshot(t *testing.T, db *sql.DB) string {
	t.Helper()
	var snapshot string
	if err := db.QueryRow(`
select jsonb_build_object(
  'templates',(
    select jsonb_agg(to_jsonb(template) order by company_id)
    from public.entity_field_types template
    where entity_field_type_id='a17e0000-0000-4000-8000-000000000106'::uuid
  ),
  'fields',(
    select jsonb_agg(to_jsonb(field) order by company_id,entity_id)
    from public.entity_fields field
    where entity_field_type_id='a17e0000-0000-4000-8000-000000000106'::uuid
  )
)::text`).Scan(&snapshot); err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func TestPostgresActionItemSourceMigrationDiscardsLegacyData(t *testing.T) {
	db, files := prepareLegacyActionItemSourceDatabase(t)

	var legacyRows, legacyPayloads, customTemplates, customFields int
	if err := db.QueryRow(`
select
  (select count(*) from public.action_item_sources),
  (select count(*) from public.recycle_bin_items where restore_payload ? 'action_item_sources'),
  (select count(*) from public.entity_field_types where entity_field_type_id='50000000-0000-4000-8000-000000000001'::uuid),
  (select count(*) from public.entity_fields where entity_field_id='60000000-0000-4000-8000-000000000001'::uuid)
`).Scan(&legacyRows, &legacyPayloads, &customTemplates, &customFields); err != nil {
		t.Fatal(err)
	}
	if legacyRows != 1 || legacyPayloads != 1 || customTemplates != 1 || customFields != 1 {
		t.Fatalf("legacy fixture rows=%d payloads=%d custom templates=%d custom fields=%d, want 1/1/1/1", legacyRows, legacyPayloads, customTemplates, customFields)
	}

	assignedByBefore := actionItemAssignedBySnapshot(t, db)
	if _, err := db.Exec(files.forward); err != nil {
		t.Fatalf("apply forward Action Item Source migration: %v", err)
	}
	if assignedByAfter := actionItemAssignedBySnapshot(t, db); assignedByAfter != assignedByBefore {
		t.Fatalf("canonical Assigned by changed during Source migration:\nbefore: %s\nafter:  %s", assignedByBefore, assignedByAfter)
	}

	var invalidActionItems int
	if err := db.QueryRow(`
select count(*)
from (
  select entity.entity_id
  from public.entities entity
  join public.entity_types entity_type
    on entity_type.company_id=entity.company_id
   and entity_type.entity_type_id=entity.entity_type_id
   and entity_type.system_key='action_item'
  left join public.entity_fields field
    on field.company_id=entity.company_id and field.entity_id=entity.entity_id
  group by entity.company_id,entity.entity_id
  having count(field.entity_field_id)<>7
     or count(*) filter (where field.entity_field_type_id in (
       'a17e0000-0000-4000-8000-000000000101'::uuid,
       'a17e0000-0000-4000-8000-000000000102'::uuid,
       'a17e0000-0000-4000-8000-000000000103'::uuid,
       'a17e0000-0000-4000-8000-000000000104'::uuid,
       'a17e0000-0000-4000-8000-000000000105'::uuid,
       'a17e0000-0000-4000-8000-000000000106'::uuid,
       'a17e0000-0000-4000-8000-000000000107'::uuid
     ))<>7
     or count(*) filter (
       where field.entity_field_type_id='a17e0000-0000-4000-8000-000000000107'::uuid
         and field.value_jsonb is null
     )<>1
) invalid`).Scan(&invalidActionItems); err != nil {
		t.Fatal(err)
	}
	if invalidActionItems != 0 {
		t.Fatalf("%d Action Items do not have exactly seven required fields with null Source", invalidActionItems)
	}

	var payloadKeys, customObjects int
	if err := db.QueryRow(`
select
  (select count(*) from public.recycle_bin_items where restore_payload ? 'action_item_sources'),
  (select count(*) from public.entity_field_types where entity_field_type_id='50000000-0000-4000-8000-000000000001'::uuid)
  + (select count(*) from public.entity_fields where entity_field_id='60000000-0000-4000-8000-000000000001'::uuid)
`).Scan(&payloadKeys, &customObjects); err != nil {
		t.Fatal(err)
	}
	if payloadKeys != 0 || customObjects != 0 {
		t.Fatalf("legacy payload keys=%d custom Source objects=%d, want 0/0", payloadKeys, customObjects)
	}

	var legacyObjectsGone, finalGuardsPresent bool
	if err := db.QueryRow(`
select
  to_regclass('public.action_item_sources') is null
  and to_regprocedure('public.mangorts_validate_action_item_source()') is null
  and to_regprocedure('public.mangorts_delete_action_item_sources_for_resource()') is null
  and not exists (
    select 1 from pg_trigger
    where not tgisinternal and tgname in (
      'trg_validate_action_item_source',
      'trg_delete_node_action_item_sources',
      'trg_delete_logic_gate_action_item_sources',
      'trg_delete_project_action_item_sources',
      'trg_delete_huddle_node_action_item_sources',
      'trg_delete_huddle_logic_gate_action_item_sources',
      'trg_delete_kpi_action_item_sources'
    )
  ),
  to_regclass('public.idx_entity_fields_resource_endpoint') is not null
  and to_regprocedure('public.mangorts_entity_resource_exists(uuid,text,uuid)') is not null
  and to_regprocedure('public.mangorts_resource_is_in_recycle_payload(uuid,text,text,uuid)') is not null
  and to_regprocedure('public.mangorts_clear_entity_resource_fields_for_deleted_resource()') is not null
  and to_regprocedure('public.mangorts_clear_entity_resource_fields_for_permanent_recycle_delete()') is not null
  and (select count(*) from pg_trigger where not tgisinternal and tgenabled<>'D' and tgname in (
    'trg_clear_node_entity_resource_fields',
    'trg_clear_logic_gate_entity_resource_fields',
    'trg_clear_project_entity_resource_fields',
    'trg_clear_huddle_node_entity_resource_fields',
    'trg_clear_huddle_logic_gate_entity_resource_fields',
    'trg_clear_kpi_entity_resource_fields',
    'trg_clear_entity_resource_fields_on_permanent_recycle_delete'
  ))=7
  and lower(pg_get_functiondef('public.mangorts_protect_action_item_field_type()'::regprocedure)) like '%''source''%'
  and lower(pg_get_functiondef('public.mangorts_protect_action_item_entity_field()'::regprocedure)) like '%''source''%'
`).Scan(&legacyObjectsGone, &finalGuardsPresent); err != nil {
		t.Fatal(err)
	}
	if !legacyObjectsGone || !finalGuardsPresent {
		t.Fatalf("legacy objects gone=%t final resource guards present=%t, want true/true", legacyObjectsGone, finalGuardsPresent)
	}
}
