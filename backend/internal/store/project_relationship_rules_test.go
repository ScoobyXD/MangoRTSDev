package store

import (
	"errors"
	"testing"
)

func TestMemoryProjectRelationshipsRequireAssignedNodesAndImplicitlyAddLogicGate(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-701400000101"
	repo.EnsureCompany(companyID, "Project relationship rules company")
	projectResult, err := repo.CreateProject(ProjectInput{CompanyID: companyID, Name: "Rules Project", Status: ProjectDefaultStatus})
	if err != nil || projectResult.Project == nil {
		t.Fatalf("CreateProject = %+v err=%v", projectResult, err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Rules Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Rules Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}

	if _, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{
		CompanyID: companyID, ProjectID: projectResult.Project.ProjectID,
		ResourceType: EntityTypeLogicGate, ResourceID: logicGate.LogicGateID,
	}); !errors.Is(err, ErrDirectProjectLogicGate) {
		t.Fatalf("direct Logic Gate relationship err = %v, want ErrDirectProjectLogicGate", err)
	}
	if _, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{
		CompanyID: companyID, ProjectID: projectResult.Project.ProjectID,
		ResourceType: EntityTypeNode, ResourceID: node.NodeID,
	}); !errors.Is(err, ErrProjectNodeLogicGateRequired) {
		t.Fatalf("standalone Node relationship err = %v, want ErrProjectNodeLogicGateRequired", err)
	}
	if _, err := repo.CreateLogicGateAssociatedWithProject(ProjectScopedLogicGateCreateInput{
		CompanyID: companyID, ProjectID: projectResult.Project.ProjectID, Header: "Blocked Gate",
	}); !errors.Is(err, ErrDirectProjectLogicGate) {
		t.Fatalf("project-scoped Logic Gate create err = %v, want ErrDirectProjectLogicGate", err)
	}

	priority := 2
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: node.NodeID,
		Priority: &priority, PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	result, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{
		CompanyID: companyID, ProjectID: projectResult.Project.ProjectID,
		ResourceType: EntityTypeNode, ResourceID: node.NodeID,
	})
	if err != nil {
		t.Fatalf("UpsertProjectRelationship assigned node: %v", err)
	}
	if result.Relationship == nil || result.Relationship.ResourceType != EntityTypeNode || result.Relationship.ResourceID != node.NodeID {
		t.Fatalf("node relationship = %+v", result.Relationship)
	}
	if len(result.ImplicitRelationships) != 1 || result.ImplicitRelationships[0].ResourceType != EntityTypeLogicGate || result.ImplicitRelationships[0].ResourceID != logicGate.LogicGateID {
		t.Fatalf("implicit relationships = %+v, want assigned Logic Gate", result.ImplicitRelationships)
	}
	relationships, err := repo.ListProjectRelationshipProjections(companyID, projectResult.Project.ProjectID)
	if err != nil || len(relationships) != 2 {
		t.Fatalf("project relationships = %+v err=%v, want node and implicit Logic Gate", relationships, err)
	}
}

func TestMemoryLogicGateWorkCardMarksProjectNode(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-701400000102"
	repo.EnsureCompany(companyID, "Logic Gate project icon company")
	projectResult, err := repo.CreateProject(ProjectInput{CompanyID: companyID, Name: "Icon Project", Status: ProjectDefaultStatus})
	if err != nil || projectResult.Project == nil {
		t.Fatalf("CreateProject = %+v err=%v", projectResult, err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Icon Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Icon Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	priority := 1
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: node.NodeID,
		Priority: &priority, PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	before, err := repo.GetLogicGateWork(companyID, logicGate.LogicGateID)
	if err != nil || len(before.Cards) != 1 || before.Cards[0].HasProject {
		t.Fatalf("Logic Gate work before project = %+v err=%v, want one unmarked card", before, err)
	}
	if _, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{
		CompanyID: companyID, ProjectID: projectResult.Project.ProjectID,
		ResourceType: EntityTypeNode, ResourceID: node.NodeID,
	}); err != nil {
		t.Fatalf("UpsertProjectRelationship: %v", err)
	}
	after, err := repo.GetLogicGateWork(companyID, logicGate.LogicGateID)
	if err != nil || len(after.Cards) != 1 || !after.Cards[0].HasProject {
		t.Fatalf("Logic Gate work after project = %+v err=%v, want one project-marked card", after, err)
	}
}
