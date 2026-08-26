package store

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
)

const (
	processMapCompactionCompanyA = "10000000-0000-4000-8000-000000000001"
	processMapCompactionCompanyB = "10000000-0000-4000-8000-000000000002"
	processMapCompactionFarID    = "30000000-0000-4000-8000-000000000004"
)

func prepareProcessMapGeometryCompactionMigrationTest(t *testing.T) (*PostgresRepo, string) {
	t.Helper()
	repo, v3Migration := prepareLegacyProcessMapMigrationTest(t)
	if _, err := repo.db.Exec(v3Migration); err != nil {
		t.Fatalf("apply V3 Process Map migration: %v", err)
	}
	fixture := readProcessMapMigrationTestFile(t, "testdata", "process_map_geometry_compaction_fixture.sql")
	if _, err := repo.db.Exec(fixture); err != nil {
		t.Fatalf("apply Process Map compaction fixture: %v", err)
	}
	migration := readProcessMapMigrationTestFile(
		t, "..", "..", "db", "migrations", "20260826_process_map_geometry_compaction.sql",
	)
	return repo, migration
}

type processMapCompactionSnapshot struct {
	placements    string
	traces        string
	relationships string
	recycle       string
	versions      string
}

func readProcessMapCompactionSnapshot(t *testing.T, repo *PostgresRepo) processMapCompactionSnapshot {
	t.Helper()
	queries := []struct {
		destination *string
		query       string
	}{
		{query: `select coalesce(jsonb_agg(to_jsonb(placement) order by company_id,resource_type,resource_id),'[]'::jsonb)::text from process_map_placements placement`},
		{query: `select coalesce(jsonb_agg(to_jsonb(trace) order by company_id,resource_operational_relationship_id),'[]'::jsonb)::text from process_map_traces trace`},
		{query: `select coalesce(jsonb_agg(to_jsonb(relationship) order by company_id,resource_operational_relationship_id),'[]'::jsonb)::text from resource_operational_relationships relationship`},
		{query: `select coalesce(jsonb_agg(to_jsonb(item) order by company_id,recycle_bin_item_id),'[]'::jsonb)::text from recycle_bin_items item`},
		{query: `select coalesce(jsonb_agg(to_jsonb(version) order by company_id,scope,resource_key),'[]'::jsonb)::text from workspace_read_versions version where scope='process-map' and resource_key=''`},
	}
	result := processMapCompactionSnapshot{}
	queries[0].destination = &result.placements
	queries[1].destination = &result.traces
	queries[2].destination = &result.relationships
	queries[3].destination = &result.recycle
	queries[4].destination = &result.versions
	for _, item := range queries {
		if err := repo.db.QueryRow(item.query).Scan(item.destination); err != nil {
			t.Fatal(err)
		}
	}
	return result
}

func readProcessMapCompactionIdentitySnapshot(t *testing.T, repo *PostgresRepo) string {
	t.Helper()
	var snapshot string
	if err := repo.db.QueryRow(`
select coalesce(jsonb_agg(jsonb_build_array(
  company_id,resource_type,resource_id,map_parent_folder_id,
  placement_incarnation_token,created_timestamp
) order by company_id,resource_type,resource_id),'[]'::jsonb)::text
from process_map_placements`).Scan(&snapshot); err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func TestPostgresProcessMapGeometryCompactionMigrationIsDeterministicAndRecycleSafe(t *testing.T) {
	repo, migration := prepareProcessMapGeometryCompactionMigrationTest(t)
	identityBefore := readProcessMapCompactionIdentitySnapshot(t, repo)
	relationshipsBefore := readProcessMapCompactionSnapshot(t, repo).relationships

	if _, err := repo.db.Exec(migration); err != nil {
		t.Fatalf("apply Process Map geometry compaction: %v", err)
	}

	if identityAfter := readProcessMapCompactionIdentitySnapshot(t, repo); identityAfter != identityBefore {
		t.Fatalf("compaction changed placement identity, parentage, incarnation, or creation time:\nbefore: %s\nafter:  %s", identityBefore, identityAfter)
	}
	if relationshipsAfter := readProcessMapCompactionSnapshot(t, repo).relationships; relationshipsAfter != relationshipsBefore {
		t.Fatalf("compaction changed operational relationships:\nbefore: %s\nafter:  %s", relationshipsBefore, relationshipsAfter)
	}

	type geometry struct {
		x, y, width, height int
		revision            int64
		created             time.Time
	}
	readGeometry := func(companyID, resourceType, resourceID string) geometry {
		t.Helper()
		var item geometry
		if err := repo.db.QueryRow(`
select grid_x,grid_y,grid_width,grid_height,revision,created_timestamp
from process_map_placements
where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`,
			companyID, resourceType, resourceID,
		).Scan(&item.x, &item.y, &item.width, &item.height, &item.revision, &item.created); err != nil {
			t.Fatal(err)
		}
		return item
	}

	root := readGeometry(processMapCompactionCompanyA, domain.ProcessMapResourceTypeFolder, "20000000-0000-4000-8000-000000000001")
	if root.x != 0 || root.y != 0 || root.width != 57 || root.height != 42 || root.revision != 5 || !root.created.Equal(time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("compacted root = %+v, want x=0 y=0 width=57 height=42 revision=5 with preserved creation time", root)
	}
	far := readGeometry(processMapCompactionCompanyA, domain.ProcessMapResourceTypeProcess, processMapCompactionFarID)
	if far.x != 81 || far.y != 54 || far.width != 7 || far.height != 5 || far.revision != 2 || !far.created.Equal(time.Date(2026, 8, 2, 0, 0, 1, 0, time.UTC)) {
		t.Fatalf("compacted far Process = %+v, want x=81 y=54 width=7 height=5 revision=2 with preserved creation time", far)
	}
	inside := readGeometry(processMapCompactionCompanyA, domain.ProcessMapResourceTypeProcess, "30000000-0000-4000-8000-000000000001")
	if inside.x != 2 || inside.y != 2 || inside.width != 7 || inside.height != 5 || inside.revision != 7 {
		t.Fatalf("compacted contained Process = %+v, want x=2 y=2 width=7 height=5 revision=7", inside)
	}

	secondA := readGeometry(processMapCompactionCompanyB, domain.ProcessMapResourceTypeProcess, "30000000-0000-4000-8000-000000000011")
	secondB := readGeometry(processMapCompactionCompanyB, domain.ProcessMapResourceTypeProcess, "30000000-0000-4000-8000-000000000012")
	if secondA.x != 0 || secondA.y != 0 || secondA.width != 7 || secondA.height != 5 || secondA.revision != 12 {
		t.Fatalf("company B first geometry = %+v, want independently mapped 0,0 7x5 revision 12", secondA)
	}
	if secondB.x != 19 || secondB.y != 17 || secondB.width != 7 || secondB.height != 5 || secondB.revision != 13 {
		t.Fatalf("company B second geometry = %+v, want independently mapped 19,17 7x5 revision 13", secondB)
	}

	var containmentFailures int
	if err := repo.db.QueryRow(`
select count(*)
from process_map_placements child
join process_map_placements parent
  on parent.company_id=child.company_id
 and parent.resource_type='company_explorer_folder'
 and parent.resource_id=child.map_parent_folder_id
where child.grid_x<parent.grid_x or child.grid_y<parent.grid_y
   or child.grid_x::bigint+child.grid_width>parent.grid_x::bigint+parent.grid_width
   or child.grid_y::bigint+child.grid_height>parent.grid_y::bigint+parent.grid_height`).Scan(&containmentFailures); err != nil {
		t.Fatal(err)
	}
	if containmentFailures != 0 {
		t.Fatalf("compaction left %d containment failures", containmentFailures)
	}

	readRoute := func(relationshipID string) ([]domain.ProcessMapRoutePoint, int64, time.Time) {
		t.Helper()
		var raw []byte
		var revision int64
		var created time.Time
		if err := repo.db.QueryRow(`
select route_points,revision,created_timestamp
from process_map_traces
where company_id=$1::uuid and resource_operational_relationship_id=$2::uuid`,
			processMapCompactionCompanyA, relationshipID,
		).Scan(&raw, &revision, &created); err != nil {
			t.Fatal(err)
		}
		var route []domain.ProcessMapRoutePoint
		if err := json.Unmarshal(raw, &route); err != nil {
			t.Fatal(err)
		}
		return route, revision, created
	}
	route, routeRevision, routeCreated := readRoute("40000000-0000-4000-8000-000000000002")
	wantRoute := []domain.ProcessMapRoutePoint{{X: 45, Y: 5}, {X: 69, Y: 56}}
	if !reflect.DeepEqual(route, wantRoute) || routeRevision != 4 || !routeCreated.Equal(time.Date(2026, 8, 2, 0, 0, 3, 0, time.UTC)) {
		t.Fatalf("compacted far trace = %v revision=%d created=%v, want %v revision=4 with preserved creation time", route, routeRevision, routeCreated, wantRoute)
	}
	sharedRoute, sharedRevision, _ := readRoute("40000000-0000-4000-8000-000000000001")
	if !reflect.DeepEqual(sharedRoute, []domain.ProcessMapRoutePoint{{X: 3, Y: 3}, {X: 6, Y: 3}}) || sharedRevision != 11 {
		t.Fatalf("compacted shared trace = %v revision=%d", sharedRoute, sharedRevision)
	}

	var payloadRaw []byte
	if err := repo.db.QueryRow(`
select restore_payload
from recycle_bin_items
where company_id=$1::uuid and recycle_bin_item_id='50000000-0000-4000-8000-000000000002'`,
		processMapCompactionCompanyA,
	).Scan(&payloadRaw); err != nil {
		t.Fatal(err)
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(payloadRaw, &payload); err != nil {
		t.Fatal(err)
	}
	var recycledPlacements []domain.ProcessMapPlacement
	if err := json.Unmarshal(payload["process_map_placements"], &recycledPlacements); err != nil {
		t.Fatal(err)
	}
	placementByID := map[string]domain.ProcessMapPlacement{}
	for _, placement := range recycledPlacements {
		placementByID[placement.ResourceID] = placement
	}
	recycledRoot := placementByID["20000000-0000-4000-8000-000000000001"]
	if recycledRoot.GridX != 0 || recycledRoot.GridY != 0 || recycledRoot.GridWidth != 57 || recycledRoot.GridHeight != 42 || recycledRoot.Revision != 5 {
		t.Fatalf("recycled root geometry = %+v", recycledRoot)
	}
	recycledFar := placementByID[processMapCompactionFarID]
	if recycledFar.GridX != 81 || recycledFar.GridY != 54 || recycledFar.Revision != 2 {
		t.Fatalf("recycled far geometry = %+v", recycledFar)
	}

	var recycledTraces []domain.ProcessMapTrace
	if err := json.Unmarshal(payload["process_map_traces"], &recycledTraces); err != nil {
		t.Fatal(err)
	}
	traceByID := map[string]domain.ProcessMapTrace{}
	for _, trace := range recycledTraces {
		traceByID[trace.ResourceOperationalRelationshipID] = trace
	}
	recycledFarTrace := traceByID["40000000-0000-4000-8000-000000000002"]
	if !reflect.DeepEqual(recycledFarTrace.RoutePoints, wantRoute) || recycledFarTrace.Revision != 4 {
		t.Fatalf("recycled far trace = %+v", recycledFarTrace)
	}

	type cleanupClaim struct {
		ResourceID      string `json:"resource_id"`
		CleanupRevision int64  `json:"cleanup_revision"`
		GridX           int    `json:"grid_x"`
		GridY           int    `json:"grid_y"`
		GridWidth       int    `json:"grid_width"`
		GridHeight      int    `json:"grid_height"`
	}
	var cleanupClaims []cleanupClaim
	if err := json.Unmarshal(payload["process_map_cleanup_child_reparents"], &cleanupClaims); err != nil {
		t.Fatal(err)
	}
	claimsByID := map[string]cleanupClaim{}
	for _, claim := range cleanupClaims {
		claimsByID[claim.ResourceID] = claim
	}
	currentClaim := claimsByID[processMapCompactionFarID]
	if currentClaim.CleanupRevision != far.revision || currentClaim.GridX != far.x || currentClaim.GridY != far.y || currentClaim.GridWidth != far.width || currentClaim.GridHeight != far.height {
		t.Fatalf("current cleanup claim = %+v, live geometry = %+v", currentClaim, far)
	}
	staleClaim := claimsByID["30000000-0000-4000-8000-000000000001"]
	if staleClaim.CleanupRevision != 5 || staleClaim.CleanupRevision >= inside.revision || staleClaim.GridX != inside.x || staleClaim.GridY != inside.y {
		t.Fatalf("stale cleanup claim = %+v, live geometry = %+v", staleClaim, inside)
	}

	versions := map[string]int64{}
	rows, err := repo.db.Query(`
select company_id::text,version
from workspace_read_versions
where scope='process-map' and resource_key=''
  and company_id in ($1::uuid,$2::uuid)
order by company_id`, processMapCompactionCompanyA, processMapCompactionCompanyB)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var companyID string
		var version int64
		if err := rows.Scan(&companyID, &version); err != nil {
			t.Fatal(err)
		}
		versions[companyID] = version
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if versions[processMapCompactionCompanyA] != 9 || versions[processMapCompactionCompanyB] != 5 {
		t.Fatalf("compacted read versions = %+v, want company A=9 company B=5", versions)
	}

	firstRun := readProcessMapCompactionSnapshot(t, repo)
	if _, err := repo.db.Exec(migration); err != nil {
		t.Fatalf("repeat Process Map geometry compaction: %v", err)
	}
	secondRun := readProcessMapCompactionSnapshot(t, repo)
	if firstRun != secondRun {
		t.Fatalf("repeated compaction was not an algorithmic no-op:\nfirst:  %+v\nsecond: %+v", firstRun, secondRun)
	}
}

func TestPostgresProcessMapGeometryCompactionMigrationRejectsMalformedPayloadAtomically(t *testing.T) {
	repo, migration := prepareProcessMapGeometryCompactionMigrationTest(t)
	if _, err := repo.db.Exec(`
update recycle_bin_items item
set restore_payload=jsonb_set(
  item.restore_payload,
  '{process_map_placements,0,grid_x}',
  '"not-an-integer"'::jsonb,
  false
)
where item.recycle_bin_item_id='50000000-0000-4000-8000-000000000002'`); err != nil {
		t.Fatal(err)
	}
	before := readProcessMapCompactionSnapshot(t, repo)

	conn, err := repo.db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_, migrationErr := conn.ExecContext(context.Background(), migration)
	if migrationErr == nil || !strings.Contains(migrationErr.Error(), "malformed recycled placement") {
		t.Fatalf("malformed payload migration error = %v, want preflight rejection", migrationErr)
	}
	if _, err := conn.ExecContext(context.Background(), "rollback"); err != nil {
		t.Fatalf("rollback rejected compaction transaction: %v", err)
	}

	after := readProcessMapCompactionSnapshot(t, repo)
	if after != before {
		t.Fatalf("rejected compaction changed data:\nbefore: %+v\nafter:  %+v", before, after)
	}
}
