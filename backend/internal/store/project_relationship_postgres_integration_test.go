package store

import (
	"errors"
	"testing"
)

func TestPostgresRealtimeProjectRelationshipsRejectNodeInAnotherProject(t *testing.T) {
	db, repo := openRealtimePostgresIntegration(t)
	company, err := repo.CreateCompany("Project relationship cardinality")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec("delete from companies where company_id=$1::uuid", company.CompanyID) })

	alphaResult, err := repo.CreateProject(ProjectInput{CompanyID: company.CompanyID, Name: "Alpha", Status: ProjectDefaultStatus})
	if err != nil || alphaResult.Project == nil {
		t.Fatalf("CreateProject Alpha = %+v err=%v", alphaResult, err)
	}
	bravoResult, err := repo.CreateProject(ProjectInput{CompanyID: company.CompanyID, Name: "Bravo", Status: ProjectDefaultStatus})
	if err != nil || bravoResult.Project == nil {
		t.Fatalf("CreateProject Bravo = %+v err=%v", bravoResult, err)
	}
	logicGate, err := repo.CreateLogicGate(company.CompanyID, "Shared Gate")
	if err != nil {
		t.Fatal(err)
	}
	alphaNode, err := repo.CreateNode(company.CompanyID, "Alpha Node")
	if err != nil {
		t.Fatal(err)
	}
	bravoNode, err := repo.CreateNode(company.CompanyID, "Bravo Node")
	if err != nil {
		t.Fatal(err)
	}
	priority := 2
	for _, nodeID := range []string{alphaNode.NodeID, bravoNode.NodeID} {
		if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
			CompanyID: company.CompanyID, LogicGateID: logicGate.LogicGateID, NodeID: nodeID,
			Priority: &priority, PrioritySet: true,
		}); err != nil {
			t.Fatalf("AssignNodeToLogicGateStatus %s: %v", nodeID, err)
		}
	}

	alpha, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{
		CompanyID: company.CompanyID, ProjectID: alphaResult.Project.ProjectID,
		ResourceType: EntityTypeNode, ResourceID: alphaNode.NodeID,
	})
	if err != nil {
		t.Fatalf("UpsertProjectRelationship Alpha: %v", err)
	}
	bravo, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{
		CompanyID: company.CompanyID, ProjectID: bravoResult.Project.ProjectID,
		ResourceType: EntityTypeNode, ResourceID: bravoNode.NodeID,
	})
	if err != nil {
		t.Fatalf("UpsertProjectRelationship Bravo: %v", err)
	}
	if alpha.Relationship == nil || bravo.Relationship == nil || len(alpha.ImplicitRelationships) != 1 || len(bravo.ImplicitRelationships) != 1 {
		t.Fatalf("initial relationships missing Node or Logic Gate: alpha=%+v bravo=%+v", alpha, bravo)
	}
	if alpha.ImplicitRelationships[0].RelationshipID == bravo.ImplicitRelationships[0].RelationshipID {
		t.Fatalf("Logic Gate reused one relationship across Projects: alpha=%+v bravo=%+v", alpha, bravo)
	}

	readded, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{
		CompanyID: company.CompanyID, ProjectID: alphaResult.Project.ProjectID,
		ResourceType: EntityTypeNode, ResourceID: alphaNode.NodeID,
	})
	if err != nil {
		t.Fatalf("re-add Alpha Node to Alpha: %v", err)
	}
	if readded.Relationship == nil || readded.Relationship.RelationshipID != alpha.Relationship.RelationshipID {
		t.Fatalf("same-Project re-add = %+v, want stable Node relationship %s", readded.Relationship, alpha.Relationship.RelationshipID)
	}

	_, err = repo.UpsertProjectRelationship(ProjectRelationshipInput{
		CompanyID: company.CompanyID, ProjectID: bravoResult.Project.ProjectID,
		ResourceType: EntityTypeNode, ResourceID: alphaNode.NodeID,
	})
	if !errors.Is(err, ErrProjectNodeInAnotherProject) {
		t.Fatalf("add Alpha Node to Bravo err = %v, want ErrProjectNodeInAnotherProject", err)
	}

	alphaRows, err := repo.ListProjectRelationshipProjections(company.CompanyID, alphaResult.Project.ProjectID)
	if err != nil || len(alphaRows) != 2 {
		t.Fatalf("Alpha relationships after rejected addition = %+v err=%v, want Node and Logic Gate unchanged", alphaRows, err)
	}
	bravoRows, err := repo.ListProjectRelationshipProjections(company.CompanyID, bravoResult.Project.ProjectID)
	if err != nil || len(bravoRows) != 2 {
		t.Fatalf("Bravo relationships after rejected addition = %+v err=%v, want its original Node and Logic Gate only", bravoRows, err)
	}
	if got := countPostgresRows(t, db, `
select count(*)
from project_relationships
where company_id=$1::uuid
  and resource_type='logic_gate'
  and resource_id=$2::uuid`, company.CompanyID, logicGate.LogicGateID); got != 2 {
		t.Fatalf("Logic Gate project relationship rows = %d, want 2", got)
	}
	if got := countPostgresRows(t, db, `
select count(*)
from project_relationships
where company_id=$1::uuid
  and resource_type='node'
  and resource_id=$2::uuid`, company.CompanyID, alphaNode.NodeID); got != 1 {
		t.Fatalf("Alpha Node project relationship rows = %d, want 1", got)
	}
	if got := countPostgresRows(t, db, `
select count(*)
from project_relationships
where company_id=$1::uuid
  and project_id=$2::uuid
  and resource_type='node'
  and resource_id=$3::uuid`, company.CompanyID, alphaResult.Project.ProjectID, alphaNode.NodeID); got != 1 {
		t.Fatalf("Alpha Node relationship rows in Alpha = %d, want 1", got)
	}
	if got := countPostgresRows(t, db, `
select count(*)
from project_relationships
where company_id=$1::uuid
  and project_id=$2::uuid
  and resource_type='node'
  and resource_id=$3::uuid`, company.CompanyID, bravoResult.Project.ProjectID, alphaNode.NodeID); got != 0 {
		t.Fatalf("Alpha Node relationship rows in Bravo = %d, want 0", got)
	}
}
