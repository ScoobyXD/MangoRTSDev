package store

import (
	"errors"
	"fmt"
	"miraeopus/backend/internal/domain"
	"reflect"
	"testing"
	"time"
)

func processMapResetTestIndex(placements []domain.ProcessMapPlacement) map[string]domain.ProcessMapPlacement {
	result := make(map[string]domain.ProcessMapPlacement, len(placements))
	for _, placement := range placements {
		result[processMapAutomaticPlacementKey(placement.ResourceType, placement.ResourceID)] = placement
	}
	return result
}

func TestProcessMapResetPreservesExplorerSiblingOrderAndWrapsSeventh(t *testing.T) {
	const companyID = "company-reset"
	var resources []processMapResetResource
	// Global Explorer ordering can put children before their parents and can mix
	// folders with gates. Only the relative order within each group determines rows.
	for index := 0; index < 7; index++ {
		childType := domain.ProcessMapResourceTypeFolder
		if index%2 == 0 {
			childType = domain.ProcessMapResourceTypeProcess
		}
		resources = append(resources,
			processMapResetResource{ResourceType: childType, ResourceID: fmt.Sprintf("child-%d", 6-index), ParentID: "root-6"},
			processMapResetResource{ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: fmt.Sprintf("root-%d", 6-index)},
		)
	}
	before := append([]processMapResetResource(nil), resources...)
	placements, err := planProcessMapReset(companyID, resources)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(resources, before) {
		t.Fatal("reset reordered the canonical input")
	}
	if len(placements) != len(resources) {
		t.Fatalf("placements = %d, want %d", len(placements), len(resources))
	}
	byKey := processMapResetTestIndex(placements)
	for _, parentID := range []string{"", "root-6"} {
		var siblings []domain.ProcessMapPlacement
		for _, resource := range resources {
			if resource.ParentID == parentID {
				siblings = append(siblings, byKey[processMapAutomaticPlacementKey(resource.ResourceType, resource.ResourceID)])
			}
		}
		for index, sibling := range siblings {
			if index < 6 {
				if sibling.GridY != siblings[0].GridY || index > 0 && sibling.GridX <= siblings[index-1].GridX {
					t.Fatalf("first row lost Explorer order: %+v", siblings)
				}
			} else if sibling.GridY <= siblings[0].GridY || sibling.GridX != siblings[0].GridX {
				t.Fatalf("seventh sibling did not wrap: %+v", siblings)
			}
		}
	}
	root := byKey[processMapAutomaticPlacementKey(domain.ProcessMapResourceTypeFolder, "root-6")]
	if root.GridWidth != 234881024 || root.GridHeight != 134217728 {
		t.Fatalf("fresh root does not use the default geometry: %+v", root)
	}
	for index, placement := range placements {
		if index < 7 && processMapAutomaticParentID(placement) != "" {
			t.Fatal("reset must complete roots before placing descendants")
		}
		if processMapAutomaticParentID(placement) == "root-6" {
			requireAutomaticProcessMapContained(t, root, placement)
			if placement.GridWidth != root.GridWidth/8 || placement.GridHeight != root.GridHeight/8 {
				t.Fatalf("fresh child has unexpected geometry: %+v", placement)
			}
		}
	}
}

func TestProcessMapResetEightFolderLevelsLeaveFourteenByEightGates(t *testing.T) {
	var resources []processMapResetResource
	for index := 0; index < 6; index++ {
		resources = append(resources, processMapResetResource{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: fmt.Sprintf("gate-%d", index), ParentID: "folder-8"})
	}
	for level := 8; level >= 1; level-- {
		parentID := ""
		if level > 1 {
			parentID = fmt.Sprintf("folder-%d", level-1)
		}
		resources = append(resources, processMapResetResource{ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: fmt.Sprintf("folder-%d", level), ParentID: parentID})
	}
	placements, err := planProcessMapReset("company-reset", resources)
	if err != nil {
		t.Fatal(err)
	}
	byKey := processMapResetTestIndex(placements)
	width, height := 234881024, 134217728
	for level := 1; level <= 8; level++ {
		folder := byKey[processMapAutomaticPlacementKey(domain.ProcessMapResourceTypeFolder, fmt.Sprintf("folder-%d", level))]
		if folder.GridWidth != width || folder.GridHeight != height {
			t.Fatalf("folder level %d size = %dx%d, want %dx%d", level, folder.GridWidth, folder.GridHeight, width, height)
		}
		if level > 1 {
			parent := byKey[processMapAutomaticPlacementKey(domain.ProcessMapResourceTypeFolder, fmt.Sprintf("folder-%d", level-1))]
			requireAutomaticProcessMapContained(t, parent, folder)
		}
		width, height = width/8, height/8
	}
	parent := byKey[processMapAutomaticPlacementKey(domain.ProcessMapResourceTypeFolder, "folder-8")]
	for index := 0; index < 6; index++ {
		gate := byKey[processMapAutomaticPlacementKey(domain.ProcessMapResourceTypeProcess, fmt.Sprintf("gate-%d", index))]
		if gate.GridWidth != 14 || gate.GridHeight != 8 {
			t.Fatalf("deep gate size = %dx%d, want 14x8", gate.GridWidth, gate.GridHeight)
		}
		requireAutomaticProcessMapContained(t, parent, gate)
	}
}

func TestProcessMapResetCrowdedGroupsFitBeforeDescendantsAndAreDeterministic(t *testing.T) {
	resources := []processMapResetResource{{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: "deep-gate", ParentID: "child-00"}}
	for index := 0; index < 48; index++ {
		resources = append(resources, processMapResetResource{ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: fmt.Sprintf("child-%02d", index), ParentID: "root-00"})
	}
	for index := 0; index < 84; index++ {
		resources = append(resources, processMapResetResource{ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: fmt.Sprintf("root-%02d", index)})
	}
	first, err := planProcessMapReset("company-reset", resources)
	if err != nil {
		t.Fatal(err)
	}
	second, err := planProcessMapReset("company-reset", resources)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatal("two resets of the same Explorer hierarchy produced different geometry")
	}
	byKey := processMapResetTestIndex(first)
	root := byKey[processMapAutomaticPlacementKey(domain.ProcessMapResourceTypeFolder, "root-00")]
	child := byKey[processMapAutomaticPlacementKey(domain.ProcessMapResourceTypeFolder, "child-00")]
	gate := byKey[processMapAutomaticPlacementKey(domain.ProcessMapResourceTypeProcess, "deep-gate")]
	if root.GridWidth >= 234881024 || child.GridWidth >= root.GridWidth/8 {
		t.Fatalf("crowded root and child groups did not both fit: root=%+v child=%+v", root, child)
	}
	if gate.GridWidth != child.GridWidth/8 || gate.GridHeight != child.GridHeight/8 {
		t.Fatalf("descendant used a parent size from before sibling fitting: child=%+v gate=%+v", child, gate)
	}
	rows := map[string]map[int]int{"": {}, "root-00": {}}
	for index, placement := range first {
		if !validProcessMapGeometry(placement.GridX, placement.GridY, placement.GridWidth, placement.GridHeight) {
			t.Fatalf("placement outside integer world: %+v", placement)
		}
		parentID := processMapAutomaticParentID(placement)
		if row, ok := rows[parentID]; ok {
			row[placement.GridY]++
		}
		if parentID != "" {
			parent := byKey[processMapAutomaticPlacementKey(domain.ProcessMapResourceTypeFolder, parentID)]
			requireAutomaticProcessMapContained(t, parent, placement)
		}
		for _, other := range first[index+1:] {
			if processMapAutomaticParentID(other) == parentID && processMapPlacementsConflictWithGap(placement, other, 0) {
				t.Fatalf("crowded siblings overlap: %+v %+v", placement, other)
			}
		}
	}
	if len(rows[""]) != 14 || len(rows["root-00"]) != 8 {
		t.Fatalf("unexpected crowded row counts: %v", rows)
	}
	for _, group := range rows {
		for _, count := range group {
			if count != 6 {
				t.Fatalf("crowded row has %d siblings, want six", count)
			}
		}
	}
}

func TestProcessMapResetRejectsInvalidCanonicalHierarchy(t *testing.T) {
	folder := func(id, parent string) processMapResetResource {
		return processMapResetResource{ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: id, ParentID: parent}
	}
	cases := []struct {
		name      string
		companyID string
		resources []processMapResetResource
		want      error
	}{
		{name: "empty company", want: ErrInvalid},
		{name: "unsupported type", companyID: "company", resources: []processMapResetResource{{ResourceType: "node", ResourceID: "n"}}, want: ErrInvalid},
		{name: "empty identity", companyID: "company", resources: []processMapResetResource{folder("", "")}, want: ErrInvalid},
		{name: "duplicate identity", companyID: "company", resources: []processMapResetResource{folder("f", ""), folder("f", "")}, want: ErrInvalid},
		{name: "missing parent", companyID: "company", resources: []processMapResetResource{folder("f", "missing")}, want: ErrNotFound},
		{name: "parent is gate", companyID: "company", resources: []processMapResetResource{{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: "gate"}, folder("f", "gate")}, want: ErrNotFound},
		{name: "self cycle", companyID: "company", resources: []processMapResetResource{folder("f", "f")}, want: ErrProcessMapCycle},
		{name: "unreachable cycle", companyID: "company", resources: []processMapResetResource{folder("root", ""), folder("a", "b"), folder("b", "a")}, want: ErrProcessMapCycle},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			placements, err := planProcessMapReset(test.companyID, test.resources)
			if !errors.Is(err, test.want) || placements != nil {
				t.Fatalf("result = %+v, %v; want no plan and %v", placements, err, test.want)
			}
		})
	}
}

func TestProcessMapResetKeepsTypedIdentitiesDistinctAndAllowsEmptyMap(t *testing.T) {
	resources := []processMapResetResource{
		{ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: "same-id"},
		{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: "same-id", ParentID: "same-id"},
	}
	placements, err := planProcessMapReset("company-reset", resources)
	if err != nil || len(placements) != 2 {
		t.Fatalf("typed identities were conflated: %+v %v", placements, err)
	}
	empty, err := planProcessMapReset("company-reset", nil)
	if err != nil || empty == nil || len(empty) != 0 {
		t.Fatalf("empty map result = %+v %v", empty, err)
	}
}

func TestProcessMapResetRejectsDepthWithoutPositiveIntegerInterior(t *testing.T) {
	var resources []processMapResetResource
	parentID := ""
	for level := 1; level <= 11; level++ {
		folderID := fmt.Sprintf("folder-%d", level)
		resources = append(resources, processMapResetResource{ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: folderID, ParentID: parentID})
		parentID = folderID
	}
	placements, err := planProcessMapReset("company-reset", resources)
	if !errors.Is(err, ErrProcessMapContainment) || placements != nil {
		t.Fatalf("integer capacity failure returned partial geometry: %+v %v", placements, err)
	}
}

func TestProcessMapResetRepresentativeSizes(t *testing.T) {
	for _, count := range []int{500, 1000} {
		t.Run(fmt.Sprintf("%d_resources", count), func(t *testing.T) {
			resources := []processMapResetResource{{ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: "root"}}
			for group := 0; len(resources) < count; group++ {
				folderID := fmt.Sprintf("folder-%02d", group)
				resources = append(resources, processMapResetResource{ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: folderID, ParentID: "root"})
				for child := 0; child < 29 && len(resources) < count; child++ {
					resources = append(resources, processMapResetResource{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: fmt.Sprintf("gate-%02d-%02d", group, child), ParentID: folderID})
				}
			}
			start := time.Now()
			placements, err := planProcessMapReset("company-reset", resources)
			t.Logf("reset %d resources: %s", count, time.Since(start))
			if err != nil || len(placements) != count {
				t.Fatalf("reset returned %d resources, %v; want %d", len(placements), err, count)
			}
		})
	}
}
