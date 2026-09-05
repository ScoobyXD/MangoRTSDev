package store

import (
	"context"
	"errors"
	"miraeopus/backend/internal/domain"
	"testing"
)

func TestPostgresProcessMapChangesSelectiveReplay(t *testing.T) {
	_, repo := openPostgresProcessMapIntegration(t)
	ctx := context.Background()
	company, err := repo.CreateCompany("Selective Process Map reads")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := repo.UpsertAuthUser("map-changes-admin", "map-changes@example.com", "Map admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	makeProcess := func(name string, x int) domain.LogicGate {
		process, err := repo.CreateLogicGate(company.CompanyID, name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeProcess, process.LogicGateID, nil, x, 64, 32, 32)); err != nil {
			t.Fatal(err)
		}
		return process
	}
	source, target := makeProcess("Source", 64), makeProcess("Target", 320)
	version, _, err := repo.CurrentProcessMapVersions(ctx, company.CompanyID)
	if err != nil {
		t.Fatal(err)
	}
	query := ProcessMapChangesQuery{CompanyID: company.CompanyID, PermissionUserID: admin.UserID, SinceVersion: version, Tiles: changesTestTiles(version, 0, 1, 2, 4)}
	move, err := repo.PutProcessMapPlacement(ctx, processMapTestPlacementWithSize(company.CompanyID, admin.UserID, domain.ProcessMapResourceTypeProcess, source.LogicGateID, nil, 600, 64, 32, 32))
	if err != nil {
		t.Fatal(err)
	}
	changes, err := repo.GetProcessMapChanges(ctx, query)
	if err != nil {
		t.Fatal(err)
	}
	requireValidatedTileXs(t, changes, 1, 4)
	if changes.ProcessMapReadVersion != move.ProcessMapReadVersion {
		t.Fatal("changes read version not atomic with current scene")
	}
	query.SinceVersion, query.Tiles = move.ProcessMapReadVersion, changesTestTiles(move.ProcessMapReadVersion, 0, 1, 2, 4)
	created, err := repo.CreateResourceOperationalRelationship(ctx, ResourceOperationalRelationshipCreateInput{CompanyID: company.CompanyID, ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
		Source: processMapTestRef(domain.ProcessMapResourceTypeProcess, source.LogicGateID), Target: processMapTestRef(domain.ProcessMapResourceTypeProcess, target.LogicGateID), Trace: &ProcessMapTraceInput{RoutePoints: []domain.ProcessMapRoutePoint{}}})
	if err != nil {
		t.Fatal(err)
	}
	changes, err = repo.GetProcessMapChanges(ctx, query)
	if err != nil {
		t.Fatal(err)
	}
	requireValidatedTileXs(t, changes, 0, 4)
	query.SinceVersion, query.Tiles = created.ProcessMapReadVersion, changesTestTiles(created.ProcessMapReadVersion, 0, 1, 2, 4)
	deleted, err := repo.DeleteResourceOperationalRelationship(ctx, ResourceOperationalRelationshipDeleteInput{CompanyID: company.CompanyID, ActorUserID: admin.UserID, PermissionUserID: admin.UserID, ResourceOperationalRelationshipID: created.Relationship.ResourceOperationalRelationshipID})
	if err != nil {
		t.Fatal(err)
	}
	changes, err = repo.GetProcessMapChanges(ctx, query)
	if err != nil {
		t.Fatal(err)
	}
	requireValidatedTileXs(t, changes, 0, 4)
	query.SinceVersion, query.Tiles = deleted.ProcessMapReadVersion, changesTestTiles(deleted.ProcessMapReadVersion, 0, 1, 2, 4)
	if _, err := repo.AppendDomainEvent(workspaceDomainEventInput(company.CompanyID, QDRatingRealtimeEventType, map[string]any{"logic_gate_id": source.LogicGateID})); err != nil {
		t.Fatal(err)
	}
	changes, err = repo.GetProcessMapChanges(ctx, query)
	if err != nil {
		t.Fatal(err)
	}
	requireValidatedTileXs(t, changes, 0, 1, 4)
	if _, err := repo.AppendDomainEvent(workspaceDomainEventInput(company.CompanyID, "logic_gate_permissions_updated", map[string]any{"logic_gate_id": source.LogicGateID})); err != nil {
		t.Fatal(err)
	}
	changes, err = repo.GetProcessMapChanges(ctx, query)
	if err != nil {
		t.Fatal(err)
	}
	if !changes.ProtectedGeometryChanged || len(changes.ValidatedTiles) != 0 {
		t.Fatal("protected history incorrectly certified tiles")
	}
	query.SinceVersion = -1
	if _, err := repo.GetProcessMapChanges(ctx, query); !errors.Is(err, ErrInvalid) {
		t.Fatalf("malformed authorized changes request error=%v, want ErrInvalid", err)
	}
	outsider, err := repo.UpsertAuthUser("map-changes-outsider", "map-changes-outsider@example.com", "Outside viewer")
	if err != nil {
		t.Fatal(err)
	}
	query.PermissionUserID = outsider.UserID
	if _, err := repo.GetProcessMapChanges(ctx, query); !errors.Is(err, ErrNotFound) {
		t.Fatalf("membership must be checked before changes validation: error=%v", err)
	}
}
