package store

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
)

func TestPostgresProcessMapTileLODMatchesMemoryProjection(t *testing.T) {
	ctx := context.Background()
	_, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Process Map PostgreSQL LOD parity")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := repo.UpsertAuthUser("process-map-lod-admin", "process-map-lod@example.com", "LOD Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}

	type fixture struct {
		name                string
		x, y, width, height int
		presentation        domain.ProcessMapPresentation
	}
	fixtures := []fixture{
		{name: "Small", x: 10, y: 10, width: 7, height: 5, presentation: domain.ProcessMapPresentationWhole},
		{name: "Small Target", x: 30, y: 10, width: 7, height: 5, presentation: domain.ProcessMapPresentationWhole},
		{name: "Medium", x: 100, y: 20, width: 100, height: 100, presentation: domain.ProcessMapPresentationNormal},
		{name: "Large", x: 300, y: 200, width: 400, height: 400, presentation: domain.ProcessMapPresentationEditing},
		{name: "Large Target", x: 700, y: 600, width: 400, height: 400, presentation: domain.ProcessMapPresentationEditing},
	}
	processIDs := map[string]string{}
	for _, item := range fixtures {
		process, err := repo.CreateLogicGate(company.CompanyID, item.name)
		if err != nil {
			t.Fatal(err)
		}
		processIDs[item.name] = process.LogicGateID
		if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(
			company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeProcess, process.LogicGateID, nil,
			item.x, item.y, item.width, item.height,
		)); err != nil {
			t.Fatal(err)
		}
	}

	wholeRoute := []domain.ProcessMapRoutePoint{{X: 24, Y: 12}}
	wholeRelationship, err := repo.CreateResourceOperationalRelationship(ctx, ResourceOperationalRelationshipCreateInput{
		CompanyID:   company.CompanyID,
		Source:      processMapTestRef(domain.ProcessMapResourceTypeProcess, processIDs["Small"]),
		Target:      processMapTestRef(domain.ProcessMapResourceTypeProcess, processIDs["Small Target"]),
		Trace:       &ProcessMapTraceInput{RoutePoints: wholeRoute},
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	editingRoute := []domain.ProcessMapRoutePoint{{X: 800, Y: 400}}
	editingRelationship, err := repo.CreateResourceOperationalRelationship(ctx, ResourceOperationalRelationshipCreateInput{
		CompanyID:   company.CompanyID,
		Source:      processMapTestRef(domain.ProcessMapResourceTypeProcess, processIDs["Large"]),
		Target:      processMapTestRef(domain.ProcessMapResourceTypeProcess, processIDs["Large Target"]),
		Trace:       &ProcessMapTraceInput{RoutePoints: editingRoute},
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}

	tile, err := repo.GetProcessMapTile(ctx, ProcessMapTileQuery{
		CompanyID: company.CompanyID, PermissionUserID: admin.UserID, Z: 20, X: 0, Y: 0,
	})
	if err != nil {
		t.Fatal(err)
	}
	placementsByID := map[string]domain.ProcessMapVisiblePlacement{}
	for _, item := range tile.Placements {
		placement, ok := item.(domain.ProcessMapVisiblePlacement)
		if !ok {
			t.Fatalf("LOD placement type = %T", item)
		}
		placementsByID[placement.ResourceID] = placement
	}
	for _, item := range fixtures {
		placement, ok := placementsByID[processIDs[item.name]]
		if !ok {
			t.Fatalf("LOD tile missing %s", item.name)
		}
		wantName := item.name
		if item.presentation == domain.ProcessMapPresentationWhole {
			wantName = ""
		}
		if placement.Presentation != item.presentation || placement.Name != wantName {
			t.Fatalf("PostgreSQL %s projection = %s/%q, want memory parity %s/%q", item.name, placement.Presentation, placement.Name, item.presentation, wantName)
		}
	}

	traceByID := map[string]domain.ProcessMapTileTrace{}
	for _, trace := range tile.Traces {
		traceByID[trace.ResourceOperationalRelationshipID] = trace
	}
	wholeTrace := traceByID[wholeRelationship.Relationship.ResourceOperationalRelationshipID]
	if wholeTrace.Presentation != domain.ProcessMapPresentationWhole || len(wholeTrace.RoutePoints) != 0 || wholeTrace.TraceWidth != 1 {
		t.Fatalf("whole trace projection = %+v, want omitted route_points", wholeTrace)
	}
	editingTrace := traceByID[editingRelationship.Relationship.ResourceOperationalRelationshipID]
	if editingTrace.Presentation != domain.ProcessMapPresentationEditing || !reflect.DeepEqual(editingTrace.RoutePoints, editingRoute) || editingTrace.TraceWidth != 400.0/7.0 {
		t.Fatalf("editing trace projection = %+v, want route_points %v", editingTrace, editingRoute)
	}

	wire, err := json.Marshal(tile)
	if err != nil {
		t.Fatal(err)
	}
	var payload struct {
		Placements []map[string]any `json:"placements"`
	}
	if err := json.Unmarshal(wire, &payload); err != nil {
		t.Fatal(err)
	}
	for _, placement := range payload.Placements {
		resourceID, _ := placement["resource_id"].(string)
		if resourceID == processIDs["Small"] {
			if _, leaked := placement["name"]; leaked {
				t.Fatalf("whole placement leaked coarse name on the wire: %+v", placement)
			}
		}
	}
}

func TestPostgresProcessMapTileUsesSpatialGiSTIndex(t *testing.T) {
	db, _ := openPostgresProcessMapIntegration(t)
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`set local enable_seqscan=off`); err != nil {
		t.Fatal(err)
	}
	rows, err := tx.Query(`
explain (costs off)
select resource_id
from process_map_placements
where box(
  point(grid_x::double precision,grid_y::double precision),
  point((grid_x::bigint+grid_width)::double precision,(grid_y::bigint+grid_height)::double precision)
) && box(point(0::double precision,0::double precision),point(256::double precision,256::double precision))`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	planLines := []string{}
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatal(err)
		}
		planLines = append(planLines, line)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	plan := strings.Join(planLines, "\n")
	if !strings.Contains(plan, "idx_process_map_placements_spatial") {
		t.Fatalf("Process Map tile spatial predicate did not use GiST index:\n%s", plan)
	}
}

func TestPostgresProcessMapTileCancellationReachesPostgreSQL(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Process Map cancellation test")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := repo.UpsertAuthUser("process-map-cancellation-admin", "process-map-cancellation@example.com", "Cancellation Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}

	lockTx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer lockTx.Rollback()
	if _, err := lockTx.Exec(`lock table process_map_placements in access exclusive mode`); err != nil {
		t.Fatal(err)
	}

	queryCtx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		_, err := repo.GetProcessMapTile(queryCtx, ProcessMapTileQuery{
			CompanyID: company.CompanyID, PermissionUserID: admin.UserID, Z: 0, X: 0, Y: 0,
		})
		result <- err
	}()

	deadline := time.Now().Add(5 * time.Second)
	blockedInPostgres := false
	for time.Now().Before(deadline) {
		if err := db.QueryRow(`
select exists(
  select 1 from pg_stat_activity
  where datname=current_database()
    and application_name='mangorts_process_map_test'
    and pid<>pg_backend_pid()
    and state='active'
    and wait_event_type='Lock'
)`).Scan(&blockedInPostgres); err != nil {
			t.Fatal(err)
		}
		if blockedInPostgres {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !blockedInPostgres {
		cancel()
		t.Fatal("Process Map tile query never reached its blocked PostgreSQL spatial read")
	}

	cancel()
	select {
	case queryErr := <-result:
		if !errors.Is(queryErr, context.Canceled) {
			t.Fatalf("canceled Process Map tile error = %v, want context.Canceled", queryErr)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("canceled Process Map tile query did not return")
	}

	deadline = time.Now().Add(3 * time.Second)
	stillActive := true
	for time.Now().Before(deadline) {
		if err := db.QueryRow(`
select exists(
  select 1 from pg_stat_activity
  where datname=current_database()
    and application_name='mangorts_process_map_test'
    and state='active'
    and wait_event_type='Lock'
)`).Scan(&stillActive); err != nil {
			t.Fatal(err)
		}
		if !stillActive {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if stillActive {
		t.Fatal("canceled Process Map tile query remained active in PostgreSQL")
	}
}
