package store

import (
	"context"
	"errors"
	"fmt"
	"miraeopus/backend/internal/domain"
	"reflect"
	"testing"
)

func automaticProcessMapTestParent(parentID string) *string {
	if parentID == "" {
		return nil
	}
	value := parentID
	return &value
}

func automaticProcessMapTestResult(
	input []domain.ProcessMapPlacement,
	plan processMapAutomaticPlacementPlan,
) map[string]domain.ProcessMapPlacement {
	result := make(map[string]domain.ProcessMapPlacement, len(input)+1)
	for _, placement := range input {
		result[processMapAutomaticPlacementKey(placement.ResourceType, placement.ResourceID)] = processMapAutomaticClonePlacement(placement)
	}
	for _, placement := range plan.Placements {
		result[processMapAutomaticPlacementKey(placement.ResourceType, placement.ResourceID)] = processMapAutomaticClonePlacement(placement)
	}
	return result
}

func TestAutomaticProcessMapPlanKeepsNegativeMixedSectionsLeftOfOrigin(t *testing.T) {
	const companyID = "company-negative"
	parentID := "parent"
	input := []domain.ProcessMapPlacement{
		{CompanyID: companyID, ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: parentID, GridX: -100, GridY: -100, GridWidth: 100, GridHeight: 60},
		{CompanyID: companyID, ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: "folder", MapParentFolderID: automaticProcessMapTestParent(parentID), GridX: -96, GridY: -94, GridWidth: 24, GridHeight: 16},
		{CompanyID: companyID, ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: "existing-process", MapParentFolderID: automaticProcessMapTestParent(parentID), GridX: -68, GridY: -94, GridWidth: 14, GridHeight: 8},
	}
	first, err := planAutomaticProcessMapPlacement(companyID, domain.ProcessMapResourceTypeProcess, "new-process", parentID, input)
	if err != nil {
		t.Fatal(err)
	}
	second, err := planAutomaticProcessMapPlacement(companyID, domain.ProcessMapResourceTypeProcess, "new-process", parentID, input)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("negative-coordinate plan is not deterministic:\nfirst=%+v\nsecond=%+v", first, second)
	}
	result := automaticProcessMapTestResult(input, first)
	existing := result[processMapAutomaticPlacementKey(domain.ProcessMapResourceTypeProcess, "existing-process")]
	created := result[processMapAutomaticPlacementKey(domain.ProcessMapResourceTypeProcess, "new-process")]
	if existing.GridX != -68 {
		t.Fatalf("existing Process crossed the origin: %+v", existing)
	}
	if created.GridX >= 0 || created.GridY >= 0 {
		t.Fatalf("new Process ignored the valid negative section: %+v", created)
	}
	parent := result[processMapAutomaticPlacementKey(domain.ProcessMapResourceTypeFolder, parentID)]
	for _, child := range []domain.ProcessMapPlacement{result[processMapAutomaticPlacementKey(domain.ProcessMapResourceTypeFolder, "folder")], existing, created} {
		if !processMapBoundsContain(processMapPlacementBounds(parent), processMapPlacementBounds(child)) {
			t.Fatalf("parent %+v does not contain child %+v", parent, child)
		}
	}
}

func TestAutomaticProcessMapPlanKeepsRootFoldersLeftOfProcesses(t *testing.T) {
	tests := []struct {
		name          string
		input         []domain.ProcessMapPlacement
		targetType    string
		targetID      string
		wantNegativeX bool
	}{
		{
			name: "negative roots stay negative",
			input: []domain.ProcessMapPlacement{
				{CompanyID: "company-root-sections", ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: "folder", GridX: -100, GridY: 0, GridWidth: 24, GridHeight: 16},
				{CompanyID: "company-root-sections", ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: "existing-process", GridX: -68, GridY: 0, GridWidth: 14, GridHeight: 8},
			},
			targetType: domain.ProcessMapResourceTypeProcess, targetID: "new-process", wantNegativeX: true,
		},
		{
			name: "overlapping Process section shifts right",
			input: []domain.ProcessMapPlacement{
				{CompanyID: "company-root-sections", ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: "folder", GridX: 0, GridY: 0, GridWidth: 32, GridHeight: 24},
				{CompanyID: "company-root-sections", ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: "existing-process", GridX: 10, GridY: 0, GridWidth: 14, GridHeight: 8},
			},
			targetType: domain.ProcessMapResourceTypeFolder, targetID: "new-folder",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			plan, err := planAutomaticProcessMapPlacement("company-root-sections", test.targetType, test.targetID, "", test.input)
			if err != nil {
				t.Fatal(err)
			}
			result := automaticProcessMapTestResult(test.input, plan)
			folderRight := 0
			processLeft := 0
			hasFolder, hasProcess := false, false
			for _, placement := range result {
				switch placement.ResourceType {
				case domain.ProcessMapResourceTypeFolder:
					right := placement.GridX + placement.GridWidth
					if !hasFolder || right > folderRight {
						folderRight = right
					}
					hasFolder = true
				case domain.ProcessMapResourceTypeProcess:
					if !hasProcess || placement.GridX < processLeft {
						processLeft = placement.GridX
					}
					hasProcess = true
				}
			}
			if !hasFolder || !hasProcess || processLeft < folderRight+processMapAutomaticRootGap {
				t.Fatalf("root sections are not Folder-left / Process-right: Folder right=%d Process left=%d result=%+v", folderRight, processLeft, result)
			}
			created := result[processMapAutomaticPlacementKey(test.targetType, test.targetID)]
			if test.wantNegativeX && created.GridX >= 0 {
				t.Fatalf("valid negative Process root crossed the origin: %+v", created)
			}
		})
	}
}

func TestProcessMapSquareBiasedFrontierIsBoundedDeterministicAndCompact(t *testing.T) {
	build := func() []domain.ProcessMapPlacement {
		placements := make([]domain.ProcessMapPlacement, 0, 320)
		for index := 0; index < 320; index++ {
			width := 7 + index*17%53
			height := 5 + index*23%41
			candidates := processMapSquareBiasedCandidates(placements, 0, 0, 3, width, height)
			if len(candidates) > processMapAutomaticCandidateLimit {
				t.Fatalf("candidate count %d exceeds limit %d at item %d", len(candidates), processMapAutomaticCandidateLimit, index)
			}
			x, y, ok := processMapSquareBiasedPosition(placements, 0, 0, 3, width, height)
			if !ok {
				t.Fatalf("no position for irregular item %d", index)
			}
			placement := domain.ProcessMapPlacement{
				ResourceType: domain.ProcessMapResourceTypeFolder,
				ResourceID:   fmt.Sprintf("irregular-%03d", index),
				GridX:        x,
				GridY:        y,
				GridWidth:    width,
				GridHeight:   height,
			}
			for _, obstacle := range placements {
				if processMapPlacementsConflictWithGap(placement, obstacle, 3) {
					t.Fatalf("item %d overlaps: new=%+v obstacle=%+v", index, placement, obstacle)
				}
			}
			placements = append(placements, placement)
		}
		return placements
	}

	first, second := build(), build()
	if !reflect.DeepEqual(first, second) {
		t.Fatal("bounded irregular placement is not deterministic")
	}
	maxX, maxY := 0, 0
	xCoordinates, yCoordinates := map[int]bool{}, map[int]bool{}
	for _, placement := range first {
		maxX = max(maxX, placement.GridX+placement.GridWidth)
		maxY = max(maxY, placement.GridY+placement.GridHeight)
		xCoordinates[placement.GridX] = true
		yCoordinates[placement.GridY] = true
	}
	if len(xCoordinates) < 8 || len(yCoordinates) < 8 {
		t.Fatalf("large irregular layout collapsed into a tower: x=%d y=%d", len(xCoordinates), len(yCoordinates))
	}
	if max(maxX, maxY) > 3*min(maxX, maxY) {
		t.Fatalf("large irregular footprint is not meaningfully square-biased: width=%d height=%d", maxX, maxY)
	}
}

func TestAutomaticProcessMapPlanRejectsAncestorCycle(t *testing.T) {
	const companyID = "company-cycle"
	input := []domain.ProcessMapPlacement{
		{CompanyID: companyID, ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: "a", MapParentFolderID: automaticProcessMapTestParent("b"), GridX: 0, GridY: 0, GridWidth: 100, GridHeight: 100},
		{CompanyID: companyID, ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: "b", MapParentFolderID: automaticProcessMapTestParent("a"), GridX: 2, GridY: 6, GridWidth: 80, GridHeight: 80},
	}
	_, err := planAutomaticProcessMapPlacement(companyID, domain.ProcessMapResourceTypeProcess, "process", "a", input)
	if !errors.Is(err, ErrProcessMapCycle) {
		t.Fatalf("cycle error = %v, want %v", err, ErrProcessMapCycle)
	}
}

func TestMemoryExplorerAutomaticPlacementFailureRollsBackWholeCommand(t *testing.T) {
	repo, companyID, admin, _, _ := newV2PolicyTestRepo(t)
	moving, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Moving")
	if err != nil {
		t.Fatal(err)
	}
	target, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Target")
	if err != nil {
		t.Fatal(err)
	}
	targetKey := processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, target.FolderID)
	targetPlacement := repo.processMapPlacements[targetKey]
	targetPlacement.GridX = ProcessMapMaxCoordinate - targetPlacement.GridWidth
	targetPlacement.GridY = 0
	repo.processMapPlacements[targetKey] = targetPlacement
	before := repo.snapshotProcessMapMutationLocked()

	_, err = repo.MoveCompanyExplorerFolder(companyID, moving.FolderID, &target.FolderID, 0, admin.UserID, admin.UserID)
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("move error = %v, want %v", err, ErrInvalid)
	}
	after := repo.snapshotProcessMapMutationLocked()
	if !reflect.DeepEqual(after, before) {
		t.Fatal("failed automatic placement did not restore Explorer, map, event, version, and outbox state")
	}
}

func TestMemoryExplorerFolderReparentTranslatesOnlyInternalTraces(t *testing.T) {
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
	moving, err := repo.CreateCompanyExplorerFolder(companyID, rootA.FolderID, "logic_gate", "Moving")
	if err != nil {
		t.Fatal(err)
	}
	insideA, _ := repo.CreateLogicGate(companyID, "Inside A")
	insideB, _ := repo.CreateLogicGate(companyID, "Inside B")
	outside, _ := repo.CreateLogicGate(companyID, "Outside")
	for index, assignment := range []struct {
		folderID string
		process  domain.LogicGate
	}{{moving.FolderID, insideA}, {moving.FolderID, insideB}, {rootA.FolderID, outside}} {
		if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, assignment.folderID, EntityTypeLogicGate, assignment.process.LogicGateID, index*1000); err != nil {
			t.Fatal(err)
		}
	}
	createTrace := func(sourceID, targetID string, points []domain.ProcessMapRoutePoint) string {
		t.Helper()
		created, err := repo.CreateResourceOperationalRelationship(ctx, ResourceOperationalRelationshipCreateInput{
			CompanyID:   companyID,
			Source:      processMapTestRef(domain.ProcessMapResourceTypeProcess, sourceID),
			Target:      processMapTestRef(domain.ProcessMapResourceTypeProcess, targetID),
			Trace:       &ProcessMapTraceInput{RoutePoints: points},
			ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
		})
		if err != nil || created.Relationship == nil {
			t.Fatalf("create relationship = %+v, err=%v", created, err)
		}
		return created.Relationship.ResourceOperationalRelationshipID
	}
	internalID := createTrace(insideA.LogicGateID, insideB.LogicGateID, []domain.ProcessMapRoutePoint{{X: 12, Y: 12}, {X: 20, Y: 12}})
	externalID := createTrace(insideA.LogicGateID, outside.LogicGateID, []domain.ProcessMapRoutePoint{{X: 30, Y: 20}, {X: 45, Y: 20}})
	before := repo.snapshotProcessMapMutationLocked()

	if _, err := repo.MoveCompanyExplorerFolder(companyID, moving.FolderID, &rootB.FolderID, 0, admin.UserID, admin.UserID); err != nil {
		t.Fatal(err)
	}
	movingKey := processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, moving.FolderID)
	afterMoving := repo.processMapPlacements[movingKey]
	beforeMoving := before.placements[movingKey]
	deltaX, deltaY := afterMoving.GridX-beforeMoving.GridX, afterMoving.GridY-beforeMoving.GridY
	if deltaX == 0 && deltaY == 0 {
		t.Fatal("reparent fixture did not move the Folder")
	}
	for _, ref := range []domain.ProcessMapResourceRef{
		{ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: moving.FolderID},
		{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: insideA.LogicGateID},
		{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: insideB.LogicGateID},
	} {
		placementKey := processMapPlacementMemoryKey(companyID, ref.ResourceType, ref.ResourceID)
		oldPlacement, newPlacement := before.placements[placementKey], repo.processMapPlacements[placementKey]
		if newPlacement.GridX-oldPlacement.GridX != deltaX || newPlacement.GridY-oldPlacement.GridY != deltaY {
			t.Fatalf("member %s/%s delta = (%d,%d), want (%d,%d)", ref.ResourceType, ref.ResourceID, newPlacement.GridX-oldPlacement.GridX, newPlacement.GridY-oldPlacement.GridY, deltaX, deltaY)
		}
	}
	internalKey := key(companyID, internalID)
	oldInternal, newInternal := before.traces[internalKey], repo.processMapTraces[internalKey]
	if newInternal.Revision != oldInternal.Revision+1 || len(newInternal.RoutePoints) != len(oldInternal.RoutePoints) {
		t.Fatalf("internal trace revision/points = %+v, before=%+v", newInternal, oldInternal)
	}
	for index := range oldInternal.RoutePoints {
		if newInternal.RoutePoints[index].X-oldInternal.RoutePoints[index].X != deltaX ||
			newInternal.RoutePoints[index].Y-oldInternal.RoutePoints[index].Y != deltaY {
			t.Fatalf("internal point %d = %+v, before=%+v delta=(%d,%d)", index, newInternal.RoutePoints[index], oldInternal.RoutePoints[index], deltaX, deltaY)
		}
	}
	externalKey := key(companyID, externalID)
	if !reflect.DeepEqual(repo.processMapTraces[externalKey], before.traces[externalKey]) {
		t.Fatalf("external trace changed: before=%+v after=%+v", before.traces[externalKey], repo.processMapTraces[externalKey])
	}
	if !reflect.DeepEqual(repo.resourceOperationalRelationships, before.relationships) {
		t.Fatal("Explorer reparent changed operational relationships")
	}
}

func TestProcessMapPathSimplificationPreservesHorizontalAndVerticalReversals(t *testing.T) {
	tests := []struct {
		name   string
		points []domain.ProcessMapPathPoint
		want   []domain.ProcessMapPathPoint
	}{
		{name: "horizontal monotonic", points: []domain.ProcessMapPathPoint{{X: 0, Y: 0}, {X: 10, Y: 0}, {X: 20, Y: 0}}, want: []domain.ProcessMapPathPoint{{X: 0, Y: 0}, {X: 20, Y: 0}}},
		{name: "horizontal reversal", points: []domain.ProcessMapPathPoint{{X: 0, Y: 0}, {X: 10, Y: 0}, {X: 5, Y: 0}}, want: []domain.ProcessMapPathPoint{{X: 0, Y: 0}, {X: 10, Y: 0}, {X: 5, Y: 0}}},
		{name: "vertical monotonic", points: []domain.ProcessMapPathPoint{{X: 2, Y: -5}, {X: 2, Y: 5}, {X: 2, Y: 15}}, want: []domain.ProcessMapPathPoint{{X: 2, Y: -5}, {X: 2, Y: 15}}},
		{name: "vertical reversal", points: []domain.ProcessMapPathPoint{{X: 2, Y: -5}, {X: 2, Y: 5}, {X: 2, Y: 0}}, want: []domain.ProcessMapPathPoint{{X: 2, Y: -5}, {X: 2, Y: 5}, {X: 2, Y: 0}}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			path := []domain.ProcessMapPathPoint{}
			for _, point := range test.points {
				path = processMapAppendSimplifiedPathPoint(path, point)
			}
			if !reflect.DeepEqual(path, test.want) {
				t.Fatalf("path = %+v, want %+v", path, test.want)
			}
		})
	}
}
