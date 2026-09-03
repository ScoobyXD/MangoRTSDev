package store

import (
	"errors"
	"testing"
)

func TestMemoryProjectRelationshipsAllowFloatingNodesAndImplicitlyAddAssignedLogicGate(t *testing.T) {
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

	directGate, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{
		CompanyID: companyID, ProjectID: projectResult.Project.ProjectID,
		ResourceType: EntityTypeLogicGate, ResourceID: logicGate.LogicGateID,
	})
	if err != nil || directGate.Relationship == nil || directGate.Relationship.ResourceType != EntityTypeLogicGate {
		t.Fatalf("direct Logic Gate relationship = %+v err=%v", directGate, err)
	}
	readdedGate, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{
		CompanyID: companyID, ProjectID: projectResult.Project.ProjectID,
		ResourceType: EntityTypeLogicGate, ResourceID: logicGate.LogicGateID,
	})
	if err != nil || readdedGate.Relationship == nil {
		t.Fatalf("re-add direct Logic Gate relationship = %+v err=%v", readdedGate, err)
	}
	if readdedGate.Relationship.RelationshipID != directGate.Relationship.RelationshipID {
		t.Fatalf("direct Logic Gate relationship ID changed: first=%s second=%s", directGate.Relationship.RelationshipID, readdedGate.Relationship.RelationshipID)
	}
	floating, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{
		CompanyID: companyID, ProjectID: projectResult.Project.ProjectID,
		ResourceType: EntityTypeNode, ResourceID: node.NodeID,
	})
	if err != nil || floating.Relationship == nil || len(floating.ImplicitRelationships) != 0 {
		t.Fatalf("floating Node relationship = %+v err=%v, want Node with no implicit Logic Gate", floating, err)
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

func TestMemoryProjectRelationshipsRejectNodeInAnotherProjectAndKeepAllRelationships(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-701400000103"
	repo.EnsureCompany(companyID, "Multi-project Logic Gate company")
	alphaResult, err := repo.CreateProject(ProjectInput{CompanyID: companyID, Name: "Alpha", Status: ProjectDefaultStatus})
	if err != nil || alphaResult.Project == nil {
		t.Fatalf("CreateProject Alpha = %+v err=%v", alphaResult, err)
	}
	bravoResult, err := repo.CreateProject(ProjectInput{CompanyID: companyID, Name: "Bravo", Status: ProjectDefaultStatus})
	if err != nil || bravoResult.Project == nil {
		t.Fatalf("CreateProject Bravo = %+v err=%v", bravoResult, err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Shared Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	alphaNode, err := repo.CreateNode(companyID, "Alpha Node")
	if err != nil {
		t.Fatalf("CreateNode Alpha: %v", err)
	}
	bravoNode, err := repo.CreateNode(companyID, "Bravo Node")
	if err != nil {
		t.Fatalf("CreateNode Bravo: %v", err)
	}
	priority := 2
	for _, nodeID := range []string{alphaNode.NodeID, bravoNode.NodeID} {
		if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
			CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: nodeID,
			Priority: &priority, PrioritySet: true,
		}); err != nil {
			t.Fatalf("AssignNodeToLogicGateStatus %s: %v", nodeID, err)
		}
	}

	alpha, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{
		CompanyID: companyID, ProjectID: alphaResult.Project.ProjectID,
		ResourceType: EntityTypeNode, ResourceID: alphaNode.NodeID,
	})
	if err != nil {
		t.Fatalf("UpsertProjectRelationship Alpha: %v", err)
	}
	bravo, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{
		CompanyID: companyID, ProjectID: bravoResult.Project.ProjectID,
		ResourceType: EntityTypeNode, ResourceID: bravoNode.NodeID,
	})
	if err != nil {
		t.Fatalf("UpsertProjectRelationship Bravo: %v", err)
	}
	if alpha.Relationship == nil || bravo.Relationship == nil || len(alpha.ImplicitRelationships) != 1 || len(bravo.ImplicitRelationships) != 1 {
		t.Fatalf("initial relationships missing node or implicit gate: alpha=%+v bravo=%+v", alpha, bravo)
	}
	if alpha.ImplicitRelationships[0].RelationshipID == bravo.ImplicitRelationships[0].RelationshipID {
		t.Fatalf("shared Logic Gate reused one relationship across Projects: alpha=%+v bravo=%+v", alpha.ImplicitRelationships[0], bravo.ImplicitRelationships[0])
	}

	gateRelationships, err := repo.ListProjectRelationshipsForResource(companyID, EntityTypeLogicGate, logicGate.LogicGateID, "")
	if err != nil || len(gateRelationships) != 2 {
		t.Fatalf("Logic Gate project relationships = %+v err=%v, want Alpha and Bravo", gateRelationships, err)
	}

	readded, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{
		CompanyID: companyID, ProjectID: alphaResult.Project.ProjectID,
		ResourceType: EntityTypeNode, ResourceID: alphaNode.NodeID,
	})
	if err != nil {
		t.Fatalf("re-add Alpha Node to Alpha: %v", err)
	}
	if readded.Relationship == nil || readded.Relationship.RelationshipID != alpha.Relationship.RelationshipID {
		t.Fatalf("same-Project re-add = %+v, want stable Node relationship %s", readded.Relationship, alpha.Relationship.RelationshipID)
	}

	_, err = repo.UpsertProjectRelationship(ProjectRelationshipInput{
		CompanyID: companyID, ProjectID: bravoResult.Project.ProjectID,
		ResourceType: EntityTypeNode, ResourceID: alphaNode.NodeID,
	})
	if !errors.Is(err, ErrProjectNodeInAnotherProject) {
		t.Fatalf("add Alpha Node to Bravo err = %v, want ErrProjectNodeInAnotherProject", err)
	}
	alphaRows, err := repo.ListProjectRelationshipProjections(companyID, alphaResult.Project.ProjectID)
	if err != nil || len(alphaRows) != 2 {
		t.Fatalf("Alpha relationships after rejected addition = %+v err=%v, want Node and Logic Gate unchanged", alphaRows, err)
	}
	bravoRows, err := repo.ListProjectRelationshipProjections(companyID, bravoResult.Project.ProjectID)
	if err != nil || len(bravoRows) != 2 {
		t.Fatalf("Bravo relationships after rejected addition = %+v err=%v, want its original Node and Logic Gate only", bravoRows, err)
	}
	gateRelationships, err = repo.ListProjectRelationshipsForResource(companyID, EntityTypeLogicGate, logicGate.LogicGateID, "")
	if err != nil || len(gateRelationships) != 2 {
		t.Fatalf("Logic Gate relationships after rejected addition = %+v err=%v, want both Projects unchanged", gateRelationships, err)
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
	before, err := repo.GetLogicGateWork(companyID, logicGate.LogicGateID, "")
	if err != nil || len(before.Nodes) != 1 || before.Nodes[0].HasProject {
		t.Fatalf("Logic Gate work before project = %+v err=%v, want one unmarked Node", before, err)
	}
	if _, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{
		CompanyID: companyID, ProjectID: projectResult.Project.ProjectID,
		ResourceType: EntityTypeNode, ResourceID: node.NodeID,
	}); err != nil {
		t.Fatalf("UpsertProjectRelationship: %v", err)
	}
	after, err := repo.GetLogicGateWork(companyID, logicGate.LogicGateID, "")
	if err != nil || len(after.Nodes) != 1 || !after.Nodes[0].HasProject {
		t.Fatalf("Logic Gate work after project = %+v err=%v, want one project-marked Node", after, err)
	}
}
