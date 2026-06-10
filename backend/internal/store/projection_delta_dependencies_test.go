package store

import (
	"errors"
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

func TestPhase2MutationPathsUseProjectionDependencyHelpers(t *testing.T) {
	files := map[string]string{}
	for _, path := range []string{
		"postgres_nodes.go",
		"postgres_logic_gates.go",
		"postgres_kanban.go",
		"accounts.go",
		"postgres_logic_gate_raci_commands.go",
		"postgres_entity_permissions.go",
		"postgres_projects.go",
		"postgres_project_scoped_creates.go",
	} {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("ReadFile %s: %v", path, err)
		}
		files[path] = strings.ToLower(strings.Join(strings.Fields(string(raw)), " "))
	}
	checks := []struct {
		name     string
		path     string
		required []string
	}{
		{
			name: "node create update delete",
			path: "postgres_nodes.go",
			required: []string{
				"applynodeprojectiondeltadependenciestx",
				"postgresdeletenodewithprojectiondeltastx",
				"projectiondeltaeventinputs",
			},
		},
		{
			name: "logic gate create update delete and raci set",
			path: "postgres_logic_gates.go",
			required: []string{
				"applylogicgateprojectiondeltadependenciestx",
				"postgresdeletelogicgatewithprojectiondeltastx",
				"projectiondeltaeventinputs",
			},
		},
		{
			name: "assignment save move remove issue",
			path: "postgres_kanban.go",
			required: []string{
				"applynodelogicgateassignmentprojectiondeltadependenciestx",
				"assignnodetologicgatestatustx",
				"movelogicgatenodeassignment",
				"removelogicgatenodeassignment",
				"setlogicgatenodeassignmentissue",
			},
		},
		{
			name: "node account assignments",
			path: "accounts.go",
			required: []string{
				"applynodeprojectiondeltadependenciesfornodestx",
				"applynodeprojectiondeltadependenciestx",
				"setnodeaccountassignments",
			},
		},
		{
			name: "racio assignment commands",
			path: "postgres_logic_gate_raci_commands.go",
			required: []string{
				"applylogicgateprojectiondeltadependenciestx",
				"projectiondeltaeventinputs",
			},
		},
		{
			name: "permission mutation revoke",
			path: "postgres_entity_permissions.go",
			required: []string{
				"applyresourcepermissionprojectiondeltadependenciestx",
				"permissionchangedeventinput",
			},
		},
		{
			name: "project relationship add delete",
			path: "postgres_projects.go",
			required: []string{
				"applyprojectrelationshipprojectiondeltadependenciestx",
				"projectrelationshipprojectiondeltaeventinputs",
			},
		},
		{
			name: "project scoped create",
			path: "postgres_project_scoped_creates.go",
			required: []string{
				"createnodeassociatedwithproject",
				"createlogicgateassociatedwithproject",
				"createnodeassociatedwithprojecttx",
				"createlogicgateassociatedwithprojecttx",
				"insert into project_relationships",
				"applynodeprojectiondeltadependenciestx",
				"applylogicgateprojectiondeltadependenciestx",
				"applyprojectrelationshipprojectiondeltadependenciestx",
				"appendeventrowstx",
				"appenddomaineventstx",
				"tx.commit",
			},
		},
	}
	for _, check := range checks {
		source := files[check.path]
		for _, required := range check.required {
			if !strings.Contains(source, required) {
				t.Fatalf("%s missing %q in %s", check.name, required, check.path)
			}
		}
	}
	for path, source := range files {
		for _, forbidden := range []string{
			"rebuildprojectrelationshipprojection",
			"truncate project_relationship_projection",
			"delete from project_relationship_projection where company_id=$1::uuid;",
		} {
			if strings.Contains(source, forbidden) {
				t.Fatalf("%s contains broad projection behavior %q", path, forbidden)
			}
		}
	}
}

func TestProjectScopedCreateCommandsCommitSourceProjectionAndEvents(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "99999999-9999-4999-8999-999999999203"
	actorID := "11111111-1111-4111-8111-111111111206"
	repo.EnsureCompany(companyID, "Project Scoped Create Co")
	projectResult, err := repo.CreateProject(ProjectInput{
		CompanyID: companyID,
		Name:      "Scoped Create Project",
		Status:    ProjectDefaultStatus,
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	initialGate, err := repo.CreateLogicGate(companyID, "Initial Assignment Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate for initial assignment: %v", err)
	}
	priority := 3

	nodeResult, err := repo.CreateNodeAssociatedWithProject(ProjectScopedNodeCreateInput{
		CompanyID:      companyID,
		ProjectID:      projectResult.Project.ProjectID,
		Title:          "Scoped project node",
		Position:       10,
		ActorUserID:    actorID,
		IdempotencyKey: "node-create",
		InitialInformation: &ProjectScopedInitialInformationInput{
			Type:        "Text box",
			Information: "Initial node content",
		},
		InitialAssignment: &ProjectScopedNodeLogicGateAssignmentInput{
			LogicGateID: initialGate.LogicGateID,
			Status:      LogicGateWorkStatusPending,
			Priority:    &priority,
		},
	})
	if err != nil {
		t.Fatalf("CreateNodeAssociatedWithProject: %v", err)
	}
	if nodeResult.Node.NodeID == "" || nodeResult.Relationship == nil || nodeResult.Relationship.NodeID == nil || *nodeResult.Relationship.NodeID != nodeResult.Node.NodeID {
		t.Fatalf("node scoped create result = %+v", nodeResult)
	}
	if nodeResult.Information == nil {
		t.Fatalf("node scoped create did not return initial information")
	}
	if nodeResult.Assignment == nil || nodeResult.Assignment.LogicGateID != initialGate.LogicGateID || nodeResult.Card == nil {
		t.Fatalf("node scoped create assignment/card = %+v / %+v", nodeResult.Assignment, nodeResult.Card)
	}
	if nodeResult.Relationship.AssignmentID == nil || *nodeResult.Relationship.AssignmentID != nodeResult.Assignment.AssignmentID {
		t.Fatalf("relationship assignment_id = %+v, want %s", nodeResult.Relationship.AssignmentID, nodeResult.Assignment.AssignmentID)
	}
	if nodeResult.Relationship.LogicGateID == nil || *nodeResult.Relationship.LogicGateID != initialGate.LogicGateID {
		t.Fatalf("relationship logic_gate_id = %+v, want %s", nodeResult.Relationship.LogicGateID, initialGate.LogicGateID)
	}
	if _, err := repo.GetNode(companyID, nodeResult.Node.NodeID); err != nil {
		t.Fatalf("GetNode after scoped create: %v", err)
	}
	nodeProjections, err := repo.ListNodeProjections(companyID, nodeResult.Node.NodeID)
	if err != nil {
		t.Fatalf("ListNodeProjections: %v", err)
	}
	if len(nodeProjections) != 1 || nodeProjections[0].Information != "Initial node content" {
		t.Fatalf("node projections = %+v", nodeProjections)
	}
	nodeEventTypes := map[string]bool{}
	for _, event := range nodeResult.Events {
		nodeEventTypes[event.Type] = true
	}
	for _, eventType := range []string{"node_created", "project_relationship_upserted", WorkItemLogicGateAssignmentSavedEventType} {
		if !nodeEventTypes[eventType] {
			t.Fatalf("node scoped create events = %+v, missing %s", nodeResult.Events, eventType)
		}
	}

	logicGateResult, err := repo.CreateLogicGateAssociatedWithProject(ProjectScopedLogicGateCreateInput{
		CompanyID:      companyID,
		ProjectID:      projectResult.Project.ProjectID,
		Header:         "Scoped project gate",
		Position:       20,
		ActorUserID:    actorID,
		IdempotencyKey: "gate-create",
	})
	if err != nil {
		t.Fatalf("CreateLogicGateAssociatedWithProject: %v", err)
	}
	if logicGateResult.LogicGate.LogicGateID == "" || logicGateResult.Relationship == nil || logicGateResult.Relationship.LogicGateID == nil || *logicGateResult.Relationship.LogicGateID != logicGateResult.LogicGate.LogicGateID {
		t.Fatalf("logic gate scoped create result = %+v", logicGateResult)
	}
	if len(logicGateResult.Events) != 2 {
		t.Fatalf("logic gate scoped create events = %d, want logic_gate_created and project_relationship_upserted", len(logicGateResult.Events))
	}

	relationships, err := repo.ListProjectRelationshipProjections(companyID, projectResult.Project.ProjectID)
	if err != nil {
		t.Fatalf("ListProjectRelationshipProjections: %v", err)
	}
	if len(relationships) != 2 {
		t.Fatalf("relationships = %+v, want node and logic gate", relationships)
	}
	row := latestEventRowOfTypeForTest(t, repo, companyID, EventTypeProjectRelationshipProjectionDelta)
	payload, err := DecodeProjectRelationshipProjectionDeltaEventPayload(row)
	if err != nil {
		t.Fatalf("DecodeProjectRelationshipProjectionDeltaEventPayload: %v", err)
	}
	if payload.Scope != ProjectRelationshipProjectionProjectScope(projectResult.Project.ProjectID) || len(payload.Deltas) == 0 {
		t.Fatalf("project relationship payload = %+v, want scoped deltas", payload)
	}
}

func TestProjectScopedCreateRollsBackSourceProjectionAndEventsTogether(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "99999999-9999-4999-8999-999999999204"
	nodeID := "11111111-1111-4111-8111-111111111207"
	repo.EnsureCompany(companyID, "Project Scoped Rollback Co")
	projectResult, err := repo.CreateProject(ProjectInput{
		CompanyID: companyID,
		Name:      "Rollback Project",
		Status:    ProjectDefaultStatus,
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	beforeRows, err := repo.ListEventRows(companyID, 100)
	if err != nil {
		t.Fatalf("ListEventRows before: %v", err)
	}
	beforeDomainEvents := len(repo.domainEvents)
	appendErr := errors.New("append event rows failed")
	repo.eventRowAppendErr = appendErr
	_, err = repo.CreateNodeAssociatedWithProject(ProjectScopedNodeCreateInput{
		CompanyID:   companyID,
		ProjectID:   projectResult.Project.ProjectID,
		NodeID:      nodeID,
		Title:       "Rolled back node",
		ActorUserID: "11111111-1111-4111-8111-111111111208",
	})
	repo.eventRowAppendErr = nil
	if !errors.Is(err, appendErr) {
		t.Fatalf("CreateNodeAssociatedWithProject error = %v, want %v", err, appendErr)
	}
	if _, err := repo.GetNode(companyID, nodeID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetNode after rollback error = %v, want ErrNotFound", err)
	}
	relationships, err := repo.ListProjectRelationshipProjections(companyID, projectResult.Project.ProjectID)
	if err != nil {
		t.Fatalf("ListProjectRelationshipProjections after rollback: %v", err)
	}
	if len(relationships) != 0 {
		t.Fatalf("relationships after rollback = %+v, want none", relationships)
	}
	afterRows, err := repo.ListEventRows(companyID, 100)
	if err != nil {
		t.Fatalf("ListEventRows after: %v", err)
	}
	if len(afterRows) != len(beforeRows) {
		t.Fatalf("event row count after rollback = %d, want %d", len(afterRows), len(beforeRows))
	}
	if len(repo.domainEvents) != beforeDomainEvents {
		t.Fatalf("domain event count after rollback = %d, want %d", len(repo.domainEvents), beforeDomainEvents)
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
