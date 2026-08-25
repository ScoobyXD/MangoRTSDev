package store

import (
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"testing"
)

func processMapTestPlacementInput(companyID, actorUserID, resourceType, resourceID string, parentID *string, x, y int) ProcessMapPlacementPutInput {
	return ProcessMapPlacementPutInput{
		CompanyID: companyID, ResourceType: resourceType, ResourceID: resourceID, MapParentFolderID: parentID,
		GridX: x, GridY: y, ActorUserID: actorUserID, PermissionUserID: actorUserID,
	}
}

func TestMemoryProcessMapRelationshipTraceLifecycle(t *testing.T) {
	repo, companyID, admin, _, _ := newV2PolicyTestRepo(t)
	folder, _ := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Operations")
	processA, _ := repo.CreateLogicGate(companyID, "Receive")
	processB, _ := repo.CreateLogicGate(companyID, "Ship")
	parentID := folder.FolderID

	if _, err := repo.PutProcessMapPlacement(processMapTestPlacementInput(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, processA.LogicGateID, nil, 1, 1)); !errors.Is(err, ErrProcessMapRootProcess) {
		t.Fatalf("root Process error = %v, want %v", err, ErrProcessMapRootProcess)
	}
	if _, err := repo.PutProcessMapPlacement(processMapTestPlacementInput(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 0, 0)); err != nil {
		t.Fatal(err)
	}
	for index, process := range []domain.LogicGate{processA, processB} {
		if _, err := repo.PutProcessMapPlacement(processMapTestPlacementInput(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, process.LogicGateID, &parentID, index*5, 4)); err != nil {
			t.Fatal(err)
		}
	}

	input := ResourceOperationalRelationshipCreateInput{
		CompanyID:   companyID,
		Source:      domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: processA.LogicGateID},
		Target:      domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: processB.LogicGateID},
		Trace:       &ProcessMapTraceInput{RoutePoints: []domain.ProcessMapRoutePoint{{X: 2, Y: 4}}},
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	}
	created, err := repo.CreateResourceOperationalRelationship(input)
	if err != nil {
		t.Fatal(err)
	}
	if !created.RelationshipCreated || !created.TraceChanged || created.Trace == nil || created.Trace.Revision != 1 || len(created.Events) != 2 {
		t.Fatalf("created result = %+v", created)
	}
	retry, err := repo.CreateResourceOperationalRelationship(input)
	if err != nil {
		t.Fatal(err)
	}
	if retry.RelationshipCreated || retry.TraceChanged || retry.Trace == nil || retry.Trace.Revision != 1 || len(retry.Events) != 0 || retry.Relationship.ResourceOperationalRelationshipID != created.Relationship.ResourceOperationalRelationshipID {
		t.Fatalf("idempotent retry = %+v", retry)
	}
	input.Trace.RoutePoints = []domain.ProcessMapRoutePoint{{X: 2, Y: 4}, {X: 2, Y: 8}}
	rerouted, err := repo.CreateResourceOperationalRelationship(input)
	if err != nil {
		t.Fatal(err)
	}
	if !rerouted.TraceChanged || rerouted.Trace == nil || rerouted.Trace.Revision != 2 || len(rerouted.Events) != 1 {
		t.Fatalf("reroute = %+v", rerouted)
	}
	reverseInput := input
	reverseInput.Source, reverseInput.Target = input.Target, input.Source
	reverseInput.Trace = nil
	reverse, err := repo.CreateResourceOperationalRelationship(reverseInput)
	if err != nil || !reverse.RelationshipCreated || reverse.Relationship.ResourceOperationalRelationshipID == created.Relationship.ResourceOperationalRelationshipID {
		t.Fatalf("reverse = %+v err=%v", reverse, err)
	}

	items, err := repo.ListResourceOperationalRelationshipsForResource(ResourceOperationalRelationshipQuery{
		CompanyID: companyID, ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: processA.LogicGateID, Direction: "both", PermissionUserID: admin.UserID,
	})
	if err != nil || len(items) != 2 {
		t.Fatalf("bounded relationships = %+v err=%v", items, err)
	}
}

func TestMemoryProcessMapRestrictedLayerAndReparentCleanup(t *testing.T) {
	repo, companyID, admin, viewer, _ := newV2PolicyTestRepo(t)
	folderA, _ := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "A")
	folderB, _ := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "B")
	processA, _ := repo.CreateLogicGate(companyID, "Visible")
	processB, _ := repo.CreateLogicGate(companyID, "Hidden")
	parentA := folderA.FolderID
	parentB := folderB.FolderID
	for _, folder := range []domain.CompanyExplorerFolder{folderA, folderB} {
		if _, err := repo.PutProcessMapPlacement(processMapTestPlacementInput(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 0, 0)); err != nil {
			t.Fatal(err)
		}
	}
	for index, process := range []domain.LogicGate{processA, processB} {
		if _, err := repo.PutProcessMapPlacement(processMapTestPlacementInput(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, process.LogicGateID, &parentA, index*4, 2)); err != nil {
			t.Fatal(err)
		}
	}
	relationship, err := repo.CreateResourceOperationalRelationship(ResourceOperationalRelationshipCreateInput{
		CompanyID: companyID,
		Source:    domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: processA.LogicGateID},
		Target:    domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: processB.LogicGateID},
		Trace:     &ProcessMapTraceInput{RoutePoints: []domain.ProcessMapRoutePoint{}}, ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	noAccess := ResourceDefaultAccessNoAccess
	if _, _, err := repo.PutResourcePermissionPolicy(ResourcePermissionPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: processB.LogicGateID,
		PermissionMode: PolicyModeCustomized, DefaultAccess: &noAccess, DescendantAction: PolicyDescendantActionInheritedOnly,
	}); err != nil {
		t.Fatal(err)
	}
	view, err := repo.GetProcessMapLayer(ProcessMapLayerQuery{CompanyID: companyID, FolderID: folderA.FolderID, PermissionUserID: viewer.UserID})
	if err != nil || len(view.Placements) != 2 || len(view.Traces) != 0 {
		t.Fatalf("restricted layer = %+v err=%v", view, err)
	}
	restrictedCount := 0
	for _, placement := range view.Placements {
		if _, ok := placement.(domain.ProcessMapRestrictedPlacement); ok {
			restrictedCount++
		}
	}
	if restrictedCount != 1 {
		t.Fatalf("restricted placements = %d, want 1", restrictedCount)
	}
	if _, err := repo.PutProcessMapPlacement(processMapTestPlacementInput(companyID, viewer.UserID, domain.ProcessMapResourceTypeProcess, processB.LogicGateID, &parentA, 9, 9)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("restricted placement mutation error = %v, want hidden not found", err)
	}
	encoded, err := json.Marshal(view)
	if err != nil {
		t.Fatal(err)
	}
	var wire struct {
		Placements []map[string]any `json:"placements"`
	}
	if err := json.Unmarshal(encoded, &wire); err != nil {
		t.Fatal(err)
	}
	for _, placement := range wire.Placements {
		if restricted, _ := placement["restricted"].(bool); restricted && len(placement) != 3 {
			t.Fatalf("restricted placement leaked fields: %+v", placement)
		}
	}

	if _, err := repo.PutProcessMapPlacement(processMapTestPlacementInput(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, processB.LogicGateID, &parentB, 4, 2)); err != nil {
		t.Fatal(err)
	}
	if _, ok := repo.processMapTraces[key(companyID, relationship.Relationship.ResourceOperationalRelationshipID)]; ok {
		t.Fatal("reparent preserved invalid trace")
	}
	if _, ok := repo.resourceOperationalRelationships[key(companyID, relationship.Relationship.ResourceOperationalRelationshipID)]; !ok {
		t.Fatal("reparent deleted operational relationship")
	}
}

func TestMemoryProcessMapValidationNoOpAndDeleteSemantics(t *testing.T) {
	repo, companyID, admin, _, _ := newV2PolicyTestRepo(t)
	folder, _ := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Operations")
	processA, _ := repo.CreateLogicGate(companyID, "Receive")
	processB, _ := repo.CreateLogicGate(companyID, "Ship")
	parentID := folder.FolderID
	if _, err := repo.PutProcessMapPlacement(processMapTestPlacementInput(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 0, 0)); err != nil {
		t.Fatal(err)
	}
	for index, process := range []domain.LogicGate{processA, processB} {
		if _, err := repo.PutProcessMapPlacement(processMapTestPlacementInput(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, process.LogicGateID, &parentID, index*4, 2)); err != nil {
			t.Fatal(err)
		}
	}

	base := ResourceOperationalRelationshipCreateInput{
		CompanyID:   companyID,
		Source:      domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: processA.LogicGateID},
		Target:      domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: processB.LogicGateID},
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	}
	created, err := repo.CreateResourceOperationalRelationship(base)
	if err != nil || !created.RelationshipCreated || created.Trace != nil {
		t.Fatalf("relationship-only create = %+v err=%v", created, err)
	}
	self := base
	self.Target = self.Source
	if _, err := repo.CreateResourceOperationalRelationship(self); !errors.Is(err, ErrInvalid) {
		t.Fatalf("self relationship error = %v, want %v", err, ErrInvalid)
	}
	otherCompanyID := "99999999-2222-4333-8444-555555555555"
	repo.EnsureCompany(otherCompanyID, "Other")
	otherProcess, _ := repo.CreateLogicGate(otherCompanyID, "Other process")
	crossCompany := base
	crossCompany.Target.ResourceID = otherProcess.LogicGateID
	if _, err := repo.CreateResourceOperationalRelationship(crossCompany); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-company relationship error = %v, want hidden not found", err)
	}

	tooMany := make([]domain.ProcessMapRoutePoint, ProcessMapMaxRoutePoints+1)
	if _, err := repo.PutProcessMapTrace(ProcessMapTracePutInput{
		CompanyID: companyID, ResourceOperationalRelationshipID: created.Relationship.ResourceOperationalRelationshipID,
		RoutePoints: nil, ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("null trace route error = %v, want %v", err, ErrInvalid)
	}
	if _, err := repo.PutProcessMapTrace(ProcessMapTracePutInput{
		CompanyID: companyID, ResourceOperationalRelationshipID: created.Relationship.ResourceOperationalRelationshipID,
		RoutePoints: tooMany, ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("oversized trace error = %v, want %v", err, ErrInvalid)
	}
	points := []domain.ProcessMapRoutePoint{{X: 3, Y: 2}, {X: 3, Y: 6}}
	firstTrace, err := repo.PutProcessMapTrace(ProcessMapTracePutInput{
		CompanyID: companyID, ResourceOperationalRelationshipID: created.Relationship.ResourceOperationalRelationshipID,
		RoutePoints: points, ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil || !firstTrace.Changed || firstTrace.Trace.Revision != 1 {
		t.Fatalf("first trace = %+v err=%v", firstTrace, err)
	}
	retry, err := repo.PutProcessMapTrace(ProcessMapTracePutInput{
		CompanyID: companyID, ResourceOperationalRelationshipID: created.Relationship.ResourceOperationalRelationshipID,
		RoutePoints: points, ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil || retry.Changed || retry.Trace.Revision != 1 || !retry.Trace.UpdatedTimestamp.Equal(firstTrace.Trace.UpdatedTimestamp) || len(retry.Events) != 0 {
		t.Fatalf("identical trace retry = %+v err=%v", retry, err)
	}

	if _, err := repo.DeleteResourceOperationalRelationship(ResourceOperationalRelationshipDeleteInput{
		CompanyID: companyID, ResourceOperationalRelationshipID: created.Relationship.ResourceOperationalRelationshipID,
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	if _, ok := repo.resourceOperationalRelationships[key(companyID, created.Relationship.ResourceOperationalRelationshipID)]; ok {
		t.Fatal("relationship delete preserved canonical relationship")
	}
	if _, ok := repo.processMapTraces[key(companyID, created.Relationship.ResourceOperationalRelationshipID)]; ok {
		t.Fatal("relationship delete preserved dependent trace")
	}
	for _, process := range []domain.LogicGate{processA, processB} {
		if _, ok := repo.logicGates[key(companyID, process.LogicGateID)]; !ok {
			t.Fatalf("relationship delete removed source process %s", process.LogicGateID)
		}
		if _, ok := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeProcess, process.LogicGateID)]; !ok {
			t.Fatalf("relationship delete removed placement %s", process.LogicGateID)
		}
	}
	invalidActor := processMapTestPlacementInput(companyID, "", domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 1, 1)
	if _, err := repo.PutProcessMapPlacement(invalidActor); !errors.Is(err, ErrInvalid) {
		t.Fatalf("blank actor placement error = %v, want %v", err, ErrInvalid)
	}
	outOfRange := processMapTestPlacementInput(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, int(processMapMaxCoordinate)+1, 0)
	if _, err := repo.PutProcessMapPlacement(outOfRange); !errors.Is(err, ErrInvalid) {
		t.Fatalf("out-of-range placement error = %v, want %v", err, ErrInvalid)
	}
	communicationsFolderID := "88888888-2222-4333-8444-555555555555"
	repo.folders[key(companyID, communicationsFolderID)] = domain.CompanyExplorerFolder{
		CompanyID: companyID, FolderID: communicationsFolderID, FolderKind: "communications", Name: "Inbox",
	}
	if _, err := repo.PutProcessMapPlacement(processMapTestPlacementInput(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, communicationsFolderID, nil, 0, 0)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("communications placement error = %v, want hidden not found", err)
	}
}

func TestMemoryProcessMapLayerReadIsExactAndLazy(t *testing.T) {
	repo, companyID, admin, _, _ := newV2PolicyTestRepo(t)
	outer, _ := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Outer")
	inner, _ := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Inner")
	process, _ := repo.CreateLogicGate(companyID, "Deep process")
	outerID := outer.FolderID
	innerID := inner.FolderID
	for _, input := range []ProcessMapPlacementPutInput{
		processMapTestPlacementInput(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, outer.FolderID, nil, 0, 0),
		processMapTestPlacementInput(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, inner.FolderID, &outerID, 1, 1),
		processMapTestPlacementInput(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, process.LogicGateID, &innerID, 2, 2),
	} {
		if _, err := repo.PutProcessMapPlacement(input); err != nil {
			t.Fatal(err)
		}
	}
	root, err := repo.GetProcessMapLayer(ProcessMapLayerQuery{CompanyID: companyID, PermissionUserID: admin.UserID})
	if err != nil || len(root.Placements) != 1 {
		t.Fatalf("root layer = %+v err=%v, want only outer folder", root, err)
	}
	outerLayer, err := repo.GetProcessMapLayer(ProcessMapLayerQuery{CompanyID: companyID, FolderID: outer.FolderID, PermissionUserID: admin.UserID})
	if err != nil || len(outerLayer.Placements) != 1 {
		t.Fatalf("outer layer = %+v err=%v, want only inner folder", outerLayer, err)
	}
	innerLayer, err := repo.GetProcessMapLayer(ProcessMapLayerQuery{CompanyID: companyID, FolderID: inner.FolderID, PermissionUserID: admin.UserID})
	if err != nil || len(innerLayer.Placements) != 1 {
		t.Fatalf("inner layer = %+v err=%v, want only deep process", innerLayer, err)
	}
}

func TestMemoryMappedSourceMutationsRollbackWithAtomicInvalidation(t *testing.T) {
	repo, companyID, admin, _, _ := newV2PolicyTestRepo(t)
	folder, _ := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Original")
	if _, err := repo.PutProcessMapPlacement(processMapTestPlacementInput(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 0, 0)); err != nil {
		t.Fatal(err)
	}
	beforeVersion, _, err := repo.CurrentWorkspaceReadVersion(WorkspaceReadVersionQuery{CompanyID: companyID, Scope: "process-map"})
	if err != nil {
		t.Fatal(err)
	}
	repo.domainEventAppendErr = errors.New("event failed")
	if _, err := repo.RenameCompanyExplorerFolder(companyID, folder.FolderID, "Failed rename", admin.UserID, admin.UserID); err == nil {
		t.Fatal("rename succeeded despite event failure")
	}
	if stored := repo.folders[key(companyID, folder.FolderID)]; stored.Name != "Original" {
		t.Fatalf("failed rename committed name %q", stored.Name)
	}
	repo.domainEventAppendErr = nil
	if _, err := repo.RenameCompanyExplorerFolder(companyID, folder.FolderID, "Renamed", admin.UserID, admin.UserID); err != nil {
		t.Fatal(err)
	}
	afterVersion, _, err := repo.CurrentWorkspaceReadVersion(WorkspaceReadVersionQuery{CompanyID: companyID, Scope: "process-map"})
	if err != nil || afterVersion <= beforeVersion {
		t.Fatalf("rename process-map version = %d after %d, err=%v", afterVersion, beforeVersion, err)
	}

	deleteFolder, _ := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Delete rollback")
	if _, err := repo.PutProcessMapPlacement(processMapTestPlacementInput(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, deleteFolder.FolderID, nil, 1, 1)); err != nil {
		t.Fatal(err)
	}
	repo.domainEventAppendErr = errors.New("event failed")
	if _, err := repo.DeleteCompanyExplorerTargets(companyID, []CompanyExplorerDeleteTargetInput{{Kind: "folder", ID: deleteFolder.FolderID}}, admin.UserID); err == nil {
		t.Fatal("delete succeeded despite event failure")
	}
	if _, ok := repo.folders[key(companyID, deleteFolder.FolderID)]; !ok {
		t.Fatal("failed delete removed source folder")
	}
	if _, ok := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, deleteFolder.FolderID)]; !ok {
		t.Fatal("failed delete removed Process Map placement")
	}
	repo.domainEventAppendErr = nil

	process, _ := repo.CreateLogicGate(companyID, "Convert rollback")
	parentID := folder.FolderID
	if _, err := repo.PutProcessMapPlacement(processMapTestPlacementInput(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, process.LogicGateID, &parentID, 2, 2)); err != nil {
		t.Fatal(err)
	}
	repo.domainEventAppendErr = errors.New("event failed")
	if _, err := repo.ConvertLogicGateToHuddle(companyID, process.LogicGateID, admin.UserID); err == nil {
		t.Fatal("conversion succeeded despite event failure")
	}
	if _, ok := repo.logicGates[key(companyID, process.LogicGateID)]; !ok {
		t.Fatal("failed conversion removed source Process")
	}
	if _, ok := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeProcess, process.LogicGateID)]; !ok {
		t.Fatal("failed conversion removed Process Map placement")
	}
	if _, ok := repo.huddleLogicGates[key(companyID, process.LogicGateID)]; ok {
		t.Fatal("failed conversion created Huddle")
	}
	repo.domainEventAppendErr = nil
	if _, err := repo.ConvertLogicGateToHuddle(companyID, process.LogicGateID, admin.UserID); err != nil {
		t.Fatal(err)
	}
	if _, ok := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeProcess, process.LogicGateID)]; ok {
		t.Fatal("successful conversion preserved Process Map placement")
	}
}

func TestMemoryDirectLogicGateDeleteIsAtomicAndInvalidatesProcessMap(t *testing.T) {
	repo, companyID, admin, _, _ := newV2PolicyTestRepo(t)
	folder, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Operations")
	if err != nil {
		t.Fatal(err)
	}
	process, err := repo.CreateLogicGate(companyID, "Direct delete")
	if err != nil {
		t.Fatal(err)
	}
	parentID := folder.FolderID
	if _, err := repo.PutProcessMapPlacement(processMapTestPlacementInput(companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, process.LogicGateID, &parentID, 1, 1)); err != nil {
		t.Fatal(err)
	}
	beforeVersion, _, err := repo.CurrentWorkspaceReadVersion(WorkspaceReadVersionQuery{CompanyID: companyID, Scope: "process-map"})
	if err != nil {
		t.Fatal(err)
	}

	forced := errors.New("forced direct delete event failure")
	repo.domainEventAppendErr = forced
	if err := repo.DeleteLogicGate(companyID, process.LogicGateID); !errors.Is(err, forced) {
		t.Fatalf("DeleteLogicGate error = %v, want %v", err, forced)
	}
	if _, ok := repo.logicGates[key(companyID, process.LogicGateID)]; !ok {
		t.Fatal("failed direct delete removed Logic Gate")
	}
	if _, ok := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeProcess, process.LogicGateID)]; !ok {
		t.Fatal("failed direct delete removed Process Map placement")
	}

	repo.domainEventAppendErr = nil
	if err := repo.DeleteLogicGate(companyID, process.LogicGateID); err != nil {
		t.Fatal(err)
	}
	if _, ok := repo.logicGates[key(companyID, process.LogicGateID)]; ok {
		t.Fatal("successful direct delete preserved Logic Gate")
	}
	if _, ok := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeProcess, process.LogicGateID)]; ok {
		t.Fatal("successful direct delete preserved Process Map placement")
	}
	afterVersion, _, err := repo.CurrentWorkspaceReadVersion(WorkspaceReadVersionQuery{CompanyID: companyID, Scope: "process-map"})
	if err != nil || afterVersion <= beforeVersion {
		t.Fatalf("direct delete process-map version = %d after %d, err=%v", afterVersion, beforeVersion, err)
	}
}

func TestMemoryExplorerParentChangesAreAtomicAndInvalidateProcessMap(t *testing.T) {
	repo, companyID, admin, _, _ := newV2PolicyTestRepo(t)
	folderA, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "A")
	if err != nil {
		t.Fatal(err)
	}
	folderB, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "B")
	if err != nil {
		t.Fatal(err)
	}
	process, err := repo.CreateLogicGate(companyID, "Movable")
	if err != nil {
		t.Fatal(err)
	}
	placed, err := repo.UpsertCompanyExplorerV2Edge(CompanyExplorerV2EdgeInput{
		CompanyID: companyID, ParentEntityID: folderA.FolderID,
		ChildEntityType: CompanyExplorerV2EntityLogicGate, ChildResourceID: process.LogicGateID,
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	beforeMoveVersion, _, err := repo.CurrentWorkspaceReadVersion(WorkspaceReadVersionQuery{CompanyID: companyID, Scope: "process-map"})
	if err != nil {
		t.Fatal(err)
	}

	forced := errors.New("forced Explorer event failure")
	repo.domainEventAppendErr = forced
	if _, err := repo.MoveCompanyExplorerV2Edge(CompanyExplorerV2MoveEdgeInput{
		CompanyID: companyID, EdgeID: placed.EdgeID, ParentEntityID: folderB.FolderID,
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	}); !errors.Is(err, forced) {
		t.Fatalf("MoveCompanyExplorerV2Edge error = %v, want %v", err, forced)
	}
	if edge, ok := repo.companyExplorerV2Edges[key(companyID, placed.EdgeID)]; !ok || edge.ParentEntityID != folderA.FolderID {
		t.Fatalf("failed edge move changed parent: %+v exists=%v", edge, ok)
	}

	repo.domainEventAppendErr = nil
	moved, err := repo.MoveCompanyExplorerV2Edge(CompanyExplorerV2MoveEdgeInput{
		CompanyID: companyID, EdgeID: placed.EdgeID, ParentEntityID: folderB.FolderID,
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	afterMoveVersion, _, err := repo.CurrentWorkspaceReadVersion(WorkspaceReadVersionQuery{CompanyID: companyID, Scope: "process-map"})
	if err != nil || afterMoveVersion <= beforeMoveVersion {
		t.Fatalf("edge move process-map version = %d after %d, err=%v", afterMoveVersion, beforeMoveVersion, err)
	}
	if _, err := repo.MoveCompanyExplorerV2Edge(CompanyExplorerV2MoveEdgeInput{
		CompanyID: companyID, EdgeID: moved.EdgeID, ParentEntityID: folderB.FolderID, Position: 9000,
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	afterReorderVersion, _, err := repo.CurrentWorkspaceReadVersion(WorkspaceReadVersionQuery{CompanyID: companyID, Scope: "process-map"})
	if err != nil || afterReorderVersion != afterMoveVersion {
		t.Fatalf("same-parent reorder version = %d, want unchanged %d, err=%v", afterReorderVersion, afterMoveVersion, err)
	}

	repo.domainEventAppendErr = forced
	if err := repo.DeleteCompanyExplorerV2Edge(companyID, moved.EdgeID, admin.UserID, admin.UserID); !errors.Is(err, forced) {
		t.Fatalf("DeleteCompanyExplorerV2Edge error = %v, want %v", err, forced)
	}
	if _, ok := repo.companyExplorerV2Edges[key(companyID, moved.EdgeID)]; !ok {
		t.Fatal("failed edge detach removed edge")
	}
	repo.domainEventAppendErr = nil
	if err := repo.DeleteCompanyExplorerV2Edge(companyID, moved.EdgeID, admin.UserID, admin.UserID); err != nil {
		t.Fatal(err)
	}
	afterDetachVersion, _, err := repo.CurrentWorkspaceReadVersion(WorkspaceReadVersionQuery{CompanyID: companyID, Scope: "process-map"})
	if err != nil || afterDetachVersion <= afterMoveVersion {
		t.Fatalf("edge detach process-map version = %d after %d, err=%v", afterDetachVersion, afterMoveVersion, err)
	}

	child, err := repo.CreateCompanyExplorerFolder(companyID, folderA.FolderID, "logic_gate", "Child")
	if err != nil {
		t.Fatal(err)
	}
	repo.domainEventAppendErr = forced
	parentB := folderB.FolderID
	if _, err := repo.MoveCompanyExplorerFolder(companyID, child.FolderID, &parentB, 0, admin.UserID, admin.UserID); !errors.Is(err, forced) {
		t.Fatalf("MoveCompanyExplorerFolder error = %v, want %v", err, forced)
	}
	if stored := repo.folders[key(companyID, child.FolderID)]; stored.ParentFolderID == nil || *stored.ParentFolderID != folderA.FolderID {
		t.Fatalf("failed folder move changed parent: %+v", stored.ParentFolderID)
	}
	repo.domainEventAppendErr = nil
	beforeFolderMoveVersion, _, err := repo.CurrentWorkspaceReadVersion(WorkspaceReadVersionQuery{CompanyID: companyID, Scope: "process-map"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.MoveCompanyExplorerFolder(companyID, child.FolderID, &parentB, 0, admin.UserID, admin.UserID); err != nil {
		t.Fatal(err)
	}
	afterFolderMoveVersion, _, err := repo.CurrentWorkspaceReadVersion(WorkspaceReadVersionQuery{CompanyID: companyID, Scope: "process-map"})
	if err != nil || afterFolderMoveVersion <= beforeFolderMoveVersion {
		t.Fatalf("folder move process-map version = %d after %d, err=%v", afterFolderMoveVersion, beforeFolderMoveVersion, err)
	}
}

func TestMemoryProcessMapFolderCycleAndEventRollback(t *testing.T) {
	repo, companyID, admin, _, _ := newV2PolicyTestRepo(t)
	folderA, _ := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "A")
	folderB, _ := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "B")
	if _, err := repo.PutProcessMapPlacement(processMapTestPlacementInput(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folderA.FolderID, nil, 0, 0)); err != nil {
		t.Fatal(err)
	}
	parentA := folderA.FolderID
	if _, err := repo.PutProcessMapPlacement(processMapTestPlacementInput(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folderB.FolderID, &parentA, 1, 1)); err != nil {
		t.Fatal(err)
	}
	parentB := folderB.FolderID
	if _, err := repo.PutProcessMapPlacement(processMapTestPlacementInput(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folderA.FolderID, &parentB, 2, 2)); !errors.Is(err, ErrProcessMapCycle) {
		t.Fatalf("cycle error = %v, want %v", err, ErrProcessMapCycle)
	}

	folderC, _ := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "C")
	repo.domainEventAppendErr = errors.New("event failed")
	if _, err := repo.PutProcessMapPlacement(processMapTestPlacementInput(companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folderC.FolderID, nil, 3, 3)); err == nil {
		t.Fatal("event failure did not fail placement")
	}
	if _, exists := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, folderC.FolderID)]; exists {
		t.Fatal("failed event left placement committed")
	}
}
