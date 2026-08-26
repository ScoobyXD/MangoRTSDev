package store

import (
	"context"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"testing"
)

func processMapTestPlacementInput(companyID, actorUserID, resourceType, resourceID string, parentID *string, x, y int) ProcessMapPlacementPutInput {
	return processMapTestPlacementWithSize(companyID, actorUserID, resourceType, resourceID, parentID, x, y, ProcessMapDefaultWidth, ProcessMapDefaultHeight)
}

func processMapTestPlacementWithSize(companyID, actorUserID, resourceType, resourceID string, parentID *string, x, y, width, height int) ProcessMapPlacementPutInput {
	return ProcessMapPlacementPutInput{
		CompanyID: companyID, ResourceType: resourceType, ResourceID: resourceID, MapParentFolderID: parentID,
		GridX: x, GridY: y, GridWidth: width, GridHeight: height,
		ActorUserID: actorUserID, PermissionUserID: actorUserID,
	}
}

func processMapTestRef(resourceType, resourceID string) domain.ProcessMapResourceRef {
	return domain.ProcessMapResourceRef{ResourceType: resourceType, ResourceID: resourceID}
}

func requireProcessMapRelationshipEventIdentities(t *testing.T, events []domain.DomainEvent, relationship domain.ResourceOperationalRelationship) {
	t.Helper()
	if len(events) == 0 {
		t.Fatal("Process Map relationship mutation emitted no durable event")
	}
	for _, event := range events {
		for field, want := range map[string]string{
			"resource_operational_relationship_id": relationship.ResourceOperationalRelationshipID,
			"source_resource_type":                 relationship.Source.ResourceType,
			"source_resource_id":                   relationship.Source.ResourceID,
			"target_resource_type":                 relationship.Target.ResourceType,
			"target_resource_id":                   relationship.Target.ResourceID,
		} {
			if got, _ := event.Payload[field].(string); got != want {
				t.Fatalf("%s payload %s = %q, want %q: %+v", event.Type, field, got, want, event.Payload)
			}
		}
	}
}

func TestMemoryProcessMapGlobalSceneTileAndCrossParentTrace(t *testing.T) {
	ctx := context.Background()
	repo, companyID, admin, _, _ := newV2PolicyTestRepo(t)
	folderA, _ := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Receiving")
	folderB, _ := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Shipping")
	processA, _ := repo.CreateLogicGate(companyID, "Receive")
	processB, _ := repo.CreateLogicGate(companyID, "Ship")
	for _, input := range []ProcessMapPlacementPutInput{
		processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folderA.FolderID, nil, 0, 0, 80, 60),
		processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folderB.FolderID, nil, 100, 0, 80, 60),
		processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, processA.LogicGateID, &folderA.FolderID, 10, 10, 11, 7),
		processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, processB.LogicGateID, &folderB.FolderID, 120, 10, 13, 9),
	} {
		envelope, err := repo.PutProcessMapPlacement(ctx, input)
		if err != nil || len(envelope.Placements) != 1 || !envelope.Changed || envelope.ProcessMapReadVersion == 0 {
			t.Fatalf("placement envelope = %+v, err=%v", envelope, err)
		}
	}
	created, err := repo.CreateResourceOperationalRelationship(ctx, ResourceOperationalRelationshipCreateInput{
		CompanyID:   companyID,
		Source:      processMapTestRef(domain.ProcessMapResourceTypeProcess, processA.LogicGateID),
		Target:      processMapTestRef(domain.ProcessMapResourceTypeProcess, processB.LogicGateID),
		Trace:       &ProcessMapTraceInput{RoutePoints: []domain.ProcessMapRoutePoint{{X: 60, Y: 14}, {X: 90, Y: 14}}},
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil || created.Relationship == nil || !created.Created || !created.Changed || len(created.Traces) != 1 {
		t.Fatalf("relationship envelope = %+v, err=%v", created, err)
	}
	requireProcessMapRelationshipEventIdentities(t, created.Events, *created.Relationship)
	scene, err := repo.GetProcessMapScene(ctx, ProcessMapSceneQuery{CompanyID: companyID, PermissionUserID: admin.UserID})
	wantBounds := domain.ProcessMapBounds{MinX: 0, MinY: 0, MaxX: 180, MaxY: 60}
	if err != nil || scene.Bounds == nil || *scene.Bounds != wantBounds || scene.TileSize != ProcessMapTileSize || scene.ProcessMapReadVersion != created.ProcessMapReadVersion {
		t.Fatalf("scene = %+v, err=%v", scene, err)
	}
	tile, err := repo.GetProcessMapTile(ctx, ProcessMapTileQuery{CompanyID: companyID, PermissionUserID: admin.UserID, Z: 0, X: 0, Y: 0})
	if err != nil || len(tile.Placements) != 4 || len(tile.Traces) != 1 || tile.ProcessMapReadVersion != scene.ProcessMapReadVersion {
		t.Fatalf("tile = %+v, err=%v", tile, err)
	}
	trace := tile.Traces[0]
	if trace.Source.ResourceID != processA.LogicGateID || trace.Target.ResourceID != processB.LogicGateID || trace.Presentation != domain.ProcessMapPresentationWhole || len(trace.RoutePoints) != 0 || len(trace.PathFragments) == 0 {
		t.Fatalf("cross-parent trace = %+v", trace)
	}
	if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, processA.LogicGateID, nil, 10, 10, 11, 7)); err != nil {
		t.Fatal(err)
	}
	if _, ok := repo.processMapTraces[key(companyID, created.Relationship.ResourceOperationalRelationshipID)]; !ok {
		t.Fatal("map reparenting deleted an operational trace")
	}
	deletedPlacement, err := repo.DeleteProcessMapPlacement(ctx, ProcessMapPlacementDeleteInput{
		CompanyID: companyID, ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: processA.LogicGateID,
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil || len(deletedPlacement.DeletedTraceIDs) != 1 || deletedPlacement.DeletedTraceIDs[0] != created.Relationship.ResourceOperationalRelationshipID {
		t.Fatalf("placement delete envelope = %+v, err=%v", deletedPlacement, err)
	}
	if _, ok := repo.resourceOperationalRelationships[key(companyID, created.Relationship.ResourceOperationalRelationshipID)]; !ok {
		t.Fatal("placement removal deleted its operational relationship")
	}
	deletedRelationship, err := repo.DeleteResourceOperationalRelationship(ctx, ResourceOperationalRelationshipDeleteInput{
		CompanyID: companyID, ResourceOperationalRelationshipID: created.Relationship.ResourceOperationalRelationshipID,
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	requireProcessMapRelationshipEventIdentities(t, deletedRelationship.Events, *created.Relationship)
}

func TestMemoryProcessMapPermissionSafeSceneAndTile(t *testing.T) {
	ctx := context.Background()
	repo, companyID, admin, viewer, _ := newV2PolicyTestRepo(t)
	visible, _ := repo.CreateLogicGate(companyID, "Visible")
	hidden, _ := repo.CreateLogicGate(companyID, "Hidden")
	for _, input := range []ProcessMapPlacementPutInput{
		processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, visible.LogicGateID, nil, 0, 0, 10, 8),
		processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, hidden.LogicGateID, nil, 100, 20, 90, 70),
	} {
		if _, err := repo.PutProcessMapPlacement(ctx, input); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := repo.CreateResourceOperationalRelationship(ctx, ResourceOperationalRelationshipCreateInput{
		CompanyID:   companyID,
		Source:      processMapTestRef(domain.ProcessMapResourceTypeProcess, visible.LogicGateID),
		Target:      processMapTestRef(domain.ProcessMapResourceTypeProcess, hidden.LogicGateID),
		Trace:       &ProcessMapTraceInput{RoutePoints: []domain.ProcessMapRoutePoint{{X: 50, Y: 4}}},
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	noAccess := ResourceDefaultAccessNoAccess
	if _, _, err := repo.PutResourcePermissionPolicy(ResourcePermissionPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: hidden.LogicGateID,
		PermissionMode: PolicyModeCustomized, DefaultAccess: &noAccess, DescendantAction: PolicyDescendantActionInheritedOnly,
	}); err != nil {
		t.Fatal(err)
	}
	scene, err := repo.GetProcessMapScene(ctx, ProcessMapSceneQuery{CompanyID: companyID, PermissionUserID: viewer.UserID})
	wantBounds := domain.ProcessMapBounds{MinX: 0, MinY: 0, MaxX: 104, MaxY: 23}
	if err != nil || scene.Bounds == nil || *scene.Bounds != wantBounds {
		t.Fatalf("permission-safe scene = %+v, err=%v", scene, err)
	}
	tile, err := repo.GetProcessMapTile(ctx, ProcessMapTileQuery{CompanyID: companyID, PermissionUserID: viewer.UserID, Z: 0, X: 0, Y: 0})
	if err != nil || len(tile.Placements) != 2 || len(tile.Traces) != 0 {
		t.Fatalf("permission-safe tile = %+v, err=%v", tile, err)
	}
	encoded, _ := json.Marshal(tile)
	var wire struct {
		Placements []map[string]any `json:"placements"`
		Traces     []map[string]any `json:"traces"`
	}
	if err := json.Unmarshal(encoded, &wire); err != nil {
		t.Fatal(err)
	}
	restricted := 0
	for _, item := range wire.Placements {
		if isRestricted, _ := item["restricted"].(bool); isRestricted {
			restricted++
			if len(item) != 3 {
				t.Fatalf("restricted placeholder leaked fields: %+v", item)
			}
		}
	}
	if restricted != 1 || len(wire.Traces) != 0 {
		t.Fatalf("privacy wire = %+v", wire)
	}
	if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementInput(companyID, viewer.UserID, domain.ProcessMapResourceTypeProcess, hidden.LogicGateID, nil, 1, 1)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("hidden write error = %v", err)
	}
}

func TestMemoryProcessMapFolderGroupMoveResizeAndEnvelopes(t *testing.T) {
	ctx := context.Background()
	repo, companyID, admin, _, _ := newV2PolicyTestRepo(t)
	folder, _ := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Group")
	insideA, _ := repo.CreateLogicGate(companyID, "A")
	insideB, _ := repo.CreateLogicGate(companyID, "B")
	outside, _ := repo.CreateLogicGate(companyID, "Outside")
	for _, input := range []ProcessMapPlacementPutInput{
		processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 0, 0, 100, 80),
		processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, insideA.LogicGateID, &folder.FolderID, 10, 10, 10, 6),
		processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, insideB.LogicGateID, &folder.FolderID, 40, 10, 10, 6),
		processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, outside.LogicGateID, nil, 180, 10, 10, 6),
	} {
		if _, err := repo.PutProcessMapPlacement(ctx, input); err != nil {
			t.Fatal(err)
		}
	}
	makeRelationship := func(sourceID, targetID string, points []domain.ProcessMapRoutePoint) ProcessMapMutationEnvelope {
		t.Helper()
		result, err := repo.CreateResourceOperationalRelationship(ctx, ResourceOperationalRelationshipCreateInput{
			CompanyID: companyID, Source: processMapTestRef(domain.ProcessMapResourceTypeProcess, sourceID), Target: processMapTestRef(domain.ProcessMapResourceTypeProcess, targetID),
			Trace: &ProcessMapTraceInput{RoutePoints: points}, ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
		})
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	internal := makeRelationship(insideA.LogicGateID, insideB.LogicGateID, []domain.ProcessMapRoutePoint{{X: 25, Y: 13}, {X: 35, Y: 13}})
	external := makeRelationship(insideA.LogicGateID, outside.LogicGateID, []domain.ProcessMapRoutePoint{{X: 80, Y: 13}, {X: 150, Y: 13}})
	moved, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 5, 7, 100, 80))
	if err != nil || len(moved.Placements) != 3 || len(moved.Traces) != 1 || moved.Traces[0].ResourceOperationalRelationshipID != internal.Relationship.ResourceOperationalRelationshipID {
		t.Fatalf("group move envelope = %+v, err=%v", moved, err)
	}
	child := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeProcess, insideA.LogicGateID)]
	if child.GridX != 15 || child.GridY != 17 {
		t.Fatalf("moved descendant = %+v", child)
	}
	internalRoute := repo.processMapTraces[key(companyID, internal.Relationship.ResourceOperationalRelationshipID)].RoutePoints
	externalRoute := repo.processMapTraces[key(companyID, external.Relationship.ResourceOperationalRelationshipID)].RoutePoints
	if internalRoute[0] != (domain.ProcessMapRoutePoint{X: 30, Y: 20}) || externalRoute[0] != (domain.ProcessMapRoutePoint{X: 80, Y: 13}) {
		t.Fatalf("route movement internal=%+v external=%+v", internalRoute, externalRoute)
	}
	resizedFromNorthWest, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 0, 0, 105, 87))
	if err != nil || len(resizedFromNorthWest.Placements) != 1 || len(resizedFromNorthWest.Traces) != 0 {
		t.Fatalf("north-west resize envelope = %+v, err=%v", resizedFromNorthWest, err)
	}
	childAfterResize := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeProcess, insideA.LogicGateID)]
	internalRouteAfterResize := repo.processMapTraces[key(companyID, internal.Relationship.ResourceOperationalRelationshipID)].RoutePoints
	if childAfterResize.GridX != 15 || childAfterResize.GridY != 17 || internalRouteAfterResize[0] != (domain.ProcessMapRoutePoint{X: 30, Y: 20}) {
		t.Fatalf("north-west resize moved contents: child=%+v route=%+v", childAfterResize, internalRouteAfterResize)
	}
	before := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, folder.FolderID)]
	if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 0, 0, 20, 20)); !errors.Is(err, ErrProcessMapContainment) {
		t.Fatalf("invalid resize error = %v", err)
	}
	if after := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, folder.FolderID)]; after != before {
		t.Fatalf("failed resize was not atomic: before=%+v after=%+v", before, after)
	}
	resized, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 0, 0, 120, 90))
	if err != nil || len(resized.Placements) != 1 || len(resized.Traces) != 0 || resized.Placements[0].GridWidth != 120 {
		t.Fatalf("resize envelope = %+v, err=%v", resized, err)
	}
}

func TestMemoryProcessMapTileDerivesOrthogonalTraceFragments(t *testing.T) {
	tests := []struct {
		name          string
		route         []domain.ProcessMapRoutePoint
		wantPath      []domain.ProcessMapPathPoint
		wantRouteSize int
	}{
		{
			name:          "empty route",
			route:         []domain.ProcessMapRoutePoint{},
			wantPath:      []domain.ProcessMapPathPoint{{X: 20, Y: 13}, {X: 20, Y: 33}, {X: 40, Y: 33}},
			wantRouteSize: 0,
		},
		{
			name:          "diagonal waypoint",
			route:         []domain.ProcessMapRoutePoint{{X: 30, Y: 20}},
			wantPath:      []domain.ProcessMapPathPoint{{X: 20, Y: 13}, {X: 30, Y: 13}, {X: 30, Y: 33}, {X: 40, Y: 33}},
			wantRouteSize: 1,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ctx := context.Background()
			repo, companyID, admin, _, _ := newV2PolicyTestRepo(t)
			source, _ := repo.CreateLogicGate(companyID, "Source")
			target, _ := repo.CreateLogicGate(companyID, "Target")
			for _, input := range []ProcessMapPlacementPutInput{
				processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, source.LogicGateID, nil, 10, 10, 10, 6),
				processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, target.LogicGateID, nil, 40, 30, 10, 6),
			} {
				if _, err := repo.PutProcessMapPlacement(ctx, input); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := repo.CreateResourceOperationalRelationship(ctx, ResourceOperationalRelationshipCreateInput{
				CompanyID:   companyID,
				Source:      processMapTestRef(domain.ProcessMapResourceTypeProcess, source.LogicGateID),
				Target:      processMapTestRef(domain.ProcessMapResourceTypeProcess, target.LogicGateID),
				Trace:       &ProcessMapTraceInput{RoutePoints: test.route},
				ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
			}); err != nil {
				t.Fatal(err)
			}
			tile, err := repo.GetProcessMapTile(ctx, ProcessMapTileQuery{CompanyID: companyID, PermissionUserID: admin.UserID, Z: ProcessMapMaxTileZoom, X: 0, Y: 0})
			if err != nil || len(tile.Traces) != 1 {
				t.Fatalf("tile traces = %+v, err=%v", tile.Traces, err)
			}
			trace := tile.Traces[0]
			if trace.Presentation != domain.ProcessMapPresentationEditing {
				t.Fatalf("trace presentation=%q, want editing", trace.Presentation)
			}
			if len(trace.RoutePoints) != test.wantRouteSize {
				t.Fatalf("stored route points changed: %+v", trace.RoutePoints)
			}
			if test.wantRouteSize == 0 {
				wire, err := json.Marshal(trace)
				if err != nil {
					t.Fatal(err)
				}
				var fields map[string]json.RawMessage
				if err := json.Unmarshal(wire, &fields); err != nil {
					t.Fatal(err)
				}
				if string(fields["route_points"]) != "[]" {
					t.Fatalf("empty editing route_points=%s, want []", fields["route_points"])
				}
			}
			if test.wantRouteSize == 1 && trace.RoutePoints[0] != test.route[0] {
				t.Fatalf("stored waypoint changed: got=%+v want=%+v", trace.RoutePoints[0], test.route[0])
			}
			if len(trace.PathFragments) != 1 || len(trace.PathFragments[0]) != len(test.wantPath) {
				t.Fatalf("path fragments = %+v, want one fragment %+v", trace.PathFragments, test.wantPath)
			}
			for index, want := range test.wantPath {
				if got := trace.PathFragments[0][index]; got != want {
					t.Fatalf("path[%d] = %+v, want %+v; full=%+v", index, got, want, trace.PathFragments[0])
				}
			}
		})
	}
}

func TestMemoryProcessMapTileUsesPerPlacementConservativeLOD(t *testing.T) {
	ctx := context.Background()
	repo, companyID, admin, _, _ := newV2PolicyTestRepo(t)
	fixtures := []struct {
		name         string
		width        int
		height       int
		presentation domain.ProcessMapPresentation
		wantName     bool
	}{
		{name: "Small", width: 7, height: 5, presentation: domain.ProcessMapPresentationWhole},
		{name: "Medium", width: 100, height: 100, presentation: domain.ProcessMapPresentationNormal, wantName: true},
		{name: "Large", width: 400, height: 400, presentation: domain.ProcessMapPresentationEditing, wantName: true},
	}
	for index, fixture := range fixtures {
		process, err := repo.CreateLogicGate(companyID, fixture.name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(
			companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, process.LogicGateID, nil,
			index*500, 0, fixture.width, fixture.height,
		)); err != nil {
			t.Fatal(err)
		}
	}

	tile, err := repo.GetProcessMapTile(ctx, ProcessMapTileQuery{
		CompanyID: companyID, PermissionUserID: admin.UserID, Z: 20, X: 0, Y: 0,
	})
	if err != nil || len(tile.Placements) != len(fixtures) {
		t.Fatalf("LOD tile = %+v, err=%v", tile, err)
	}
	for index, item := range tile.Placements {
		placement, ok := item.(domain.ProcessMapVisiblePlacement)
		if !ok {
			t.Fatalf("placement %d type = %T", index, item)
		}
		want := fixtures[index]
		if placement.Presentation != want.presentation || (placement.Name != "") != want.wantName {
			t.Fatalf("placement %s projection = %+v, want presentation=%s name=%t", want.name, placement, want.presentation, want.wantName)
		}
	}
}

func TestMemoryProcessMapRootDimensionsCancellationAndRollback(t *testing.T) {
	ctx := context.Background()
	repo, companyID, admin, _, _ := newV2PolicyTestRepo(t)
	rootProcess, _ := repo.CreateLogicGate(companyID, "Root")
	if result, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, rootProcess.LogicGateID, nil, -20, -10, 12, 8)); err != nil || len(result.Placements) != 1 {
		t.Fatalf("root Process = %+v, err=%v", result, err)
	}
	invalid := processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, rootProcess.LogicGateID, nil, 0, 0, 0, 5)
	if _, err := repo.PutProcessMapPlacement(ctx, invalid); !errors.Is(err, ErrInvalid) {
		t.Fatalf("dimension error = %v", err)
	}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := repo.GetProcessMapScene(cancelled, ProcessMapSceneQuery{CompanyID: companyID, PermissionUserID: admin.UserID}); !errors.Is(err, context.Canceled) {
		t.Fatalf("scene cancellation = %v", err)
	}
	if _, err := repo.GetProcessMapTile(cancelled, ProcessMapTileQuery{CompanyID: companyID, PermissionUserID: admin.UserID, Z: 0, X: 0, Y: 0}); !errors.Is(err, context.Canceled) {
		t.Fatalf("tile cancellation = %v", err)
	}
	if _, err := repo.PutProcessMapPlacement(cancelled, processMapTestPlacementInput(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, rootProcess.LogicGateID, nil, 1, 1)); !errors.Is(err, context.Canceled) {
		t.Fatalf("write cancellation = %v", err)
	}
	folder, _ := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Rollback")
	repo.domainEventAppendErr = errors.New("event failed")
	if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementInput(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 3, 3)); err == nil {
		t.Fatal("event failure did not fail")
	}
	if _, exists := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, folder.FolderID)]; exists {
		t.Fatal("failed event left placement")
	}
}
