package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"miraeopus/backend/internal/domain"
	"reflect"
	"testing"
	"time"
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

func TestMemoryAutomaticProcessMapEightFolderLevelsKeepAncestorsFixed(t *testing.T) {
	repo, companyID, _, _, _ := newV2PolicyTestRepo(t)
	var folders []domain.CompanyExplorerFolder
	var saved []domain.ProcessMapPlacement
	parentID := ""
	width, height := 234881024, 134217728
	for level := 1; level <= 8; level++ {
		folder, err := repo.CreateCompanyExplorerFolder(companyID, parentID, "logic_gate", fmt.Sprintf("Level %d", level))
		if err != nil {
			t.Fatalf("folder level %d: %v", level, err)
		}
		placement := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, folder.FolderID)]
		if placement.GridWidth != width || placement.GridHeight != height {
			t.Fatalf("level %d size = %dx%d, want %dx%d", level, placement.GridWidth, placement.GridHeight, width, height)
		}
		if len(saved) > 0 {
			requireAutomaticProcessMapContained(t, saved[len(saved)-1], placement)
		}
		folders = append(folders, folder)
		saved = append(saved, placement)
		parentID, width, height = folder.FolderID, width/8, height/8
	}
	for index := 0; index < 8; index++ {
		process, err := repo.CreateLogicGate(companyID, fmt.Sprintf("Deep Process %d", index))
		if err != nil {
			t.Fatal(err)
		}
		if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, parentID, EntityTypeLogicGate, process.LogicGateID, index*1000); err != nil {
			t.Fatal(err)
		}
		placement := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeProcess, process.LogicGateID)]
		if placement.GridWidth != 14 || placement.GridHeight != 8 {
			t.Fatalf("deep gate %d size = %dx%d, want 14x8", index, placement.GridWidth, placement.GridHeight)
		}
		requireAutomaticProcessMapContained(t, saved[len(saved)-1], placement)
	}
	for index, folder := range folders {
		current := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, folder.FolderID)]
		if !reflect.DeepEqual(current, saved[index]) {
			t.Fatalf("descendant creation changed level %d: before=%+v after=%+v", index+1, saved[index], current)
		}
	}
}

func TestMemoryAutomaticProcessMapPreservesManualGeometryOnReorderAndDescendantCreate(t *testing.T) {
	ctx := context.Background()
	repo, companyID, admin, _, _ := newV2PolicyTestRepo(t)
	root, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Manual root")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(
		companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, root.FolderID, nil, -4000, -2000, 4000, 2000,
	)); err != nil {
		t.Fatal(err)
	}
	child, err := repo.CreateCompanyExplorerFolder(companyID, root.FolderID, "logic_gate", "Manual child")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(
		companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, child.FolderID, &root.FolderID, -3000, -1500, 600, 300,
	)); err != nil {
		t.Fatal(err)
	}
	rootKey := processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, root.FolderID)
	childKey := processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, child.FolderID)
	beforeRoot, beforeChild := repo.processMapPlacements[rootKey], repo.processMapPlacements[childKey]
	if _, err := repo.MoveCompanyExplorerFolder(companyID, child.FolderID, &root.FolderID, 9000, admin.UserID, admin.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateCompanyExplorerFolder(companyID, child.FolderID, "logic_gate", "Grandchild"); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(repo.processMapPlacements[rootKey], beforeRoot) || !reflect.DeepEqual(repo.processMapPlacements[childKey], beforeChild) {
		t.Fatalf("saved manual geometry or revision changed: root=%+v child=%+v", repo.processMapPlacements[rootKey], repo.processMapPlacements[childKey])
	}
}

func TestMemoryAutomaticProcessMapCrowdingScalesDescendantsAndInternalTrace(t *testing.T) {
	ctx := context.Background()
	repo, companyID, admin, _, _ := newV2PolicyTestRepo(t)
	root, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Crowded root")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(
		companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, root.FolderID, nil, -2000, -1000, 1792, 1024,
	)); err != nil {
		t.Fatal(err)
	}
	child, err := repo.CreateCompanyExplorerFolder(companyID, root.FolderID, "logic_gate", "Nested child")
	if err != nil {
		t.Fatal(err)
	}
	createProcess := func(parentID, name string) domain.LogicGate {
		t.Helper()
		process, err := repo.CreateLogicGate(companyID, name)
		if err != nil {
			t.Fatal(err)
		}
		if parentID != "" {
			if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, parentID, EntityTypeLogicGate, process.LogicGateID, 0); err != nil {
				t.Fatal(err)
			}
		}
		return process
	}
	insideA := createProcess(child.FolderID, "Inside A")
	insideB := createProcess(child.FolderID, "Inside B")
	outside := createProcess("", "Outside")
	for index := 1; index < 30; index++ {
		createProcess(root.FolderID, fmt.Sprintf("Sibling %d", index))
	}
	createTrace := func(targetID string, points []domain.ProcessMapRoutePoint) string {
		t.Helper()
		created, err := repo.CreateResourceOperationalRelationship(ctx, ResourceOperationalRelationshipCreateInput{
			CompanyID: companyID,
			Source:    processMapTestRef(domain.ProcessMapResourceTypeProcess, insideA.LogicGateID),
			Target:    processMapTestRef(domain.ProcessMapResourceTypeProcess, targetID),
			Trace:     &ProcessMapTraceInput{RoutePoints: points}, ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
		})
		if err != nil || created.Relationship == nil {
			t.Fatalf("create relationship = %+v, error=%v", created, err)
		}
		return key(companyID, created.Relationship.ResourceOperationalRelationshipID)
	}
	internalKey := createTrace(insideB.LogicGateID, []domain.ProcessMapRoutePoint{{X: -1898, Y: -840}, {X: -1868, Y: -840}})
	externalKey := createTrace(outside.LogicGateID, []domain.ProcessMapRoutePoint{{X: 50, Y: 20}})
	before := repo.snapshotProcessMapMutationLocked()
	createProcess(root.FolderID, "First sixth-row sibling")
	rootKey := processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, root.FolderID)
	childKey := processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, child.FolderID)
	if !reflect.DeepEqual(repo.processMapPlacements[rootKey], before.placements[rootKey]) {
		t.Fatal("crowding changed the parent")
	}
	if repo.processMapPlacements[childKey].GridWidth >= before.placements[childKey].GridWidth {
		t.Fatal("fixture did not force the child group to shrink")
	}
	for _, process := range []domain.LogicGate{insideA, insideB} {
		placement := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeProcess, process.LogicGateID)]
		requireAutomaticProcessMapContained(t, repo.processMapPlacements[childKey], placement)
	}
	// The sixth row has a 1,504 x 928 envelope. The usable parent height is
	// 864, giving the same proportional fit for every descendant and route.
	wantPoints := []domain.ProcessMapRoutePoint{{X: -1903, Y: -842}, {X: -1875, Y: -842}}
	trace := repo.processMapTraces[internalKey]
	if trace.Revision != before.traces[internalKey].Revision+1 || !reflect.DeepEqual(trace.RoutePoints, wantPoints) {
		t.Fatalf("crowded internal trace = %+v, want points=%+v and one revision", trace, wantPoints)
	}
	if !reflect.DeepEqual(repo.processMapTraces[externalKey], before.traces[externalKey]) || !reflect.DeepEqual(repo.resourceOperationalRelationships, before.relationships) {
		t.Fatal("crowding changed crossing trace geometry or operational relationships")
	}
}
func TestMemoryProcessMapAutomaticallyMirrorsExplorerStructure(t *testing.T) {
	ctx := context.Background()
	repo, companyID, admin, _, _ := newV2PolicyTestRepo(t)
	root, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Operations")
	if err != nil {
		t.Fatal(err)
	}
	child, err := repo.CreateCompanyExplorerFolder(companyID, root.FolderID, "logic_gate", "Receiving")
	if err != nil {
		t.Fatal(err)
	}
	process, err := repo.CreateLogicGate(companyID, "Unload")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, child.FolderID, EntityTypeLogicGate, process.LogicGateID, 0); err != nil {
		t.Fatal(err)
	}
	rootPlacement := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, root.FolderID)]
	childPlacement := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, child.FolderID)]
	processPlacement := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeProcess, process.LogicGateID)]
	if rootPlacement.ResourceID == "" || rootPlacement.MapParentFolderID != nil || rootPlacement.GridWidth < processMapAutomaticRootFolderWidth || rootPlacement.GridHeight < processMapAutomaticRootFolderHeight {
		t.Fatalf("root automatic placement = %+v", rootPlacement)
	}
	if childPlacement.MapParentFolderID == nil || *childPlacement.MapParentFolderID != root.FolderID ||
		processPlacement.MapParentFolderID == nil || *processPlacement.MapParentFolderID != child.FolderID {
		t.Fatalf("automatic hierarchy root=%+v child=%+v process=%+v", rootPlacement, childPlacement, processPlacement)
	}
	beforeReorder := cloneProcessMapPlacement(childPlacement)
	if _, err := repo.MoveCompanyExplorerFolder(companyID, child.FolderID, &root.FolderID, child.Position+1000, admin.UserID, admin.UserID); err != nil {
		t.Fatal(err)
	}
	if afterReorder := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, child.FolderID)]; afterReorder.GridX != beforeReorder.GridX || afterReorder.GridY != beforeReorder.GridY ||
		afterReorder.GridWidth != beforeReorder.GridWidth || afterReorder.GridHeight != beforeReorder.GridHeight ||
		afterReorder.Revision != beforeReorder.Revision || !sameProcessMapParent(afterReorder.MapParentFolderID, beforeReorder.MapParentFolderID) {
		t.Fatalf("same-parent Explorer reorder changed Process Map geometry: before=%+v after=%+v", beforeReorder, afterReorder)
	}

	if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(
		companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, process.LogicGateID, &root.FolderID,
		rootPlacement.GridX+rootPlacement.GridWidth/2, rootPlacement.GridY+rootPlacement.GridHeight/2,
		processPlacement.GridWidth, processPlacement.GridHeight,
	)); err != nil {
		t.Fatal(err)
	}
	if item := repo.folderItems[folderItemKey(companyID, EntityTypeLogicGate, process.LogicGateID)]; item.FolderID != root.FolderID {
		t.Fatalf("map reparent did not update Explorer: %+v", item)
	}

	if _, err := repo.DeleteProcessMapPlacement(ctx, ProcessMapPlacementDeleteInput{
		CompanyID: companyID, ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: process.LogicGateID,
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	if _, exists := repo.logicGates[key(companyID, process.LogicGateID)]; !exists {
		t.Fatal("Process Map deletion removed the Process")
	}
	if _, exists := repo.folderItems[folderItemKey(companyID, EntityTypeLogicGate, process.LogicGateID)]; exists {
		t.Fatal("Process Map deletion left the Explorer edge")
	}
	if _, err := repo.GetProcessMapScene(ctx, ProcessMapSceneQuery{CompanyID: companyID, PermissionUserID: admin.UserID}); err != nil {
		t.Fatal(err)
	}
	if _, exists := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeProcess, process.LogicGateID)]; exists {
		t.Fatal("removed Explorer Process placement was automatically recreated")
	}

	companyRoot := ""
	if _, err := repo.MoveCompanyExplorerFolder(companyID, child.FolderID, &companyRoot, 0, admin.UserID, admin.UserID); err != nil {
		t.Fatal(err)
	}
	if moved := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, child.FolderID)]; moved.MapParentFolderID != nil {
		t.Fatalf("Explorer folder move did not update Process Map: %+v", moved)
	} else if moved.GridWidth < processMapAutomaticRootFolderWidth || moved.GridHeight < processMapAutomaticRootFolderHeight {
		t.Fatalf("promoted root Folder size = %dx%d, want at least %dx%d", moved.GridWidth, moved.GridHeight, processMapAutomaticRootFolderWidth, processMapAutomaticRootFolderHeight)
	}
	if _, err := repo.DeleteProcessMapPlacement(ctx, ProcessMapPlacementDeleteInput{
		CompanyID: companyID, ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: child.FolderID,
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	if _, exists := repo.folders[key(companyID, child.FolderID)]; exists {
		t.Fatal("Process Map Folder deletion did not use canonical Company Explorer deletion")
	}
	recycleItems, err := repo.ListRecycleBinItems(companyID, admin.UserID)
	if err != nil || len(recycleItems) != 1 || recycleItems[0].ObjectID != child.FolderID {
		t.Fatalf("Folder recycle items = %+v, err=%v", recycleItems, err)
	}
}

func TestMemoryProcessMapLegacyExplorerWritesInvalidateAtWriteTime(t *testing.T) {
	repo, companyID, _, _, _ := newV2PolicyTestRepo(t)
	readVersion := func() int64 {
		return repo.workspaceReadVersions[workspaceReadVersionMemoryKey(companyID, "process-map", "")]
	}

	beforeFolder := readVersion()
	folder, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Direct legacy folder")
	if err != nil {
		t.Fatal(err)
	}
	if readVersion() <= beforeFolder {
		t.Fatal("legacy Folder create did not invalidate Process Map")
	}
	if placement := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, folder.FolderID)]; placement.ResourceID == "" {
		t.Fatal("legacy Folder create did not place the Folder before returning")
	}

	process, err := repo.CreateLogicGate(companyID, "Direct legacy Process")
	if err != nil {
		t.Fatal(err)
	}
	beforeAssign := readVersion()
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, folder.FolderID, EntityTypeLogicGate, process.LogicGateID, 0); err != nil {
		t.Fatal(err)
	}
	if readVersion() <= beforeAssign {
		t.Fatal("legacy Process assignment did not invalidate Process Map")
	}
	placementKey := processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeProcess, process.LogicGateID)
	if placement := repo.processMapPlacements[placementKey]; placement.MapParentFolderID == nil || *placement.MapParentFolderID != folder.FolderID {
		t.Fatalf("legacy Process assignment placement = %+v", placement)
	}

	beforeRemove := readVersion()
	if err := repo.RemoveCompanyExplorerFolderItem(companyID, EntityTypeLogicGate, process.LogicGateID); err != nil {
		t.Fatal(err)
	}
	if readVersion() <= beforeRemove {
		t.Fatal("legacy Process removal did not invalidate Process Map")
	}
	if _, exists := repo.processMapPlacements[placementKey]; exists {
		t.Fatal("legacy Process removal left its Process Map placement")
	}

	beforeCreatedProcess := readVersion()
	createdProcess, event, err := repo.CreateLogicGateWithWorkspaceEvent(companyID, "Event Process", "")
	if err != nil {
		t.Fatal(err)
	}
	if event.Type != "logic_gate_created" || readVersion() <= beforeCreatedProcess {
		t.Fatalf("Process creation event = %+v, read version %d -> %d", event, beforeCreatedProcess, readVersion())
	}
	if placement := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeProcess, createdProcess.LogicGateID)]; placement.ResourceID == "" {
		t.Fatal("eventful Process creation did not place the Process before returning")
	}
}

func TestMemoryProcessMapV2ExplorerWritesSynchronizeAtWriteTime(t *testing.T) {
	ctx := context.Background()
	repo, companyID, admin, _, _ := newV2PolicyTestRepo(t)
	folder, err := repo.CreateCompanyExplorerV2Folder(CompanyExplorerV2FolderInput{
		CompanyID: companyID, ParentEntityID: companyID, Name: "V2 Operations",
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if placement := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, folder.EntityID)]; placement.ResourceID == "" || placement.MapParentFolderID != nil {
		t.Fatalf("V2 Folder placement = %+v", placement)
	}
	batch, err := repo.CreateWorkspaceEntityBatch(WorkspaceEntityBatchInput{
		CompanyID: companyID, EntityKind: EntityTypeLogicGate, FolderID: folder.EntityID,
		MutationOrigin: MutationOriginCompanyExplorer, CreatorUserID: admin.UserID,
		Items: []WorkspaceEntityBatchItemInput{{ClientID: "batch-process", Title: "Batch Process"}},
	})
	if err != nil || len(batch.EntityMappings) != 1 {
		t.Fatalf("CreateWorkspaceEntityBatch = %+v, err=%v", batch, err)
	}
	batchPlacement := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeProcess, batch.EntityMappings[0].EntityID)]
	if batchPlacement.MapParentFolderID == nil || *batchPlacement.MapParentFolderID != folder.EntityID {
		t.Fatalf("batch Process placement = %+v", batchPlacement)
	}

	process, err := repo.CreateLogicGate(companyID, "V2 Process")
	if err != nil {
		t.Fatal(err)
	}
	peer, err := repo.CreateLogicGate(companyID, "V2 Peer")
	if err != nil {
		t.Fatal(err)
	}
	placed, err := repo.UpsertCompanyExplorerV2Edge(CompanyExplorerV2EdgeInput{
		CompanyID: companyID, ParentEntityID: folder.EntityID,
		ChildEntityType: CompanyExplorerV2EntityLogicGate, ChildResourceID: process.LogicGateID,
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	placementKey := processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeProcess, process.LogicGateID)
	if placement := repo.processMapPlacements[placementKey]; placement.MapParentFolderID == nil || *placement.MapParentFolderID != folder.EntityID {
		t.Fatalf("V2 placed Process = %+v", placement)
	}

	created, err := repo.CreateResourceOperationalRelationship(ctx, ResourceOperationalRelationshipCreateInput{
		CompanyID:   companyID,
		Source:      processMapTestRef(domain.ProcessMapResourceTypeProcess, process.LogicGateID),
		Target:      processMapTestRef(domain.ProcessMapResourceTypeProcess, peer.LogicGateID),
		Trace:       &ProcessMapTraceInput{RoutePoints: []domain.ProcessMapRoutePoint{{X: 4, Y: 4}, {X: 8, Y: 8}}},
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil || created.Relationship == nil || len(created.Traces) != 1 {
		t.Fatalf("CreateResourceOperationalRelationship = %+v, err=%v", created, err)
	}
	relationshipID := created.Relationship.ResourceOperationalRelationshipID

	moved, err := repo.MoveCompanyExplorerV2Edge(CompanyExplorerV2MoveEdgeInput{
		CompanyID: companyID, EdgeID: placed.EdgeID, ParentEntityID: companyID,
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if placement := repo.processMapPlacements[placementKey]; placement.MapParentFolderID != nil {
		t.Fatalf("V2 root-moved Process = %+v", placement)
	}
	if _, exists := repo.folderItems[folderItemKey(companyID, EntityTypeLogicGate, process.LogicGateID)]; exists {
		t.Fatal("V2 root move left a stale legacy Folder item")
	}
	edgeCount := 0
	for _, edge := range repo.companyExplorerV2Edges {
		if edge.CompanyID == companyID && edge.ChildEntityID == process.LogicGateID {
			edgeCount++
			if edge.ParentEntityID != companyID {
				t.Fatalf("V2 root edge parent = %q, want company root", edge.ParentEntityID)
			}
		}
	}
	if edgeCount != 1 {
		t.Fatalf("V2 root edge count = %d, want 1", edgeCount)
	}

	if err := repo.DeleteCompanyExplorerV2Edge(companyID, moved.EdgeID, admin.UserID, admin.UserID); err != nil {
		t.Fatal(err)
	}
	if _, exists := repo.processMapPlacements[placementKey]; exists {
		t.Fatal("V2 edge removal left the Process Map placement")
	}
	if _, exists := repo.processMapTraces[key(companyID, relationshipID)]; exists {
		t.Fatal("V2 edge removal left incident trace geometry")
	}
	if _, exists := repo.resourceOperationalRelationships[key(companyID, relationshipID)]; !exists {
		t.Fatal("V2 edge removal deleted the operational relationship")
	}
	if _, err := repo.GetProcessMapScene(ctx, ProcessMapSceneQuery{CompanyID: companyID, PermissionUserID: admin.UserID}); err != nil {
		t.Fatal(err)
	}
	if _, exists := repo.processMapPlacements[placementKey]; exists {
		t.Fatal("Process Map read recreated a detached V2 Process")
	}
}

func TestMemoryProcessMapEditingTileIncludesCurrentScoreCardAndRACINames(t *testing.T) {
	ctx := context.Background()
	repo, companyID, admin, viewer, _ := newV2PolicyTestRepo(t)
	process, err := repo.CreateLogicGate(companyID, "Daily Shipping")
	if err != nil {
		t.Fatal(err)
	}
	accountabilityGroup, err := repo.CreateCompanyUserGroup(companyID, "", "Accountability Team")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, accountabilityGroup.GroupID, []string{viewer.UserID}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.PutResourceRACIPolicy(ResourceRACIPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: process.LogicGateID,
		AssignmentMode: PolicyModeCustomized, DescendantAction: PolicyDescendantActionInheritedOnly,
		Assignments: []ResourceRACIAssignmentInput{
			{Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectUser, PrincipalID: admin.UserID},
			{Role: domain.RACIRoleAccountable, PrincipalType: EntityPermissionSubjectGroup, PrincipalID: accountabilityGroup.GroupID},
		},
	}); err != nil {
		t.Fatal(err)
	}
	green := "green"
	if _, err := repo.PutLogicGateQDRating(QDRatingPutInput{
		CompanyID: companyID, LogicGateID: process.LogicGateID, Metric: QDRatingMetricQuality, Rating: &green,
		RatedByUserID: admin.UserID, RatedByDisplayName: admin.DisplayName, Now: time.Now().UTC(),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetProcessMapScene(ctx, ProcessMapSceneQuery{CompanyID: companyID, PermissionUserID: admin.UserID}); err != nil {
		t.Fatal(err)
	}
	placement := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeProcess, process.LogicGateID)]
	tile, err := repo.GetProcessMapTile(ctx, ProcessMapTileQuery{
		CompanyID: companyID, PermissionUserID: admin.UserID, Z: ProcessMapMaxTileZoom,
		X: placement.GridX / ProcessMapTileSize, Y: placement.GridY / ProcessMapTileSize,
	})
	if err != nil {
		t.Fatal(err)
	}
	var summary *domain.ProcessMapVisiblePlacement
	for _, item := range tile.Placements {
		visible, ok := item.(domain.ProcessMapVisiblePlacement)
		if ok && visible.ResourceID == process.LogicGateID {
			summary = &visible
			break
		}
	}
	if summary == nil || summary.Presentation != domain.ProcessMapPresentationEditing || summary.ScoreCard == nil ||
		summary.ScoreCard.QualityRating == nil || *summary.ScoreCard.QualityRating != green ||
		len(summary.ResponsibleNames) != 1 || summary.ResponsibleNames[0] != admin.DisplayName ||
		len(summary.AccountableNames) != 1 || summary.AccountableNames[0] != accountabilityGroup.Name {
		t.Fatalf("editing summary = %+v", summary)
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
	if err != nil || scene.Bounds == nil || scene.Bounds.MinX > 0 || scene.Bounds.MinY > 0 || scene.Bounds.MaxX < 180 || scene.Bounds.MaxY < 60 || scene.TileSize != ProcessMapTileSize || scene.ProcessMapReadVersion != created.ProcessMapReadVersion {
		t.Fatalf("scene = %+v, err=%v", scene, err)
	}
	tile, err := repo.GetProcessMapTile(ctx, ProcessMapTileQuery{CompanyID: companyID, PermissionUserID: admin.UserID, Z: 0, X: 0, Y: 0})
	if err != nil || len(tile.Traces) != 1 || tile.ProcessMapReadVersion != scene.ProcessMapReadVersion {
		t.Fatalf("tile = %+v, err=%v", tile, err)
	}
	wantPlacementIDs := map[string]bool{folderA.FolderID: true, folderB.FolderID: true, processA.LogicGateID: true, processB.LogicGateID: true}
	for _, item := range tile.Placements {
		if placement, ok := item.(domain.ProcessMapVisiblePlacement); ok {
			delete(wantPlacementIDs, placement.ResourceID)
		}
	}
	if len(wantPlacementIDs) != 0 {
		t.Fatalf("automatic tile omitted requested placements: %v", wantPlacementIDs)
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
	if err != nil || scene.Bounds == nil || scene.Bounds.MaxX < 104 || scene.Bounds.MaxX >= 190 {
		t.Fatalf("permission-safe scene = %+v, err=%v", scene, err)
	}
	tile, err := repo.GetProcessMapTile(ctx, ProcessMapTileQuery{CompanyID: companyID, PermissionUserID: viewer.UserID, Z: 0, X: 0, Y: 0})
	if err != nil || len(tile.Traces) != 0 {
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

func TestProcessMapScaleCoordinateMatchesJavaScriptMathRound(t *testing.T) {
	tests := []struct {
		value int
		want  int
	}{
		{value: -3, want: -1},
		{value: -1, want: 0},
		{value: 1, want: 1},
		{value: 3, want: 2},
	}
	for _, test := range tests {
		if got := processMapScaleCoordinate(test.value, 0, 2, 0, 1); got != test.want {
			t.Fatalf("scale coordinate %d = %d, want JavaScript Math.round result %d", test.value, got, test.want)
		}
	}
}

func TestMemoryProcessMapFolderGroupMoveResizeAndEnvelopes(t *testing.T) {
	ctx := context.Background()
	repo, companyID, admin, _, _ := newV2PolicyTestRepo(t)
	folder, _ := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Group")
	nestedFolder, _ := repo.CreateCompanyExplorerFolder(companyID, folder.FolderID, "logic_gate", "Nested")
	insideA, _ := repo.CreateLogicGate(companyID, "A")
	insideB, _ := repo.CreateLogicGate(companyID, "B")
	insideNested, _ := repo.CreateLogicGate(companyID, "Nested Process")
	outside, _ := repo.CreateLogicGate(companyID, "Outside")
	for _, input := range []ProcessMapPlacementPutInput{
		processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 0, 0, 100, 80),
		processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, insideA.LogicGateID, &folder.FolderID, 10, 10, 10, 6),
		processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, insideB.LogicGateID, &folder.FolderID, 40, 10, 10, 6),
		processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, nestedFolder.FolderID, &folder.FolderID, 10, 40, 40, 30),
		processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, insideNested.LogicGateID, &nestedFolder.FolderID, 20, 50, 10, 6),
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
	nestedInternal := makeRelationship(insideA.LogicGateID, insideNested.LogicGateID, []domain.ProcessMapRoutePoint{{X: 22, Y: 30}, {X: 22, Y: 45}})
	external := makeRelationship(insideA.LogicGateID, outside.LogicGateID, []domain.ProcessMapRoutePoint{{X: 80, Y: 13}, {X: 150, Y: 13}})
	moved, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 5, 7, 100, 80))
	if err != nil || len(moved.Placements) != 5 || len(moved.Traces) != 2 {
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

	resizedFromNorthWest, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 0, 0, 200, 160))
	if err != nil || len(resizedFromNorthWest.Placements) != 5 || len(resizedFromNorthWest.Traces) != 2 {
		t.Fatalf("north-west grow envelope = %+v, err=%v", resizedFromNorthWest, err)
	}
	childAfterResize := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeProcess, insideA.LogicGateID)]
	nestedAfterResize := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, nestedFolder.FolderID)]
	nestedProcessAfterResize := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeProcess, insideNested.LogicGateID)]
	internalRouteAfterResize := repo.processMapTraces[key(companyID, internal.Relationship.ResourceOperationalRelationshipID)].RoutePoints
	nestedRouteAfterResize := repo.processMapTraces[key(companyID, nestedInternal.Relationship.ResourceOperationalRelationshipID)].RoutePoints
	if childAfterResize.GridX != 20 || childAfterResize.GridY != 20 || childAfterResize.GridWidth != 20 || childAfterResize.GridHeight != 12 ||
		nestedAfterResize.GridX != 20 || nestedAfterResize.GridY != 80 || nestedAfterResize.GridWidth != 80 || nestedAfterResize.GridHeight != 60 ||
		nestedProcessAfterResize.GridX != 40 || nestedProcessAfterResize.GridY != 100 || nestedProcessAfterResize.GridWidth != 20 || nestedProcessAfterResize.GridHeight != 12 ||
		internalRouteAfterResize[0] != (domain.ProcessMapRoutePoint{X: 50, Y: 26}) ||
		nestedRouteAfterResize[1] != (domain.ProcessMapRoutePoint{X: 44, Y: 90}) {
		t.Fatalf("north-west grow did not scale subtree: child=%+v nested=%+v nested process=%+v routes=%+v/%+v", childAfterResize, nestedAfterResize, nestedProcessAfterResize, internalRouteAfterResize, nestedRouteAfterResize)
	}
	if got := repo.processMapTraces[key(companyID, external.Relationship.ResourceOperationalRelationshipID)].RoutePoints; got[0] != (domain.ProcessMapRoutePoint{X: 80, Y: 13}) {
		t.Fatalf("external route changed during grow: %+v", got)
	}

	shrunk, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 0, 0, 100, 80))
	if err != nil || len(shrunk.Placements) != 5 || len(shrunk.Traces) != 2 {
		t.Fatalf("shrink envelope = %+v, err=%v", shrunk, err)
	}
	childAfterShrink := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeProcess, insideA.LogicGateID)]
	nestedAfterShrink := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, nestedFolder.FolderID)]
	nestedProcessAfterShrink := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeProcess, insideNested.LogicGateID)]
	internalRouteAfterShrink := repo.processMapTraces[key(companyID, internal.Relationship.ResourceOperationalRelationshipID)].RoutePoints
	if childAfterShrink.GridX != 10 || childAfterShrink.GridY != 10 || childAfterShrink.GridWidth != 10 || childAfterShrink.GridHeight != 6 ||
		nestedAfterShrink.GridX != 10 || nestedAfterShrink.GridY != 40 || nestedAfterShrink.GridWidth != 40 || nestedAfterShrink.GridHeight != 30 ||
		nestedProcessAfterShrink.GridX != 20 || nestedProcessAfterShrink.GridY != 50 || nestedProcessAfterShrink.GridWidth != 10 || nestedProcessAfterShrink.GridHeight != 6 ||
		internalRouteAfterShrink[0] != (domain.ProcessMapRoutePoint{X: 25, Y: 13}) {
		t.Fatalf("shrink did not restore proportional subtree: child=%+v nested=%+v nested process=%+v route=%+v", childAfterShrink, nestedAfterShrink, nestedProcessAfterShrink, internalRouteAfterShrink)
	}

	beforeRoot := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, folder.FolderID)]
	beforeChild := childAfterShrink
	beforeRoute := append([]domain.ProcessMapRoutePoint(nil), internalRouteAfterShrink...)
	if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 0, 0, 2, 2)); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid collapsing resize error = %v", err)
	}
	afterRoot := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, folder.FolderID)]
	afterChild := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeProcess, insideA.LogicGateID)]
	afterRoute := repo.processMapTraces[key(companyID, internal.Relationship.ResourceOperationalRelationshipID)].RoutePoints
	rootUnchanged := processMapAutomaticGeometryEqual(beforeRoot, afterRoot) && beforeRoot.PlacementIncarnationToken == afterRoot.PlacementIncarnationToken &&
		beforeRoot.Revision == afterRoot.Revision && beforeRoot.CreatedTimestamp.Equal(afterRoot.CreatedTimestamp) && beforeRoot.UpdatedTimestamp.Equal(afterRoot.UpdatedTimestamp)
	childUnchanged := processMapAutomaticGeometryEqual(beforeChild, afterChild) && beforeChild.PlacementIncarnationToken == afterChild.PlacementIncarnationToken &&
		beforeChild.Revision == afterChild.Revision && beforeChild.CreatedTimestamp.Equal(afterChild.CreatedTimestamp) && beforeChild.UpdatedTimestamp.Equal(afterChild.UpdatedTimestamp)
	if !rootUnchanged || !childUnchanged || len(afterRoute) != len(beforeRoute) || afterRoute[0] != beforeRoute[0] || afterRoute[1] != beforeRoute[1] {
		t.Fatalf("failed resize was not atomic: root=%+v/%+v child=%+v/%+v route=%+v/%+v", beforeRoot, afterRoot, beforeChild, afterChild, beforeRoute, afterRoute)
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
		resourceID   string
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
		fixtures[index].resourceID = process.LogicGateID
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
	if err != nil {
		t.Fatalf("LOD tile = %+v, err=%v", tile, err)
	}
	placementsByID := map[string]domain.ProcessMapVisiblePlacement{}
	for index, item := range tile.Placements {
		placement, ok := item.(domain.ProcessMapVisiblePlacement)
		if !ok {
			t.Fatalf("placement %d type = %T", index, item)
		}
		placementsByID[placement.ResourceID] = placement
	}
	for _, want := range fixtures {
		placement, ok := placementsByID[want.resourceID]
		if !ok {
			t.Fatalf("LOD tile omitted %s", want.name)
		}
		if placement.Presentation != want.presentation || (placement.Name != "") != want.wantName {
			t.Fatalf("placement %s projection = %+v, want presentation=%s name=%t", want.name, placement, want.presentation, want.wantName)
		}
	}
}

func TestMemoryProcessMapTileMetadataUsesCurrentMembershipAndBusinessDate(t *testing.T) {
	repo, companyID, admin, _, _ := newV2PolicyTestRepo(t)
	ctx := context.Background()
	query := ProcessMapTileQuery{CompanyID: companyID, PermissionUserID: admin.UserID, Z: ProcessMapMaxTileZoom}
	process, err := repo.CreateLogicGate(companyID, "Daily score")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, process.LogicGateID, nil, 0, 0, 10, 8)); err != nil {
		t.Fatal(err)
	}
	for _, day := range []string{"2026-09-04", "2026-09-05"} {
		rating := day
		repo.qdRatings[memoryQDRatingDayKey(companyID, process.LogicGateID, day)] = domain.QDRating{QualityRating: &rating}
		summary, _, _ := repo.memoryProcessMapProcessSummaryLocked(companyID, process.LogicGateID, day)
		if summary == nil || summary.QualityRating == nil || *summary.QualityRating != day {
			t.Fatalf("score summary ignored snapshot date %s: %+v", day, summary)
		}
	}
	otherCompanyID := "99999999-2222-4333-8444-555555555555"
	repo.EnsureCompany(otherCompanyID, "Global admin company")
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, otherCompanyID, domain.RoleDevAdmin); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	tile, err := repo.GetProcessMapTile(ctx, query)
	if err != nil || tile.Metadata.ActorRole != domain.RoleCompanyUser || tile.Metadata.ProcessMapVersion != tile.ProcessMapReadVersion || tile.Metadata.BusinessDate == "" {
		t.Fatalf("tile metadata = %+v, err=%v", tile.Metadata, err)
	}
	metadata, err := repo.GetProcessMapTileMetadata(ctx, query)
	if err != nil || metadata != tile.Metadata {
		t.Fatalf("unchanged metadata = %+v, full=%+v, err=%v", metadata, tile.Metadata, err)
	}
	delete(repo.memberships, membershipKey(companyID, admin.UserID))
	metadata, err = repo.GetProcessMapTileMetadata(ctx, query)
	if err != nil || metadata.ActorRole != domain.RoleDevAdmin {
		t.Fatalf("global admin metadata = %+v, err=%v", metadata, err)
	}
	delete(repo.memberships, membershipKey(otherCompanyID, admin.UserID))
	if _, err := repo.GetProcessMapTileMetadata(ctx, query); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked metadata error = %v", err)
	}
	if _, err := repo.GetProcessMapTile(ctx, query); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked tile error = %v", err)
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
	if _, err := repo.GetProcessMapTileMetadata(cancelled, ProcessMapTileQuery{CompanyID: companyID, PermissionUserID: admin.UserID}); !errors.Is(err, context.Canceled) {
		t.Fatalf("tile metadata cancellation = %v", err)
	}
	if _, err := repo.PutProcessMapPlacement(cancelled, processMapTestPlacementInput(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, rootProcess.LogicGateID, nil, 1, 1)); !errors.Is(err, context.Canceled) {
		t.Fatalf("write cancellation = %v", err)
	}
	folder, _ := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Rollback")
	if _, err := repo.GetProcessMapScene(ctx, ProcessMapSceneQuery{CompanyID: companyID, PermissionUserID: admin.UserID}); err != nil {
		t.Fatal(err)
	}
	placementKey := processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, folder.FolderID)
	before := cloneProcessMapPlacement(repo.processMapPlacements[placementKey])
	repo.domainEventAppendErr = errors.New("event failed")
	if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementInput(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 3, 3)); err == nil {
		t.Fatal("event failure did not fail")
	}
	if after := repo.processMapPlacements[placementKey]; after != before {
		t.Fatalf("failed event changed automatic placement: before=%+v after=%+v", before, after)
	}
}
