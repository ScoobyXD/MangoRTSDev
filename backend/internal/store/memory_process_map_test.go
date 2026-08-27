package store

import (
	"context"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
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

func TestAutomaticProcessMapPlacementConstantsStayCompactAndAligned(t *testing.T) {
	checks := []struct {
		name                   string
		memory, postgres, want int
	}{
		{"root Folder width", memoryProcessMapRootFolderWidth, postgresAutomaticProcessMapRootFolderWidth, 32},
		{"root Folder height", memoryProcessMapRootFolderHeight, postgresAutomaticProcessMapRootFolderHeight, 24},
		{"nested Folder width", memoryProcessMapNestedFolderWidth, postgresAutomaticProcessMapNestedFolderWidth, 24},
		{"nested Folder height", memoryProcessMapNestedFolderHeight, postgresAutomaticProcessMapNestedFolderHeight, 16},
		{"Process width", memoryProcessMapProcessWidth, postgresAutomaticProcessMapProcessWidth, 14},
		{"Process height", memoryProcessMapProcessHeight, postgresAutomaticProcessMapProcessHeight, 8},
		{"root gap", memoryProcessMapRootGap, postgresAutomaticProcessMapRootGap, 8},
		{"child gap", memoryProcessMapChildGap, postgresAutomaticProcessMapGap, 2},
		{"Folder padding", memoryProcessMapFolderPadding, postgresAutomaticProcessMapPadding, 2},
	}
	for _, check := range checks {
		if check.memory != check.want || check.postgres != check.want {
			t.Errorf("%s memory/Postgres = %d/%d, want %d/%d", check.name, check.memory, check.postgres, check.want, check.want)
		}
	}
}

func TestMemoryAutomaticProcessMapPlacementKeepsRootGapAfterDeepGrowth(t *testing.T) {
	repo, companyID, _, _, _ := newV2PolicyTestRepo(t)
	rootA, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Root A")
	if err != nil {
		t.Fatal(err)
	}
	rootB, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Root B")
	if err != nil {
		t.Fatal(err)
	}
	process, err := repo.CreateLogicGate(companyID, "Root B Process")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, rootB.FolderID, EntityTypeLogicGate, process.LogicGateID, 0); err != nil {
		t.Fatal(err)
	}
	rootBKey := processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, rootB.FolderID)
	processKey := processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeProcess, process.LogicGateID)
	beforeRootB := repo.processMapPlacements[rootBKey]
	beforeProcess := repo.processMapPlacements[processKey]
	parentID := rootA.FolderID
	for depth := 0; depth < 4; depth++ {
		child, err := repo.CreateCompanyExplorerFolder(companyID, parentID, "logic_gate", "Nested")
		if err != nil {
			t.Fatal(err)
		}
		parentID = child.FolderID
	}
	afterRootA := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, rootA.FolderID)]
	afterRootB := repo.processMapPlacements[rootBKey]
	afterProcess := repo.processMapPlacements[processKey]
	if afterRootB.GridX < afterRootA.GridX+afterRootA.GridWidth+memoryProcessMapRootGap {
		t.Fatalf("automatic roots overlap after growth: A=%+v B=%+v", afterRootA, afterRootB)
	}
	if afterRootB.GridX <= beforeRootB.GridX {
		t.Fatalf("later root did not move after earlier root growth: before=%+v after=%+v", beforeRootB, afterRootB)
	}
	if afterProcess.GridX-beforeProcess.GridX != afterRootB.GridX-beforeRootB.GridX || afterProcess.GridX != afterRootB.GridX+memoryProcessMapFolderPadding {
		t.Fatalf("later root descendants did not keep their relative geometry: root=%+v Process=%+v", afterRootB, afterProcess)
	}
}

func TestMemoryAutomaticProcessMapPlacementPreservesVerticallySeparatedRoot(t *testing.T) {
	ctx := context.Background()
	repo, companyID, admin, _, _ := newV2PolicyTestRepo(t)
	rootA, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Root A")
	if err != nil {
		t.Fatal(err)
	}
	rootB, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Root B")
	if err != nil {
		t.Fatal(err)
	}
	rootBKey := processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, rootB.FolderID)
	rootBPlacement := repo.processMapPlacements[rootBKey]
	if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(
		companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, rootB.FolderID, nil,
		1, 100, rootBPlacement.GridWidth, rootBPlacement.GridHeight,
	)); err != nil {
		t.Fatal(err)
	}
	manualRootB := cloneProcessMapPlacement(repo.processMapPlacements[rootBKey])
	parentID := rootA.FolderID
	for depth := 0; depth < 4; depth++ {
		child, err := repo.CreateCompanyExplorerFolder(companyID, parentID, "logic_gate", "Nested")
		if err != nil {
			t.Fatal(err)
		}
		parentID = child.FolderID
	}
	afterRootA := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, rootA.FolderID)]
	afterRootB := repo.processMapPlacements[rootBKey]
	if afterRootB.GridX != manualRootB.GridX || afterRootB.GridY != manualRootB.GridY || afterRootB.Revision != manualRootB.Revision {
		t.Fatalf("vertical separation did not preserve manual root geometry: before=%+v after=%+v", manualRootB, afterRootB)
	}
	if afterRootA.GridX+afterRootA.GridWidth <= afterRootB.GridX || afterRootA.GridY+afterRootA.GridHeight > afterRootB.GridY {
		t.Fatalf("preservation fixture does not overlap only on X: A=%+v B=%+v", afterRootA, afterRootB)
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
	if rootPlacement.ResourceID == "" || rootPlacement.MapParentFolderID != nil || rootPlacement.GridWidth < memoryProcessMapRootFolderWidth || rootPlacement.GridHeight < memoryProcessMapRootFolderHeight {
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
		rootPlacement.GridX+memoryProcessMapFolderPadding, rootPlacement.GridY+memoryProcessMapFolderPadding,
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
	} else if moved.GridWidth < memoryProcessMapRootFolderWidth || moved.GridHeight < memoryProcessMapRootFolderHeight {
		t.Fatalf("promoted root Folder size = %dx%d, want at least %dx%d", moved.GridWidth, moved.GridHeight, memoryProcessMapRootFolderWidth, memoryProcessMapRootFolderHeight)
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
	createdProcess, event, err := repo.CreateLogicGateWithWorkspaceEvent(companyID, "Event Process")
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
