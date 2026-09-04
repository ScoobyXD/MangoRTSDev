package store

import (
	"context"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"reflect"
	"slices"
	"testing"
)

func newProcessMapChangesFixture(t *testing.T) (*MemoryRepo, string, domain.User, domain.User, domain.LogicGate, domain.LogicGate) {
	t.Helper()
	repo, companyID, admin, viewer, _ := newV2PolicyTestRepo(t)
	makeProcess := func(name string, x int) domain.LogicGate {
		process, err := repo.CreateLogicGate(companyID, name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := repo.PutProcessMapPlacement(context.Background(), processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, process.LogicGateID, nil, x, 64, 32, 32)); err != nil {
			t.Fatal(err)
		}
		return process
	}
	return repo, companyID, admin, viewer, makeProcess("First", 64), makeProcess("Second", 320)
}

func changesTestTiles(version int64, xs ...int) []ProcessMapTileValidation {
	tiles := make([]ProcessMapTileValidation, 0, len(xs))
	for _, x := range xs {
		tiles = append(tiles, ProcessMapTileValidation{Z: ProcessMapMaxTileZoom, X: x, Y: 0, ProcessMapReadVersion: version})
	}
	return tiles
}

func requireValidatedTileXs(t *testing.T, result ProcessMapChanges, xs ...int) {
	t.Helper()
	got := []int{}
	for _, tile := range result.ValidatedTiles {
		got = append(got, tile.X)
	}
	if result.ProtectedGeometryChanged || !slices.Equal(got, xs) {
		t.Fatalf("validated tile X values=%v protected=%v, want %v", got, result.ProtectedGeometryChanged, xs)
	}
}

func TestMemoryProcessMapChangesMoveInvalidatesOldAndNewTilesOnly(t *testing.T) {
	repo, companyID, admin, _, process, _ := newProcessMapChangesFixture(t)
	ctx := context.Background()
	version, _, _ := repo.CurrentProcessMapVersions(ctx, companyID)
	query := ProcessMapChangesQuery{CompanyID: companyID, PermissionUserID: admin.UserID, SinceVersion: version, Tiles: changesTestTiles(version, 0, 1, 2, 4)}
	before, err := repo.GetProcessMapTile(ctx, ProcessMapTileQuery{CompanyID: companyID, PermissionUserID: admin.UserID, Z: ProcessMapMaxTileZoom, X: 1})
	if err != nil {
		t.Fatal(err)
	}
	move, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, process.LogicGateID, nil, 600, 64, 32, 32))
	if err != nil {
		t.Fatal(err)
	}
	result, err := repo.GetProcessMapChanges(ctx, query)
	if err != nil {
		t.Fatal(err)
	}
	requireValidatedTileXs(t, result, 1, 4)
	if result.ProcessMapReadVersion != move.ProcessMapReadVersion || result.Bounds.MaxX != 632 {
		t.Fatalf("scene is not from committed move: %+v", result)
	}
	after, err := repo.GetProcessMapTile(ctx, ProcessMapTileQuery{CompanyID: companyID, PermissionUserID: admin.UserID, Z: ProcessMapMaxTileZoom, X: 1})
	if err != nil {
		t.Fatal(err)
	}
	before.ProcessMapReadVersion = after.ProcessMapReadVersion
	if !reflect.DeepEqual(before, after) {
		t.Fatal("server certified a changed tile as reusable")
	}

	second, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, process.LogicGateID, nil, 900, 64, 32, 32))
	if err != nil {
		t.Fatal(err)
	}
	query.SinceVersion = move.ProcessMapReadVersion
	query.Tiles = changesTestTiles(version, 0, 2, 3, 4)
	query.Tiles[0].ProcessMapReadVersion = move.ProcessMapReadVersion
	result, err = repo.GetProcessMapChanges(ctx, query)
	if err != nil {
		t.Fatal(err)
	}
	requireValidatedTileXs(t, result, 0, 4)
	if result.ProcessMapReadVersion != second.ProcessMapReadVersion {
		t.Fatal("missed a concurrent/newer committed move")
	}
}

func TestMemoryProcessMapChangesIncludeExternalTracesAndDeletedRoutes(t *testing.T) {
	repo, companyID, admin, _, source, target := newProcessMapChangesFixture(t)
	ctx := context.Background()
	created, err := repo.CreateResourceOperationalRelationship(ctx, ResourceOperationalRelationshipCreateInput{CompanyID: companyID, ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
		Source: processMapTestRef(domain.ProcessMapResourceTypeProcess, source.LogicGateID), Target: processMapTestRef(domain.ProcessMapResourceTypeProcess, target.LogicGateID),
		Trace: &ProcessMapTraceInput{RoutePoints: []domain.ProcessMapRoutePoint{{X: 700, Y: 80}, {X: 700, Y: 600}, {X: 320, Y: 600}}}})
	if err != nil {
		t.Fatal(err)
	}
	query := ProcessMapChangesQuery{CompanyID: companyID, PermissionUserID: admin.UserID, SinceVersion: created.ProcessMapReadVersion,
		Tiles: []ProcessMapTileValidation{{Z: ProcessMapMaxTileZoom, X: 2, Y: 2, ProcessMapReadVersion: created.ProcessMapReadVersion}, {Z: ProcessMapMaxTileZoom, X: 4, Y: 2, ProcessMapReadVersion: created.ProcessMapReadVersion}}}
	moved, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, source.LogicGateID, nil, 96, 64, 32, 32))
	if err != nil {
		t.Fatal(err)
	}
	if len(moved.Traces) != 0 {
		t.Fatal("moving one endpoint should preserve external saved route")
	}
	result, err := repo.GetProcessMapChanges(ctx, query)
	if err != nil {
		t.Fatal(err)
	}
	requireValidatedTileXs(t, result, 4)

	query.SinceVersion = moved.ProcessMapReadVersion
	for index := range query.Tiles {
		query.Tiles[index].ProcessMapReadVersion = moved.ProcessMapReadVersion
	}
	rerouted, err := repo.PutProcessMapTrace(ctx, ProcessMapTracePutInput{CompanyID: companyID, ActorUserID: admin.UserID, PermissionUserID: admin.UserID, ResourceOperationalRelationshipID: created.Relationship.ResourceOperationalRelationshipID, RoutePoints: []domain.ProcessMapRoutePoint{}})
	if err != nil {
		t.Fatal(err)
	}
	result, err = repo.GetProcessMapChanges(ctx, query)
	if err != nil {
		t.Fatal(err)
	}
	requireValidatedTileXs(t, result, 4)
	query.SinceVersion, query.Tiles = rerouted.ProcessMapReadVersion, changesTestTiles(rerouted.ProcessMapReadVersion, 0, 1, 4)
	if _, err := repo.DeleteResourceOperationalRelationship(ctx, ResourceOperationalRelationshipDeleteInput{CompanyID: companyID, ActorUserID: admin.UserID, PermissionUserID: admin.UserID, ResourceOperationalRelationshipID: created.Relationship.ResourceOperationalRelationshipID}); err != nil {
		t.Fatal(err)
	}
	result, err = repo.GetProcessMapChanges(ctx, query)
	if err != nil {
		t.Fatal(err)
	}
	requireValidatedTileXs(t, result, 4)
}

func TestMemoryProcessMapChangesPresentationEventsAndBroadRefresh(t *testing.T) {
	for _, eventType := range []string{"logic_gate_updated", LogicGateRACIUpdatedEventType, QDRatingRealtimeEventType} {
		t.Run(eventType, func(t *testing.T) {
			repo, companyID, admin, _, process, _ := newProcessMapChangesFixture(t)
			version, _, _ := repo.CurrentProcessMapVersions(context.Background(), companyID)
			if _, err := repo.AppendDomainEvent(workspaceDomainEventInput(companyID, eventType, map[string]any{"logic_gate_id": process.LogicGateID})); err != nil {
				t.Fatal(err)
			}
			query := ProcessMapChangesQuery{CompanyID: companyID, PermissionUserID: admin.UserID, SinceVersion: version, Tiles: changesTestTiles(version, 0, 1, 4)}
			result, err := repo.GetProcessMapChanges(context.Background(), query)
			if err != nil {
				t.Fatal(err)
			}
			requireValidatedTileXs(t, result, 1, 4)
			if _, err := repo.AppendDomainEvent(workspaceDomainEventInput(companyID, "company_explorer_folder_updated", map[string]any{})); err != nil {
				t.Fatal(err)
			}
			result, err = repo.GetProcessMapChanges(context.Background(), query)
			if err != nil {
				t.Fatal(err)
			}
			requireValidatedTileXs(t, result)
		})
	}
}

func TestMemoryProcessMapChangesFolderMoveIncludesSubtreeAndExternalConnection(t *testing.T) {
	repo, companyID, admin, _, source, target := newProcessMapChangesFixture(t)
	ctx := context.Background()
	folder, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Moving folder")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 0, 0, 512, 512)); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, source.LogicGateID, &folder.FolderID, 64, 64, 32, 32)); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, target.LogicGateID, nil, 900, 64, 32, 32)); err != nil {
		t.Fatal(err)
	}
	created, err := repo.CreateResourceOperationalRelationship(ctx, ResourceOperationalRelationshipCreateInput{CompanyID: companyID, ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
		Source: processMapTestRef(domain.ProcessMapResourceTypeProcess, source.LogicGateID), Target: processMapTestRef(domain.ProcessMapResourceTypeProcess, target.LogicGateID), Trace: &ProcessMapTraceInput{RoutePoints: []domain.ProcessMapRoutePoint{}}})
	if err != nil {
		t.Fatal(err)
	}
	moved, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 600, 0, 512, 512))
	if err != nil {
		t.Fatal(err)
	}
	if len(moved.Placements) != 2 || len(moved.Traces) != 0 {
		t.Fatalf("unexpected group move envelope: %+v", moved)
	}
	result, err := repo.GetProcessMapChanges(ctx, ProcessMapChangesQuery{CompanyID: companyID, PermissionUserID: admin.UserID, SinceVersion: created.ProcessMapReadVersion, Tiles: changesTestTiles(created.ProcessMapReadVersion, 0, 1, 2, 3, 4, 6)})
	if err != nil {
		t.Fatal(err)
	}
	requireValidatedTileXs(t, result, 6)
	query := ProcessMapChangesQuery{CompanyID: companyID, PermissionUserID: admin.UserID, SinceVersion: moved.ProcessMapReadVersion, Tiles: changesTestTiles(moved.ProcessMapReadVersion, 0, 2, 3, 4, 6)}
	if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 600, 0, 256, 256)); err != nil {
		t.Fatal(err)
	}
	result, err = repo.GetProcessMapChanges(ctx, query)
	if err != nil {
		t.Fatal(err)
	}
	requireValidatedTileXs(t, result, 0, 6)
}

func TestMemoryProcessMapChangesProtectedAndMissingHistoryPurge(t *testing.T) {
	for _, mode := range []string{"permission", "missing", "too_many"} {
		t.Run(mode, func(t *testing.T) {
			repo, companyID, admin, _, process, _ := newProcessMapChangesFixture(t)
			version, _, _ := repo.CurrentProcessMapVersions(context.Background(), companyID)
			eventType := "logic_gate_updated"
			if mode == "permission" {
				eventType = "logic_gate_permissions_updated"
			}
			event, err := repo.AppendDomainEvent(workspaceDomainEventInput(companyID, eventType, map[string]any{"logic_gate_id": process.LogicGateID}))
			if err != nil {
				t.Fatal(err)
			}
			if mode == "missing" {
				delete(repo.domainEvents, domainEventMemoryKey(companyID, event.EventID))
			}
			if mode == "too_many" {
				repo.workspaceReadVersions[workspaceReadVersionMemoryKey(companyID, "process-map", "")] += processMapMaxReplayEvents
			}
			result, err := repo.GetProcessMapChanges(context.Background(), ProcessMapChangesQuery{CompanyID: companyID, PermissionUserID: admin.UserID, SinceVersion: version, Tiles: changesTestTiles(version, 0, 4)})
			if err != nil {
				t.Fatal(err)
			}
			if !result.ProtectedGeometryChanged || len(result.ValidatedTiles) != 0 {
				t.Fatalf("protected/incomplete replay was reusable: %+v", result)
			}
		})
	}
}

func TestMemoryProcessMapChangesRestrictedDamageDoesNotRevealBounds(t *testing.T) {
	repo, companyID, admin, viewer, process, _ := newProcessMapChangesFixture(t)
	noAccess := ResourceDefaultAccessNoAccess
	putMemoryPermissionPolicy(t, repo, ResourcePermissionPolicyUpdateInput{CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: process.LogicGateID, PermissionMode: PolicyModeCustomized, DefaultAccess: &noAccess, DescendantAction: PolicyDescendantActionInheritedOnly})
	version, _, _ := repo.CurrentProcessMapVersions(context.Background(), companyID)
	if _, err := repo.PutProcessMapPlacement(context.Background(), processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, process.LogicGateID, nil, 600, 64, 32, 32)); err != nil {
		t.Fatal(err)
	}
	result, err := repo.GetProcessMapChanges(context.Background(), ProcessMapChangesQuery{CompanyID: companyID, PermissionUserID: viewer.UserID, SinceVersion: version, Tiles: changesTestTiles(version, 0, 1, 2, 4)})
	if err != nil {
		t.Fatal(err)
	}
	requireValidatedTileXs(t, result)
	wire, _ := json.Marshal(result)
	var payload map[string]any
	if err := json.Unmarshal(wire, &payload); err != nil {
		t.Fatal(err)
	}
	if _, exists := payload[processMapDamagePayloadKey]; exists {
		t.Fatal("private change geometry escaped in the read response")
	}
}

func TestMemoryProcessMapChangesRejectInvalidOrUnauthorizedReads(t *testing.T) {
	repo, companyID, admin, _, _, _ := newProcessMapChangesFixture(t)
	version, _, _ := repo.CurrentProcessMapVersions(context.Background(), companyID)
	query := ProcessMapChangesQuery{CompanyID: companyID, PermissionUserID: admin.UserID, SinceVersion: version + 1}
	if _, err := repo.GetProcessMapChanges(context.Background(), query); !errors.Is(err, ErrInvalid) {
		t.Fatalf("future version error=%v", err)
	}
	query.SinceVersion, query.Tiles = version, changesTestTiles(version, 0, 0)
	if _, err := repo.GetProcessMapChanges(context.Background(), query); !errors.Is(err, ErrInvalid) {
		t.Fatalf("duplicate tiles error=%v", err)
	}
	query.Tiles = changesTestTiles(version, 0)
	query.PermissionUserID = "not-a-member"
	if _, err := repo.GetProcessMapChanges(context.Background(), query); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unauthorized read error=%v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := repo.GetProcessMapChanges(ctx, query); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation error=%v", err)
	}
}
