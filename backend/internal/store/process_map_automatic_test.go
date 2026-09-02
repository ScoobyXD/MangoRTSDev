package store

import (
	"context"
	"errors"
	"fmt"
	"math"
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

func requireAutomaticProcessMapContained(t *testing.T, parent, child domain.ProcessMapPlacement) {
	t.Helper()
	padding := max(1, min(parent.GridWidth, parent.GridHeight)/32)
	header := max(1, parent.GridHeight/8)
	if child.GridX < parent.GridX+padding || child.GridY < parent.GridY+header ||
		child.GridX+child.GridWidth > parent.GridX+parent.GridWidth-padding ||
		child.GridY+child.GridHeight > parent.GridY+parent.GridHeight-padding || child.GridWidth <= 0 || child.GridHeight <= 0 {
		t.Fatalf("child is outside parent usable interior: parent=%+v child=%+v", parent, child)
	}
}

func automaticProcessMapTestAppend(t *testing.T, input []domain.ProcessMapPlacement, resourceType, resourceID, parentID string) []domain.ProcessMapPlacement {
	t.Helper()
	plan, err := planAutomaticProcessMapPlacement("company-layout", resourceType, resourceID, parentID, input)
	if err != nil {
		t.Fatalf("place %s/%s: %v", resourceType, resourceID, err)
	}
	result := automaticProcessMapTestResult(input, plan)
	output := make([]domain.ProcessMapPlacement, 0, len(result))
	for _, placement := range result {
		output = append(output, placement)
	}
	return output
}

func TestProcessMapRowsUseSixActualSizedSiblings(t *testing.T) {
	const startX, startY, gap = -100, -200, 3
	sizes := [][2]int{{32, 24}, {70, 18}, {24, 55}, {45, 28}, {28, 42}, {62, 20}, {36, 30}, {26, 48}, {50, 25}, {17, 19}, {40, 24}, {28, 16}}
	var placements []domain.ProcessMapPlacement
	for index, size := range sizes {
		x, y := processMapRowPosition(placements, startX, startY, gap, size[0], size[1])
		placement := domain.ProcessMapPlacement{
			ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: fmt.Sprintf("item-%02d", index),
			GridX: x, GridY: y, GridWidth: size[0], GridHeight: size[1],
		}
		wantY := startY
		if index >= 6 {
			wantY += 55 + gap
		}
		wantX := startX
		if index%6 != 0 {
			previous := placements[index-1]
			wantX = previous.GridX + previous.GridWidth + gap
		}
		if x != wantX || y != wantY {
			t.Fatalf("item %d position = (%d,%d), want (%d,%d)", index+1, x, y, wantX, wantY)
		}
		for _, existing := range placements {
			if processMapPlacementsConflictWithGap(placement, existing, gap) {
				t.Fatalf("mixed-size siblings overlap: new=%+v existing=%+v", placement, existing)
			}
		}
		placements = append(placements, placement)
	}
}

func TestAutomaticProcessMapTwelveRootsFormTwoRowsOfSix(t *testing.T) {
	var placements []domain.ProcessMapPlacement
	for index := 0; index < 12; index++ {
		placements = automaticProcessMapTestAppend(t, placements, domain.ProcessMapResourceTypeFolder, fmt.Sprintf("root-%02d", index), "")
	}
	rows := map[int]int{}
	for _, placement := range placements {
		if placement.GridWidth != 234881024 || placement.GridHeight != 134217728 {
			t.Fatalf("unexpected root size: %+v", placement)
		}
		if !validProcessMapGeometry(placement.GridX, placement.GridY, placement.GridWidth, placement.GridHeight) {
			t.Fatalf("root is outside integer world bounds: %+v", placement)
		}
		rows[placement.GridY]++
	}
	if len(rows) != 2 || rows[0] != 6 || rows[134217728+29360128] != 6 {
		t.Fatalf("twelve roots should form two rows of six, got rows=%v", rows)
	}
	for index, placement := range placements {
		for _, other := range placements[index+1:] {
			if processMapPlacementsConflictWithGap(placement, other, 29360128) {
				t.Fatalf("roots overlap or lose gap: %+v %+v", placement, other)
			}
		}
	}
}

func TestAutomaticProcessMapCrowdedRootsRemainInsideIntegerWorld(t *testing.T) {
	var placements []domain.ProcessMapPlacement
	for index := 0; index < 84; index++ {
		placements = automaticProcessMapTestAppend(t, placements, domain.ProcessMapResourceTypeFolder, fmt.Sprintf("root-%03d", index), "")
		if index != 41 && index != 83 {
			continue
		}
		rows := map[int]int{}
		for _, placement := range placements {
			if !validProcessMapGeometry(placement.GridX, placement.GridY, placement.GridWidth, placement.GridHeight) {
				t.Fatalf("root %d is outside integer world: %+v", index+1, placement)
			}
			rows[placement.GridY]++
		}
		if len(rows) != (index+1)/6 {
			t.Fatalf("%d roots should have %d rows, got %v", index+1, (index+1)/6, rows)
		}
		for y, count := range rows {
			if count != 6 {
				t.Fatalf("root row at %d contains %d items, want six", y, count)
			}
		}
		for i, placement := range placements {
			for _, other := range placements[i+1:] {
				if processMapPlacementsConflictWithGap(placement, other, 0) {
					t.Fatalf("crowded roots overlap: %+v %+v", placement, other)
				}
			}
		}
	}
}

func TestAutomaticProcessMapNestedRowsMixFoldersAndGatesWithoutChangingParents(t *testing.T) {
	placements := automaticProcessMapTestAppend(t, nil, domain.ProcessMapResourceTypeFolder, "root", "")
	placements = automaticProcessMapTestAppend(t, placements, domain.ProcessMapResourceTypeFolder, "nested", "root")
	before := automaticProcessMapTestResult(placements, processMapAutomaticPlacementPlan{})
	for index := 0; index < 8; index++ {
		resourceType := domain.ProcessMapResourceTypeFolder
		if index%2 != 0 {
			resourceType = domain.ProcessMapResourceTypeProcess
		}
		placements = automaticProcessMapTestAppend(t, placements, resourceType, fmt.Sprintf("child-%02d", index), "nested")
	}
	result := automaticProcessMapTestResult(placements, processMapAutomaticPlacementPlan{})
	rootKey := processMapAutomaticPlacementKey(domain.ProcessMapResourceTypeFolder, "root")
	parentKey := processMapAutomaticPlacementKey(domain.ProcessMapResourceTypeFolder, "nested")
	if !reflect.DeepEqual(result[rootKey], before[rootKey]) || !reflect.DeepEqual(result[parentKey], before[parentKey]) {
		t.Fatal("children changed an ancestor's saved geometry")
	}
	parent := result[parentKey]
	rows := map[int]int{}
	for _, placement := range placements {
		if placement.MapParentFolderID == nil || *placement.MapParentFolderID != "nested" {
			continue
		}
		requireAutomaticProcessMapContained(t, parent, placement)
		if placement.GridWidth != parent.GridWidth/8 || placement.GridHeight != parent.GridHeight/8 {
			t.Fatalf("child lacks proportional dimensions: parent=%+v child=%+v", parent, placement)
		}
		rows[placement.GridY]++
	}
	if len(rows) != 2 {
		t.Fatalf("eight children should form two rows: %v", rows)
	}
	rowCounts := []int{}
	for _, count := range rows {
		rowCounts = append(rowCounts, count)
	}
	if !((rowCounts[0] == 6 && rowCounts[1] == 2) || (rowCounts[0] == 2 && rowCounts[1] == 6)) {
		t.Fatalf("eight children row counts = %v, want 6 and 2", rowCounts)
	}
}

func TestAutomaticProcessMapDeletionDoesNotAddSeventhItemToSavedRow(t *testing.T) {
	var placements []domain.ProcessMapPlacement
	for index := 0; index < 12; index++ {
		placements = automaticProcessMapTestAppend(t, placements, domain.ProcessMapResourceTypeFolder, fmt.Sprintf("root-%02d", index), "")
	}
	remaining := make([]domain.ProcessMapPlacement, 0, 11)
	for _, placement := range placements {
		if placement.ResourceID != "root-00" {
			remaining = append(remaining, placement)
		}
	}
	placements = automaticProcessMapTestAppend(t, remaining, domain.ProcessMapResourceTypeFolder, "new-root", "")
	rows := map[int]int{}
	for _, placement := range placements {
		rows[placement.GridY]++
	}
	if len(rows) != 3 || rows[0] != 5 || rows[163577856] != 6 || rows[327155712] != 1 {
		t.Fatalf("deleting an earlier item must preserve saved rows and start a new row: %v", rows)
	}
}

func TestAutomaticProcessMapSameParentPreservesSavedGeometry(t *testing.T) {
	parent := domain.ProcessMapPlacement{CompanyID: "company-layout", ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: "parent", GridX: -400, GridY: -200, GridWidth: 400, GridHeight: 200, Revision: 7}
	child := domain.ProcessMapPlacement{CompanyID: "company-layout", ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: "manual", MapParentFolderID: automaticProcessMapTestParent("parent"), GridX: -220, GridY: -100, GridWidth: 63, GridHeight: 27, Revision: 13}
	plan, err := planAutomaticProcessMapPlacement("company-layout", child.ResourceType, child.ResourceID, "parent", []domain.ProcessMapPlacement{parent, child})
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Placements) != 0 || len(plan.Transforms) != 0 {
		t.Fatalf("same-parent sync rewrote manual placement: %+v", plan)
	}
}

func TestAutomaticProcessMapCrowdedChildrenShrinkInsideFixedParent(t *testing.T) {
	parent := domain.ProcessMapPlacement{CompanyID: "company-layout", ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: "parent", GridX: -2000, GridY: -1000, GridWidth: 1792, GridHeight: 1024, Revision: 5}
	placements := []domain.ProcessMapPlacement{parent}
	for index := 0; index < 48; index++ {
		placements = automaticProcessMapTestAppend(t, placements, domain.ProcessMapResourceTypeProcess, fmt.Sprintf("gate-%02d", index), "parent")
	}
	rows := map[int]int{}
	var children []domain.ProcessMapPlacement
	for _, placement := range placements {
		if placement.ResourceID == "parent" {
			if !reflect.DeepEqual(placement, parent) {
				t.Fatalf("crowding expanded parent: before=%+v after=%+v", parent, placement)
			}
			continue
		}
		requireAutomaticProcessMapContained(t, parent, placement)
		rows[placement.GridY]++
		for _, existing := range children {
			if processMapPlacementsConflictWithGap(placement, existing, 0) {
				t.Fatalf("crowded children overlap: %+v %+v", placement, existing)
			}
		}
		children = append(children, placement)
	}
	if len(rows) != 8 {
		t.Fatalf("48 children should have eight rows: %v", rows)
	}
	for y, count := range rows {
		if count != 6 {
			t.Fatalf("row at %d has %d children, want six", y, count)
		}
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
	targetPlacement.GridWidth = 1
	targetPlacement.GridHeight = 1
	targetPlacement.GridY = 0
	repo.processMapPlacements[targetKey] = targetPlacement
	before := repo.snapshotProcessMapMutationLocked()

	_, err = repo.MoveCompanyExplorerFolder(companyID, moving.FolderID, &target.FolderID, 0, admin.UserID, admin.UserID)
	if !errors.Is(err, ErrProcessMapContainment) {
		t.Fatalf("move error = %v, want %v", err, ErrProcessMapContainment)
	}
	after := repo.snapshotProcessMapMutationLocked()
	if !reflect.DeepEqual(after, before) {
		t.Fatal("failed automatic placement did not restore Explorer, map, event, version, and outbox state")
	}
}

func TestMemoryExplorerFolderReparentScalesSubtreeAndOnlyInternalTraces(t *testing.T) {
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
	destination, err := repo.CreateCompanyExplorerFolder(companyID, rootB.FolderID, "logic_gate", "Deeper destination")
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
	sourceFolder := repo.processMapPlacements[processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, moving.FolderID)]
	internalID := createTrace(insideA.LogicGateID, insideB.LogicGateID, []domain.ProcessMapRoutePoint{{X: sourceFolder.GridX + 128, Y: sourceFolder.GridY + 128}, {X: sourceFolder.GridX + 256, Y: sourceFolder.GridY + 128}})
	externalID := createTrace(insideA.LogicGateID, outside.LogicGateID, []domain.ProcessMapRoutePoint{{X: 30, Y: 20}, {X: 45, Y: 20}})
	before := repo.snapshotProcessMapMutationLocked()

	if _, err := repo.MoveCompanyExplorerFolder(companyID, moving.FolderID, &destination.FolderID, 0, admin.UserID, admin.UserID); err != nil {
		t.Fatal(err)
	}
	movingKey := processMapPlacementMemoryKey(companyID, domain.ProcessMapResourceTypeFolder, moving.FolderID)
	afterMoving := repo.processMapPlacements[movingKey]
	beforeMoving := before.placements[movingKey]
	if afterMoving.GridWidth*8 != beforeMoving.GridWidth || afterMoving.GridHeight*8 != beforeMoving.GridHeight {
		t.Fatalf("reparent should scale moving subtree by 1/8: before=%+v after=%+v", beforeMoving, afterMoving)
	}
	scaleX := func(x int) int { return afterMoving.GridX + int(math.Floor(float64(x-beforeMoving.GridX)/8+0.5)) }
	scaleY := func(y int) int { return afterMoving.GridY + int(math.Floor(float64(y-beforeMoving.GridY)/8+0.5)) }
	for _, ref := range []domain.ProcessMapResourceRef{
		{ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: moving.FolderID},
		{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: insideA.LogicGateID},
		{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: insideB.LogicGateID},
	} {
		placementKey := processMapPlacementMemoryKey(companyID, ref.ResourceType, ref.ResourceID)
		oldPlacement, newPlacement := before.placements[placementKey], repo.processMapPlacements[placementKey]
		if newPlacement.GridX != scaleX(oldPlacement.GridX) || newPlacement.GridY != scaleY(oldPlacement.GridY) ||
			newPlacement.GridWidth*8 != oldPlacement.GridWidth || newPlacement.GridHeight*8 != oldPlacement.GridHeight {
			t.Fatalf("member %s/%s did not scale with subtree: before=%+v after=%+v", ref.ResourceType, ref.ResourceID, oldPlacement, newPlacement)
		}
		if ref.ResourceType == domain.ProcessMapResourceTypeProcess {
			requireAutomaticProcessMapContained(t, afterMoving, newPlacement)
		}
	}
	internalKey := key(companyID, internalID)
	oldInternal, newInternal := before.traces[internalKey], repo.processMapTraces[internalKey]
	if newInternal.Revision != oldInternal.Revision+1 || len(newInternal.RoutePoints) != len(oldInternal.RoutePoints) {
		t.Fatalf("internal trace revision/points = %+v, before=%+v", newInternal, oldInternal)
	}
	for index, oldPoint := range oldInternal.RoutePoints {
		want := domain.ProcessMapRoutePoint{X: scaleX(oldPoint.X), Y: scaleY(oldPoint.Y)}
		if newInternal.RoutePoints[index] != want {
			t.Fatalf("internal point %d = %+v, want %+v", index, newInternal.RoutePoints[index], want)
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
