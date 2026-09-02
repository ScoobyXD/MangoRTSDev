package store

import (
	"errors"
	"miraeopus/backend/internal/domain"
	"reflect"
	"testing"
)

func TestAutomaticProcessMapFitsBeforeWorldValidation(t *testing.T) {
	const companyID = "boundary-company"
	parentID, movingID := "destination", "moving"
	placements := []domain.ProcessMapPlacement{
		{CompanyID: companyID, ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: parentID, GridX: 999999600, GridY: 0, GridWidth: 400, GridHeight: 256},
		{CompanyID: companyID, ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: "existing", MapParentFolderID: &parentID, GridX: 999999608, GridY: 32, GridWidth: 384, GridHeight: 216},
		{CompanyID: companyID, ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: movingID, GridX: 0, GridY: 0, GridWidth: 112, GridHeight: 64},
		{CompanyID: companyID, ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: "source", MapParentFolderID: &movingID, GridX: 4, GridY: 8, GridWidth: 14, GridHeight: 8},
		{CompanyID: companyID, ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: "target", MapParentFolderID: &movingID, GridX: 32, GridY: 8, GridWidth: 14, GridHeight: 8},
	}
	plan, err := planAutomaticProcessMapPlacement(companyID, domain.ProcessMapResourceTypeFolder, movingID, parentID, placements)
	if err != nil {
		t.Fatalf("valid final parent fit rejected an intermediate row: %v", err)
	}
	if len(plan.Transforms) != 2 || validProcessMapGeometry(plan.Transforms[0].Target.GridX, plan.Transforms[0].Target.GridY, plan.Transforms[0].Target.GridWidth, plan.Transforms[0].Target.GridHeight) {
		t.Fatalf("fixture must move beyond the world before fitting: %+v", plan.Transforms)
	}
	for _, item := range plan.Placements {
		if !validProcessMapGeometry(item.GridX, item.GridY, item.GridWidth, item.GridHeight) {
			t.Fatalf("final placement exceeds world bounds: %+v", item)
		}
	}

	for _, test := range []struct {
		name  string
		x     int
		valid bool
	}{
		{name: "final trace inside world", x: 20, valid: true},
		{name: "final trace outside world", x: ProcessMapMaxCoordinate, valid: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			repo := NewMemoryRepo()
			for _, item := range placements {
				repo.processMapPlacements[processMapPlacementMemoryKey(companyID, item.ResourceType, item.ResourceID)] = cloneProcessMapPlacement(item)
			}
			relationship := domain.ResourceOperationalRelationship{
				CompanyID: companyID, ResourceOperationalRelationshipID: "internal",
				Source: domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: "source"},
				Target: domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: "target"},
			}
			traceKey := key(companyID, relationship.ResourceOperationalRelationshipID)
			repo.resourceOperationalRelationships[traceKey] = relationship
			route := []domain.ProcessMapRoutePoint{{X: test.x, Y: 12}}
			repo.processMapTraces[traceKey] = domain.ProcessMapTrace{
				CompanyID: companyID, ResourceOperationalRelationshipID: relationship.ResourceOperationalRelationshipID, RoutePoints: route, Revision: 7,
			}
			intermediate := processMapScaleRoutePointsWithinFolder(route, plan.Transforms[0].Source, plan.Transforms[0].Target)
			if validProcessMapRoutePoints(intermediate) {
				t.Fatalf("fixture must cross world bounds before final fit: %+v", intermediate)
			}
			want := processMapScaleRoutePointsWithinFolder(intermediate, plan.Transforms[1].Source, plan.Transforms[1].Target)
			before := repo.snapshotProcessMapMutationLocked()
			changed, err := repo.syncAutomaticMemoryProcessMapPlacementLocked(companyID, domain.ProcessMapResourceTypeFolder, movingID, &parentID, "")
			if !test.valid {
				if changed || !errors.Is(err, ErrInvalid) {
					t.Fatalf("invalid final trace must fail: changed=%v err=%v", changed, err)
				}
				if !reflect.DeepEqual(before, repo.snapshotProcessMapMutationLocked()) {
					t.Fatal("invalid final trace changed saved geometry")
				}
				return
			}
			if err != nil || !changed {
				t.Fatalf("final trace within world was rejected: changed=%v err=%v", changed, err)
			}
			after := repo.processMapTraces[traceKey]
			if !validProcessMapRoutePoints(after.RoutePoints) || !reflect.DeepEqual(after.RoutePoints, want) || after.Revision != 8 {
				t.Fatalf("final trace was not saved exactly once: %+v, want points=%+v", after, want)
			}
		})
	}
}

func TestAutomaticProcessMapTransformStillRejectsCollapsedDimensions(t *testing.T) {
	placements := map[string]domain.ProcessMapPlacement{"small": {GridWidth: 1, GridHeight: 1}}
	_, err := processMapAutomaticTransformMembers(placements, []string{"small"},
		domain.ProcessMapPlacement{GridWidth: 100, GridHeight: 100},
		domain.ProcessMapPlacement{GridWidth: 1, GridHeight: 1})
	if !errors.Is(err, ErrProcessMapContainment) {
		t.Fatalf("collapsed dimensions must remain invalid: %v", err)
	}
}
