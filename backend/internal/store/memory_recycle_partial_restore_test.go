package store

import (
	"errors"
	"miraeopus/backend/internal/domain"
	"testing"
)

func TestMemoryRecycleBatchRestoreKeepsRootsExactAndDefersSharedProcessMapEdge(t *testing.T) {
	repo, companyID, admin, _, _ := newV2PolicyTestRepo(t)
	folder, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Operations")
	if err != nil {
		t.Fatal(err)
	}
	processA, err := repo.CreateLogicGate(companyID, "Receive")
	if err != nil {
		t.Fatal(err)
	}
	processB, err := repo.CreateLogicGate(companyID, "Ship")
	if err != nil {
		t.Fatal(err)
	}
	parentID := folder.FolderID
	for index, process := range []domain.LogicGate{processA, processB} {
		if _, err := repo.PutProcessMapPlacement(processMapTestPlacementInput(
			companyID,
			admin.UserID,
			domain.ProcessMapResourceTypeProcess,
			process.LogicGateID,
			&parentID,
			index*4,
			2,
		)); err != nil {
			t.Fatal(err)
		}
	}
	created, err := repo.CreateResourceOperationalRelationship(ResourceOperationalRelationshipCreateInput{
		CompanyID: companyID,
		Source: domain.ProcessMapResourceRef{
			ResourceType: domain.ProcessMapResourceTypeProcess,
			ResourceID:   processA.LogicGateID,
		},
		Target: domain.ProcessMapResourceRef{
			ResourceType: domain.ProcessMapResourceTypeProcess,
			ResourceID:   processB.LogicGateID,
		},
		Trace: &ProcessMapTraceInput{RoutePoints: []domain.ProcessMapRoutePoint{
			{X: 1, Y: 2},
			{X: 4, Y: 2},
		}},
		ActorUserID:      admin.UserID,
		PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	relationshipID := created.Relationship.ResourceOperationalRelationshipID

	if _, err := repo.DeleteCompanyExplorerTargets(companyID, []CompanyExplorerDeleteTargetInput{
		{Kind: EntityTypeLogicGate, ID: processA.LogicGateID},
		{Kind: EntityTypeLogicGate, ID: processB.LogicGateID},
	}, admin.UserID); err != nil {
		t.Fatal(err)
	}
	items, err := repo.ListRecycleBinItems(companyID, admin.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("recycle item count = %d, want one row per selected Process", len(items))
	}
	itemByProcess := map[string]domain.RecycleBinItem{}
	for _, item := range items {
		itemByProcess[item.ObjectID] = item
		record := repo.recycleBin[key(companyID, item.RecycleBinItemID)]
		if len(record.Targets) != 1 || record.Targets[0].Kind != EntityTypeLogicGate || record.Targets[0].ID != item.ObjectID {
			t.Fatalf("recycle row %s targets = %+v, want its exact selected Process", item.ObjectID, record.Targets)
		}
		if len(record.Delta.logicGates) != 1 {
			t.Fatalf("recycle row %s Process delta count = %d, want 1", item.ObjectID, len(record.Delta.logicGates))
		}
		if len(record.Delta.resourceOperationalRelationships) != 1 || len(record.Delta.processMapTraces) != 1 {
			t.Fatalf("recycle row %s shared edge delta = relationships:%d traces:%d, want 1/1", item.ObjectID, len(record.Delta.resourceOperationalRelationships), len(record.Delta.processMapTraces))
		}
	}

	if _, err := repo.RestoreRecycleBinItems(companyID, admin.UserID, []string{itemByProcess[processA.LogicGateID].RecycleBinItemID}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetLogicGate(companyID, processA.LogicGateID); err != nil {
		t.Fatalf("first selected Process was not restored: %v", err)
	}
	if _, err := repo.GetLogicGate(companyID, processB.LogicGateID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("restoring A also restored B: %v", err)
	}
	if _, ok := repo.resourceOperationalRelationships[key(companyID, relationshipID)]; ok {
		t.Fatal("shared relationship restored before both endpoints existed")
	}
	if _, ok := repo.processMapTraces[key(companyID, relationshipID)]; ok {
		t.Fatal("shared trace restored without its relationship")
	}

	if _, err := repo.RestoreRecycleBinItems(companyID, admin.UserID, []string{itemByProcess[processB.LogicGateID].RecycleBinItemID}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetLogicGate(companyID, processB.LogicGateID); err != nil {
		t.Fatalf("second selected Process was not restored: %v", err)
	}
	if _, ok := repo.resourceOperationalRelationships[key(companyID, relationshipID)]; !ok {
		t.Fatal("second endpoint restore did not recover the shared relationship")
	}
	if _, ok := repo.processMapTraces[key(companyID, relationshipID)]; !ok {
		t.Fatal("second endpoint restore did not recover the shared trace")
	}
}

func TestMemoryRecycleFolderRestoreRecoversOnlyRemovedProcessMapGeometry(t *testing.T) {
	repo, companyID, admin, _, _ := newV2PolicyTestRepo(t)
	folder, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Map layer")
	if err != nil {
		t.Fatal(err)
	}
	processA, err := repo.CreateLogicGate(companyID, "Receive")
	if err != nil {
		t.Fatal(err)
	}
	processB, err := repo.CreateLogicGate(companyID, "Ship")
	if err != nil {
		t.Fatal(err)
	}
	parentID := folder.FolderID
	if _, err := repo.PutProcessMapPlacement(processMapTestPlacementInput(
		companyID,
		admin.UserID,
		domain.ProcessMapResourceTypeFolder,
		folder.FolderID,
		nil,
		0,
		0,
	)); err != nil {
		t.Fatal(err)
	}
	for index, process := range []domain.LogicGate{processA, processB} {
		if _, err := repo.PutProcessMapPlacement(processMapTestPlacementInput(
			companyID,
			admin.UserID,
			domain.ProcessMapResourceTypeProcess,
			process.LogicGateID,
			&parentID,
			index*4,
			2,
		)); err != nil {
			t.Fatal(err)
		}
	}
	created, err := repo.CreateResourceOperationalRelationship(ResourceOperationalRelationshipCreateInput{
		CompanyID: companyID,
		Source:    domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: processA.LogicGateID},
		Target:    domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: processB.LogicGateID},
		Trace: &ProcessMapTraceInput{RoutePoints: []domain.ProcessMapRoutePoint{
			{X: 1, Y: 2},
			{X: 4, Y: 2},
		}},
		ActorUserID:      admin.UserID,
		PermissionUserID: admin.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	relationshipID := created.Relationship.ResourceOperationalRelationshipID

	if _, err := repo.DeleteCompanyExplorerTargets(companyID, []CompanyExplorerDeleteTargetInput{
		{Kind: "folder", ID: folder.FolderID},
	}, admin.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetLogicGate(companyID, processA.LogicGateID); err != nil {
		t.Fatalf("map Folder deletion removed a surviving Process: %v", err)
	}
	if _, ok := repo.resourceOperationalRelationships[key(companyID, relationshipID)]; !ok {
		t.Fatal("map Folder deletion removed the surviving operational relationship")
	}
	if _, ok := repo.processMapTraces[key(companyID, relationshipID)]; ok {
		t.Fatal("map Folder deletion preserved invalid child trace geometry")
	}

	items, err := repo.ListRecycleBinItems(companyID, admin.UserID)
	if err != nil || len(items) != 1 {
		t.Fatalf("folder recycle items = %+v, err = %v", items, err)
	}
	record := repo.recycleBin[key(companyID, items[0].RecycleBinItemID)]
	if len(record.Delta.resourceOperationalRelationships) != 0 || len(record.Delta.processMapTraces) != 1 {
		t.Fatalf("folder Process Map delta = relationships:%d traces:%d, want 0/1", len(record.Delta.resourceOperationalRelationships), len(record.Delta.processMapTraces))
	}
	if _, err := repo.RestoreRecycleBinItems(companyID, admin.UserID, []string{items[0].RecycleBinItemID}); err != nil {
		t.Fatal(err)
	}
	if _, ok := repo.resourceOperationalRelationships[key(companyID, relationshipID)]; !ok {
		t.Fatal("folder restore removed the surviving operational relationship")
	}
	if _, ok := repo.processMapTraces[key(companyID, relationshipID)]; !ok {
		t.Fatal("folder restore did not recover removed child trace geometry")
	}
}

func TestMemoryRecyclePlacementWaitsForIndependentlyDeletedMapParent(t *testing.T) {
	repo, companyID, admin, _, _ := newV2PolicyTestRepo(t)
	folder, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Map layer")
	if err != nil {
		t.Fatal(err)
	}
	process, err := repo.CreateLogicGate(companyID, "Receive")
	if err != nil {
		t.Fatal(err)
	}
	parentID := folder.FolderID
	if _, err := repo.PutProcessMapPlacement(processMapTestPlacementInput(
		companyID,
		admin.UserID,
		domain.ProcessMapResourceTypeProcess,
		process.LogicGateID,
		&parentID,
		4,
		2,
	)); err != nil {
		t.Fatal(err)
	}

	if _, err := repo.DeleteCompanyExplorerTargets(companyID, []CompanyExplorerDeleteTargetInput{
		{Kind: EntityTypeLogicGate, ID: process.LogicGateID},
		{Kind: "folder", ID: folder.FolderID},
	}, admin.UserID); err != nil {
		t.Fatal(err)
	}
	items, err := repo.ListRecycleBinItems(companyID, admin.UserID)
	if err != nil || len(items) != 2 {
		t.Fatalf("recycle items = %+v, err = %v", items, err)
	}
	itemByObject := map[string]domain.RecycleBinItem{}
	for _, item := range items {
		itemByObject[item.ObjectKind+":"+item.ObjectID] = item
		record := repo.recycleBin[key(companyID, item.RecycleBinItemID)]
		if len(record.Delta.processMapPlacements) != 1 {
			t.Fatalf("recycle row %s:%s placement count = %d, want shared placement in each root payload", item.ObjectKind, item.ObjectID, len(record.Delta.processMapPlacements))
		}
	}

	processItem := itemByObject[EntityTypeLogicGate+":"+process.LogicGateID]
	if _, err := repo.RestoreRecycleBinItems(companyID, admin.UserID, []string{processItem.RecycleBinItemID}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetLogicGate(companyID, process.LogicGateID); err != nil {
		t.Fatalf("Process restore failed: %v", err)
	}
	if _, ok := repo.folders[key(companyID, folder.FolderID)]; ok {
		t.Fatal("Process restore resurrected independently deleted map parent Folder")
	}
	placementKey := processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeProcess, process.LogicGateID)
	if _, ok := repo.processMapPlacements[placementKey]; ok {
		t.Fatal("Process restore resurrected placement with absent map parent Folder")
	}

	folderItem := itemByObject["folder:"+folder.FolderID]
	if _, err := repo.RestoreRecycleBinItems(companyID, admin.UserID, []string{folderItem.RecycleBinItemID}); err != nil {
		t.Fatal(err)
	}
	placement, ok := repo.processMapPlacements[placementKey]
	if !ok || placement.MapParentFolderID == nil || *placement.MapParentFolderID != folder.FolderID {
		t.Fatalf("later Folder restore placement = %+v, want original parent", placement)
	}

	fallbackFolder, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Fallback layer")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.DeleteCompanyExplorerTargets(companyID, []CompanyExplorerDeleteTargetInput{
		{Kind: EntityTypeLogicGate, ID: process.LogicGateID},
		{Kind: "folder", ID: folder.FolderID},
	}, admin.UserID); err != nil {
		t.Fatal(err)
	}
	items, err = repo.ListRecycleBinItems(companyID, admin.UserID)
	if err != nil || len(items) != 2 {
		t.Fatalf("second recycle items = %+v, err = %v", items, err)
	}
	itemByObject = map[string]domain.RecycleBinItem{}
	for _, item := range items {
		itemByObject[item.ObjectKind+":"+item.ObjectID] = item
	}
	processItem = itemByObject[EntityTypeLogicGate+":"+process.LogicGateID]
	if _, err := repo.RestoreRecycleBinItems(companyID, admin.UserID, []string{processItem.RecycleBinItemID}); err != nil {
		t.Fatal(err)
	}
	fallbackParentID := fallbackFolder.FolderID
	if _, err := repo.PutProcessMapPlacement(processMapTestPlacementInput(
		companyID,
		admin.UserID,
		domain.ProcessMapResourceTypeProcess,
		process.LogicGateID,
		&fallbackParentID,
		11,
		-3,
	)); err != nil {
		t.Fatal(err)
	}
	folderItem = itemByObject["folder:"+folder.FolderID]
	if _, err := repo.RestoreRecycleBinItems(companyID, admin.UserID, []string{folderItem.RecycleBinItemID}); err != nil {
		t.Fatal(err)
	}
	placement, ok = repo.processMapPlacements[placementKey]
	if !ok || placement.MapParentFolderID == nil || *placement.MapParentFolderID != fallbackFolder.FolderID || placement.GridX != 11 || placement.GridY != -3 {
		t.Fatalf("later Folder restore overwrote newer placement = %+v", placement)
	}
}
