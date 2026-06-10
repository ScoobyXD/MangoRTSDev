package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestProjectRelationshipProjectionDeltaEventsUseExactRowKeys(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "99999999-9999-4999-8999-999999999201"
	repo.EnsureCompany(companyID, "Project Relationship Delta Co")
	projectResult, err := repo.CreateProject(ProjectInput{
		CompanyID: companyID,
		Name:      "Delta Project",
		Status:    ProjectDefaultStatus,
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Delta Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Delta Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	priority := 2
	assigned, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      LogicGateWorkStatusPending,
		Priority:    &priority,
		PrioritySet: true,
	})
	if err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	relationshipID := "11111111-1111-4111-8111-111111111201"
	result, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{
		CompanyID:      companyID,
		ProjectID:      projectResult.Project.ProjectID,
		RelationshipID: relationshipID,
		ResourceType:   EntityTypeNode,
		ResourceID:     node.NodeID,
		Position:       1000,
		ActorUserID:    "11111111-1111-4111-8111-111111111202",
	})
	if err != nil {
		t.Fatalf("UpsertProjectRelationship: %v", err)
	}
	if result.Relationship == nil || result.Relationship.AssignmentID == nil || *result.Relationship.AssignmentID != assigned.Assignment.AssignmentID {
		t.Fatalf("relationship assignment_id = %+v, want %s", result.Relationship, assigned.Assignment.AssignmentID)
	}

	row := latestEventRowOfTypeForTest(t, repo, companyID, EventTypeProjectRelationshipProjectionDelta)
	payload, err := DecodeProjectRelationshipProjectionDeltaEventPayload(row)
	if err != nil {
		t.Fatalf("DecodeProjectRelationshipProjectionDeltaEventPayload: %v", err)
	}
	wantScope := ProjectRelationshipProjectionProjectScope(projectResult.Project.ProjectID)
	if payload.Projection != ProjectionNameProjectRelationship || payload.Scope != wantScope || len(payload.Deltas) != 1 {
		t.Fatalf("payload = %+v, want one project relationship delta for %s", payload, wantScope)
	}
	delta := payload.Deltas[0]
	if delta.Operation != ProjectionDeltaOperationUpsert || delta.Row == nil {
		t.Fatalf("delta = %+v, want upsert row", delta)
	}
	if delta.RowKey.ProjectID != projectResult.Project.ProjectID ||
		delta.RowKey.RelationshipID != relationshipID ||
		delta.RowKey.NodeID != node.NodeID ||
		delta.RowKey.LogicGateID != logicGate.LogicGateID ||
		delta.RowKey.AssignmentID != assigned.Assignment.AssignmentID {
		t.Fatalf("row key = %+v, want exact project/relationship/node/gate/assignment keys", delta.RowKey)
	}
	if delta.Row.ProjectID != projectResult.Project.ProjectID || delta.Row.RelationshipID != relationshipID || delta.Row.AssignmentID != assigned.Assignment.AssignmentID {
		t.Fatalf("row = %+v, want exact relationship row payload", delta.Row)
	}
}

func TestProjectRelationshipProjectionDeleteEmitsExactDeleteDelta(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "99999999-9999-4999-8999-999999999202"
	repo.EnsureCompany(companyID, "Project Relationship Delete Delta Co")
	projectResult, err := repo.CreateProject(ProjectInput{
		CompanyID: companyID,
		Name:      "Delete Delta Project",
		Status:    ProjectDefaultStatus,
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Delete Delta Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	relationshipID := "11111111-1111-4111-8111-111111111203"
	if _, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{
		CompanyID:      companyID,
		ProjectID:      projectResult.Project.ProjectID,
		RelationshipID: relationshipID,
		ResourceType:   EntityTypeLogicGate,
		ResourceID:     logicGate.LogicGateID,
		ActorUserID:    "11111111-1111-4111-8111-111111111204",
	}); err != nil {
		t.Fatalf("UpsertProjectRelationship: %v", err)
	}
	if _, err := repo.DeleteProjectRelationship(ProjectRelationshipDeleteInput{
		CompanyID:      companyID,
		ProjectID:      projectResult.Project.ProjectID,
		RelationshipID: relationshipID,
		ActorUserID:    "11111111-1111-4111-8111-111111111205",
	}); err != nil {
		t.Fatalf("DeleteProjectRelationship: %v", err)
	}

	row := latestEventRowOfTypeForTest(t, repo, companyID, EventTypeProjectRelationshipProjectionDelta)
	payload, err := DecodeProjectRelationshipProjectionDeltaEventPayload(row)
	if err != nil {
		t.Fatalf("DecodeProjectRelationshipProjectionDeltaEventPayload: %v", err)
	}
	if len(payload.Deltas) != 1 {
		t.Fatalf("delete payload deltas = %+v, want one", payload.Deltas)
	}
	delta := payload.Deltas[0]
	if delta.Operation != ProjectionDeltaOperationDelete || delta.Row != nil {
		t.Fatalf("delete delta = %+v, want delete without row", delta)
	}
	if delta.RowKey.ProjectID != projectResult.Project.ProjectID || delta.RowKey.RelationshipID != relationshipID || delta.RowKey.LogicGateID != logicGate.LogicGateID {
		t.Fatalf("delete row key = %+v, want exact project relationship key", delta.RowKey)
	}
}

func TestProjectRelationshipProjectionDependencyLayerUsesExactKeys(t *testing.T) {
	raw, err := os.ReadFile("projection_delta_dependencies.go")
	if err != nil {
		t.Fatalf("ReadFile projection_delta_dependencies.go: %v", err)
	}
	normalized := strings.ToLower(strings.Join(strings.Fields(string(raw)), " "))
	for _, required := range []string{
		"func applynodeprojectiondeltadependenciestx",
		"func applylogicgateprojectiondeltadependenciestx",
		"func applynodelogicgateassignmentprojectiondeltadependenciestx",
		"func applyprojectrelationshipprojectiondeltadependenciestx",
		"func syncprojectrelationshipprojectionforrelationshiptx",
		"func syncprojectrelationshipprojectionfornodetx",
		"func syncprojectrelationshipprojectionforlogicgatetx",
		"func syncprojectrelationshipprojectionfornodelogicgateassignmenttx",
		"func deleteprojectrelationshipprojectionforrelationshiptx",
		"relationship.relationship_id=$2::uuid",
		"relationship.resource_type='node' and relationship.resource_id=$2::uuid",
		"projection.node_id=$2::uuid",
		"projection.logic_gate_id=$2::uuid",
		"assignment_id=$2::uuid",
	} {
		if !strings.Contains(normalized, required) {
			t.Fatalf("dependency layer missing exact key pattern %q", required)
		}
	}
	for _, forbidden := range []string{
		"truncate project_relationship_projection",
		"rebuildprojectrelationshipprojection",
		"delete from project_relationship_projection where company_id=$1::uuid;",
	} {
		if strings.Contains(normalized, forbidden) {
			t.Fatalf("dependency layer contains broad projection behavior %q", forbidden)
		}
	}
}

func TestProjectRelationshipProjectionSchemaHasDependencyIndexes(t *testing.T) {
	for _, path := range []string{
		filepath.Join("..", "..", "db", "schema.sql"),
		filepath.Join("..", "..", "db", "migrations", "20260610_projects.sql"),
	} {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("ReadFile %s: %v", path, err)
		}
		normalized := strings.ToLower(strings.Join(strings.Fields(string(raw)), " "))
		for _, required := range []string{
			"assignment_id uuid",
			"idx_project_relationship_projection_project",
			"on project_relationship_projection(company_id, project_id, position, lower(display_title), relationship_id)",
			"idx_project_relationship_projection_relationship",
			"on project_relationship_projection(company_id, relationship_id)",
			"idx_project_relationship_projection_resource",
			"on project_relationship_projection(company_id, resource_type, resource_id)",
			"idx_project_relationship_projection_node",
			"on project_relationship_projection(company_id, node_id)",
			"idx_project_relationship_projection_logic_gate",
			"on project_relationship_projection(company_id, logic_gate_id)",
			"idx_project_relationship_projection_assignment",
			"on project_relationship_projection(company_id, assignment_id)",
		} {
			if !strings.Contains(normalized, required) {
				t.Fatalf("%s missing %q", path, required)
			}
		}
	}
}

func TestProjectRelationshipCommandsUseDependencyLayerWithoutBroadMaintenance(t *testing.T) {
	raw, err := os.ReadFile("postgres_projects.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_projects.go: %v", err)
	}
	normalized := strings.ToLower(strings.Join(strings.Fields(string(raw)), " "))
	for _, required := range []string{
		"applyprojectrelationshipprojectiondeltadependenciestx",
		"projectrelationshipprojectiondeltaeventinputs",
		"deleteprojectrelationship(input projectrelationshipdeleteinput)",
		"r.db.begintx(ctx",
	} {
		if !strings.Contains(normalized, required) {
			t.Fatalf("postgres project command source missing %q", required)
		}
	}
	for _, forbidden := range []string{
		"rebuildprojectrelationshipprojection",
		"delete from project_relationship_projection where company_id=$1::uuid;",
	} {
		if strings.Contains(normalized, forbidden) {
			t.Fatalf("postgres project command source contains broad maintenance %q", forbidden)
		}
	}
}

func latestEventRowOfTypeForTest(t *testing.T, repo *MemoryRepo, companyID, eventType string) EventRow {
	t.Helper()
	rows, err := repo.ListEventRows(companyID, 50)
	if err != nil {
		t.Fatalf("ListEventRows: %v", err)
	}
	for index := len(rows) - 1; index >= 0; index-- {
		if rows[index].EventType == eventType {
			return rows[index]
		}
	}
	t.Fatalf("missing event row type %s in %+v", eventType, rows)
	return EventRow{}
}
