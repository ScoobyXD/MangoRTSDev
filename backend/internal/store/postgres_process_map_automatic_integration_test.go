package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"reflect"
	"testing"
)

func postgresAutomaticTestPlacements(t *testing.T, db *sql.DB, companyID string) map[string]domain.ProcessMapPlacement {
	t.Helper()
	rows, err := db.Query(`
select company_id::text,resource_type,resource_id::text,map_parent_folder_id::text,
       grid_x,grid_y,grid_width,grid_height,revision,created_timestamp,updated_timestamp
from process_map_placements
where company_id=$1::uuid
order by resource_type,resource_id`, companyID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	items := map[string]domain.ProcessMapPlacement{}
	for rows.Next() {
		item, err := scanProcessMapPlacement(rows)
		if err != nil {
			t.Fatal(err)
		}
		items[processMapAutomaticPlacementKey(item.ResourceType, item.ResourceID)] = item
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return items
}

func postgresAutomaticTestTrace(t *testing.T, db *sql.DB, companyID, relationshipID string) domain.ProcessMapTrace {
	t.Helper()
	item, err := scanProcessMapTrace(db.QueryRow(`
select company_id::text,resource_operational_relationship_id::text,route_points,revision,created_timestamp,updated_timestamp
from process_map_traces
where company_id=$1::uuid and resource_operational_relationship_id=$2::uuid`, companyID, relationshipID))
	if err != nil {
		t.Fatal(err)
	}
	return item
}

func TestPostgresProcessMapAutomaticPlacementMatchesMemoryPlacementAndTracePlan(t *testing.T) {
	ctx := context.Background()
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Automatic placement parity")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := repo.UpsertAuthUser("automatic-parity-admin", "automatic-parity@example.com", "Automatic Parity Admin")
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
	moving, err := repo.CreateCompanyExplorerFolder(company.CompanyID, rootA.FolderID, "logic_gate", "Moving")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateCompanyExplorerFolder(company.CompanyID, rootB.FolderID, "logic_gate", "Irregular sibling"); err != nil {
		t.Fatal(err)
	}
	insideA, _ := repo.CreateLogicGate(company.CompanyID, "Inside A")
	insideB, _ := repo.CreateLogicGate(company.CompanyID, "Inside B")
	outside, _ := repo.CreateLogicGate(company.CompanyID, "Outside")
	rootBProcess, _ := repo.CreateLogicGate(company.CompanyID, "Root B Process")
	for index, assignment := range []struct {
		folderID string
		process  domain.LogicGate
	}{{moving.FolderID, insideA}, {moving.FolderID, insideB}, {rootA.FolderID, outside}, {rootB.FolderID, rootBProcess}} {
		if _, _, err := repo.AssignCompanyExplorerFolderItem(company.CompanyID, assignment.folderID, EntityTypeLogicGate, assignment.process.LogicGateID, index*1000); err != nil {
			t.Fatal(err)
		}
	}
	createTrace := func(sourceID, targetID string, points []domain.ProcessMapRoutePoint) domain.ResourceOperationalRelationship {
		t.Helper()
		created, err := repo.CreateResourceOperationalRelationship(ctx, ResourceOperationalRelationshipCreateInput{
			CompanyID:   company.CompanyID,
			Source:      processMapTestRef(domain.ProcessMapResourceTypeProcess, sourceID),
			Target:      processMapTestRef(domain.ProcessMapResourceTypeProcess, targetID),
			Trace:       &ProcessMapTraceInput{RoutePoints: points},
			ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
		})
		if err != nil || created.Relationship == nil {
			t.Fatalf("create relationship = %+v, err=%v", created, err)
		}
		return *created.Relationship
	}
	internal := createTrace(insideA.LogicGateID, insideB.LogicGateID, []domain.ProcessMapRoutePoint{{X: 12, Y: 12}, {X: 20, Y: 12}})
	external := createTrace(insideA.LogicGateID, outside.LogicGateID, []domain.ProcessMapRoutePoint{{X: 30, Y: 20}, {X: 45, Y: 20}})

	before := postgresAutomaticTestPlacements(t, db, company.CompanyID)
	memory := NewMemoryRepo()
	for _, placement := range before {
		placementKey := processMapPlacementMemoryKey(company.CompanyID, placement.ResourceType, placement.ResourceID)
		memory.processMapPlacements[placementKey] = processMapAutomaticClonePlacement(placement)
	}
	for _, relationship := range []domain.ResourceOperationalRelationship{internal, external} {
		relationshipKey := key(company.CompanyID, relationship.ResourceOperationalRelationshipID)
		memory.resourceOperationalRelationships[relationshipKey] = relationship
		memory.processMapTraces[relationshipKey] = postgresAutomaticTestTrace(t, db, company.CompanyID, relationship.ResourceOperationalRelationshipID)
	}
	targetParentID := rootB.FolderID
	changed, err := memory.syncAutomaticMemoryProcessMapPlacementLocked(
		company.CompanyID,
		domain.ProcessMapResourceTypeFolder,
		moving.FolderID,
		&targetParentID,
	)
	if err != nil || !changed {
		t.Fatalf("Memory automatic plan changed=%t err=%v", changed, err)
	}
	if _, err := repo.MoveCompanyExplorerFolder(company.CompanyID, moving.FolderID, &targetParentID, 0, admin.UserID, admin.UserID); err != nil {
		t.Fatal(err)
	}

	postgresPlacements := postgresAutomaticTestPlacements(t, db, company.CompanyID)
	if len(postgresPlacements) != len(memory.processMapPlacements) {
		t.Fatalf("placement count PostgreSQL/Memory = %d/%d", len(postgresPlacements), len(memory.processMapPlacements))
	}
	for placementKey, postgresPlacement := range postgresPlacements {
		memoryKey := processMapPlacementMemoryKey(company.CompanyID, postgresPlacement.ResourceType, postgresPlacement.ResourceID)
		memoryPlacement, ok := memory.processMapPlacements[memoryKey]
		if !ok {
			t.Fatalf("Memory missing placement %s", placementKey)
		}
		if !processMapAutomaticGeometryEqual(postgresPlacement, memoryPlacement) || postgresPlacement.Revision != memoryPlacement.Revision {
			t.Fatalf("placement %s PostgreSQL=%+v Memory=%+v", placementKey, postgresPlacement, memoryPlacement)
		}
	}
	for _, relationship := range []domain.ResourceOperationalRelationship{internal, external} {
		traceKey := key(company.CompanyID, relationship.ResourceOperationalRelationshipID)
		postgresTrace := postgresAutomaticTestTrace(t, db, company.CompanyID, relationship.ResourceOperationalRelationshipID)
		memoryTrace := memory.processMapTraces[traceKey]
		if postgresTrace.Revision != memoryTrace.Revision || !reflect.DeepEqual(postgresTrace.RoutePoints, memoryTrace.RoutePoints) {
			t.Fatalf("trace %s PostgreSQL=%+v Memory=%+v", relationship.ResourceOperationalRelationshipID, postgresTrace, memoryTrace)
		}
	}
}

func TestPostgresProcessMapExplorerAutomaticPlacementFailureRollsBackWholeCommand(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("Automatic placement rollback")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := repo.UpsertAuthUser("automatic-rollback-admin", "automatic-rollback@example.com", "Automatic Rollback Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	moving, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Moving")
	if err != nil {
		t.Fatal(err)
	}
	target, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Target")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
update process_map_placements
set grid_x=$3-grid_width,grid_y=0,revision=revision+1,updated_timestamp=statement_timestamp()
where company_id=$1::uuid and resource_type='company_explorer_folder' and resource_id=$2::uuid`,
		company.CompanyID, target.FolderID, ProcessMapMaxCoordinate); err != nil {
		t.Fatal(err)
	}
	readSnapshot := func() string {
		t.Helper()
		var snapshot string
		if err := db.QueryRow(`
select jsonb_build_object(
  'folders',coalesce((select jsonb_agg(to_jsonb(folder) order by folder.folder_id) from company_explorer_folders folder where folder.company_id=$1::uuid),'[]'::jsonb),
  'placements',coalesce((select jsonb_agg(to_jsonb(placement) order by placement.resource_type,placement.resource_id) from process_map_placements placement where placement.company_id=$1::uuid),'[]'::jsonb),
  'events',coalesce((select jsonb_agg(to_jsonb(event) order by event.sequence) from domain_events event where event.company_id=$1::uuid),'[]'::jsonb),
  'versions',coalesce((select jsonb_agg(to_jsonb(version) order by version.scope,version.resource_key) from workspace_read_versions version where version.company_id=$1::uuid),'[]'::jsonb),
  'outbox',coalesce((select jsonb_agg(to_jsonb(item) order by item.outbox_sequence) from realtime_outbox item where item.company_id=$1::uuid),'[]'::jsonb)
)::text`, company.CompanyID).Scan(&snapshot); err != nil {
			t.Fatal(err)
		}
		return snapshot
	}
	before := readSnapshot()
	_, err = repo.MoveCompanyExplorerFolder(company.CompanyID, moving.FolderID, &target.FolderID, 0, admin.UserID, admin.UserID)
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("move error = %v, want %v", err, ErrInvalid)
	}
	if after := readSnapshot(); after != before {
		t.Fatalf("failed automatic placement changed durable state:\nbefore=%s\nafter=%s", before, after)
	}
}
