package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"reflect"
	"slices"
	"testing"

	"miraeopus/backend/internal/domain"
)

var processMapResetSourceTables = []string{
	"companies", "company_explorer_folders", "company_explorer_items", "logic_gates",
	"resource_permission_settings", "resource_permissions", "resource_gvic_settings", "resource_gvic_assignments",
	"process_steps", "nodes", "node_logic_gate_assignments",
}

func snapshotPostgresProcessMapReset(t *testing.T, db *sql.DB, companyID string, includeMap bool) map[string]string {
	t.Helper()
	tables := slices.Clone(processMapResetSourceTables)
	if includeMap {
		tables = append(tables, "process_map_placements", "resource_operational_relationships", "process_map_traces", "workspace_read_versions", "domain_events", "realtime_outbox")
	}
	result := make(map[string]string, len(tables))
	for _, table := range tables {
		var rows string
		// Table names come only from the fixed test lists above. Compare complete
		// rows so identity, timestamps, parentage, and policy sequences are covered.
		query := fmt.Sprintf(`select coalesce(jsonb_agg(to_jsonb(saved) order by to_jsonb(saved)::text),'[]'::jsonb)::text from %s saved where company_id=$1::uuid`, table)
		if err := db.QueryRow(query, companyID).Scan(&rows); err != nil {
			t.Fatalf("snapshot %s: %v", table, err)
		}
		result[table] = rows
	}
	return result
}

func requirePostgresProcessMapResetSnapshot(t *testing.T, before, after map[string]string) {
	t.Helper()
	for table, expected := range before {
		if after[table] != expected {
			t.Errorf("reset unexpectedly changed %s", table)
		}
	}
}

func newPostgresProcessMapResetCompany(t *testing.T, repo *PostgresRepo, name string) (domain.Company, domain.User) {
	t.Helper()
	company, err := repo.CreateCompany(name)
	if err != nil {
		t.Fatal(err)
	}
	subject := "reset-admin-" + company.CompanyID
	admin, err := repo.UpsertAuthUser(subject, subject+"@example.test", "Reset administrator")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	return company, admin
}

func postgresProcessMapResetPlacements(t *testing.T, db *sql.DB, companyID string) map[string]domain.ProcessMapPlacement {
	t.Helper()
	rows, err := db.Query(`select company_id::text,resource_type,resource_id::text,placement_incarnation_token::text,map_parent_folder_id::text,
grid_x,grid_y,grid_width,grid_height,revision,created_timestamp,updated_timestamp
from process_map_placements where company_id=$1::uuid`, companyID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	result := map[string]domain.ProcessMapPlacement{}
	for rows.Next() {
		var item domain.ProcessMapPlacement
		var parentID sql.NullString
		if err := rows.Scan(&item.CompanyID, &item.ResourceType, &item.ResourceID, &item.PlacementIncarnationToken, &parentID,
			&item.GridX, &item.GridY, &item.GridWidth, &item.GridHeight, &item.Revision, &item.CreatedTimestamp, &item.UpdatedTimestamp); err != nil {
			t.Fatal(err)
		}
		if item.PlacementIncarnationToken == "" {
			t.Fatalf("placement %s/%s has no stored incarnation token", item.ResourceType, item.ResourceID)
		}
		if parentID.Valid {
			item.MapParentFolderID = &parentID.String
		}
		result[processMapAutomaticPlacementKey(item.ResourceType, item.ResourceID)] = item
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return result
}

func createPostgresProcessMapResetEdge(t *testing.T, repo *PostgresRepo, companyID, actorID string, source, target domain.ProcessMapResourceRef, routed bool) domain.ResourceOperationalRelationship {
	t.Helper()
	input := ResourceOperationalRelationshipCreateInput{CompanyID: companyID, ActorUserID: actorID, PermissionUserID: actorID, Source: source, Target: target}
	if routed {
		input.Trace = &ProcessMapTraceInput{RoutePoints: []domain.ProcessMapRoutePoint{{X: 0, Y: 0}, {X: 0, Y: 2}, {X: 2, Y: 2}}}
	}
	result, err := repo.CreateResourceOperationalRelationship(context.Background(), input)
	if err != nil || result.Relationship == nil {
		t.Fatalf("create operational relationship: result=%+v err=%v", result, err)
	}
	return *result.Relationship
}

func setPostgresProcessMapResetLegacyGeometry(t *testing.T, db *sql.DB, companyID string) {
	t.Helper()
	if _, err := db.Exec(`update process_map_placements
set grid_x=grid_x/1000000,grid_y=grid_y/1000000,
grid_width=greatest(2,grid_width/1000000),grid_height=greatest(2,grid_height/1000000),
revision=7,created_timestamp='2026-08-01T00:00:00Z',updated_timestamp='2026-08-02T00:00:00Z'
where company_id=$1::uuid`, companyID); err != nil {
		t.Fatal(err)
	}
}

func TestPostgresProcessMapResetPreviewAndApplyPreserveCompanyState(t *testing.T) {
	ctx := context.Background()
	db, repo := openPostgresProcessMapIntegration(t)
	company, admin := newPostgresProcessMapResetCompany(t, repo, "Company to reset")
	parent, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Mixed children")
	if err != nil {
		t.Fatal(err)
	}
	children := make([]domain.ProcessMapResourceRef, 0, 7)
	for index := 0; index < 7; index++ {
		if index%2 == 0 {
			folder, err := repo.CreateCompanyExplorerFolder(company.CompanyID, parent.FolderID, "logic_gate", fmt.Sprintf("Folder %d", index))
			if err != nil {
				t.Fatal(err)
			}
			children = append(children, domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: folder.FolderID})
		} else {
			gate, err := repo.CreateLogicGate(company.CompanyID, fmt.Sprintf("Process %d", index))
			if err != nil {
				t.Fatal(err)
			}
			if _, _, err := repo.AssignCompanyExplorerFolderItem(company.CompanyID, parent.FolderID, EntityTypeLogicGate, gate.LogicGateID, (index+1)*1000); err != nil {
				t.Fatal(err)
			}
			children = append(children, domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: gate.LogicGateID})
		}
	}
	unmapped, err := repo.CreateLogicGate(company.CompanyID, "Unmapped endpoint")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.DeleteProcessMapPlacement(ctx, ProcessMapPlacementDeleteInput{
		CompanyID: company.CompanyID, ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: unmapped.LogicGateID,
		ActorUserID: admin.UserID, PermissionUserID: admin.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	deletedRelationships := []domain.ResourceOperationalRelationship{
		createPostgresProcessMapResetEdge(t, repo, company.CompanyID, admin.UserID, children[0], children[1], true),
		createPostgresProcessMapResetEdge(t, repo, company.CompanyID, admin.UserID, children[1], children[2], false),
		createPostgresProcessMapResetEdge(t, repo, company.CompanyID, admin.UserID,
			domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: unmapped.LogicGateID}, children[3], false),
	}
	noAccess := ResourceDefaultAccessNoAccess
	if _, _, err := repo.PutResourcePermissionPolicy(ResourcePermissionPolicyUpdateInput{
		CompanyID: company.CompanyID, ResourceType: children[0].ResourceType, ResourceID: children[0].ResourceID,
		PermissionMode: PolicyModeCustomized, DefaultAccess: &noAccess, DescendantAction: PolicyDescendantActionInheritedOnly,
		Permissions: []EntityPermissionInput{{SubjectType: EntityPermissionSubjectUser, SubjectID: admin.UserID, AccessLevel: EntityPermissionEdit}},
	}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.PutResourceRACIPolicy(ResourceRACIPolicyUpdateInput{
		CompanyID: company.CompanyID, ResourceType: children[1].ResourceType, ResourceID: children[1].ResourceID,
		AssignmentMode: PolicyModeCustomized, DescendantAction: PolicyDescendantActionInheritedOnly,
		Assignments: []ResourceRACIAssignmentInput{{Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectUser, PrincipalID: admin.UserID}},
	}); err != nil {
		t.Fatal(err)
	}
	other, otherAdmin := newPostgresProcessMapResetCompany(t, repo, "Other company")
	firstStep, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: company.CompanyID, LogicGateID: children[1].ResourceID, Name: "Prepare"})
	if err != nil {
		t.Fatal(err)
	}
	secondStep, err := repo.CreateProcessStep(ProcessStepCreateInput{CompanyID: company.CompanyID, LogicGateID: children[1].ResourceID, Name: "Review", AfterProcessStepID: &firstStep.Step.ProcessStepID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID: company.CompanyID, LogicGateID: children[1].ResourceID, NodeID: newUUIDv7String(),
		CreateNodeTitle: "Keep this work", Status: "Done", ProcessStepID: &secondStep.Step.ProcessStepID, ProcessStepIDSet: true,
	}); err != nil {
		t.Fatal(err)
	}
	otherA, err := repo.CreateLogicGate(other.CompanyID, "Other A")
	if err != nil {
		t.Fatal(err)
	}
	otherB, err := repo.CreateLogicGate(other.CompanyID, "Other B")
	if err != nil {
		t.Fatal(err)
	}
	createPostgresProcessMapResetEdge(t, repo, other.CompanyID, otherAdmin.UserID,
		domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: otherA.LogicGateID},
		domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: otherB.LogicGateID}, true)
	setPostgresProcessMapResetLegacyGeometry(t, db, company.CompanyID)
	// Missing supported geometry must be rebuilt from its existing Explorer row.
	missing := children[len(children)-1]
	if _, err := db.Exec(`delete from process_map_placements where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid`, company.CompanyID, missing.ResourceType, missing.ResourceID); err != nil {
		t.Fatal(err)
	}
	before := snapshotPostgresProcessMapReset(t, db, company.CompanyID, true)
	otherBefore := snapshotPostgresProcessMapReset(t, db, other.CompanyID, true)
	sourcesBefore := snapshotPostgresProcessMapReset(t, db, company.CompanyID, false)
	placementsBefore := postgresProcessMapResetPlacements(t, db, company.CompanyID)
	var beforeEventSequence, beforeOutboxSequence int64
	if err := db.QueryRow(`select coalesce(max(sequence),0) from domain_events where company_id=$1::uuid and stream_type=$2 and stream_id=$1::text`, company.CompanyID, workspaceDomainStreamType).Scan(&beforeEventSequence); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`select coalesce(max(outbox_sequence),0) from realtime_outbox where company_id=$1::uuid`, company.CompanyID).Scan(&beforeOutboxSequence); err != nil {
		t.Fatal(err)
	}
	input := ProcessMapResetInput{CompanyID: company.CompanyID, ActorUserID: admin.UserID}
	preview, err := repo.ResetProcessMap(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	if preview.Applied || preview.CompanyID != company.CompanyID || preview.CompanyName != company.Name || preview.ServerVersion == "" || preview.PlanToken == "" || preview.RelationshipCount != 3 || preview.TraceCount != 1 || preview.MaxFolderDepth < 2 {
		t.Fatalf("unexpected preview: %+v", preview)
	}
	if preview.FolderCount+preview.ProcessCount != len(placementsBefore)+1 || preview.ChangedPlacements != len(placementsBefore)+1 {
		t.Fatalf("preview omitted canonical placements or geometry changes: %+v", preview)
	}
	requirePostgresProcessMapResetSnapshot(t, before, snapshotPostgresProcessMapReset(t, db, company.CompanyID, true))
	repeated, err := repo.ResetProcessMap(ctx, input)
	if err != nil || repeated.PlanToken != preview.PlanToken {
		t.Fatalf("unchanged read-only preview token changed: preview=%+v err=%v", repeated, err)
	}
	input.Apply, input.ExpectedPlanToken = true, preview.PlanToken
	applied, err := repo.ResetProcessMap(ctx, input)
	if err != nil || !applied.Applied || applied.ChangedPlacements != preview.ChangedPlacements || applied.ReadVersion <= preview.ReadVersion {
		t.Fatalf("apply=%+v err=%v", applied, err)
	}
	requirePostgresProcessMapResetSnapshot(t, sourcesBefore, snapshotPostgresProcessMapReset(t, db, company.CompanyID, false))
	requirePostgresProcessMapResetSnapshot(t, otherBefore, snapshotPostgresProcessMapReset(t, db, other.CompanyID, true))
	for _, table := range []string{"resource_operational_relationships", "process_map_traces"} {
		var count int
		filter := ""
		if table == "resource_operational_relationships" {
			filter = " and source_resource_type <> 'process_step'"
		}
		if err := db.QueryRow("select count(*) from "+table+" where company_id=$1::uuid"+filter, company.CompanyID).Scan(&count); err != nil || count != 0 {
			t.Fatalf("%s remaining=%d err=%v", table, count, err)
		}
	}
	var stepConnectionSurvived bool
	if err := db.QueryRow(`select exists(select 1 from resource_operational_relationships
 where company_id=$1::uuid and resource_operational_relationship_id=$2::uuid
 and source_resource_type='process_step' and source_resource_id=$3::uuid
 and target_resource_type='process_step' and target_resource_id=$4::uuid)`,
		company.CompanyID, secondStep.Relationship.ResourceOperationalRelationshipID,
		firstStep.Step.ProcessStepID, secondStep.Step.ProcessStepID).Scan(&stepConnectionSurvived); err != nil || !stepConnectionSurvived {
		t.Fatalf("company map reset changed the Process step connection: survived=%t err=%v", stepConnectionSurvived, err)
	}
	placementsAfter := postgresProcessMapResetPlacements(t, db, company.CompanyID)
	expectedSaved := make(map[string]bool, len(placementsAfter))
	for key := range placementsAfter {
		expectedSaved[key] = true
	}
	expectedDeleted := make(map[string]domain.ResourceOperationalRelationship, len(deletedRelationships))
	for _, relationship := range deletedRelationships {
		expectedDeleted[relationship.ResourceOperationalRelationshipID] = relationship
	}
	eventRows, err := db.Query(`select `+domainEventSelectColumns+` from domain_events
where company_id=$1::uuid and stream_type=$2 and stream_id=$1::text and sequence>$3 order by sequence`, company.CompanyID, workspaceDomainStreamType, beforeEventSequence)
	if err != nil {
		t.Fatal(err)
	}
	func() {
		defer eventRows.Close()
		for eventRows.Next() {
			event, err := scanDomainEvent(eventRows)
			if err != nil {
				t.Fatal(err)
			}
			if event.ActorUserID == nil || *event.ActorUserID != admin.UserID {
				t.Fatalf("reset event lost its actor: %+v", event)
			}
			switch event.Type {
			case ProcessMapPlacementSavedEvent:
				resourceType, _ := event.Payload["resource_type"].(string)
				resourceID, _ := event.Payload["resource_id"].(string)
				key := processMapAutomaticPlacementKey(resourceType, resourceID)
				if !expectedSaved[key] {
					t.Fatalf("unexpected or duplicate typed placement event: %+v", event)
				}
				delete(expectedSaved, key)
			case ResourceOperationalRelationshipDeletedEvent:
				relationshipID, _ := event.Payload["resource_operational_relationship_id"].(string)
				relationship, exists := expectedDeleted[relationshipID]
				if !exists {
					t.Fatalf("unexpected or duplicate relationship deletion event: %+v", event)
				}
				requireProcessMapRelationshipEventIdentities(t, []domain.DomainEvent{event}, relationship)
				delete(expectedDeleted, relationshipID)
			default:
				t.Fatalf("reset emitted an unrelated workspace event: %+v", event)
			}
		}
		if err := eventRows.Err(); err != nil {
			t.Fatal(err)
		}
	}()
	if len(expectedSaved) != 0 || len(expectedDeleted) != 0 {
		t.Fatalf("reset omitted saved/deleted events: placements=%v relationships=%v", expectedSaved, expectedDeleted)
	}
	var invalidations int
	if err := db.QueryRow(`select count(*) from realtime_outbox
where company_id=$1::uuid and outbox_sequence>$2 and scope=$3 and event_type='process_map.changed'
  and payload->>'company_id'=$1::text and payload->>'type'='process_map.changed'`, company.CompanyID, beforeOutboxSequence, processMapRealtimeScope).Scan(&invalidations); err != nil || invalidations < 1 {
		t.Fatalf("reset Process Map invalidations=%d err=%v", invalidations, err)
	}
	if version := postgresProcessMapVersionForTest(t, repo, company.CompanyID); version <= 0 || version != applied.ReadVersion {
		t.Fatalf("stored Process Map read version=%d, reset reported %d", version, applied.ReadVersion)
	}
	for key, previous := range placementsBefore {
		current, exists := placementsAfter[key]
		if !exists || current.Revision != previous.Revision+1 || current.PlacementIncarnationToken != previous.PlacementIncarnationToken || !current.CreatedTimestamp.Equal(previous.CreatedTimestamp) || !sameProcessMapParent(current.MapParentFolderID, previous.MapParentFolderID) {
			t.Errorf("reset lost placement identity/parent or incremented revision incorrectly: before=%+v after=%+v", previous, current)
		}
	}
	if restored := placementsAfter[processMapAutomaticPlacementKey(missing.ResourceType, missing.ResourceID)]; restored.Revision != 1 {
		t.Fatalf("rebuilt missing placement revision=%d", restored.Revision)
	}
	parentPlacement := placementsAfter[processMapAutomaticPlacementKey(domain.ProcessMapResourceTypeFolder, parent.FolderID)]
	if parentPlacement.GridWidth != processMapAutomaticRootFolderWidth || parentPlacement.GridHeight != processMapAutomaticRootFolderHeight {
		t.Fatalf("legacy root was not reset to current dimensions: %+v", parentPlacement)
	}
	rowCounts := map[int]int{}
	for _, ref := range children {
		placement := placementsAfter[processMapAutomaticPlacementKey(ref.ResourceType, ref.ResourceID)]
		if placement.MapParentFolderID == nil || *placement.MapParentFolderID != parent.FolderID || !processMapBoundsContain(processMapPlacementBounds(parentPlacement), processMapPlacementBounds(placement)) {
			t.Fatalf("reset child escaped canonical parent: %+v", placement)
		}
		rowCounts[placement.GridY]++
	}
	counts := []int{}
	for _, count := range rowCounts {
		counts = append(counts, count)
	}
	slices.Sort(counts)
	if !slices.Equal(counts, []int{1, 6}) {
		t.Fatalf("seven mixed children must use rows of six and one, got %v", counts)
	}
	if _, mapped := placementsAfter[processMapAutomaticPlacementKey(domain.ProcessMapResourceTypeProcess, unmapped.LogicGateID)]; mapped {
		t.Fatal("reset created geometry for a Process absent from canonical Explorer")
	}
	added, err := repo.CreateCompanyExplorerFolder(company.CompanyID, parent.FolderID, "logic_gate", "Next child")
	if err != nil {
		t.Fatal(err)
	}
	afterInsert := postgresProcessMapResetPlacements(t, db, company.CompanyID)
	for key, previous := range placementsAfter {
		if !reflect.DeepEqual(previous, afterInsert[key]) {
			t.Errorf("ordinary insertion changed reset geometry for %s", key)
		}
	}
	addedPlacement := afterInsert[processMapAutomaticPlacementKey(domain.ProcessMapResourceTypeFolder, added.FolderID)]
	if rowCounts[addedPlacement.GridY] != 1 {
		t.Fatalf("next child did not continue the second row: %+v", addedPlacement)
	}
}

func TestPostgresProcessMapResetRejectsStalePreviewAtomically(t *testing.T) {
	for _, change := range []string{"missing token", "geometry", "trace", "read version"} {
		t.Run(change, func(t *testing.T) {
			ctx := context.Background()
			db, repo := openPostgresProcessMapIntegration(t)
			company, admin := newPostgresProcessMapResetCompany(t, repo, "Stale reset preview")
			a, err := repo.CreateLogicGate(company.CompanyID, "A")
			if err != nil {
				t.Fatal(err)
			}
			b, err := repo.CreateLogicGate(company.CompanyID, "B")
			if err != nil {
				t.Fatal(err)
			}
			edge := createPostgresProcessMapResetEdge(t, repo, company.CompanyID, admin.UserID,
				domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: a.LogicGateID},
				domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: b.LogicGateID}, true)
			setPostgresProcessMapResetLegacyGeometry(t, db, company.CompanyID)
			input := ProcessMapResetInput{CompanyID: company.CompanyID, ActorUserID: admin.UserID}
			preview, err := repo.ResetProcessMap(ctx, input)
			if err != nil {
				t.Fatal(err)
			}
			input.Apply, input.ExpectedPlanToken = true, preview.PlanToken
			switch change {
			case "missing token":
				input.ExpectedPlanToken = ""
			case "geometry":
				_, err = db.Exec(`update process_map_placements set grid_x=grid_x+1 where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`, company.CompanyID, a.LogicGateID)
			case "trace":
				_, err = repo.PutProcessMapTrace(ctx, ProcessMapTracePutInput{CompanyID: company.CompanyID, ResourceOperationalRelationshipID: edge.ResourceOperationalRelationshipID,
					RoutePoints: []domain.ProcessMapRoutePoint{{X: 1, Y: 1}, {X: 1, Y: 3}, {X: 3, Y: 3}}, ActorUserID: admin.UserID, PermissionUserID: admin.UserID})
			case "read version":
				_, err = db.Exec(`update workspace_read_versions set version=version+1 where company_id=$1::uuid and scope='process-map' and resource_key=''`, company.CompanyID)
			}
			if err != nil {
				t.Fatal(err)
			}
			before := snapshotPostgresProcessMapReset(t, db, company.CompanyID, true)
			wantError := ErrProcessMapResetStalePlan
			if change == "missing token" {
				wantError = ErrInvalid
			}
			if _, err := repo.ResetProcessMap(ctx, input); !errors.Is(err, wantError) {
				t.Fatalf("stale %s preview error=%v", change, err)
			}
			requirePostgresProcessMapResetSnapshot(t, before, snapshotPostgresProcessMapReset(t, db, company.CompanyID, true))
		})
	}
}

func TestPostgresProcessMapResetDeniedEditLeavesEverythingUntouched(t *testing.T) {
	for _, restricted := range []string{"mapped geometry", "unmapped relationship endpoint"} {
		t.Run(restricted, func(t *testing.T) {
			ctx := context.Background()
			db, repo := openPostgresProcessMapIntegration(t)
			company, admin := newPostgresProcessMapResetCompany(t, repo, "Denied reset")
			member, err := repo.UpsertAuthUser("reset-member", "reset-member@example.test", "Member")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := repo.AddCompanyMembership(member.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
				t.Fatal(err)
			}
			hidden, err := repo.CreateLogicGate(company.CompanyID, "Restricted")
			if err != nil {
				t.Fatal(err)
			}
			other, err := repo.CreateLogicGate(company.CompanyID, "Other")
			if err != nil {
				t.Fatal(err)
			}
			edge := createPostgresProcessMapResetEdge(t, repo, company.CompanyID, admin.UserID,
				domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: hidden.LogicGateID},
				domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: other.LogicGateID}, false)
			setPostgresProcessMapResetLegacyGeometry(t, db, company.CompanyID)
			input := ProcessMapResetInput{CompanyID: company.CompanyID, ActorUserID: member.UserID}
			preview, err := repo.ResetProcessMap(ctx, input)
			if err != nil {
				t.Fatalf("authorized preview before revoke: %v", err)
			}
			noAccess := ResourceDefaultAccessNoAccess
			if _, _, err := repo.PutResourcePermissionPolicy(ResourcePermissionPolicyUpdateInput{CompanyID: company.CompanyID, ResourceType: EntityTypeLogicGate, ResourceID: hidden.LogicGateID,
				PermissionMode: PolicyModeCustomized, DefaultAccess: &noAccess, DescendantAction: PolicyDescendantActionInheritedOnly}); err != nil {
				t.Fatal(err)
			}
			if restricted == "unmapped relationship endpoint" {
				// Customize the policy before detaching so the normal Explorer
				// removal materializes the endpoint's existing denied access.
				if _, err := repo.DeleteProcessMapPlacement(ctx, ProcessMapPlacementDeleteInput{CompanyID: company.CompanyID, ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: hidden.LogicGateID, ActorUserID: admin.UserID, PermissionUserID: admin.UserID}); err != nil {
					t.Fatal(err)
				}
				if _, mapped := postgresProcessMapResetPlacements(t, db, company.CompanyID)[processMapAutomaticPlacementKey(domain.ProcessMapResourceTypeProcess, hidden.LogicGateID)]; mapped {
					t.Fatal("restricted endpoint remained mapped")
				}
				var relationshipExists bool
				if err := db.QueryRow(`select exists(select 1 from resource_operational_relationships where company_id=$1::uuid and resource_operational_relationship_id=$2::uuid)`, company.CompanyID, edge.ResourceOperationalRelationshipID).Scan(&relationshipExists); err != nil || !relationshipExists {
					t.Fatalf("unmapped endpoint relationship was not preserved: exists=%v err=%v", relationshipExists, err)
				}
			}
			before := snapshotPostgresProcessMapReset(t, db, company.CompanyID, true)
			if result, err := repo.ResetProcessMap(ctx, input); !errors.Is(err, ErrNotFound) || result.PlanToken != "" {
				t.Fatalf("denied preview must disclose no plan: result=%+v err=%v", result, err)
			}
			input.Apply, input.ExpectedPlanToken = true, preview.PlanToken
			if _, err := repo.ResetProcessMap(ctx, input); err == nil {
				t.Fatal("reset applied after endpoint Edit was revoked")
			}
			requirePostgresProcessMapResetSnapshot(t, before, snapshotPostgresProcessMapReset(t, db, company.CompanyID, true))
		})
	}
}

func TestPostgresProcessMapResetRejectsUnrebuildableSourceWithoutDeletingConnections(t *testing.T) {
	for _, invalid := range []string{"extra placement", "precision exhausted"} {
		t.Run(invalid, func(t *testing.T) {
			ctx := context.Background()
			db, repo := openPostgresProcessMapIntegration(t)
			company, admin := newPostgresProcessMapResetCompany(t, repo, "Invalid reset source")
			folder, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Root")
			if err != nil {
				t.Fatal(err)
			}
			gate, err := repo.CreateLogicGate(company.CompanyID, "Endpoint")
			if err != nil {
				t.Fatal(err)
			}
			createPostgresProcessMapResetEdge(t, repo, company.CompanyID, admin.UserID,
				domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeFolder, ResourceID: folder.FolderID},
				domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: gate.LogicGateID}, true)
			if invalid == "extra placement" {
				// A live source may exist without an Explorer item. Its leftover map
				// row is a projection mismatch, not permission to silently drop it.
				if _, err := db.Exec(`delete from company_explorer_items where company_id=$1::uuid and target_type='logic_gate' and target_id=$2::uuid`, company.CompanyID, gate.LogicGateID); err != nil {
					t.Fatal(err)
				}
			} else {
				parentID := folder.FolderID
				for depth := 0; depth < 20; depth++ {
					folderID := newUUIDv7String()
					if _, err := db.Exec(`insert into company_explorer_folders(company_id,folder_id,parent_folder_id,name,position) values($1::uuid,$2::uuid,$3::uuid,$4,1000)`, company.CompanyID, folderID, parentID, fmt.Sprintf("Legacy depth %d", depth)); err != nil {
						t.Fatal(err)
					}
					parentID = folderID
				}
			}
			before := snapshotPostgresProcessMapReset(t, db, company.CompanyID, true)
			_, err = repo.ResetProcessMap(ctx, ProcessMapResetInput{CompanyID: company.CompanyID, ActorUserID: admin.UserID})
			if err == nil || invalid == "extra placement" && !errors.Is(err, ErrProcessMapResetSource) {
				t.Fatalf("invalid %s source was not rejected: %v", invalid, err)
			}
			requirePostgresProcessMapResetSnapshot(t, before, snapshotPostgresProcessMapReset(t, db, company.CompanyID, true))
		})
	}
}

func TestPostgresProcessMapResetRejectsMissingCapacityMigrationWithoutWrites(t *testing.T) {
	ctx := context.Background()
	db, repo := openPostgresProcessMapIntegration(t)
	company, admin := newPostgresProcessMapResetCompany(t, repo, "Old Process Map dimension cap")
	a, err := repo.CreateLogicGate(company.CompanyID, "A")
	if err != nil {
		t.Fatal(err)
	}
	b, err := repo.CreateLogicGate(company.CompanyID, "B")
	if err != nil {
		t.Fatal(err)
	}
	createPostgresProcessMapResetEdge(t, repo, company.CompanyID, admin.UserID,
		domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: a.LogicGateID},
		domain.ProcessMapResourceRef{ResourceType: domain.ProcessMapResourceTypeProcess, ResourceID: b.LogicGateID}, true)
	setPostgresProcessMapResetLegacyGeometry(t, db, company.CompanyID)
	if _, err := db.Exec(`alter table process_map_placements
drop constraint process_map_placements_geometry_chk,
add constraint process_map_placements_geometry_chk check (
  grid_x >= -1000000000 and grid_y >= -1000000000
  and grid_width > 0 and grid_width <= 1000000
  and grid_height > 0 and grid_height <= 1000000
  and grid_x::bigint + grid_width <= 1000000000
  and grid_y::bigint + grid_height <= 1000000000
)`); err != nil {
		t.Fatal(err)
	}
	before := snapshotPostgresProcessMapReset(t, db, company.CompanyID, true)
	for _, apply := range []bool{false, true} {
		input := ProcessMapResetInput{CompanyID: company.CompanyID, ActorUserID: admin.UserID, Apply: apply}
		if apply {
			input.ExpectedPlanToken = fmt.Sprintf("%064x", 0)
		}
		if result, err := repo.ResetProcessMap(ctx, input); !errors.Is(err, ErrProcessMapResetSchema) || result.Applied || result.PlanToken != "" {
			t.Fatalf("missing capacity migration apply=%v result=%+v err=%v", apply, result, err)
		}
	}
	requirePostgresProcessMapResetSnapshot(t, before, snapshotPostgresProcessMapReset(t, db, company.CompanyID, true))
}
