package store

import (
	"context"
	"errors"
	"miraeopus/backend/internal/domain"
	"testing"
	"time"
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
	if _, err := repo.PutProcessMapPlacement(context.Background(), processMapTestPlacementWithSize(
		companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 0, 0, 40, 20,
	)); err != nil {
		t.Fatal(err)
	}
	for index, process := range []domain.LogicGate{processA, processB} {
		if _, err := repo.PutProcessMapPlacement(context.Background(), processMapTestPlacementInput(
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
	created, err := repo.CreateResourceOperationalRelationship(context.Background(), ResourceOperationalRelationshipCreateInput{
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
	if _, err := repo.PutProcessMapPlacement(context.Background(), processMapTestPlacementWithSize(
		companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 0, 0, 40, 20,
	)); err != nil {
		t.Fatal(err)
	}
	for index, process := range []domain.LogicGate{processA, processB} {
		if _, err := repo.PutProcessMapPlacement(context.Background(), processMapTestPlacementInput(
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
	created, err := repo.CreateResourceOperationalRelationship(context.Background(), ResourceOperationalRelationshipCreateInput{
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
	if _, ok := repo.processMapTraces[key(companyID, relationshipID)]; !ok {
		t.Fatal("map Folder deletion removed a valid global trace")
	}

	items, err := repo.ListRecycleBinItems(companyID, admin.UserID)
	if err != nil || len(items) != 1 {
		t.Fatalf("folder recycle items = %+v, err = %v", items, err)
	}
	record := repo.recycleBin[key(companyID, items[0].RecycleBinItemID)]
	if len(record.Delta.resourceOperationalRelationships) != 0 || len(record.Delta.processMapTraces) != 0 {
		t.Fatalf("folder Process Map delta = relationships:%d traces:%d, want 0/0 for preserved global authorities", len(record.Delta.resourceOperationalRelationships), len(record.Delta.processMapTraces))
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
	if _, err := repo.PutProcessMapPlacement(context.Background(), processMapTestPlacementWithSize(
		companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 0, 0, 40, 20,
	)); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.PutProcessMapPlacement(context.Background(), processMapTestPlacementInput(
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
		if len(record.Delta.processMapPlacements) < 1 {
			t.Fatalf("recycle row %s:%s omitted Process Map placement geometry", item.ObjectKind, item.ObjectID)
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
	if _, err := repo.PutProcessMapPlacement(context.Background(), processMapTestPlacementWithSize(
		companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, fallbackFolder.FolderID, nil, -20, -20, 100, 100,
	)); err != nil {
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
	if _, err := repo.PutProcessMapPlacement(context.Background(), processMapTestPlacementInput(
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

func TestMemoryRecycleFolderRestoreDoesNotReclaimRecreatedCleanupChild(t *testing.T) {
	repo, companyID, admin, _, _ := newV2PolicyTestRepo(t)
	folder, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Map perimeter")
	if err != nil {
		t.Fatal(err)
	}
	process, err := repo.CreateLogicGate(companyID, "Surviving Process")
	if err != nil {
		t.Fatal(err)
	}
	parentID := folder.FolderID
	if _, err := repo.PutProcessMapPlacement(context.Background(), processMapTestPlacementWithSize(
		companyID, admin.UserID, domain.ProcessMapResourceTypeFolder, folder.FolderID, nil, 0, 0, 80, 60,
	)); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.PutProcessMapPlacement(context.Background(), processMapTestPlacementWithSize(
		companyID, admin.UserID, domain.ProcessMapResourceTypeProcess, process.LogicGateID, &parentID, 11, 13, 9, 6,
	)); err != nil {
		t.Fatal(err)
	}

	placementKey := processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeProcess, process.LogicGateID)
	originalToken := repo.processMapPlacements[placementKey].PlacementIncarnationToken
	if originalToken == "" {
		t.Fatal("new memory placement has no incarnation token")
	}
	if _, err := repo.DeleteCompanyExplorerTargets(companyID, []CompanyExplorerDeleteTargetInput{{Kind: "folder", ID: folder.FolderID}}, admin.UserID); err != nil {
		t.Fatal(err)
	}
	cleanupPlacement := repo.processMapPlacements[placementKey]
	if cleanupPlacement.PlacementIncarnationToken != originalToken || cleanupPlacement.MapParentFolderID != nil {
		t.Fatalf("Folder cleanup placement = %+v, want unchanged incarnation at company root", cleanupPlacement)
	}

	items, err := repo.ListRecycleBinItems(companyID, admin.UserID)
	if err != nil || len(items) != 1 {
		t.Fatalf("Folder recycle items = %+v, err=%v", items, err)
	}
	folderRecycleID := items[0].RecycleBinItemID
	if _, err := repo.DeleteCompanyExplorerTargets(companyID, []CompanyExplorerDeleteTargetInput{{Kind: EntityTypeLogicGate, ID: process.LogicGateID}}, admin.UserID); err != nil {
		t.Fatal(err)
	}
	items, err = repo.ListRecycleBinItems(companyID, admin.UserID)
	if err != nil {
		t.Fatal(err)
	}
	processRecycleID := ""
	for _, item := range items {
		if item.ObjectID == process.LogicGateID {
			processRecycleID = item.RecycleBinItemID
		}
	}
	if processRecycleID == "" {
		t.Fatal("Process recycle item missing")
	}
	if _, err := repo.RestoreRecycleBinItems(companyID, admin.UserID, []string{processRecycleID}); err != nil {
		t.Fatal(err)
	}
	recreated := repo.processMapPlacements[placementKey]
	if recreated.PlacementIncarnationToken == "" || recreated.PlacementIncarnationToken == originalToken {
		t.Fatalf("restored placement incarnation token = %q, want a new token", recreated.PlacementIncarnationToken)
	}
	if recreated.MapParentFolderID != nil || recreated.Revision != cleanupPlacement.Revision ||
		!recreated.CreatedTimestamp.Equal(cleanupPlacement.CreatedTimestamp) ||
		recreated.GridX != cleanupPlacement.GridX || recreated.GridY != cleanupPlacement.GridY ||
		recreated.GridWidth != cleanupPlacement.GridWidth || recreated.GridHeight != cleanupPlacement.GridHeight {
		t.Fatalf("restored placement = %+v, want the same cleanup claim fields except incarnation", recreated)
	}

	if _, err := repo.RestoreRecycleBinItems(companyID, admin.UserID, []string{folderRecycleID}); err != nil {
		t.Fatal(err)
	}
	afterFolderRestore := repo.processMapPlacements[placementKey]
	if afterFolderRestore.MapParentFolderID != nil {
		t.Fatalf("Folder restore reclaimed recreated child: %+v", afterFolderRestore)
	}
}

func TestMemoryRecycleFolderRestoreReclaimsOnlyUnchangedCleanupReparents(t *testing.T) {
	const (
		companyID        = "89898989-8989-4989-8989-898989898981"
		folderID         = "89898989-8989-4989-8989-898989898982"
		fallbackFolderID = "89898989-8989-4989-8989-898989898983"
		processID        = "89898989-8989-4989-8989-898989898984"
	)
	created := time.Date(2026, time.August, 25, 12, 0, 0, 0, time.UTC)
	childKey := processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeProcess, processID)
	parentKey := processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, folderID)
	fallbackKey := processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, fallbackFolderID)

	tests := []struct {
		name        string
		mutate      func(*memoryRecycleBinSnapshot)
		wantReclaim bool
	}{
		{name: "unchanged surviving child", wantReclaim: true},
		{name: "intervening move", mutate: func(snapshot *memoryRecycleBinSnapshot) {
			placement := snapshot.processMapPlacements[childKey]
			placement.GridX++
			snapshot.processMapPlacements[childKey] = placement
		}},
		{name: "intervening resize", mutate: func(snapshot *memoryRecycleBinSnapshot) {
			placement := snapshot.processMapPlacements[childKey]
			placement.GridWidth++
			snapshot.processMapPlacements[childKey] = placement
		}},
		{name: "intervening reparent", mutate: func(snapshot *memoryRecycleBinSnapshot) {
			placement := snapshot.processMapPlacements[childKey]
			fallbackID := fallbackFolderID
			placement.MapParentFolderID = &fallbackID
			snapshot.processMapPlacements[childKey] = placement
		}},
		{name: "intervening removal", mutate: func(snapshot *memoryRecycleBinSnapshot) {
			delete(snapshot.processMapPlacements, childKey)
		}},
		{name: "intervening recreation", mutate: func(snapshot *memoryRecycleBinSnapshot) {
			placement := snapshot.processMapPlacements[childKey]
			placement.PlacementIncarnationToken = "recreated-incarnation"
			snapshot.processMapPlacements[childKey] = placement
		}},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			repo := NewMemoryRepo()
			repo.folders[key(companyID, folderID)] = domain.CompanyExplorerFolder{CompanyID: companyID, FolderID: folderID}
			repo.folders[key(companyID, fallbackFolderID)] = domain.CompanyExplorerFolder{CompanyID: companyID, FolderID: fallbackFolderID}
			repo.logicGates[key(companyID, processID)] = domain.LogicGate{CompanyID: companyID, LogicGateID: processID}
			destination := repo.snapshotRecycleStateLocked()
			destination.processMapPlacements[childKey] = domain.ProcessMapPlacement{
				CompanyID: companyID, ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: processID,
				PlacementIncarnationToken: "cleanup-incarnation",
				GridX:                     11, GridY: 13, GridWidth: 9, GridHeight: 6, Revision: 8,
				CreatedTimestamp: created, UpdatedTimestamp: created,
			}
			destination.processMapPlacements[fallbackKey] = domain.ProcessMapPlacement{
				CompanyID: companyID, ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: fallbackFolderID,
				GridX: -10, GridY: -10, GridWidth: 80, GridHeight: 60, Revision: 1,
				CreatedTimestamp: created, UpdatedTimestamp: created,
			}
			if testCase.mutate != nil {
				testCase.mutate(&destination)
			}

			delta := memoryRecycleBinSnapshot{
				processMapPlacements: map[string]domain.ProcessMapPlacement{
					parentKey: {
						CompanyID: companyID, ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: folderID,
						GridX: 0, GridY: 0, GridWidth: 80, GridHeight: 60, Revision: 2,
						CreatedTimestamp: created, UpdatedTimestamp: created,
					},
				},
				processMapCleanupChildren: map[string]memoryProcessMapCleanupChild{
					childKey: {
						CompanyID: companyID, ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: processID,
						PlacementIncarnationToken: "cleanup-incarnation",
						OriginalParentFolderID:    folderID, CleanupParentFolderID: nil, CleanupRevision: 8,
						CreatedTimestamp: created, GridX: 11, GridY: 13, GridWidth: 9, GridHeight: 6,
					},
				},
			}
			mergeMemoryRecycleSnapshot(&destination, delta)

			placement, exists := destination.processMapPlacements[childKey]
			if testCase.wantReclaim {
				if !exists || placement.MapParentFolderID == nil || *placement.MapParentFolderID != folderID || placement.Revision != 9 {
					t.Fatalf("unchanged cleanup child = %+v, exists=%v; want restored parent and fenced revision", placement, exists)
				}
				return
			}
			if exists && placement.MapParentFolderID != nil && *placement.MapParentFolderID == folderID {
				t.Fatalf("intervening child change was overwritten by Folder restore: %+v", placement)
			}
		})
	}
}
