package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"net"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

func postgresProcessMapVersionForTest(t *testing.T, repo *PostgresRepo, companyID string) int64 {
	t.Helper()
	version, found, err := repo.CurrentWorkspaceReadVersion(WorkspaceReadVersionQuery{CompanyID: companyID, Scope: "process-map"})
	if err != nil || !found {
		t.Fatalf("Process Map read version for %s = %d/%t err=%v", companyID, version, found, err)
	}
	return version
}

func postgresPolicyGroupVersionForTest(t *testing.T, repo *PostgresRepo, companyID string) int64 {
	t.Helper()
	version, found, err := repo.CurrentWorkspaceReadVersion(WorkspaceReadVersionQuery{CompanyID: companyID, Scope: "policy-group-membership"})
	if err != nil || !found {
		t.Fatalf("policy/group read version for %s = %d/%t err=%v", companyID, version, found, err)
	}
	return version
}

func openPostgresProcessMapTestDatabase(t *testing.T) *sql.DB {
	t.Helper()
	dsn := strings.TrimSpace(os.Getenv("MANGORTS_PROCESS_MAP_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("set MANGORTS_PROCESS_MAP_TEST_DATABASE_URL to a disposable local PostgreSQL 17 or 18 database")
	}
	if os.Getenv("MANGORTS_PROCESS_MAP_TEST_RESET_ACK") != "DROP_DISPOSABLE_SCHEMA" {
		t.Fatal("set MANGORTS_PROCESS_MAP_TEST_RESET_ACK=DROP_DISPOSABLE_SCHEMA for the guarded disposable test")
	}
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	privateHostAck := strings.TrimSpace(os.Getenv("MANGORTS_PROCESS_MAP_TEST_PRIVATE_HOST_ACK"))
	privateHostIP := net.ParseIP(config.Host)
	isLoopback := config.Host == "127.0.0.1" || strings.EqualFold(config.Host, "localhost")
	isAcknowledgedPrivateHost := privateHostAck != "" && config.Host == privateHostAck && privateHostIP != nil && privateHostIP.IsPrivate()
	if !isLoopback && !isAcknowledgedPrivateHost {
		t.Fatalf("refusing non-local disposable database host %q", config.Host)
	}
	config.RuntimeParams["client_encoding"] = "UTF8"
	config.RuntimeParams["application_name"] = "mangorts_process_map_test"
	config.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	db := stdlib.OpenDB(*config)
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)
	t.Cleanup(func() { _ = db.Close() })

	var version int
	var databaseName string
	if err := db.QueryRow(`select current_setting('server_version_num')::integer,current_database()`).Scan(&version, &databaseName); err != nil {
		t.Fatal(err)
	}
	if version < 170000 || version >= 190000 || !strings.HasPrefix(databaseName, "mangorts_process_map_test") {
		t.Fatalf("refusing PostgreSQL version/database %d/%q", version, databaseName)
	}
	if _, err := db.Exec("drop schema public cascade; create schema public"); err != nil {
		t.Fatalf("reset disposable schema: %v", err)
	}
	return db
}

func openPostgresProcessMapIntegration(t *testing.T) (*sql.DB, *PostgresRepo) {
	t.Helper()
	db := openPostgresProcessMapTestDatabase(t)
	schema, err := os.ReadFile(filepath.Join("..", "..", "db", "schema.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(schema)); err != nil {
		t.Fatalf("apply canonical schema: %v", err)
	}
	return db, NewPostgresRepo(db)
}

func TestPostgresProcessMapRepositoryLifecycle(t *testing.T) {
	ctx := context.Background()
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Process Map repository test")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := repo.UpsertAuthUser("process-map-postgres-admin", "process-map-admin@example.com", "Process Map Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	outsider, err := repo.UpsertAuthUser("process-map-postgres-outsider", "process-map-outsider@example.com", "Process Map Outsider")
	if err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Operations")
	if err != nil {
		t.Fatal(err)
	}
	processA, err := repo.CreateLogicGate(company.CompanyID, "Receive")
	if err != nil {
		t.Fatal(err)
	}
	processB, err := repo.CreateLogicGate(company.CompanyID, "Ship")
	if err != nil {
		t.Fatal(err)
	}
	parentID := folder.FolderID
	placements := []ProcessMapPlacementPutInput{
		processMapTestPlacementWithSize(company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 0, 0, 80, 40),
		processMapTestPlacementWithSize(company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeProcess, processA.LogicGateID, &parentID, 10, 10, 10, 6),
		processMapTestPlacementWithSize(company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeProcess, processB.LogicGateID, &parentID, 30, 10, 10, 6),
	}
	for _, input := range placements {
		if _, err := repo.PutProcessMapPlacement(ctx, input); err != nil {
			t.Fatalf("PutProcessMapPlacement(%s/%s): %v", input.ResourceType, input.ResourceID, err)
		}
	}
	denied := placements[1]
	denied.ActorUserID = outsider.UserID
	denied.PermissionUserID = outsider.UserID
	if _, err := repo.PutProcessMapPlacement(ctx, denied); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unauthorized placement error = %v, want %v", err, ErrNotFound)
	}

	relationshipInput := ResourceOperationalRelationshipCreateInput{
		CompanyID:   company.CompanyID,
		Source:      domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: processA.LogicGateID},
		Target:      domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: processB.LogicGateID},
		Trace:       &ProcessMapTraceInput{RoutePoints: []domain.ProcessMapRoutePoint{{X: 2, Y: 2}, {X: 2, Y: 4}, {X: 5, Y: 4}}},
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	}
	created, err := repo.CreateResourceOperationalRelationship(ctx, relationshipInput)
	if err != nil {
		t.Fatal(err)
	}
	if !created.Created || !created.Changed || created.Relationship == nil || len(created.Traces) != 1 || created.Traces[0].Revision != 1 {
		t.Fatalf("created relationship = %+v", created)
	}
	requireProcessMapRelationshipEventIdentities(t, created.Events, *created.Relationship)
	retry, err := repo.CreateResourceOperationalRelationship(ctx, relationshipInput)
	if err != nil {
		t.Fatal(err)
	}
	if retry.Created || retry.Changed || retry.Relationship == nil || len(retry.Traces) != 1 || retry.Traces[0].Revision != 1 || retry.Relationship.ResourceOperationalRelationshipID != created.Relationship.ResourceOperationalRelationshipID {
		t.Fatalf("idempotent relationship retry = %+v", retry)
	}

	scene, err := repo.GetProcessMapScene(ctx, ProcessMapSceneQuery{CompanyID: company.CompanyID, PermissionUserID: admin.UserID})
	if err != nil || scene.Bounds == nil || scene.Bounds.MinX > 0 || scene.Bounds.MinY > 0 || scene.Bounds.MaxX < 80 || scene.Bounds.MaxY < 40 {
		t.Fatalf("global scene = %+v err=%v", scene, err)
	}
	tile, err := repo.GetProcessMapTile(ctx, ProcessMapTileQuery{CompanyID: company.CompanyID, PermissionUserID: admin.UserID, Z: 0, X: 0, Y: 0})
	if err != nil || len(tile.Placements) != 6 || len(tile.Traces) != 1 || len(tile.Traces[0].PathFragments) == 0 {
		t.Fatalf("global tile = %+v err=%v", tile, err)
	}
	if _, err := repo.GetProcessMapScene(ctx, ProcessMapSceneQuery{CompanyID: company.CompanyID, PermissionUserID: outsider.UserID}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-member scene error = %v, want %v", err, ErrNotFound)
	}

	points := []domain.ProcessMapRoutePoint{{X: 1, Y: 2}, {X: 1, Y: 6}, {X: 5, Y: 6}}
	traceInput := ProcessMapTracePutInput{CompanyID: company.CompanyID, ResourceOperationalRelationshipID: created.Relationship.ResourceOperationalRelationshipID, RoutePoints: points, ActorUserID: admin.UserID, PermissionUserID: admin.UserID}
	routed, err := repo.PutProcessMapTrace(ctx, traceInput)
	if err != nil || !routed.Changed || len(routed.Traces) != 1 || routed.Traces[0].Revision != 2 {
		t.Fatalf("rerouted trace = %+v err=%v", routed, err)
	}
	requireProcessMapRelationshipEventIdentities(t, routed.Events, *created.Relationship)
	identical, err := repo.PutProcessMapTrace(ctx, traceInput)
	if err != nil || identical.Changed || len(identical.Traces) != 1 || identical.Traces[0].Revision != 2 {
		t.Fatalf("identical trace retry = %+v err=%v", identical, err)
	}
	relationships, err := repo.ListResourceOperationalRelationshipsForResource(ctx, ResourceOperationalRelationshipQuery{
		CompanyID: company.CompanyID, ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: processA.LogicGateID, Direction: "outgoing", PermissionUserID: admin.UserID,
	})
	if err != nil || len(relationships) != 1 || relationships[0].ResourceOperationalRelationshipID != created.Relationship.ResourceOperationalRelationshipID {
		t.Fatalf("bounded relationships = %+v err=%v", relationships, err)
	}

	deletedPlacement, err := repo.DeleteProcessMapPlacement(ctx, ProcessMapPlacementDeleteInput{
		CompanyID: company.CompanyID, ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: processB.LogicGateID,
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil || len(deletedPlacement.DeletedTraceIDs) != 1 || deletedPlacement.DeletedTraceIDs[0] != created.Relationship.ResourceOperationalRelationshipID {
		t.Fatalf("placement delete envelope = %+v err=%v", deletedPlacement, err)
	}
	deletedRelationship, err := repo.DeleteResourceOperationalRelationship(ctx, ResourceOperationalRelationshipDeleteInput{
		CompanyID: company.CompanyID, ResourceOperationalRelationshipID: created.Relationship.ResourceOperationalRelationshipID,
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	requireProcessMapRelationshipEventIdentities(t, deletedRelationship.Events, *created.Relationship)
	var relationshipCount, traceCount, placementCount int
	if err := db.QueryRow(`select count(*) from resource_operational_relationships where company_id=$1::uuid`, company.CompanyID).Scan(&relationshipCount); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`select count(*) from process_map_traces where company_id=$1::uuid`, company.CompanyID).Scan(&traceCount); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`select count(*) from process_map_placements where company_id=$1::uuid`, company.CompanyID).Scan(&placementCount); err != nil {
		t.Fatal(err)
	}
	if relationshipCount != 0 || traceCount != 0 || placementCount != 5 {
		t.Fatalf("delete counts relationships=%d traces=%d placements=%d, want 0/0/5", relationshipCount, traceCount, placementCount)
	}
}

func TestPostgresProcessMapAutomaticPlacementMigrationCanonicalizesExplorerProjection(t *testing.T) {
	ctx := context.Background()
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Process Map automatic projection migration")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := repo.UpsertAuthUser("process-map-projection-admin", "process-map-projection@example.com", "Projection Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	rootA, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Root A")
	if err != nil {
		t.Fatal(err)
	}
	rootB, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Root B")
	if err != nil {
		t.Fatal(err)
	}
	nested, err := repo.CreateCompanyExplorerFolder(company.CompanyID, rootA.FolderID, "logic_gate", "Nested")
	if err != nil {
		t.Fatal(err)
	}
	kept, err := repo.CreateLogicGate(company.CompanyID, "Kept Process")
	if err != nil {
		t.Fatal(err)
	}
	keptSecond, err := repo.CreateLogicGate(company.CompanyID, "Second Kept Process")
	if err != nil {
		t.Fatal(err)
	}
	orphan, err := repo.CreateLogicGate(company.CompanyID, "Old map-only Process")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(company.CompanyID, nested.FolderID, EntityTypeLogicGate, kept.LogicGateID, 0); err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(company.CompanyID, nested.FolderID, EntityTypeLogicGate, keptSecond.LogicGateID, 1000); err != nil {
		t.Fatal(err)
	}
	created, err := repo.CreateResourceOperationalRelationship(ctx, ResourceOperationalRelationshipCreateInput{
		CompanyID: company.CompanyID,
		Source:    processMapTestRef(domain.ProcessMapResourceTypeProcess, kept.LogicGateID),
		Target:    processMapTestRef(domain.ProcessMapResourceTypeProcess, orphan.LogicGateID),
		Trace: &ProcessMapTraceInput{RoutePoints: []domain.ProcessMapRoutePoint{
			{X: 5, Y: 5}, {X: 10, Y: 5},
		}},
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil || created.Relationship == nil {
		t.Fatalf("create migration relationship = %+v, err=%v", created, err)
	}
	if _, err := db.Exec(`
update process_map_placements
set grid_x=-50,grid_y=-25,grid_width=150,grid_height=90
where company_id=$1::uuid and resource_type='company_explorer_folder' and resource_id=$2::uuid`, company.CompanyID, rootA.FolderID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
update process_map_placements
set grid_height=70
where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`, company.CompanyID, kept.LogicGateID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
update company_explorer_folders
set parent_folder_id=$3::uuid,updated_timestamp=statement_timestamp()
where company_id=$1::uuid and folder_id=$2::uuid`, company.CompanyID, nested.FolderID, rootB.FolderID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
delete from company_explorer_items
where company_id=$1::uuid and target_type='logic_gate' and target_id=$2::uuid`, company.CompanyID, orphan.LogicGateID); err != nil {
		t.Fatal(err)
	}
	versionBefore := postgresProcessMapVersionForTest(t, repo, company.CompanyID)

	migration, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260826_zz_process_map_automatic_placement.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(migration)); err != nil {
		t.Fatalf("apply automatic placement migration: %v", err)
	}
	versionAfter := postgresProcessMapVersionForTest(t, repo, company.CompanyID)
	if versionAfter <= versionBefore {
		t.Fatalf("automatic placement migration Process Map version = %d, want > %d", versionAfter, versionBefore)
	}
	var migrationSequence int64
	if err := db.QueryRow(`
select sequence
from domain_events
where company_id=$1::uuid and idempotency_key='migration:20260826-process-map-automatic-placement'`, company.CompanyID).Scan(&migrationSequence); err != nil {
		t.Fatal(err)
	}
	if versionAfter != migrationSequence {
		t.Fatalf("automatic placement migration Process Map version = %d, want migration event sequence %d", versionAfter, migrationSequence)
	}
	nextEvent, err := repo.AppendDomainEvent(workspaceDomainEventInput(company.CompanyID, ProcessMapPlacementSavedEvent, map[string]any{
		"resource_type": domain.ProcessMapResourceTypeProcess,
		"resource_id":   kept.LogicGateID,
	}))
	if err != nil {
		t.Fatal(err)
	}
	if nextEvent.Sequence != migrationSequence+1 {
		t.Fatalf("next workspace event sequence = %d, want %d", nextEvent.Sequence, migrationSequence+1)
	}
	if nextVersion := postgresProcessMapVersionForTest(t, repo, company.CompanyID); nextVersion != nextEvent.Sequence {
		t.Fatalf("next Process Map version = %d, want event sequence %d", nextVersion, nextEvent.Sequence)
	}

	var rootX, rootY, rootWidth, rootHeight int
	if err := db.QueryRow(`
select grid_x,grid_y,grid_width,grid_height
from process_map_placements
where company_id=$1::uuid and resource_type='company_explorer_folder' and resource_id=$2::uuid`, company.CompanyID, rootA.FolderID).Scan(&rootX, &rootY, &rootWidth, &rootHeight); err != nil {
		t.Fatal(err)
	}
	if rootX != -50 || rootY != -25 || rootWidth != 150 || rootHeight != 90 {
		t.Fatalf("unchanged-parent root geometry = (%d,%d %dx%d), want (-50,-25 150x90)", rootX, rootY, rootWidth, rootHeight)
	}
	var nestedParent string
	if err := db.QueryRow(`
select map_parent_folder_id::text
from process_map_placements
where company_id=$1::uuid and resource_type='company_explorer_folder' and resource_id=$2::uuid`, company.CompanyID, nested.FolderID).Scan(&nestedParent); err != nil {
		t.Fatal(err)
	}
	if nestedParent != rootB.FolderID {
		t.Fatalf("nested map parent = %q, want %q", nestedParent, rootB.FolderID)
	}
	var keptY, keptHeight, keptSecondY int
	if err := db.QueryRow(`
select first.grid_y,first.grid_height,second.grid_y
from process_map_placements first
join process_map_placements second
  on second.company_id=first.company_id
where first.company_id=$1::uuid
  and first.resource_type='logic_gate' and first.resource_id=$2::uuid
  and second.resource_type='logic_gate' and second.resource_id=$3::uuid`, company.CompanyID, kept.LogicGateID, keptSecond.LogicGateID).Scan(&keptY, &keptHeight, &keptSecondY); err != nil {
		t.Fatal(err)
	}
	if keptSecondY < keptY+keptHeight+2 {
		t.Fatalf("second moved Process y = %d, want at least %d after oversized sibling", keptSecondY, keptY+keptHeight+2)
	}
	var missingPlacementCount, stalePlacementCount, traceCount, relationshipCount int
	if err := db.QueryRow(`
select count(*)
from company_explorer_items item
where item.company_id=$1::uuid and item.target_type='logic_gate'
  and not exists (
    select 1 from process_map_placements placement
    where placement.company_id=item.company_id and placement.resource_type='logic_gate' and placement.resource_id=item.target_id
  )`, company.CompanyID).Scan(&missingPlacementCount); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`
select count(*)
from process_map_placements placement
where placement.company_id=$1::uuid and placement.resource_type='logic_gate'
  and not exists (
    select 1 from company_explorer_items item
    where item.company_id=placement.company_id and item.target_type='logic_gate' and item.target_id=placement.resource_id
  )`, company.CompanyID).Scan(&stalePlacementCount); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`select count(*) from process_map_traces where company_id=$1::uuid`, company.CompanyID).Scan(&traceCount); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`select count(*) from resource_operational_relationships where company_id=$1::uuid`, company.CompanyID).Scan(&relationshipCount); err != nil {
		t.Fatal(err)
	}
	if missingPlacementCount != 0 || stalePlacementCount != 0 || traceCount != 1 || relationshipCount != 1 {
		t.Fatalf("projection counts missing=%d stale=%d traces=%d relationships=%d, want 0/0/1/1", missingPlacementCount, stalePlacementCount, traceCount, relationshipCount)
	}
}

func TestPostgresAutomaticProcessMapPlacementKeepsRootGapAfterDeepGrowth(t *testing.T) {
	ctx := context.Background()
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Process Map runtime root spacing")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := repo.UpsertAuthUser("process-map-root-spacing-admin", "process-map-root-spacing@example.com", "Root Spacing Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	rootA, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Root A")
	if err != nil {
		t.Fatal(err)
	}
	rootB, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Root B")
	if err != nil {
		t.Fatal(err)
	}
	processA, err := repo.CreateLogicGate(company.CompanyID, "Root A Process")
	if err != nil {
		t.Fatal(err)
	}
	processB, err := repo.CreateLogicGate(company.CompanyID, "Root B Process")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(company.CompanyID, rootA.FolderID, EntityTypeLogicGate, processA.LogicGateID, 0); err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(company.CompanyID, rootB.FolderID, EntityTypeLogicGate, processB.LogicGateID, 0); err != nil {
		t.Fatal(err)
	}
	created, err := repo.CreateResourceOperationalRelationship(ctx, ResourceOperationalRelationshipCreateInput{
		CompanyID:   company.CompanyID,
		Source:      processMapTestRef(domain.ProcessMapResourceTypeProcess, processA.LogicGateID),
		Target:      processMapTestRef(domain.ProcessMapResourceTypeProcess, processB.LogicGateID),
		Trace:       &ProcessMapTraceInput{RoutePoints: []domain.ProcessMapRoutePoint{{X: 10, Y: 10}, {X: 30, Y: 10}}},
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil || created.Relationship == nil {
		t.Fatalf("create relationship before automatic growth = %+v, err=%v", created, err)
	}
	growingFolder, err := repo.CreateCompanyExplorerFolder(company.CompanyID, rootA.FolderID, "logic_gate", "Growing Folder")
	if err != nil {
		t.Fatal(err)
	}
	laterFolder, err := repo.CreateCompanyExplorerFolder(company.CompanyID, rootA.FolderID, "logic_gate", "Later Folder")
	if err != nil {
		t.Fatal(err)
	}

	type geometry struct {
		x, y, width, height int
		revision            int64
	}
	readGeometry := func(resourceType, resourceID string) geometry {
		t.Helper()
		var result geometry
		if err := db.QueryRow(`
select grid_x,grid_y,grid_width,grid_height,revision
from process_map_placements
where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`,
			company.CompanyID, resourceType, resourceID).Scan(&result.x, &result.y, &result.width, &result.height, &result.revision); err != nil {
			t.Fatal(err)
		}
		return result
	}
	laterPlacement := readGeometry(domain.ProcessMapResourceTypeFolder, laterFolder.FolderID)
	rootAID := rootA.FolderID
	if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(
		company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeFolder, laterFolder.FolderID, &rootAID,
		laterPlacement.x, laterPlacement.y, laterPlacement.width, laterPlacement.height,
	)); err != nil {
		t.Fatal(err)
	}
	beforeRootB := readGeometry(domain.ProcessMapResourceTypeFolder, rootB.FolderID)
	beforeGrowingFolder := readGeometry(domain.ProcessMapResourceTypeFolder, growingFolder.FolderID)
	beforeLaterFolder := readGeometry(domain.ProcessMapResourceTypeFolder, laterFolder.FolderID)
	beforeProcessA := readGeometry(domain.ProcessMapResourceTypeProcess, processA.LogicGateID)
	beforeProcessB := readGeometry(domain.ProcessMapResourceTypeProcess, processB.LogicGateID)
	var traceBefore string
	var traceRevisionBefore int64
	if err := db.QueryRow(`
select route_points::text,revision
from process_map_traces
where company_id=$1::uuid and resource_operational_relationship_id=$2::uuid`,
		company.CompanyID, created.Relationship.ResourceOperationalRelationshipID).Scan(&traceBefore, &traceRevisionBefore); err != nil {
		t.Fatal(err)
	}

	parentID := growingFolder.FolderID
	for depth := 0; depth < 4; depth++ {
		child, err := repo.CreateCompanyExplorerFolder(company.CompanyID, parentID, "logic_gate", "Nested")
		if err != nil {
			t.Fatal(err)
		}
		parentID = child.FolderID
	}
	afterRootA := readGeometry(domain.ProcessMapResourceTypeFolder, rootA.FolderID)
	afterRootB := readGeometry(domain.ProcessMapResourceTypeFolder, rootB.FolderID)
	afterProcessA := readGeometry(domain.ProcessMapResourceTypeProcess, processA.LogicGateID)
	afterProcessB := readGeometry(domain.ProcessMapResourceTypeProcess, processB.LogicGateID)
	afterGrowingFolder := readGeometry(domain.ProcessMapResourceTypeFolder, growingFolder.FolderID)
	afterLaterFolder := readGeometry(domain.ProcessMapResourceTypeFolder, laterFolder.FolderID)
	if afterRootB.x < afterRootA.x+afterRootA.width+postgresAutomaticProcessMapRootGap {
		t.Fatalf("automatic roots overlap after growth: A=%+v B=%+v", afterRootA, afterRootB)
	}
	if afterRootB.x <= beforeRootB.x {
		t.Fatalf("later root did not move after earlier root growth: before=%+v after=%+v", beforeRootB, afterRootB)
	}
	processSectionOffset := postgresAutomaticProcessMapPadding + postgresAutomaticProcessMapNestedFolderWidth + postgresAutomaticProcessMapSectionGap
	if afterProcessB.x-beforeProcessB.x != afterRootB.x-beforeRootB.x || afterProcessB.x != afterRootB.x+processSectionOffset {
		t.Fatalf("later root descendants did not keep their relative geometry: root=%+v Process=%+v", afterRootB, afterProcessB)
	}
	if afterLaterFolder != beforeLaterFolder {
		t.Fatalf("deep growth changed manual sibling geometry or revision: before=%+v after=%+v", beforeLaterFolder, afterLaterFolder)
	}
	if afterProcessA != beforeProcessA {
		t.Fatalf("deep growth changed unrelated Process geometry or revision: before=%+v after=%+v", beforeProcessA, afterProcessA)
	}
	overlaps := func(left, right geometry) bool {
		return left.x < right.x+right.width && left.x+left.width > right.x &&
			left.y < right.y+right.height && left.y+left.height > right.y
	}
	if afterGrowingFolder.y <= beforeGrowingFolder.y || overlaps(afterGrowingFolder, afterLaterFolder) || overlaps(afterGrowingFolder, afterProcessA) {
		t.Fatalf("affected growing Folder was not relocated safely: before=%+v after=%+v sibling=%+v Process=%+v", beforeGrowingFolder, afterGrowingFolder, afterLaterFolder, afterProcessA)
	}
	var traceAfter string
	var traceRevisionAfter int64
	var relationshipCount int
	if err := db.QueryRow(`
select route_points::text,revision
from process_map_traces
where company_id=$1::uuid and resource_operational_relationship_id=$2::uuid`,
		company.CompanyID, created.Relationship.ResourceOperationalRelationshipID).Scan(&traceAfter, &traceRevisionAfter); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`select count(*) from resource_operational_relationships where company_id=$1::uuid`, company.CompanyID).Scan(&relationshipCount); err != nil {
		t.Fatal(err)
	}
	if traceAfter != traceBefore || traceRevisionAfter != traceRevisionBefore || relationshipCount != 1 {
		t.Fatalf("automatic root spacing changed relationship data: trace=%q/%d before=%q/%d relationships=%d", traceAfter, traceRevisionAfter, traceBefore, traceRevisionBefore, relationshipCount)
	}
}

func TestPostgresAutomaticProcessMapPlacementStopsAtUnchangedParent(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Process Map unchanged parent")
	if err != nil {
		t.Fatal(err)
	}
	root, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Root")
	if err != nil {
		t.Fatal(err)
	}
	parent, err := repo.CreateCompanyExplorerFolder(company.CompanyID, root.FolderID, "logic_gate", "Parent")
	if err != nil {
		t.Fatal(err)
	}
	sibling, err := repo.CreateCompanyExplorerFolder(company.CompanyID, root.FolderID, "logic_gate", "Sibling")
	if err != nil {
		t.Fatal(err)
	}
	process, err := repo.CreateLogicGate(company.CompanyID, "New Process")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
update process_map_placements
set grid_x=0,grid_y=0,grid_width=500,grid_height=500,revision=revision+1,updated_timestamp=statement_timestamp()
where company_id=$1::uuid and resource_type='company_explorer_folder' and resource_id=$2::uuid`, company.CompanyID, root.FolderID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
update process_map_placements
set grid_x=10,grid_y=10,grid_width=200,grid_height=200,revision=revision+1,updated_timestamp=statement_timestamp()
where company_id=$1::uuid and resource_type='company_explorer_folder' and resource_id=$2::uuid`, company.CompanyID, parent.FolderID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
update process_map_placements
set grid_x=20,grid_y=20,grid_width=24,grid_height=16,revision=revision+1,updated_timestamp=statement_timestamp()
where company_id=$1::uuid and resource_type='company_explorer_folder' and resource_id=$2::uuid`, company.CompanyID, sibling.FolderID); err != nil {
		t.Fatal(err)
	}
	type geometry struct {
		x, y, width, height int
		revision            int64
	}
	readGeometry := func(resourceID string) geometry {
		t.Helper()
		var result geometry
		if err := db.QueryRow(`
select grid_x,grid_y,grid_width,grid_height,revision
from process_map_placements
where company_id=$1::uuid and resource_type='company_explorer_folder' and resource_id=$2::uuid`,
			company.CompanyID, resourceID).Scan(&result.x, &result.y, &result.width, &result.height, &result.revision); err != nil {
			t.Fatal(err)
		}
		return result
	}
	parentBefore := readGeometry(parent.FolderID)
	siblingBefore := readGeometry(sibling.FolderID)
	if _, _, err := repo.AssignCompanyExplorerFolderItem(company.CompanyID, parent.FolderID, EntityTypeLogicGate, process.LogicGateID, 0); err != nil {
		t.Fatal(err)
	}
	if parentAfter := readGeometry(parent.FolderID); parentAfter != parentBefore {
		t.Fatalf("contained Process changed its already-large parent: before=%+v after=%+v", parentBefore, parentAfter)
	}
	if siblingAfter := readGeometry(sibling.FolderID); siblingAfter != siblingBefore {
		t.Fatalf("contained Process changed an unrelated overlapping sibling: before=%+v after=%+v", siblingBefore, siblingAfter)
	}
}

func TestPostgresAutomaticProcessMapPlacementPreservesVerticallySeparatedRoot(t *testing.T) {
	ctx := context.Background()
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Process Map vertical root preservation")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := repo.UpsertAuthUser("process-map-vertical-root-admin", "process-map-vertical-root@example.com", "Vertical Root Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	rootA, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Root A")
	if err != nil {
		t.Fatal(err)
	}
	rootB, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Root B")
	if err != nil {
		t.Fatal(err)
	}
	type geometry struct {
		x, y, width, height int
		revision            int64
	}
	readGeometry := func(resourceID string) geometry {
		t.Helper()
		var result geometry
		if err := db.QueryRow(`
select grid_x,grid_y,grid_width,grid_height,revision
from process_map_placements
where company_id=$1::uuid and resource_type='company_explorer_folder' and resource_id=$2::uuid`,
			company.CompanyID, resourceID).Scan(&result.x, &result.y, &result.width, &result.height, &result.revision); err != nil {
			t.Fatal(err)
		}
		return result
	}
	rootBGeometry := readGeometry(rootB.FolderID)
	if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(
		company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeFolder, rootB.FolderID, nil,
		1, 100, rootBGeometry.width, rootBGeometry.height,
	)); err != nil {
		t.Fatal(err)
	}
	manualRootB := readGeometry(rootB.FolderID)
	parentID := rootA.FolderID
	for depth := 0; depth < 4; depth++ {
		child, err := repo.CreateCompanyExplorerFolder(company.CompanyID, parentID, "logic_gate", "Nested")
		if err != nil {
			t.Fatal(err)
		}
		parentID = child.FolderID
	}
	afterRootA := readGeometry(rootA.FolderID)
	afterRootB := readGeometry(rootB.FolderID)
	if afterRootB != manualRootB {
		t.Fatalf("vertical separation did not preserve manual root geometry: before=%+v after=%+v", manualRootB, afterRootB)
	}
	if afterRootA.x+afterRootA.width <= afterRootB.x || afterRootA.y+afterRootA.height > afterRootB.y {
		t.Fatalf("preservation fixture does not overlap only on X: A=%+v B=%+v", afterRootA, afterRootB)
	}
}

func TestPostgresAutomaticProcessMapPlacementPreservesStaggeredSeparatedRoot(t *testing.T) {
	ctx := context.Background()
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Process Map staggered root preservation")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := repo.UpsertAuthUser("process-map-staggered-root-admin", "process-map-staggered-root@example.com", "Staggered Root Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	rootA, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Root A")
	if err != nil {
		t.Fatal(err)
	}
	rootB, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Root B")
	if err != nil {
		t.Fatal(err)
	}
	type geometry struct {
		x, y, width, height int
		revision            int64
	}
	readGeometry := func(resourceID string) geometry {
		t.Helper()
		var result geometry
		if err := db.QueryRow(`
select grid_x,grid_y,grid_width,grid_height,revision
from process_map_placements
where company_id=$1::uuid and resource_type='company_explorer_folder' and resource_id=$2::uuid`,
			company.CompanyID, resourceID).Scan(&result.x, &result.y, &result.width, &result.height, &result.revision); err != nil {
			t.Fatal(err)
		}
		return result
	}
	rootAGeometry := readGeometry(rootA.FolderID)
	rootBGeometry := readGeometry(rootB.FolderID)
	var farX int
	if err := db.QueryRow(`
select coalesce(max(grid_x+grid_width),0)+1000
from process_map_placements
where company_id=$1::uuid and map_parent_folder_id is null
  and not (resource_type='company_explorer_folder' and resource_id=$2::uuid)`, company.CompanyID, rootB.FolderID).Scan(&farX); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(
		company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeFolder, rootB.FolderID, nil,
		farX, rootAGeometry.y+10, rootBGeometry.width, rootBGeometry.height,
	)); err != nil {
		t.Fatal(err)
	}
	manualRootB := readGeometry(rootB.FolderID)
	parentID := rootA.FolderID
	for depth := 0; depth < 4; depth++ {
		child, err := repo.CreateCompanyExplorerFolder(company.CompanyID, parentID, "logic_gate", "Nested")
		if err != nil {
			t.Fatal(err)
		}
		parentID = child.FolderID
	}
	afterRootA := readGeometry(rootA.FolderID)
	afterRootB := readGeometry(rootB.FolderID)
	if afterRootB != manualRootB {
		t.Fatalf("staggered horizontal separation did not preserve manual root: before=%+v after=%+v", manualRootB, afterRootB)
	}
	if afterRootA.y+afterRootA.height <= afterRootB.y || afterRootA.x+afterRootA.width+postgresAutomaticProcessMapRootGap >= afterRootB.x {
		t.Fatalf("staggered fixture is not vertically close and horizontally separated: A=%+v B=%+v", afterRootA, afterRootB)
	}
}

func TestPostgresProcessMapTidyInitialLayoutMigrationSeparatesRootsAndIsRestartSafe(t *testing.T) {
	ctx := context.Background()
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Process Map tidy initial layout")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := repo.UpsertAuthUser("process-map-tidy-admin", "process-map-tidy@example.com", "Tidy Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	rootA, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Root A")
	if err != nil {
		t.Fatal(err)
	}
	rootB, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Root B")
	if err != nil {
		t.Fatal(err)
	}
	nested, err := repo.CreateCompanyExplorerFolder(company.CompanyID, rootA.FolderID, "logic_gate", "Nested")
	if err != nil {
		t.Fatal(err)
	}
	processA, err := repo.CreateLogicGate(company.CompanyID, "First nested Process")
	if err != nil {
		t.Fatal(err)
	}
	processB, err := repo.CreateLogicGate(company.CompanyID, "Second nested Process")
	if err != nil {
		t.Fatal(err)
	}
	processC, err := repo.CreateLogicGate(company.CompanyID, "Root B Process")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(company.CompanyID, nested.FolderID, EntityTypeLogicGate, processA.LogicGateID, 0); err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(company.CompanyID, nested.FolderID, EntityTypeLogicGate, processB.LogicGateID, 1000); err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(company.CompanyID, rootB.FolderID, EntityTypeLogicGate, processC.LogicGateID, 0); err != nil {
		t.Fatal(err)
	}

	route := []domain.ProcessMapRoutePoint{{X: 5, Y: 5}, {X: 25, Y: 5}}
	created, err := repo.CreateResourceOperationalRelationship(ctx, ResourceOperationalRelationshipCreateInput{
		CompanyID:   company.CompanyID,
		Source:      processMapTestRef(domain.ProcessMapResourceTypeProcess, processA.LogicGateID),
		Target:      processMapTestRef(domain.ProcessMapResourceTypeProcess, processC.LogicGateID),
		Trace:       &ProcessMapTraceInput{RoutePoints: route},
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil || created.Relationship == nil {
		t.Fatalf("create relationship before tidy = %+v, err=%v", created, err)
	}

	if _, err := db.Exec(`
update process_map_placements
set grid_x=case
      when resource_type='company_explorer_folder' and resource_id=$2::uuid then -400
      when resource_type='company_explorer_folder' and resource_id=$3::uuid then 5
      else 6
    end,
    grid_y=case when resource_type='company_explorer_folder' then 10 else 11 end,
    grid_width=case when resource_type='company_explorer_folder' then 300 else 14 end,
    grid_height=case when resource_type='company_explorer_folder' then 200 else 70 end
where company_id=$1::uuid`, company.CompanyID, rootA.FolderID, rootB.FolderID); err != nil {
		t.Fatal(err)
	}

	var traceBefore string
	var traceRevisionBefore int64
	if err := db.QueryRow(`
select route_points::text,revision
from process_map_traces
where company_id=$1::uuid and resource_operational_relationship_id=$2::uuid`,
		company.CompanyID, created.Relationship.ResourceOperationalRelationshipID).Scan(&traceBefore, &traceRevisionBefore); err != nil {
		t.Fatal(err)
	}
	versionBefore := postgresProcessMapVersionForTest(t, repo, company.CompanyID)
	migration, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260826_zzzz_process_map_tidy_initial_layout.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(migration)); err != nil {
		t.Fatalf("apply tidy initial layout migration: %v", err)
	}
	versionAfter := postgresProcessMapVersionForTest(t, repo, company.CompanyID)
	if versionAfter <= versionBefore {
		t.Fatalf("tidy layout Process Map version = %d, want > %d", versionAfter, versionBefore)
	}

	type geometry struct{ x, y, width, height int }
	readGeometry := func(resourceType, resourceID string) geometry {
		t.Helper()
		var result geometry
		if err := db.QueryRow(`
select grid_x,grid_y,grid_width,grid_height
from process_map_placements
where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`,
			company.CompanyID, resourceType, resourceID).Scan(&result.x, &result.y, &result.width, &result.height); err != nil {
			t.Fatal(err)
		}
		return result
	}
	rootAGeometry := readGeometry(domain.ProcessMapResourceTypeFolder, rootA.FolderID)
	rootBGeometry := readGeometry(domain.ProcessMapResourceTypeFolder, rootB.FolderID)
	if rootAGeometry.y != 0 || rootBGeometry.y != 0 || rootAGeometry.width != 32 || rootAGeometry.height != 26 || rootBGeometry.width != 32 || rootBGeometry.height != 24 {
		t.Fatalf("tidy roots A=%+v B=%+v, want y=0 and sizes 32x26/32x24", rootAGeometry, rootBGeometry)
	}
	left, right := rootAGeometry, rootBGeometry
	if right.x < left.x {
		left, right = right, left
	}
	if right.x < left.x+left.width+8 {
		t.Fatalf("root shelf overlap left=%+v right=%+v", left, right)
	}
	nestedGeometry := readGeometry(domain.ProcessMapResourceTypeFolder, nested.FolderID)
	firstGeometry := readGeometry(domain.ProcessMapResourceTypeProcess, processA.LogicGateID)
	secondGeometry := readGeometry(domain.ProcessMapResourceTypeProcess, processB.LogicGateID)
	rootProcessGeometry := readGeometry(domain.ProcessMapResourceTypeProcess, processC.LogicGateID)
	if nestedGeometry != (geometry{x: rootAGeometry.x + 2, y: 2, width: 24, height: 22}) {
		t.Fatalf("nested tidy geometry = %+v", nestedGeometry)
	}
	if firstGeometry != (geometry{x: nestedGeometry.x + 2, y: nestedGeometry.y + 2, width: 14, height: 8}) ||
		secondGeometry != (geometry{x: nestedGeometry.x + 2, y: nestedGeometry.y + 12, width: 14, height: 8}) {
		t.Fatalf("nested Process tidy geometry first=%+v second=%+v", firstGeometry, secondGeometry)
	}
	if rootProcessGeometry != (geometry{x: rootBGeometry.x + 2, y: 2, width: 14, height: 8}) {
		t.Fatalf("Root B Process tidy geometry = %+v", rootProcessGeometry)
	}

	var traceAfter string
	var traceRevisionAfter int64
	var relationshipCount int
	if err := db.QueryRow(`
select route_points::text,revision
from process_map_traces
where company_id=$1::uuid and resource_operational_relationship_id=$2::uuid`,
		company.CompanyID, created.Relationship.ResourceOperationalRelationshipID).Scan(&traceAfter, &traceRevisionAfter); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`select count(*) from resource_operational_relationships where company_id=$1::uuid`, company.CompanyID).Scan(&relationshipCount); err != nil {
		t.Fatal(err)
	}
	if traceAfter != traceBefore || traceRevisionAfter != traceRevisionBefore || relationshipCount != 1 {
		t.Fatalf("tidy changed relationship data: trace=%q/%d before=%q/%d relationships=%d", traceAfter, traceRevisionAfter, traceBefore, traceRevisionBefore, relationshipCount)
	}

	var placementSnapshotBeforeRestart string
	if err := db.QueryRow(`
select coalesce(jsonb_agg(jsonb_build_array(resource_type,resource_id,grid_x,grid_y,grid_width,grid_height,revision)
                          order by resource_type,resource_id),'[]'::jsonb)::text
from process_map_placements
where company_id=$1::uuid`, company.CompanyID).Scan(&placementSnapshotBeforeRestart); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(migration)); err != nil {
		t.Fatalf("restart tidy initial layout migration: %v", err)
	}
	var placementSnapshotAfterRestart string
	if err := db.QueryRow(`
select coalesce(jsonb_agg(jsonb_build_array(resource_type,resource_id,grid_x,grid_y,grid_width,grid_height,revision)
                          order by resource_type,resource_id),'[]'::jsonb)::text
from process_map_placements
where company_id=$1::uuid`, company.CompanyID).Scan(&placementSnapshotAfterRestart); err != nil {
		t.Fatal(err)
	}
	if placementSnapshotAfterRestart != placementSnapshotBeforeRestart {
		t.Fatalf("tidy restart changed placements: before=%s after=%s", placementSnapshotBeforeRestart, placementSnapshotAfterRestart)
	}
	if versionRestart := postgresProcessMapVersionForTest(t, repo, company.CompanyID); versionRestart != versionAfter {
		t.Fatalf("tidy restart Process Map version = %d, want %d", versionRestart, versionAfter)
	}
	if _, err := db.Exec(`
update process_map_placements
set grid_x=grid_x+1,revision=revision+1,updated_timestamp=statement_timestamp()
where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`, company.CompanyID, processA.LogicGateID); err != nil {
		t.Fatal(err)
	}
	manualGeometry := readGeometry(domain.ProcessMapResourceTypeProcess, processA.LogicGateID)
	connection, err := db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, migrationErr := connection.ExecContext(ctx, string(migration))
	if _, rollbackErr := connection.ExecContext(ctx, "rollback"); rollbackErr != nil {
		connection.Close()
		t.Fatalf("rollback refused tidy rerun: %v", rollbackErr)
	}
	connection.Close()
	if migrationErr == nil || !strings.Contains(migrationErr.Error(), "already ran") {
		t.Fatalf("tidy rerun after manual geometry error = %v, want already-ran refusal", migrationErr)
	}
	if afterRefusal := readGeometry(domain.ProcessMapResourceTypeProcess, processA.LogicGateID); afterRefusal != manualGeometry {
		t.Fatalf("tidy rerun refusal changed manual geometry: before=%+v after=%+v", manualGeometry, afterRefusal)
	}
}

func TestPostgresProcessMapTidyInitialLayoutMarksNoOpFirstRun(t *testing.T) {
	ctx := context.Background()
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Process Map tidy no-op marker")
	if err != nil {
		t.Fatal(err)
	}
	root, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Already Tidy Root")
	if err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260826_zzzz_process_map_tidy_initial_layout.sql"))
	if err != nil {
		t.Fatal(err)
	}
	// Runtime now uses the later rectangular layout. Seed the exact historical
	// tidy geometry, then remove only its disposable-test marker so this fixture
	// still proves that a first no-op run records its one marker.
	if _, err := db.Exec(string(migration)); err != nil {
		t.Fatalf("seed historical tidy layout: %v", err)
	}
	if _, err := db.Exec(`
delete from domain_events
where company_id=$1::uuid and idempotency_key='migration:20260826-process-map-tidy-initial-layout'`, company.CompanyID); err != nil {
		t.Fatal(err)
	}
	var xBefore int
	if err := db.QueryRow(`
select grid_x
from process_map_placements
where company_id=$1::uuid and resource_type='company_explorer_folder' and resource_id=$2::uuid`,
		company.CompanyID, root.FolderID).Scan(&xBefore); err != nil {
		t.Fatal(err)
	}
	var placementSnapshotBefore string
	if err := db.QueryRow(`
select coalesce(jsonb_agg(jsonb_build_array(resource_type,resource_id,grid_x,grid_y,grid_width,grid_height,revision)
                          order by resource_type,resource_id),'[]'::jsonb)::text
from process_map_placements
where company_id=$1::uuid`, company.CompanyID).Scan(&placementSnapshotBefore); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(migration)); err != nil {
		t.Fatalf("apply no-op tidy initial layout migration: %v", err)
	}
	var placementSnapshotAfter string
	if err := db.QueryRow(`
	select coalesce(jsonb_agg(jsonb_build_array(resource_type,resource_id,grid_x,grid_y,grid_width,grid_height,revision)
	                          order by resource_type,resource_id),'[]'::jsonb)::text
	from process_map_placements
	where company_id=$1::uuid`, company.CompanyID).Scan(&placementSnapshotAfter); err != nil {
		t.Fatal(err)
	}
	var markerCount int
	if err := db.QueryRow(`
select count(*)
from domain_events
where company_id=$1::uuid and idempotency_key='migration:20260826-process-map-tidy-initial-layout'`, company.CompanyID).Scan(&markerCount); err != nil {
		t.Fatal(err)
	}
	if placementSnapshotAfter != placementSnapshotBefore || markerCount != 1 {
		t.Fatalf("no-op tidy first run placements/marker changed: before=%s after=%s marker=%d", placementSnapshotBefore, placementSnapshotAfter, markerCount)
	}
	if _, err := db.Exec(`
update process_map_placements
set grid_x=grid_x+1,revision=revision+1,updated_timestamp=statement_timestamp()
where company_id=$1::uuid and resource_type='company_explorer_folder' and resource_id=$2::uuid`, company.CompanyID, root.FolderID); err != nil {
		t.Fatal(err)
	}
	connection, err := db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, migrationErr := connection.ExecContext(ctx, string(migration))
	if _, rollbackErr := connection.ExecContext(ctx, "rollback"); rollbackErr != nil {
		connection.Close()
		t.Fatalf("rollback refused no-op tidy rerun: %v", rollbackErr)
	}
	connection.Close()
	if migrationErr == nil || !strings.Contains(migrationErr.Error(), "already ran") {
		t.Fatalf("no-op tidy rerun after manual geometry error = %v, want already-ran refusal", migrationErr)
	}
	var xAfterRefusal int
	if err := db.QueryRow(`
select grid_x
from process_map_placements
where company_id=$1::uuid and resource_type='company_explorer_folder' and resource_id=$2::uuid`,
		company.CompanyID, root.FolderID).Scan(&xAfterRefusal); err != nil {
		t.Fatal(err)
	}
	if xAfterRefusal != xBefore+1 {
		t.Fatalf("no-op tidy rerun changed manual root x = %d, want %d", xAfterRefusal, xBefore+1)
	}
}

func TestPostgresProcessMapRectangularLayoutMigrationUsesContainedSectionsAndIsRestartSafe(t *testing.T) {
	ctx := context.Background()
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Process Map rectangular layout")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := repo.UpsertAuthUser("process-map-rectangular-admin", "process-map-rectangular@example.com", "Rectangular Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}

	rootIDs := make([]string, 0, 5)
	for index := 0; index < 5; index++ {
		root, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Root "+string(rune('A'+index)))
		if err != nil {
			t.Fatal(err)
		}
		rootIDs = append(rootIDs, root.FolderID)
	}
	rootA, rootB := rootIDs[0], rootIDs[1]
	leftA, err := repo.CreateCompanyExplorerFolder(company.CompanyID, rootA, "logic_gate", "Left A")
	if err != nil {
		t.Fatal(err)
	}
	leftB, err := repo.CreateCompanyExplorerFolder(company.CompanyID, rootA, "logic_gate", "Left B")
	if err != nil {
		t.Fatal(err)
	}
	grandA, err := repo.CreateCompanyExplorerFolder(company.CompanyID, leftA.FolderID, "logic_gate", "Grand A")
	if err != nil {
		t.Fatal(err)
	}
	grandB, err := repo.CreateCompanyExplorerFolder(company.CompanyID, leftA.FolderID, "logic_gate", "Grand B")
	if err != nil {
		t.Fatal(err)
	}
	rootBChildren := make([]string, 0, 3)
	for index := 0; index < 3; index++ {
		child, err := repo.CreateCompanyExplorerFolder(company.CompanyID, rootB, "logic_gate", "Folder Only "+string(rune('A'+index)))
		if err != nil {
			t.Fatal(err)
		}
		rootBChildren = append(rootBChildren, child.FolderID)
	}

	createProcess := func(parentFolderID, name string, position int) string {
		t.Helper()
		process, err := repo.CreateLogicGate(company.CompanyID, name)
		if err != nil {
			t.Fatal(err)
		}
		if _, _, err := repo.AssignCompanyExplorerFolderItem(company.CompanyID, parentFolderID, EntityTypeLogicGate, process.LogicGateID, position); err != nil {
			t.Fatal(err)
		}
		return process.LogicGateID
	}
	rootProcesses := []string{
		createProcess(rootA, "Root Process A", 0),
		createProcess(rootA, "Root Process B", 1000),
		createProcess(rootA, "Root Process C", 2000),
		createProcess(rootA, "Root Process D", 3000),
	}
	nestedProcesses := []string{
		createProcess(leftA.FolderID, "Nested Process A", 0),
		createProcess(leftA.FolderID, "Nested Process B", 1000),
	}

	route := []domain.ProcessMapRoutePoint{{X: 5, Y: 5}, {X: 25, Y: 5}}
	created, err := repo.CreateResourceOperationalRelationship(ctx, ResourceOperationalRelationshipCreateInput{
		CompanyID:   company.CompanyID,
		Source:      processMapTestRef(domain.ProcessMapResourceTypeProcess, rootProcesses[0]),
		Target:      processMapTestRef(domain.ProcessMapResourceTypeProcess, nestedProcesses[0]),
		Trace:       &ProcessMapTraceInput{RoutePoints: route},
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil || created.Relationship == nil {
		t.Fatalf("create relationship before rectangular layout = %+v, err=%v", created, err)
	}

	if _, err := db.Exec(`
update process_map_placements
set grid_x=7,
    grid_y=9,
    grid_width=case when resource_type='company_explorer_folder' then 300 else 14 end,
    grid_height=case when resource_type='company_explorer_folder' then 200 else 70 end
where company_id=$1::uuid`, company.CompanyID); err != nil {
		t.Fatal(err)
	}

	readPlacementSnapshot := func() string {
		t.Helper()
		var snapshot string
		if err := db.QueryRow(`
select coalesce(jsonb_agg(jsonb_build_array(resource_type,resource_id,map_parent_folder_id,grid_x,grid_y,grid_width,grid_height,revision)
                          order by resource_type,resource_id),'[]'::jsonb)::text
from process_map_placements
where company_id=$1::uuid`, company.CompanyID).Scan(&snapshot); err != nil {
			t.Fatal(err)
		}
		return snapshot
	}
	readRevisions := func() map[string]int64 {
		t.Helper()
		rows, err := db.Query(`
select resource_type,resource_id::text,revision
from process_map_placements
where company_id=$1::uuid`, company.CompanyID)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		result := map[string]int64{}
		for rows.Next() {
			var resourceType, resourceID string
			var revision int64
			if err := rows.Scan(&resourceType, &resourceID, &revision); err != nil {
				t.Fatal(err)
			}
			result[resourceType+":"+resourceID] = revision
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		return result
	}

	migration, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260826_zzzzz_process_map_rectangular_layout.sql"))
	if err != nil {
		t.Fatal(err)
	}
	conflictSnapshot := readPlacementSnapshot()
	if _, err := db.Exec(`
insert into domain_events(
  event_id,company_id,stream_type,stream_id,sequence,event_type,
  actor_user_id,idempotency_key,payload,created_timestamp
)
values (
  gen_random_uuid(),$1::uuid,'test','rectangular-layout-marker-conflict',1,'test_marker',
  null,'migration:20260826-process-map-rectangular-layout','{}'::jsonb,statement_timestamp()
)`, company.CompanyID); err != nil {
		t.Fatal(err)
	}
	connection, err := db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, migrationErr := connection.ExecContext(ctx, string(migration))
	if _, rollbackErr := connection.ExecContext(ctx, "rollback"); rollbackErr != nil {
		connection.Close()
		t.Fatalf("rollback rectangular layout marker-conflict refusal: %v", rollbackErr)
	}
	connection.Close()
	if migrationErr == nil || !strings.Contains(migrationErr.Error(), "marker key is already used by another event") {
		t.Fatalf("rectangular layout marker-conflict error = %v", migrationErr)
	}
	if afterConflict := readPlacementSnapshot(); afterConflict != conflictSnapshot {
		t.Fatalf("marker-conflict refusal changed placements: before=%s after=%s", conflictSnapshot, afterConflict)
	}
	if _, err := db.Exec(`
delete from domain_events
where company_id=$1::uuid and idempotency_key='migration:20260826-process-map-rectangular-layout'`, company.CompanyID); err != nil {
		t.Fatal(err)
	}
	versionBeforeRejectedRun := postgresProcessMapVersionForTest(t, repo, company.CompanyID)
	rejectedSnapshot := readPlacementSnapshot()
	if _, err := db.Exec(`
update process_map_placements
set map_parent_folder_id=$3::uuid
where company_id=$1::uuid and resource_type='company_explorer_folder' and resource_id=$2::uuid`,
		company.CompanyID, leftB.FolderID, rootB); err != nil {
		t.Fatal(err)
	}
	connection, err = db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, migrationErr = connection.ExecContext(ctx, string(migration))
	if _, rollbackErr := connection.ExecContext(ctx, "rollback"); rollbackErr != nil {
		connection.Close()
		t.Fatalf("rollback rectangular layout parentage refusal: %v", rollbackErr)
	}
	connection.Close()
	if migrationErr == nil || !strings.Contains(migrationErr.Error(), "parentage is not synchronized") {
		t.Fatalf("rectangular layout mismatched parent error = %v", migrationErr)
	}
	if versionAfterRejectedRun := postgresProcessMapVersionForTest(t, repo, company.CompanyID); versionAfterRejectedRun != versionBeforeRejectedRun {
		t.Fatalf("rejected rectangular layout version = %d, want %d", versionAfterRejectedRun, versionBeforeRejectedRun)
	}
	if _, err := db.Exec(`
update process_map_placements
set map_parent_folder_id=$3::uuid
where company_id=$1::uuid and resource_type='company_explorer_folder' and resource_id=$2::uuid`,
		company.CompanyID, leftB.FolderID, rootA); err != nil {
		t.Fatal(err)
	}
	if restoredSnapshot := readPlacementSnapshot(); restoredSnapshot != rejectedSnapshot {
		t.Fatalf("parentage refusal or restoration changed placement geometry: before=%s after=%s", rejectedSnapshot, restoredSnapshot)
	}

	revisionsBefore := readRevisions()
	var parentSnapshotBefore string
	if err := db.QueryRow(`
select coalesce(jsonb_agg(jsonb_build_array(resource_type,resource_id,map_parent_folder_id)
                          order by resource_type,resource_id),'[]'::jsonb)::text
from process_map_placements
where company_id=$1::uuid`, company.CompanyID).Scan(&parentSnapshotBefore); err != nil {
		t.Fatal(err)
	}
	var traceBefore string
	var traceRevisionBefore int64
	if err := db.QueryRow(`
select route_points::text,revision
from process_map_traces
where company_id=$1::uuid and resource_operational_relationship_id=$2::uuid`,
		company.CompanyID, created.Relationship.ResourceOperationalRelationshipID).Scan(&traceBefore, &traceRevisionBefore); err != nil {
		t.Fatal(err)
	}
	versionBefore := postgresProcessMapVersionForTest(t, repo, company.CompanyID)
	if _, err := db.Exec(string(migration)); err != nil {
		t.Fatalf("apply rectangular layout migration: %v", err)
	}
	versionAfter := postgresProcessMapVersionForTest(t, repo, company.CompanyID)
	if versionAfter <= versionBefore {
		t.Fatalf("rectangular layout Process Map version = %d, want > %d", versionAfter, versionBefore)
	}

	type rectangle struct{ x, y, width, height int }
	readRectangle := func(resourceType, resourceID string) rectangle {
		t.Helper()
		var result rectangle
		if err := db.QueryRow(`
select grid_x,grid_y,grid_width,grid_height
from process_map_placements
where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`,
			company.CompanyID, resourceType, resourceID).Scan(&result.x, &result.y, &result.width, &result.height); err != nil {
			t.Fatal(err)
		}
		return result
	}
	contains := func(parent, child rectangle) bool {
		return child.x >= parent.x+2 && child.y >= parent.y+6 &&
			child.x+child.width <= parent.x+parent.width-2 &&
			child.y+child.height <= parent.y+parent.height-2
	}
	overlaps := func(first, second rectangle) bool {
		return first.x < second.x+second.width && first.x+first.width > second.x &&
			first.y < second.y+second.height && first.y+first.height > second.y
	}

	for index, rootID := range rootIDs {
		rootRectangle := readRectangle(domain.ProcessMapResourceTypeFolder, rootID)
		if rootRectangle.width < 32 || rootRectangle.height < 24 {
			t.Fatalf("created root %d geometry = %+v, want minimum 32x24", index, rootRectangle)
		}
	}
	rootRows, err := db.Query(`
select placement.grid_x,placement.grid_y,placement.grid_width,placement.grid_height
from process_map_placements placement
join company_explorer_folders folder
  on folder.company_id=placement.company_id and folder.folder_id=placement.resource_id
where placement.company_id=$1::uuid
  and placement.resource_type='company_explorer_folder'
  and placement.map_parent_folder_id is null
order by folder.position,folder.created_timestamp,placement.resource_type,folder.folder_id`, company.CompanyID)
	if err != nil {
		t.Fatal(err)
	}
	allRootRectangles := []rectangle{}
	for rootRows.Next() {
		var rootRectangle rectangle
		if err := rootRows.Scan(&rootRectangle.x, &rootRectangle.y, &rootRectangle.width, &rootRectangle.height); err != nil {
			rootRows.Close()
			t.Fatal(err)
		}
		allRootRectangles = append(allRootRectangles, rootRectangle)
	}
	if err := rootRows.Err(); err != nil {
		rootRows.Close()
		t.Fatal(err)
	}
	rootRows.Close()
	if len(allRootRectangles) < 5 {
		t.Fatalf("root count = %d, want at least 5", len(allRootRectangles))
	}
	for index, rootRectangle := range allRootRectangles {
		rowStart := index - index%4
		if rootRectangle.y != allRootRectangles[rowStart].y {
			t.Fatalf("root %d y=%d differs from row start y=%d", index, rootRectangle.y, allRootRectangles[rowStart].y)
		}
		if index >= 4 && rootRectangle.x != allRootRectangles[index%4].x {
			t.Fatalf("root %d x=%d differs from aligned column x=%d", index, rootRectangle.x, allRootRectangles[index%4].x)
		}
		if index >= 4 && index%4 == 0 && rootRectangle.y <= allRootRectangles[index-4].y {
			t.Fatalf("root row %d y=%d does not follow prior row y=%d", index/4, rootRectangle.y, allRootRectangles[index-4].y)
		}
	}
	for first := range allRootRectangles {
		for second := first + 1; second < len(allRootRectangles); second++ {
			if overlaps(allRootRectangles[first], allRootRectangles[second]) {
				t.Fatalf("root rectangles overlap: %d=%+v %d=%+v", first, allRootRectangles[first], second, allRootRectangles[second])
			}
		}
	}

	rootARectangle := readRectangle(domain.ProcessMapResourceTypeFolder, rootA)
	leftARectangle := readRectangle(domain.ProcessMapResourceTypeFolder, leftA.FolderID)
	leftBRectangle := readRectangle(domain.ProcessMapResourceTypeFolder, leftB.FolderID)
	if !contains(rootARectangle, leftARectangle) || !contains(rootARectangle, leftBRectangle) || leftARectangle.x != leftBRectangle.x || leftBRectangle.y == leftARectangle.y {
		t.Fatalf("root Folder lane geometry root=%+v first=%+v second=%+v", rootARectangle, leftARectangle, leftBRectangle)
	}
	rootProcessRectangles := make([]rectangle, len(rootProcesses))
	for index, processID := range rootProcesses {
		rootProcessRectangles[index] = readRectangle(domain.ProcessMapResourceTypeProcess, processID)
		if rootProcessRectangles[index].width != 14 || rootProcessRectangles[index].height != 8 || !contains(rootARectangle, rootProcessRectangles[index]) {
			t.Fatalf("root Process %d geometry = %+v under root %+v", index, rootProcessRectangles[index], rootARectangle)
		}
	}
	processXCounts, processYCounts := map[int]int{}, map[int]int{}
	for _, processRectangle := range rootProcessRectangles {
		processXCounts[processRectangle.x]++
		processYCounts[processRectangle.y]++
	}
	processXs, processYs := []int{}, []int{}
	for coordinate, count := range processXCounts {
		processXs = append(processXs, coordinate)
		if count != 2 {
			t.Fatalf("root Process x=%d count=%d, want 2", coordinate, count)
		}
	}
	for coordinate, count := range processYCounts {
		processYs = append(processYs, coordinate)
		if count != 2 {
			t.Fatalf("root Process y=%d count=%d, want 2", coordinate, count)
		}
	}
	slices.Sort(processXs)
	slices.Sort(processYs)
	if len(processXs) != 2 || len(processYs) != 2 || processXs[1]-processXs[0] != 16 || processYs[1]-processYs[0] != 10 {
		t.Fatalf("root Process two-column geometry = %+v", rootProcessRectangles)
	}
	folderLaneRight := leftARectangle.x + leftARectangle.width
	if right := leftBRectangle.x + leftBRectangle.width; right > folderLaneRight {
		folderLaneRight = right
	}
	if rootProcessRectangles[0].x < folderLaneRight+4 {
		t.Fatalf("root sections lack gap: Folders end %d, Processes start %d", folderLaneRight, rootProcessRectangles[0].x)
	}

	grandARectangle := readRectangle(domain.ProcessMapResourceTypeFolder, grandA.FolderID)
	grandBRectangle := readRectangle(domain.ProcessMapResourceTypeFolder, grandB.FolderID)
	if !contains(leftARectangle, grandARectangle) || !contains(leftARectangle, grandBRectangle) || grandARectangle.x != grandBRectangle.x || grandBRectangle.y == grandARectangle.y {
		t.Fatalf("nested Folder lane geometry parent=%+v first=%+v second=%+v", leftARectangle, grandARectangle, grandBRectangle)
	}
	for index, processID := range nestedProcesses {
		processRectangle := readRectangle(domain.ProcessMapResourceTypeProcess, processID)
		if !contains(leftARectangle, processRectangle) || processRectangle.x < grandARectangle.x+grandARectangle.width+4 {
			t.Fatalf("nested Process %d geometry=%+v parent=%+v Folder=%+v", index, processRectangle, leftARectangle, grandARectangle)
		}
	}

	rootBRectangle := readRectangle(domain.ProcessMapResourceTypeFolder, rootB)
	rootBChildRectangles := make([]rectangle, len(rootBChildren))
	for index, childID := range rootBChildren {
		rootBChildRectangles[index] = readRectangle(domain.ProcessMapResourceTypeFolder, childID)
		if !contains(rootBRectangle, rootBChildRectangles[index]) {
			t.Fatalf("Folder-only child %d=%+v is outside root %+v", index, rootBChildRectangles[index], rootBRectangle)
		}
	}
	folderXCounts, folderYCounts := map[int]int{}, map[int]int{}
	for _, childRectangle := range rootBChildRectangles {
		folderXCounts[childRectangle.x]++
		folderYCounts[childRectangle.y]++
	}
	folderXs, folderYs := []int{}, []int{}
	for coordinate := range folderXCounts {
		folderXs = append(folderXs, coordinate)
	}
	for coordinate := range folderYCounts {
		folderYs = append(folderYs, coordinate)
	}
	slices.Sort(folderXs)
	slices.Sort(folderYs)
	if len(folderXs) != 2 || len(folderYs) != 2 || folderXCounts[folderXs[0]] != 2 || folderXCounts[folderXs[1]] != 1 ||
		folderYCounts[folderYs[0]] != 2 || folderYCounts[folderYs[1]] != 1 {
		t.Fatalf("root Folder-only two-column geometry = %+v", rootBChildRectangles)
	}

	revisionsAfter := readRevisions()
	if len(revisionsAfter) != len(revisionsBefore) {
		t.Fatalf("placement revision count before=%d after=%d", len(revisionsBefore), len(revisionsAfter))
	}
	for key, revisionBefore := range revisionsBefore {
		if revisionsAfter[key] != revisionBefore+1 {
			t.Fatalf("placement %s revision = %d, want %d", key, revisionsAfter[key], revisionBefore+1)
		}
	}
	var parentSnapshotAfter string
	if err := db.QueryRow(`
select coalesce(jsonb_agg(jsonb_build_array(resource_type,resource_id,map_parent_folder_id)
                          order by resource_type,resource_id),'[]'::jsonb)::text
from process_map_placements
where company_id=$1::uuid`, company.CompanyID).Scan(&parentSnapshotAfter); err != nil {
		t.Fatal(err)
	}
	if parentSnapshotAfter != parentSnapshotBefore {
		t.Fatalf("rectangular layout changed Explorer parent projection: before=%s after=%s", parentSnapshotBefore, parentSnapshotAfter)
	}
	var traceAfter string
	var traceRevisionAfter int64
	var relationshipCount int
	if err := db.QueryRow(`
select route_points::text,revision
from process_map_traces
where company_id=$1::uuid and resource_operational_relationship_id=$2::uuid`,
		company.CompanyID, created.Relationship.ResourceOperationalRelationshipID).Scan(&traceAfter, &traceRevisionAfter); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`select count(*) from resource_operational_relationships where company_id=$1::uuid`, company.CompanyID).Scan(&relationshipCount); err != nil {
		t.Fatal(err)
	}
	if traceAfter != traceBefore || traceRevisionAfter != traceRevisionBefore || relationshipCount != 1 {
		t.Fatalf("rectangular layout changed relationship data: trace=%q/%d before=%q/%d relationships=%d", traceAfter, traceRevisionAfter, traceBefore, traceRevisionBefore, relationshipCount)
	}

	var markerCount int
	if err := db.QueryRow(`
select count(*)
from domain_events
where company_id=$1::uuid and idempotency_key='migration:20260826-process-map-rectangular-layout'`, company.CompanyID).Scan(&markerCount); err != nil {
		t.Fatal(err)
	}
	if markerCount != 1 {
		t.Fatalf("rectangular layout marker count = %d, want 1", markerCount)
	}
	placementSnapshotBeforeRestart := readPlacementSnapshot()
	if _, err := db.Exec(string(migration)); err != nil {
		t.Fatalf("restart rectangular layout migration: %v", err)
	}
	if placementSnapshotAfterRestart := readPlacementSnapshot(); placementSnapshotAfterRestart != placementSnapshotBeforeRestart {
		t.Fatalf("rectangular layout restart changed placements: before=%s after=%s", placementSnapshotBeforeRestart, placementSnapshotAfterRestart)
	}
	if versionRestart := postgresProcessMapVersionForTest(t, repo, company.CompanyID); versionRestart != versionAfter {
		t.Fatalf("rectangular layout restart version = %d, want %d", versionRestart, versionAfter)
	}

	if _, err := db.Exec(`
update process_map_placements
set grid_x=grid_x+1,revision=revision+1,updated_timestamp=statement_timestamp()
where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`, company.CompanyID, rootProcesses[0]); err != nil {
		t.Fatal(err)
	}
	manualGeometry := readRectangle(domain.ProcessMapResourceTypeProcess, rootProcesses[0])
	manualRevision := readRevisions()[domain.ProcessMapResourceTypeProcess+":"+rootProcesses[0]]
	connection, err = db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, migrationErr = connection.ExecContext(ctx, string(migration))
	if _, rollbackErr := connection.ExecContext(ctx, "rollback"); rollbackErr != nil {
		connection.Close()
		t.Fatalf("rollback rectangular layout rerun refusal: %v", rollbackErr)
	}
	connection.Close()
	if migrationErr == nil || !strings.Contains(migrationErr.Error(), "already ran") {
		t.Fatalf("rectangular layout rerun after manual geometry error = %v", migrationErr)
	}
	if afterRefusal := readRectangle(domain.ProcessMapResourceTypeProcess, rootProcesses[0]); afterRefusal != manualGeometry {
		t.Fatalf("rectangular layout refusal changed manual geometry: before=%+v after=%+v", manualGeometry, afterRefusal)
	}
	if revisionAfterRefusal := readRevisions()[domain.ProcessMapResourceTypeProcess+":"+rootProcesses[0]]; revisionAfterRefusal != manualRevision {
		t.Fatalf("rectangular layout refusal changed manual revision: before=%d after=%d", manualRevision, revisionAfterRefusal)
	}
}

func TestPostgresProcessMapScoreCardRenameMigrationIsRestartSafe(t *testing.T) {
	db, _ := openPostgresProcessMapIntegration(t)
	migration, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260826_z_scorecards.sql"))
	if err != nil {
		t.Fatal(err)
	}
	for attempt := 1; attempt <= 2; attempt++ {
		if _, err := db.Exec(string(migration)); err != nil {
			t.Fatalf("apply Score Cards migration attempt %d: %v", attempt, err)
		}
	}
	var oldTable, newTable *string
	if err := db.QueryRow(`select to_regclass('public.qd_ratings')::text,to_regclass('public.scorecards')::text`).Scan(&oldTable, &newTable); err != nil {
		t.Fatal(err)
	}
	if oldTable != nil || newTable == nil || *newTable != "scorecards" {
		t.Fatalf("Score Cards migration tables old=%v new=%v, want nil/scorecards", oldTable, newTable)
	}
}

func TestPostgresProcessMapFolderResizeDoesNotRequireUnmovedDescendantAccess(t *testing.T) {
	ctx := context.Background()
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Process Map Folder resize permission test")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := repo.UpsertAuthUser("process-map-resize-admin", "process-map-resize-admin@example.com", "Resize Admin")
	if err != nil {
		t.Fatal(err)
	}
	viewer, err := repo.UpsertAuthUser("process-map-resize-viewer", "process-map-resize-viewer@example.com", "Resize Viewer")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(viewer.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Visible Folder")
	if err != nil {
		t.Fatal(err)
	}
	child, err := repo.CreateLogicGate(company.CompanyID, "Restricted Child")
	if err != nil {
		t.Fatal(err)
	}
	peer, err := repo.CreateLogicGate(company.CompanyID, "Visible Peer")
	if err != nil {
		t.Fatal(err)
	}
	parentID := folder.FolderID
	for _, input := range []ProcessMapPlacementPutInput{
		processMapTestPlacementWithSize(company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 0, 0, 50, 40),
		processMapTestPlacementWithSize(company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeProcess, child.LogicGateID, &parentID, 10, 10, 10, 6),
		processMapTestPlacementWithSize(company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeProcess, peer.LogicGateID, &parentID, 30, 10, 10, 6),
	} {
		if _, err := repo.PutProcessMapPlacement(ctx, input); err != nil {
			t.Fatal(err)
		}
	}
	route := []domain.ProcessMapRoutePoint{{X: 24, Y: 13}, {X: 28, Y: 13}}
	created, err := repo.CreateResourceOperationalRelationship(ctx, ResourceOperationalRelationshipCreateInput{
		CompanyID:   company.CompanyID,
		Source:      processMapTestRef(domain.ProcessMapResourceTypeProcess, child.LogicGateID),
		Target:      processMapTestRef(domain.ProcessMapResourceTypeProcess, peer.LogicGateID),
		Trace:       &ProcessMapTraceInput{RoutePoints: route},
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil || created.Relationship == nil {
		t.Fatalf("create internal trace = %+v, err=%v", created, err)
	}
	noAccess := ResourceDefaultAccessNoAccess
	if _, _, err := repo.PutResourcePermissionPolicy(ResourcePermissionPolicyUpdateInput{
		CompanyID: company.CompanyID, ResourceType: EntityTypeLogicGate, ResourceID: child.LogicGateID,
		PermissionMode: PolicyModeCustomized, DefaultAccess: &noAccess, DescendantAction: PolicyDescendantActionInheritedOnly,
		ActorUserID: admin.UserID,
	}); err != nil {
		t.Fatal(err)
	}

	resized, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(
		company.CompanyID, viewer.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, -5, -7, 55, 47,
	))
	if err != nil || len(resized.Placements) != 1 || len(resized.Traces) != 0 || resized.Placements[0].GridX != -5 || resized.Placements[0].GridY != -7 {
		t.Fatalf("Folder resize with restricted unmoved child = %+v, err=%v", resized, err)
	}
	var childX, childY int
	if err := db.QueryRow(`select grid_x,grid_y from process_map_placements where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`, company.CompanyID, child.LogicGateID).Scan(&childX, &childY); err != nil {
		t.Fatal(err)
	}
	var routeJSON []byte
	if err := db.QueryRow(`select route_points from process_map_traces where company_id=$1::uuid and resource_operational_relationship_id=$2::uuid`, company.CompanyID, created.Relationship.ResourceOperationalRelationshipID).Scan(&routeJSON); err != nil {
		t.Fatal(err)
	}
	var routeAfterResize []domain.ProcessMapRoutePoint
	if err := json.Unmarshal(routeJSON, &routeAfterResize); err != nil {
		t.Fatal(err)
	}
	if childX != 10 || childY != 10 || !slices.Equal(routeAfterResize, route) {
		t.Fatalf("Folder resize moved contents: child=(%d,%d) route=%+v", childX, childY, routeAfterResize)
	}
	if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(
		company.CompanyID, viewer.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, -4, -7, 55, 47,
	)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Folder group move with restricted child error = %v, want %v", err, ErrNotFound)
	}
}

func TestPostgresProcessMapSceneTilePrivacyMatchesMemory(t *testing.T) {
	ctx := context.Background()
	_, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Process Map privacy test")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := repo.UpsertAuthUser("process-map-privacy-admin", "process-map-privacy-admin@example.com", "Privacy Admin")
	if err != nil {
		t.Fatal(err)
	}
	viewer, err := repo.UpsertAuthUser("process-map-privacy-viewer", "process-map-privacy-viewer@example.com", "Privacy Viewer")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(viewer.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	visible, _ := repo.CreateLogicGate(company.CompanyID, "Visible")
	hidden, _ := repo.CreateLogicGate(company.CompanyID, "Hidden")
	for _, input := range []ProcessMapPlacementPutInput{
		processMapTestPlacementWithSize(company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeProcess, visible.LogicGateID, nil, 0, 0, 10, 8),
		processMapTestPlacementWithSize(company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeProcess, hidden.LogicGateID, nil, 100, 20, 90, 70),
	} {
		if _, err := repo.PutProcessMapPlacement(ctx, input); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := repo.CreateResourceOperationalRelationship(ctx, ResourceOperationalRelationshipCreateInput{
		CompanyID:   company.CompanyID,
		Source:      processMapTestRef(domain.ProcessMapResourceTypeProcess, visible.LogicGateID),
		Target:      processMapTestRef(domain.ProcessMapResourceTypeProcess, hidden.LogicGateID),
		Trace:       &ProcessMapTraceInput{RoutePoints: []domain.ProcessMapRoutePoint{{X: 50, Y: 4}}},
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	noAccess := ResourceDefaultAccessNoAccess
	if _, _, err := repo.PutResourcePermissionPolicy(ResourcePermissionPolicyUpdateInput{
		CompanyID: company.CompanyID, ResourceType: EntityTypeLogicGate, ResourceID: hidden.LogicGateID,
		PermissionMode: PolicyModeCustomized, DefaultAccess: &noAccess, DescendantAction: PolicyDescendantActionInheritedOnly,
		ActorUserID: admin.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	scene, err := repo.GetProcessMapScene(ctx, ProcessMapSceneQuery{CompanyID: company.CompanyID, PermissionUserID: viewer.UserID})
	if err != nil || scene.Bounds == nil || scene.Bounds.MinX > 0 || scene.Bounds.MinY > 0 || scene.Bounds.MaxX < 104 || scene.Bounds.MaxY < 23 {
		t.Fatalf("permission-safe scene = %+v err=%v", scene, err)
	}
	tile, err := repo.GetProcessMapTile(ctx, ProcessMapTileQuery{CompanyID: company.CompanyID, PermissionUserID: viewer.UserID, Z: 0, X: 0, Y: 0})
	if err != nil || len(tile.Placements) != 5 || len(tile.Traces) != 0 {
		t.Fatalf("permission-safe tile = %+v err=%v", tile, err)
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
	for _, item := range payload.Placements {
		if restricted, _ := item["restricted"].(bool); restricted && len(item) != 3 {
			t.Fatalf("restricted placeholder leaked fields: %+v", item)
		}
	}
}

func TestPostgresCompanyMembershipProcessMapInvalidationLifecycle(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	companyA, err := repo.CreateCompany("Membership Process Map A")
	if err != nil {
		t.Fatal(err)
	}
	companyB, err := repo.CreateCompany("Membership Process Map B")
	if err != nil {
		t.Fatal(err)
	}
	user, err := repo.UpsertAuthUser("postgres-membership-process-map", "postgres-membership-process-map@example.com", "Postgres Membership")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyB.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	created, err := repo.AddCompanyMembership(user.CognitoSubject, companyA.CompanyID, domain.RoleCompanyUser)
	if err != nil {
		t.Fatal(err)
	}
	versionBeforeRetry := postgresProcessMapVersionForTest(t, repo, companyA.CompanyID)
	policyGroupVersionBeforeRetry := postgresPolicyGroupVersionForTest(t, repo, companyA.CompanyID)
	var eventCountBeforeRetry int
	if err := db.QueryRow(`select count(*) from domain_events where event_type=$1`, CompanyMembershipSavedEventType).Scan(&eventCountBeforeRetry); err != nil {
		t.Fatal(err)
	}
	retry, err := repo.AddCompanyMembership(user.CognitoSubject, companyA.CompanyID, domain.RoleCompanyUser)
	if err != nil {
		t.Fatal(err)
	}
	if !retry.UpdatedTimestamp.Equal(created.UpdatedTimestamp) {
		t.Fatalf("same-role PostgreSQL retry changed timestamp: %s != %s", retry.UpdatedTimestamp, created.UpdatedTimestamp)
	}
	var eventCountAfterRetry int
	if err := db.QueryRow(`select count(*) from domain_events where event_type=$1`, CompanyMembershipSavedEventType).Scan(&eventCountAfterRetry); err != nil {
		t.Fatal(err)
	}
	if eventCountAfterRetry != eventCountBeforeRetry || postgresProcessMapVersionForTest(t, repo, companyA.CompanyID) != versionBeforeRetry || postgresPolicyGroupVersionForTest(t, repo, companyA.CompanyID) != policyGroupVersionBeforeRetry {
		t.Fatalf("same-role retry changed event/version: events %d->%d Process Map %d->%d policy/group %d->%d", eventCountBeforeRetry, eventCountAfterRetry, versionBeforeRetry, postgresProcessMapVersionForTest(t, repo, companyA.CompanyID), policyGroupVersionBeforeRetry, postgresPolicyGroupVersionForTest(t, repo, companyA.CompanyID))
	}

	versionABeforeGrant := postgresProcessMapVersionForTest(t, repo, companyA.CompanyID)
	versionBBeforeGrant := postgresProcessMapVersionForTest(t, repo, companyB.CompanyID)
	policyGroupABeforeGrant := postgresPolicyGroupVersionForTest(t, repo, companyA.CompanyID)
	policyGroupBBeforeGrant := postgresPolicyGroupVersionForTest(t, repo, companyB.CompanyID)
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyA.CompanyID, domain.RoleDevAdmin); err != nil {
		t.Fatal(err)
	}
	if got := postgresProcessMapVersionForTest(t, repo, companyA.CompanyID); got <= versionABeforeGrant {
		t.Fatalf("dev-admin grant did not advance company A Process Map version: %d <= %d", got, versionABeforeGrant)
	}
	if got := postgresProcessMapVersionForTest(t, repo, companyB.CompanyID); got <= versionBBeforeGrant {
		t.Fatalf("dev-admin grant did not advance company B Process Map version: %d <= %d", got, versionBBeforeGrant)
	}
	if got := postgresPolicyGroupVersionForTest(t, repo, companyA.CompanyID); got <= policyGroupABeforeGrant {
		t.Fatalf("dev-admin grant did not advance company A policy/group version: %d <= %d", got, policyGroupABeforeGrant)
	}
	if got := postgresPolicyGroupVersionForTest(t, repo, companyB.CompanyID); got <= policyGroupBBeforeGrant {
		t.Fatalf("dev-admin grant did not advance company B policy/group version: %d <= %d", got, policyGroupBBeforeGrant)
	}

	versionABeforeDelete := postgresProcessMapVersionForTest(t, repo, companyA.CompanyID)
	versionBBeforeDelete := postgresProcessMapVersionForTest(t, repo, companyB.CompanyID)
	policyGroupABeforeDelete := postgresPolicyGroupVersionForTest(t, repo, companyA.CompanyID)
	policyGroupBBeforeDelete := postgresPolicyGroupVersionForTest(t, repo, companyB.CompanyID)
	if _, err := repo.DeleteCompanyUser(companyA.CompanyID, user.UserID, false); err != nil {
		t.Fatal(err)
	}
	if got := postgresProcessMapVersionForTest(t, repo, companyA.CompanyID); got <= versionABeforeDelete {
		t.Fatalf("dev-admin deletion did not advance company A Process Map version: %d <= %d", got, versionABeforeDelete)
	}
	if got := postgresProcessMapVersionForTest(t, repo, companyB.CompanyID); got <= versionBBeforeDelete {
		t.Fatalf("dev-admin deletion did not advance company B Process Map version: %d <= %d", got, versionBBeforeDelete)
	}
	if got := postgresPolicyGroupVersionForTest(t, repo, companyA.CompanyID); got <= policyGroupABeforeDelete {
		t.Fatalf("dev-admin deletion did not advance company A policy/group version: %d <= %d", got, policyGroupABeforeDelete)
	}
	if got := postgresPolicyGroupVersionForTest(t, repo, companyB.CompanyID); got <= policyGroupBBeforeDelete {
		t.Fatalf("dev-admin deletion did not advance company B policy/group version: %d <= %d", got, policyGroupBBeforeDelete)
	}
	for _, companyID := range []string{companyA.CompanyID, companyB.CompanyID} {
		var allowedJSON []byte
		if err := db.QueryRow(`
select allowed_user_ids
from realtime_outbox
where company_id=$1::uuid
  and scope='process-map:company'
  and event_type='process_map.changed'
order by outbox_sequence desc
limit 1`, companyID).Scan(&allowedJSON); err != nil {
			t.Fatal(err)
		}
		var allowed []string
		if err := json.Unmarshal(allowedJSON, &allowed); err != nil {
			t.Fatal(err)
		}
		if !slices.Contains(allowed, user.UserID) {
			t.Fatalf("revoked user missing from PostgreSQL invalidation audience for %s: %v", companyID, allowed)
		}
	}
}

func TestPostgresPendingInvitationDowngradeInvalidatesGlobalDevAdmin(t *testing.T) {
	_, repo := openPostgresProcessMapIntegration(t)
	companyA, err := repo.CreateCompany("Postgres invitation A")
	if err != nil {
		t.Fatal(err)
	}
	companyB, err := repo.CreateCompany("Postgres invitation B")
	if err != nil {
		t.Fatal(err)
	}
	inviter, err := repo.UpsertAuthUser("postgres-invitation-fence-admin", "postgres-invitation-fence-admin@example.com", "Invitation Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(inviter.CognitoSubject, companyA.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	invitation, err := repo.CreateInvitation(CreateInvitationInput{
		CompanyID: companyA.CompanyID, Email: "postgres-pending-global@example.com",
		Role: domain.RoleCompanyUser, InvitedByUserID: inviter.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	invitee, err := repo.UpsertAuthUser("postgres-pending-global-user", "postgres-pending-global@example.com", "Pending Global")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(invitee.CognitoSubject, companyA.CompanyID, domain.RoleDevAdmin); err != nil {
		t.Fatal(err)
	}
	processBefore := map[string]int64{
		companyA.CompanyID: postgresProcessMapVersionForTest(t, repo, companyA.CompanyID),
		companyB.CompanyID: postgresProcessMapVersionForTest(t, repo, companyB.CompanyID),
	}
	policyBefore := map[string]int64{
		companyA.CompanyID: postgresPolicyGroupVersionForTest(t, repo, companyA.CompanyID),
		companyB.CompanyID: postgresPolicyGroupVersionForTest(t, repo, companyB.CompanyID),
	}
	if _, err := repo.AcceptInvitation(invitation.Token, invitee.CognitoSubject, invitee.Email, invitee.DisplayName); err != nil {
		t.Fatal(err)
	}
	membership, err := repo.GetCompanyUser(companyA.CompanyID, invitee.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if membership.Role != domain.RoleCompanyUser {
		t.Fatalf("accepted invitation role = %q, want %q", membership.Role, domain.RoleCompanyUser)
	}
	for _, companyID := range []string{companyA.CompanyID, companyB.CompanyID} {
		if got := postgresProcessMapVersionForTest(t, repo, companyID); got <= processBefore[companyID] {
			t.Fatalf("invitation downgrade Process Map version for %s = %d, want > %d", companyID, got, processBefore[companyID])
		}
		if got := postgresPolicyGroupVersionForTest(t, repo, companyID); got <= policyBefore[companyID] {
			t.Fatalf("invitation downgrade policy/group version for %s = %d, want > %d", companyID, got, policyBefore[companyID])
		}
	}
}

func TestPostgresProcessMapRecycleFolderRestoreDoesNotReclaimRecreatedCleanupChild(t *testing.T) {
	ctx := context.Background()
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Process Map cleanup incarnation fence")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := repo.UpsertAuthUser("process-map-cleanup-incarnation-admin", "process-map-cleanup-incarnation@example.com", "Cleanup Incarnation Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	folder, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Map perimeter")
	if err != nil {
		t.Fatal(err)
	}
	process, err := repo.CreateLogicGate(company.CompanyID, "Surviving Process")
	if err != nil {
		t.Fatal(err)
	}
	parentID := folder.FolderID
	for _, input := range []ProcessMapPlacementPutInput{
		processMapTestPlacementWithSize(company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 0, 0, 80, 60),
		processMapTestPlacementWithSize(company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeProcess, process.LogicGateID, nil, 11, 13, 9, 6),
	} {
		if _, err := repo.PutProcessMapPlacement(ctx, input); err != nil {
			t.Fatal(err)
		}
	}
	// Seed the mismatched state this cleanup safety test exercises directly.
	// Public Process Map writes now synchronize the Explorer parent and cannot create it.
	if _, err := db.Exec(`
update process_map_placements
set map_parent_folder_id=$3::uuid
where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`,
		company.CompanyID, process.LogicGateID, parentID); err != nil {
		t.Fatal(err)
	}
	var explorerParent string
	if err := db.QueryRow(`
select coalesce(parent_folder_id::text,'')
from company_explorer_items
where company_id=$1::uuid and target_type='logic_gate' and target_id=$2::uuid`,
		company.CompanyID, process.LogicGateID).Scan(&explorerParent); err != nil {
		t.Fatal(err)
	}
	if explorerParent != "" {
		t.Fatalf("cleanup safety setup retained Explorer Folder parent %s", explorerParent)
	}

	placementState := func() (string, string) {
		t.Helper()
		var token, state string
		if err := db.QueryRow(`
select placement_incarnation_token::text,
       jsonb_build_object(
         'map_parent_folder_id',map_parent_folder_id,
         'revision',revision,
         'created_timestamp',created_timestamp,
         'updated_timestamp',updated_timestamp,
         'grid_x',grid_x,'grid_y',grid_y,'grid_width',grid_width,'grid_height',grid_height
       )::text
from process_map_placements
where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`, company.CompanyID, process.LogicGateID).Scan(&token, &state); err != nil {
			t.Fatal(err)
		}
		return token, state
	}
	originalToken, _ := placementState()
	if _, err := repo.DeleteCompanyExplorerTargets(company.CompanyID, []CompanyExplorerDeleteTargetInput{{Kind: "folder", ID: folder.FolderID}}, admin.UserID); err != nil {
		t.Fatal(err)
	}
	cleanupToken, cleanupState := placementState()
	if cleanupToken != originalToken {
		t.Fatalf("Folder cleanup changed placement incarnation token: %s -> %s", originalToken, cleanupToken)
	}

	items, err := repo.ListRecycleBinItems(company.CompanyID, admin.UserID)
	if err != nil || len(items) != 1 {
		t.Fatalf("Folder recycle items = %+v, err=%v", items, err)
	}
	folderRecycleID := items[0].RecycleBinItemID
	var claimedToken string
	if err := db.QueryRow(`
select claim->>'placement_incarnation_token'
from recycle_bin_items item
cross join lateral jsonb_array_elements(coalesce(item.restore_payload->'process_map_cleanup_child_reparents','[]'::jsonb)) claim
where item.company_id=$1::uuid and item.recycle_bin_item_id=$2::uuid
  and claim->>'resource_id'=$3`, company.CompanyID, folderRecycleID, process.LogicGateID).Scan(&claimedToken); err != nil {
		t.Fatal(err)
	}
	if claimedToken != cleanupToken {
		t.Fatalf("cleanup claim token = %q, want %q", claimedToken, cleanupToken)
	}

	var placementPayload []byte
	if err := db.QueryRow(`
select jsonb_agg(to_jsonb(placement))
from process_map_placements placement
where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`, company.CompanyID, process.LogicGateID).Scan(&placementPayload); err != nil {
		t.Fatal(err)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(ctx, `delete from process_map_placements where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`, company.CompanyID, process.LogicGateID); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := postgresRestoreProcessMapPlacementsTx(ctx, tx, json.RawMessage(placementPayload)); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	recreatedToken, recreatedState := placementState()
	if recreatedToken == cleanupToken {
		t.Fatalf("restored placement reused incarnation token %s", recreatedToken)
	}
	if recreatedState != cleanupState {
		t.Fatalf("restored placement claim fields changed:\ncleanup:   %s\nrecreated: %s", cleanupState, recreatedState)
	}

	if _, err := repo.RestoreRecycleBinItems(company.CompanyID, admin.UserID, []string{folderRecycleID}); err != nil {
		t.Fatal(err)
	}
	finalToken, finalState := placementState()
	if finalToken != recreatedToken || finalState != recreatedState {
		t.Fatalf("Folder restore reclaimed recreated cleanup child:\nbefore: %s %s\nafter:  %s %s", recreatedToken, recreatedState, finalToken, finalState)
	}
}
