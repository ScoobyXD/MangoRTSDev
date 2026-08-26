package store

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
)

const processMapMigrationCompanyID = "10000000-0000-4000-8000-000000000001"

func readProcessMapMigrationTestFile(t *testing.T, parts ...string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(parts...))
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func prepareLegacyProcessMapMigrationTest(t *testing.T) (*PostgresRepo, string) {
	t.Helper()
	db := openPostgresProcessMapTestDatabase(t)
	fixture := readProcessMapMigrationTestFile(t, "testdata", "process_map_v3_migration_fixture.sql")
	if _, err := db.Exec(fixture); err != nil {
		t.Fatalf("apply legacy Process Map fixture: %v", err)
	}
	migration := readProcessMapMigrationTestFile(t, "..", "..", "db", "migrations", "20260825_v3_process_map_global_canvas.sql")
	return NewPostgresRepo(db), migration
}

func TestPostgresProcessMapV3MigrationFlattensLegacyGeometry(t *testing.T) {
	repo, migration := prepareLegacyProcessMapMigrationTest(t)
	db := repo.db
	if _, err := db.Exec(migration); err != nil {
		t.Fatalf("apply V3 Process Map migration: %v", err)
	}

	type expectedGeometry struct {
		resourceType  string
		resourceID    string
		parentID      string
		x, y          int
		width, height int
		revision      int64
	}
	expected := []expectedGeometry{
		{"company_explorer_folder", "20000000-0000-4000-8000-000000000001", "", 100, 200, 33, 31, 4},
		{"company_explorer_folder", "20000000-0000-4000-8000-000000000002", "20000000-0000-4000-8000-000000000001", 101, 201, 31, 29, 5},
		{"company_explorer_folder", "20000000-0000-4000-8000-000000000003", "20000000-0000-4000-8000-000000000002", 122, 222, 9, 7, 8},
		{"logic_gate", "30000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000002", 102, 202, 7, 5, 6},
		{"logic_gate", "30000000-0000-4000-8000-000000000002", "20000000-0000-4000-8000-000000000002", 107, 204, 7, 5, 7},
		{"logic_gate", "30000000-0000-4000-8000-000000000003", "20000000-0000-4000-8000-000000000003", 123, 223, 7, 5, 9},
	}
	rows, err := db.Query(`
select resource_type,resource_id::text,coalesce(map_parent_folder_id::text,''),
       grid_x,grid_y,grid_width,grid_height,revision
from process_map_placements
order by resource_type,resource_id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	actual := []expectedGeometry{}
	for rows.Next() {
		var item expectedGeometry
		if err := rows.Scan(&item.resourceType, &item.resourceID, &item.parentID, &item.x, &item.y, &item.width, &item.height, &item.revision); err != nil {
			t.Fatal(err)
		}
		actual = append(actual, item)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("flattened geometry = %#v, want %#v", actual, expected)
	}
	var stalePlacementTimestamps int
	if err := db.QueryRow(`
select count(*) from process_map_placements
where updated_timestamp<='2026-08-01T00:00:08Z'::timestamptz`).Scan(&stalePlacementTimestamps); err != nil {
		t.Fatal(err)
	}
	if stalePlacementTimestamps != 0 {
		t.Fatalf("%d migrated placements did not advance updated_timestamp", stalePlacementTimestamps)
	}

	var routeJSON []byte
	var traceRevision int64
	if err := db.QueryRow(`
select route_points,revision
from process_map_traces
where company_id=$1::uuid and resource_operational_relationship_id='40000000-0000-4000-8000-000000000001'`, processMapMigrationCompanyID).Scan(&routeJSON, &traceRevision); err != nil {
		t.Fatal(err)
	}
	var route []domain.ProcessMapRoutePoint
	if err := json.Unmarshal(routeJSON, &route); err != nil {
		t.Fatal(err)
	}
	wantRoute := []domain.ProcessMapRoutePoint{{X: 103, Y: 203}, {X: 106, Y: 203}}
	if traceRevision != 10 || !reflect.DeepEqual(route, wantRoute) {
		t.Fatalf("translated trace revision/route = %d/%v, want 10/%v", traceRevision, route, wantRoute)
	}
	var traceTimestampAdvanced bool
	if err := db.QueryRow(`
select updated_timestamp>'2026-08-01T00:00:08Z'::timestamptz
from process_map_traces
where company_id=$1::uuid and resource_operational_relationship_id='40000000-0000-4000-8000-000000000001'`, processMapMigrationCompanyID).Scan(&traceTimestampAdvanced); err != nil {
		t.Fatal(err)
	}
	if !traceTimestampAdvanced {
		t.Fatal("migrated trace did not advance updated_timestamp")
	}

	var payloadJSON []byte
	if err := db.QueryRow(`
select restore_payload
from recycle_bin_items
where company_id=$1::uuid
  and recycle_bin_item_id='50000000-0000-4000-8000-000000000001'`, processMapMigrationCompanyID).Scan(&payloadJSON); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(payloadJSON), "placement_incarnation_token") {
		t.Fatal("migrated placement payload exposed the private incarnation token")
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(payloadJSON, &payload); err != nil {
		t.Fatal(err)
	}
	var recycledPlacements []domain.ProcessMapPlacement
	if err := json.Unmarshal(payload["process_map_placements"], &recycledPlacements); err != nil {
		t.Fatal(err)
	}
	if len(recycledPlacements) != len(expected) {
		t.Fatalf("migrated recycle placement count = %d, want %d", len(recycledPlacements), len(expected))
	}
	for index, placement := range recycledPlacements {
		want := expected[index]
		parentID := ""
		if placement.MapParentFolderID != nil {
			parentID = *placement.MapParentFolderID
		}
		if placement.ResourceType != want.resourceType || placement.ResourceID != want.resourceID ||
			parentID != want.parentID || placement.GridX != want.x || placement.GridY != want.y ||
			placement.GridWidth != want.width || placement.GridHeight != want.height || placement.Revision != want.revision {
			t.Fatalf("migrated recycle placement[%d] = %#v, want %#v", index, placement, want)
		}
	}
	var recycledTraces []domain.ProcessMapTrace
	if err := json.Unmarshal(payload["process_map_traces"], &recycledTraces); err != nil {
		t.Fatal(err)
	}
	if len(recycledTraces) != 1 || recycledTraces[0].Revision != 10 || !reflect.DeepEqual(recycledTraces[0].RoutePoints, wantRoute) {
		t.Fatalf("migrated recycle trace = %#v, want revision 10 and route %v", recycledTraces, wantRoute)
	}

	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(`delete from process_map_traces; delete from process_map_placements`); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := postgresRestoreProcessMapPlacementsTx(context.Background(), tx, payload["process_map_placements"]); err != nil {
		_ = tx.Rollback()
		t.Fatalf("restore migrated placements through V3 restore: %v", err)
	}
	if err := postgresRestoreRecycleTableTx(context.Background(), tx, "process_map_traces", payload["process_map_traces"]); err != nil {
		_ = tx.Rollback()
		t.Fatalf("restore migrated traces through V3 restore: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	var restoredPlacementCount int
	if err := db.QueryRow(`select count(*) from process_map_placements`).Scan(&restoredPlacementCount); err != nil {
		t.Fatal(err)
	}
	if restoredPlacementCount != len(expected) {
		t.Fatalf("restored migrated placement count = %d, want %d", restoredPlacementCount, len(expected))
	}
	var restoredRouteJSON []byte
	if err := db.QueryRow(`select route_points from process_map_traces where resource_operational_relationship_id='40000000-0000-4000-8000-000000000001'`).Scan(&restoredRouteJSON); err != nil {
		t.Fatal(err)
	}
	var restoredRoute []domain.ProcessMapRoutePoint
	if err := json.Unmarshal(restoredRouteJSON, &restoredRoute); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(restoredRoute, wantRoute) {
		t.Fatalf("restored migrated route = %v, want %v", restoredRoute, wantRoute)
	}

	var readVersion int64
	if err := db.QueryRow(`select version from workspace_read_versions where company_id=$1::uuid and scope='process-map' and resource_key=''`, processMapMigrationCompanyID).Scan(&readVersion); err != nil {
		t.Fatal(err)
	}
	if readVersion != 8 {
		t.Fatalf("Process Map read version = %d, want 8", readVersion)
	}

	var spatialIndex, legacyIndex bool
	if err := db.QueryRow(`select to_regclass('public.idx_process_map_placements_spatial') is not null,to_regclass('public.idx_process_map_placements_layer') is not null`).Scan(&spatialIndex, &legacyIndex); err != nil {
		t.Fatal(err)
	}
	if !spatialIndex || legacyIndex {
		t.Fatalf("V3 indexes spatial/legacy = %t/%t, want true/false", spatialIndex, legacyIndex)
	}
	var triggerCount int
	if err := db.QueryRow(`
select count(*) from pg_trigger
where tgrelid='process_map_placements'::regclass and tgname='trg_validate_process_map_placement' and not tgisinternal`).Scan(&triggerCount); err != nil {
		t.Fatal(err)
	}
	if triggerCount != 1 {
		t.Fatalf("V3 placement validator trigger count = %d, want 1", triggerCount)
	}
}

func TestPostgresProcessMapV3MigrationRejectsInvalidGraphAtomically(t *testing.T) {
	cases := []struct {
		name      string
		mutateSQL string
		wantError string
	}{
		{
			name: "map parent cycle",
			mutateSQL: `
update process_map_placements
set map_parent_folder_id='20000000-0000-4000-8000-000000000003'
where company_id='10000000-0000-4000-8000-000000000001'
  and resource_type='company_explorer_folder'
  and resource_id='20000000-0000-4000-8000-000000000001'`,
			wantError: "map-parent cycle",
		},
		{
			name: "missing mapped parent",
			mutateSQL: `
delete from process_map_placements
where company_id='10000000-0000-4000-8000-000000000001'
  and resource_type='company_explorer_folder'
  and resource_id='20000000-0000-4000-8000-000000000001'`,
			wantError: "unmapped or cross-company map parent",
		},
		{
			name: "mismatched trace layer",
			mutateSQL: `
update process_map_placements
set map_parent_folder_id='20000000-0000-4000-8000-000000000003'
where company_id='10000000-0000-4000-8000-000000000001'
  and resource_type='logic_gate'
  and resource_id='30000000-0000-4000-8000-000000000002'`,
			wantError: "endpoints do not share one legacy layer",
		},
		{
			name: "coordinate overflow",
			mutateSQL: `
update process_map_placements
set grid_x=999999990
where company_id='10000000-0000-4000-8000-000000000001'
  and resource_type='company_explorer_folder'
  and resource_id='20000000-0000-4000-8000-000000000001'`,
			wantError: "geometry would overflow canonical bounds",
		},
		{
			name: "recycle payload missing mapped parent",
			mutateSQL: `
with rebuilt as (
  select jsonb_agg(
    case when placement.value->>'resource_id'='30000000-0000-4000-8000-000000000001'
      then jsonb_set(placement.value,'{map_parent_folder_id}',to_jsonb('29999999-0000-4000-8000-000000000099'::text))
      else placement.value end
    order by ordinality
  ) placements
  from recycle_bin_items item
  cross join lateral jsonb_array_elements(item.restore_payload->'process_map_placements')
    with ordinality placement(value,ordinality)
  where item.recycle_bin_item_id='50000000-0000-4000-8000-000000000001'
)
update recycle_bin_items item
set restore_payload=jsonb_set(item.restore_payload,'{process_map_placements}',rebuilt.placements,false)
from rebuilt
where item.recycle_bin_item_id='50000000-0000-4000-8000-000000000001'`,
			wantError: "recycle payload contains an unmapped or ambiguous map parent",
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			repo, migration := prepareLegacyProcessMapMigrationTest(t)
			db := repo.db
			if _, err := db.Exec(testCase.mutateSQL); err != nil {
				t.Fatalf("prepare invalid legacy graph: %v", err)
			}

			var placementsBefore, tracesBefore, payloadBefore string
			var versionBefore int64
			if err := db.QueryRow(`select jsonb_agg(to_jsonb(placement) order by resource_type,resource_id)::text from process_map_placements placement`).Scan(&placementsBefore); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRow(`select jsonb_agg(to_jsonb(trace) order by resource_operational_relationship_id)::text from process_map_traces trace`).Scan(&tracesBefore); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRow(`select restore_payload::text from recycle_bin_items where recycle_bin_item_id='50000000-0000-4000-8000-000000000001'`).Scan(&payloadBefore); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRow(`select version from workspace_read_versions where company_id=$1::uuid and scope='process-map' and resource_key=''`, processMapMigrationCompanyID).Scan(&versionBefore); err != nil {
				t.Fatal(err)
			}

			conn, err := db.Conn(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close()
			_, migrationErr := conn.ExecContext(context.Background(), migration)
			if migrationErr == nil || !strings.Contains(migrationErr.Error(), testCase.wantError) {
				t.Fatalf("invalid legacy graph error = %v, want %q rejection", migrationErr, testCase.wantError)
			}
			if _, err := conn.ExecContext(context.Background(), "rollback"); err != nil {
				t.Fatalf("rollback rejected migration transaction: %v", err)
			}

			var placementsAfter, tracesAfter, payloadAfter string
			var versionAfter int64
			if err := db.QueryRow(`select jsonb_agg(to_jsonb(placement) order by resource_type,resource_id)::text from process_map_placements placement`).Scan(&placementsAfter); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRow(`select jsonb_agg(to_jsonb(trace) order by resource_operational_relationship_id)::text from process_map_traces trace`).Scan(&tracesAfter); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRow(`select restore_payload::text from recycle_bin_items where recycle_bin_item_id='50000000-0000-4000-8000-000000000001'`).Scan(&payloadAfter); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRow(`select version from workspace_read_versions where company_id=$1::uuid and scope='process-map' and resource_key=''`, processMapMigrationCompanyID).Scan(&versionAfter); err != nil {
				t.Fatal(err)
			}
			if placementsAfter != placementsBefore || tracesAfter != tracesBefore || payloadAfter != payloadBefore || versionAfter != versionBefore {
				t.Fatalf("rejected migration changed rows: placements=%t traces=%t payload=%t version=%d->%d", placementsAfter != placementsBefore, tracesAfter != tracesBefore, payloadAfter != payloadBefore, versionBefore, versionAfter)
			}
			var v3ColumnCount int
			if err := db.QueryRow(`
select count(*) from information_schema.columns
where table_schema='public' and table_name='process_map_placements' and column_name in ('grid_width','grid_height')`).Scan(&v3ColumnCount); err != nil {
				t.Fatal(err)
			}
			if v3ColumnCount != 0 {
				t.Fatalf("rejected migration left %d V3 geometry columns", v3ColumnCount)
			}
		})
	}
}
