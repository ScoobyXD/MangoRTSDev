package store

import "testing"

func TestPostgresRealtimeProjectRelationshipsKeepLogicGateInManyProjects(t *testing.T) {
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

	moved, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{
		CompanyID: company.CompanyID, ProjectID: bravoResult.Project.ProjectID,
		ResourceType: EntityTypeNode, ResourceID: alphaNode.NodeID,
	})
	if err != nil {
		t.Fatalf("move Alpha Node to Bravo: %v", err)
	}
	if moved.Relationship == nil || moved.Relationship.RelationshipID != alpha.Relationship.RelationshipID || moved.Relationship.ProjectID != bravoResult.Project.ProjectID {
		t.Fatalf("moved Node relationship = %+v, want stable relationship in Bravo", moved.Relationship)
	}

	alphaRows, err := repo.ListProjectRelationshipProjections(company.CompanyID, alphaResult.Project.ProjectID)
	if err != nil || len(alphaRows) != 1 || alphaRows[0].ResourceType != EntityTypeLogicGate || alphaRows[0].ResourceID != logicGate.LogicGateID {
		t.Fatalf("Alpha relationships after Node move = %+v err=%v, want retained Logic Gate", alphaRows, err)
	}
	bravoRows, err := repo.ListProjectRelationshipProjections(company.CompanyID, bravoResult.Project.ProjectID)
	if err != nil || len(bravoRows) != 3 {
		t.Fatalf("Bravo relationships after Node move = %+v err=%v, want one Logic Gate and two Nodes", bravoRows, err)
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
		t.Fatalf("moved Node project relationship rows = %d, want 1", got)
	}
}
