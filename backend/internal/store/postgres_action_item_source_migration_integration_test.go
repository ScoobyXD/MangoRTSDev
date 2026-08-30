package store

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

const (
	actionItemSourceTransitionCompanyID         = "10000000-0000-4000-8000-000000000001"
	actionItemSourceTransitionLiveEntityID      = "20000000-0000-4000-8000-000000000001"
	actionItemSourceTransitionRecycledEntityID  = "20000000-0000-4000-8000-000000000002"
	actionItemSourceTransitionLiveNodeID        = "30000000-0000-4000-8000-000000000001"
	actionItemSourceTransitionRecycledProjectID = "40000000-0000-4000-8000-000000000001"
)

type actionItemSourceTransitionFiles struct {
	historical string
	forward    string
	preflight  string
}

func readActionItemSourceTransitionFile(t *testing.T, parts ...string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(parts...))
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func actionItemSourceTransitionFilesForTest(t *testing.T) actionItemSourceTransitionFiles {
	t.Helper()
	return actionItemSourceTransitionFiles{
		historical: readActionItemSourceTransitionFile(t, "..", "..", "db", "migrations", "20260829_action_item_delegation_source.sql"),
		forward:    readActionItemSourceTransitionFile(t, "..", "..", "db", "migrations", "20260829_z_action_item_source_entity_field.sql"),
		preflight:  readActionItemSourceTransitionFile(t, "..", "..", "..", "scripts", "action_item_source_entity_field_preflight.sql"),
	}
}

func prepareFreshActionItemSourceTransition(t *testing.T) (*sql.DB, actionItemSourceTransitionFiles) {
	t.Helper()
	db := openPostgresProcessMapTestDatabase(t)
	fixture := readActionItemSourceTransitionFile(t, "testdata", "action_item_source_entity_field_transition_fixture.sql")
	if _, err := db.Exec(fixture); err != nil {
		t.Fatalf("apply Action Item Source predecessor fixture: %v", err)
	}
	return db, actionItemSourceTransitionFilesForTest(t)
}

func preparePriorAppliedActionItemSourceTransition(t *testing.T) (*sql.DB, actionItemSourceTransitionFiles) {
	t.Helper()
	db, files := prepareFreshActionItemSourceTransition(t)
	if _, err := db.Exec(files.historical); err != nil {
		t.Fatalf("apply shipped table-based Action Item Source migration: %v", err)
	}
	if _, err := db.Exec(`
insert into public.schema_migrations(version)
values ('20260829_action_item_delegation_source.sql');

insert into public.action_item_sources(company_id,entity_id,resource_type,resource_id,created_timestamp) values
  ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','node','30000000-0000-4000-8000-000000000001','2026-08-29T10:00:00Z'),
  ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','project','40000000-0000-4000-8000-000000000001','2026-08-29T10:01:00Z');

insert into public.recycle_bin_items(
  company_id,recycle_bin_item_id,object_kind,object_id,object_label,restore_payload,deleted_timestamp
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
      'name','Recycled Source Project',
      'status','Active',
      'default_access','edit',
      'created_timestamp','2026-08-29T09:00:00Z',
      'updated_timestamp','2026-08-29T09:00:00Z',
      'health','On Track'
    )),
    'action_item_sources',jsonb_build_array(jsonb_build_object(
      'company_id','10000000-0000-4000-8000-000000000001',
      'entity_id','20000000-0000-4000-8000-000000000002',
      'resource_type','project',
      'resource_id','40000000-0000-4000-8000-000000000001',
      'created_timestamp','2026-08-29T10:01:00Z'
    ))
  ),
  '2026-08-29T10:02:00Z'
);

delete from public.projects
where company_id='10000000-0000-4000-8000-000000000001'
  and project_id='40000000-0000-4000-8000-000000000001';`); err != nil {
		t.Fatalf("seed exact PRIOR_APPLIED Action Item Source state: %v", err)
	}
	return db, files
}

func actionItemAssignedBySnapshot(t *testing.T, db *sql.DB) string {
	t.Helper()
	var snapshot string
	if err := db.QueryRow(`
select jsonb_build_object(
  'templates',coalesce((
    select jsonb_agg(to_jsonb(template) order by company_id,entity_field_type_id)
    from public.entity_field_types template
    where entity_field_type_id='a17e0000-0000-4000-8000-000000000106'::uuid
  ),'[]'::jsonb),
  'fields',coalesce((
    select jsonb_agg(to_jsonb(field) order by company_id,entity_id,entity_field_id)
    from public.entity_fields field
    where entity_field_type_id='a17e0000-0000-4000-8000-000000000106'::uuid
  ),'[]'::jsonb)
)::text`).Scan(&snapshot); err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func actionItemSourceTransitionSnapshot(t *testing.T, db *sql.DB) string {
	t.Helper()
	var snapshot string
	if err := db.QueryRow(`
select jsonb_build_object(
  'ledger',coalesce((
    select jsonb_agg(to_jsonb(migration) order by version)
    from public.schema_migrations migration
  ),'[]'::jsonb),
  'templates',coalesce((
    select jsonb_agg(to_jsonb(template) order by company_id,entity_field_type_id)
    from public.entity_field_types template
  ),'[]'::jsonb),
  'fields',coalesce((
    select jsonb_agg(to_jsonb(field) order by company_id,entity_id,entity_field_id)
    from public.entity_fields field
  ),'[]'::jsonb),
  'recycle',coalesce((
    select jsonb_agg(to_jsonb(item) order by company_id,recycle_bin_item_id)
    from public.recycle_bin_items item
  ),'[]'::jsonb),
  'relations',coalesce((
    select jsonb_agg(jsonb_build_array(c.relkind,c.relname) order by c.relkind,c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and (c.relname like '%action_item_source%' or c.relname='idx_entity_fields_resource_endpoint')
  ),'[]'::jsonb),
  'functions',coalesce((
    select jsonb_agg(jsonb_build_array(p.proname,pg_get_functiondef(p.oid)) order by p.proname)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and (p.proname like '%action_item_source%' or p.proname like '%entity_resource%')
  ),'[]'::jsonb),
  'triggers',coalesce((
    select jsonb_agg(jsonb_build_array(t.tgname,pg_get_triggerdef(t.oid)) order by t.tgname)
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and not t.tgisinternal
      and (t.tgname like '%action_item_source%' or t.tgname like '%entity_resource%')
  ),'[]'::jsonb),
  'constraints',coalesce((
    select jsonb_agg(jsonb_build_array(c.relname,con.conname,pg_get_constraintdef(con.oid)) order by c.relname,con.conname)
    from pg_constraint con
    join pg_class c on c.oid=con.conrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('entity_field_types','entity_fields','action_item_sources')
  ),'[]'::jsonb)
)::text`).Scan(&snapshot); err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func executeFailingActionItemSourceMigration(t *testing.T, db *sql.DB, migration, marker string) {
	t.Helper()
	ctx := context.Background()
	conn, err := db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_, migrationErr := conn.ExecContext(ctx, migration)
	if migrationErr == nil || !strings.Contains(strings.ToLower(migrationErr.Error()), strings.ToLower(marker)) {
		t.Fatalf("Action Item Source migration error=%v, want marker %q", migrationErr, marker)
	}
	if _, err := conn.ExecContext(ctx, "rollback"); err != nil {
		t.Fatalf("rollback rejected Action Item Source migration: %v", err)
	}
}

func TestPostgresActionItemSourceMigrationReproducesAssignedByFailureAndPreservesPairs(t *testing.T) {
	db, files := preparePriorAppliedActionItemSourceTransition(t)
	assignedByBefore := actionItemAssignedBySnapshot(t, db)

	executeFailingActionItemSourceMigration(
		t, db, files.historical, "action_item_entity_field_immutable:assigned_by",
	)
	if got := actionItemAssignedBySnapshot(t, db); got != assignedByBefore {
		t.Fatalf("failed historical rerun changed canonical Assigned by:\nbefore: %s\nafter:  %s", assignedByBefore, got)
	}

	if _, err := db.Exec(files.forward); err != nil {
		t.Fatalf("apply forward Action Item Source Entity field migration: %v", err)
	}
	if got := actionItemAssignedBySnapshot(t, db); got != assignedByBefore {
		t.Fatalf("forward migration changed canonical Assigned by:\nbefore: %s\nafter:  %s", assignedByBefore, got)
	}

	type sourcePair struct{ resourceType, resourceID string }
	pairs := map[string]sourcePair{}
	rows, err := db.Query(`
select field.entity_id::text,field.value_jsonb->>'resource_type',field.value_jsonb->>'resource_id'
from public.entity_fields field
where field.company_id=$1::uuid
  and field.entity_field_type_id='a17e0000-0000-4000-8000-000000000107'::uuid
order by field.entity_id`, actionItemSourceTransitionCompanyID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var entityID string
		var pair sourcePair
		if err := rows.Scan(&entityID, &pair.resourceType, &pair.resourceID); err != nil {
			t.Fatal(err)
		}
		pairs[entityID] = pair
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if got, want := pairs[actionItemSourceTransitionLiveEntityID], (sourcePair{"node", actionItemSourceTransitionLiveNodeID}); got != want {
		t.Fatalf("migrated live Source=%+v, want %+v", got, want)
	}
	if got, want := pairs[actionItemSourceTransitionRecycledEntityID], (sourcePair{"project", actionItemSourceTransitionRecycledProjectID}); got != want {
		t.Fatalf("migrated recycled Source=%+v, want %+v", got, want)
	}

	fieldRows, err := db.Query(`
select entity.entity_id::text,
       count(*) filter (where template.system_key in (
         'person_in_charge','assigned_by','analysis_due_date','completion_due_date','status','color','source'
       )),
       count(*) filter (where template.system_key='source')
from public.entities entity
join public.entity_types entity_type
  on entity_type.company_id=entity.company_id and entity_type.entity_type_id=entity.entity_type_id
join public.entity_fields field
  on field.company_id=entity.company_id and field.entity_id=entity.entity_id
left join public.entity_field_types template
  on template.company_id=field.company_id and template.entity_field_type_id=field.entity_field_type_id
where entity.company_id=$1::uuid and entity_type.system_key='action_item'
group by entity.entity_id
order by entity.entity_id`, actionItemSourceTransitionCompanyID)
	if err != nil {
		t.Fatal(err)
	}
	defer fieldRows.Close()
	seenEntities := 0
	for fieldRows.Next() {
		var entityID string
		var requiredCount, sourceCount int
		if err := fieldRows.Scan(&entityID, &requiredCount, &sourceCount); err != nil {
			t.Fatal(err)
		}
		if requiredCount != 7 || sourceCount != 1 {
			t.Fatalf("Action Item %s required fields/source=%d/%d, want 7/1", entityID, requiredCount, sourceCount)
		}
		seenEntities++
	}
	if err := fieldRows.Err(); err != nil {
		t.Fatal(err)
	}
	if seenEntities != 2 {
		t.Fatalf("verified Action Items=%d, want 2", seenEntities)
	}

	var customTemplateName, customFieldName string
	if err := db.QueryRow(`
select template.name,field.name
from public.entity_field_types template
join public.entity_fields field
  on field.company_id=template.company_id and field.entity_field_type_id=template.entity_field_type_id
where template.company_id=$1::uuid
  and template.entity_field_type_id='50000000-0000-4000-8000-000000000001'::uuid
  and field.entity_field_id='60000000-0000-4000-8000-000000000001'::uuid`,
		actionItemSourceTransitionCompanyID,
	).Scan(&customTemplateName, &customFieldName); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(customTemplateName, "Source (custom ") || !strings.HasPrefix(customFieldName, "Source (custom ") {
		t.Fatalf("custom Source names=%q/%q, want collision-safe custom names", customTemplateName, customFieldName)
	}

	var payloadRetainsLegacyKey bool
	if err := db.QueryRow(`
select restore_payload ? 'action_item_sources'
from public.recycle_bin_items
where company_id=$1::uuid and recycle_bin_item_id='70000000-0000-4000-8000-000000000001'::uuid`,
		actionItemSourceTransitionCompanyID,
	).Scan(&payloadRetainsLegacyKey); err != nil {
		t.Fatal(err)
	}
	if payloadRetainsLegacyKey {
		t.Fatal("forward migration retained obsolete action_item_sources recycle payload")
	}

	var retired bool
	if err := db.QueryRow(`
select to_regclass('public.action_item_sources') is null
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
   )`).Scan(&retired); err != nil {
		t.Fatal(err)
	}
	if !retired {
		t.Fatal("forward migration retained a legacy Action Item Source table, function, or trigger")
	}
}

func TestPostgresActionItemSourceMigrationRejectsUnsafePriorStateAtomically(t *testing.T) {
	cases := []struct {
		name   string
		mutate string
		marker string
	}{
		{
			name:   "partial schema drift",
			mutate: "drop trigger trg_delete_kpi_action_item_sources on public.kpis",
			marker: "STOP: Action Item Source migration requires exact PRIOR_APPLIED state",
		},
		{
			name: "malformed recycle payload",
			mutate: `update public.recycle_bin_items
set restore_payload=jsonb_set(restore_payload,'{action_item_sources}','{}'::jsonb,false)`,
			marker: "STOP: malformed legacy Action Item Source recycle payload",
		},
		{
			name: "missing recycled endpoint",
			mutate: `update public.recycle_bin_items
set restore_payload=jsonb_set(
  restore_payload,'{action_item_sources,0,resource_id}',
  '"49999999-0000-4000-8000-000000000099"'::jsonb,false
)`,
			marker: "STOP: legacy Action Item Source endpoint is unsupported, missing, or mismatched",
		},
		{
			name: "recycled endpoint is also live",
			mutate: `insert into public.projects(company_id,project_id,name)
values (
  '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'Unexpected live copy of recycled Source Project'
)`,
			marker: "STOP: legacy Action Item Source endpoint is unsupported, missing, or mismatched",
		},
		{
			name: "conflicting pairs",
			mutate: `
insert into public.logic_gates(company_id,logic_gate_id,header)
values ('10000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','Conflicting Source Gate');
insert into public.recycle_bin_items(
  company_id,recycle_bin_item_id,object_kind,object_id,object_label,restore_payload
) values (
  '10000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000002',
  'logic_gate','41000000-0000-4000-8000-000000000001','Conflicting Source Gate',
  jsonb_build_object(
    'logic_gates',jsonb_build_array(jsonb_build_object(
      'company_id','10000000-0000-4000-8000-000000000001',
      'logic_gate_id','41000000-0000-4000-8000-000000000001',
      'header','Conflicting Source Gate'
    )),
    'action_item_sources',jsonb_build_array(jsonb_build_object(
      'company_id','10000000-0000-4000-8000-000000000001',
      'entity_id','20000000-0000-4000-8000-000000000001',
      'resource_type','logic_gate',
      'resource_id','41000000-0000-4000-8000-000000000001',
      'created_timestamp','2026-08-29T10:03:00Z'
    ))
  )
);
delete from public.logic_gates
where company_id='10000000-0000-4000-8000-000000000001'
  and logic_gate_id='41000000-0000-4000-8000-000000000001'::uuid`,
			marker: "STOP: conflicting legacy Action Item Source pairs",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			db, files := preparePriorAppliedActionItemSourceTransition(t)
			if _, err := db.Exec(testCase.mutate); err != nil {
				t.Fatalf("prepare %s: %v", testCase.name, err)
			}
			before := actionItemSourceTransitionSnapshot(t, db)
			executeFailingActionItemSourceMigration(t, db, files.forward, testCase.marker)
			after := actionItemSourceTransitionSnapshot(t, db)
			if after != before {
				t.Fatalf("rejected %s changed data or catalogs:\nbefore: %s\nafter:  %s", testCase.name, before, after)
			}
		})
	}
}

func actionItemSourcePreflightResult(t *testing.T, db *sql.DB, preflight string) map[string]string {
	t.Helper()
	ctx := context.Background()
	conn, err := db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	trimmed := strings.TrimSpace(preflight)
	const rollbackStatement = "rollback;"
	if !strings.HasSuffix(strings.ToLower(trimmed), rollbackStatement) {
		t.Fatal("Action Item Source preflight test requires a trailing ROLLBACK")
	}
	preflightWithoutRollback := strings.TrimSpace(trimmed[:len(trimmed)-len(rollbackStatement)])
	const resultSelectMarker = "select current_setting('mangorts.action_item_source_preflight_state') as database_state"
	resultSelectOffset := strings.LastIndex(strings.ToLower(preflightWithoutRollback), resultSelectMarker)
	if resultSelectOffset < 0 {
		t.Fatal("Action Item Source preflight is missing its final state result")
	}
	preflightSetup := strings.TrimSpace(preflightWithoutRollback[:resultSelectOffset])
	preflightResultQuery := strings.TrimSpace(preflightWithoutRollback[resultSelectOffset:])
	rolledBack := false
	defer func() {
		if !rolledBack {
			_, _ = conn.ExecContext(context.Background(), "rollback")
		}
	}()

	if _, err := conn.ExecContext(ctx, preflightSetup); err != nil {
		t.Fatalf("run Action Item Source preflight classification: %v", err)
	}
	rows, err := conn.QueryContext(ctx, preflightResultQuery)
	if err != nil {
		t.Fatalf("run Action Item Source preflight: %v", err)
	}
	result := map[string]string{}
	columns, err := rows.Columns()
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		values := make([]any, len(columns))
		destinations := make([]any, len(columns))
		for index := range values {
			destinations[index] = &values[index]
		}
		if err := rows.Scan(destinations...); err != nil {
			t.Fatal(err)
		}
		for index, column := range columns {
			switch value := values[index].(type) {
			case []byte:
				result[strings.ToLower(column)] = string(value)
			case nil:
				result[strings.ToLower(column)] = ""
			default:
				result[strings.ToLower(column)] = fmt.Sprint(value)
			}
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if err := rows.Close(); err != nil {
		t.Fatal(err)
	}
	result["state"] = result["database_state"]
	var serverVersion string
	var serverVersionNumber string
	if err := conn.QueryRowContext(ctx, `select current_setting('server_version'),current_setting('server_version_num')`).Scan(
		&serverVersion, &serverVersionNumber,
	); err != nil {
		t.Fatal(err)
	}
	result["server_version"] = serverVersion
	result["server_version_num"] = serverVersionNumber
	if _, err := conn.ExecContext(ctx, "rollback"); err != nil {
		t.Fatalf("rollback Action Item Source preflight: %v", err)
	}
	rolledBack = true
	if result["state"] == "" {
		t.Fatal("Action Item Source preflight returned no state row")
	}
	return result
}

func prepareFinalActionItemSourceTransition(t *testing.T) (*sql.DB, actionItemSourceTransitionFiles) {
	t.Helper()
	db, files := preparePriorAppliedActionItemSourceTransition(t)
	if _, err := db.Exec(files.forward); err != nil {
		t.Fatalf("prepare FINAL state: %v", err)
	}
	if _, err := db.Exec(`insert into public.schema_migrations(version) values ('20260829_z_action_item_source_entity_field.sql')`); err != nil {
		t.Fatal(err)
	}
	return db, files
}

func TestPostgresActionItemSourcePreflightClassifiesStatesReadOnly(t *testing.T) {
	tests := []struct {
		name       string
		state      string
		status     string
		nextAction string
		prepare    func(*testing.T) (*sql.DB, actionItemSourceTransitionFiles)
	}{
		{
			name: "fresh", state: "FRESH", status: "READY", nextAction: "RUN_NORMAL_MIGRATOR_OLD_THEN_NEW",
			prepare: prepareFreshActionItemSourceTransition,
		},
		{
			name: "prior applied", state: "PRIOR_APPLIED", status: "READY", nextAction: "RUN_NORMAL_MIGRATOR_NEW_FILE_ONLY",
			prepare: preparePriorAppliedActionItemSourceTransition,
		},
		{
			name: "final", state: "FINAL", status: "READY", nextAction: "NO_WRITE_REQUIRED",
			prepare: prepareFinalActionItemSourceTransition,
		},
		{
			name: "final with disabled cleanup trigger", state: "PARTIAL_DRIFT", status: "STOP", nextAction: "STOP_AND_REVIEW_DRIFT",
			prepare: func(t *testing.T) (*sql.DB, actionItemSourceTransitionFiles) {
				db, files := prepareFinalActionItemSourceTransition(t)
				if _, err := db.Exec(`alter table public.nodes disable trigger trg_clear_node_entity_resource_fields`); err != nil {
					t.Fatal(err)
				}
				return db, files
			},
		},
		{
			name: "partial drift", state: "PARTIAL_DRIFT", status: "STOP", nextAction: "STOP_AND_REVIEW_DRIFT",
			prepare: func(t *testing.T) (*sql.DB, actionItemSourceTransitionFiles) {
				db, files := preparePriorAppliedActionItemSourceTransition(t)
				if _, err := db.Exec(`drop trigger trg_delete_kpi_action_item_sources on public.kpis`); err != nil {
					t.Fatal(err)
				}
				return db, files
			},
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			db, files := testCase.prepare(t)
			before := actionItemSourceTransitionSnapshot(t, db)
			result := actionItemSourcePreflightResult(t, db, files.preflight)
			after := actionItemSourceTransitionSnapshot(t, db)
			if after != before {
				t.Fatalf("%s preflight changed data or catalogs:\nbefore: %s\nafter:  %s", testCase.name, before, after)
			}
			if result["state"] != testCase.state || result["status"] != testCase.status || result["next_action"] != testCase.nextAction {
				t.Fatalf("%s preflight result=%+v, want state/status/next_action=%s/%s/%s", testCase.name, result, testCase.state, testCase.status, testCase.nextAction)
			}
			versionNumber, err := strconv.Atoi(result["server_version_num"])
			if err != nil || versionNumber < 170000 || versionNumber >= 190000 || result["server_version"] == "" {
				t.Fatalf("%s preflight PostgreSQL version=%q/%q err=%v", testCase.name, result["server_version"], result["server_version_num"], err)
			}
		})
	}
}
