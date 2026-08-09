package store

import (
	"context"
	"miraeopus/backend/internal/domain"
	"os"
	"strings"
	"testing"
)

func TestMemoryProjectRelationshipAllowsEmailNodeAndPreservesEmailOrigin(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-701300000101"
	repo.EnsureCompany(companyID, "Email node project company")
	user := mustEmailCollaborationGuardUser(t, repo, companyID, "email-node-project-user", "project@example.com", domain.RoleCompanyUser)
	projectResult, err := repo.CreateProject(ProjectInput{
		CompanyID: companyID, Name: "Email project", Status: "Active", ActorUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	priority := 3
	collaborationResult, err := repo.EnsureCommunicationsEmailCollaboration(context.Background(), CommunicationsEmailCollaborationEnsureInput{
		CompanyID: companyID, PersonalUserID: user.UserID, PersonalAccountEmail: user.Email,
		AccountEmail: user.Email, Provider: "google", CreatedByUserID: user.UserID, Priority: &priority,
		Message: domain.EmailMessageSnapshot{ID: "project-email-message", ThreadID: "project-email-thread", Subject: "Project email node"},
	})
	if err != nil {
		t.Fatalf("EnsureCommunicationsEmailCollaboration: %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Email project gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID: companyID, LogicGateID: logicGate.LogicGateID,
		NodeID: collaborationResult.Collaboration.NodeID, Priority: &priority, PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	relationshipID := NewUUIDv7String()
	result, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{
		CompanyID: companyID, RelationshipID: relationshipID, ProjectID: projectResult.Project.ProjectID,
		ResourceType: EntityTypeNode, ResourceID: collaborationResult.Collaboration.NodeID,
	})
	if err != nil {
		t.Fatalf("UpsertProjectRelationship email node: %v", err)
	}
	if result.Relationship == nil || result.Relationship.NodeID == nil || *result.Relationship.NodeID != collaborationResult.Collaboration.NodeID {
		t.Fatalf("email node relationship = %+v", result.Relationship)
	}
	projections, err := repo.ListProjectRelationshipProjections(companyID, projectResult.Project.ProjectID)
	if err != nil || len(projections) != 2 {
		t.Fatalf("email node project projections = %+v err=%v, want node and implicit gate", projections, err)
	}
	var foundEmailNode bool
	for _, projection := range projections {
		if projection.ResourceType == EntityTypeNode && projection.ResourceID == collaborationResult.Collaboration.NodeID && projection.CreatedFromEmail {
			foundEmailNode = true
		}
	}
	if !foundEmailNode {
		t.Fatalf("email node project projections = %+v, want created_from_email node", projections)
	}
	deleted, err := repo.DeleteProjectRelationship(ProjectRelationshipDeleteInput{
		CompanyID: companyID, ProjectID: projectResult.Project.ProjectID, RelationshipID: relationshipID,
	})
	if err != nil || deleted.DeletedRelationshipID != relationshipID {
		t.Fatalf("DeleteProjectRelationship = %+v err=%v", deleted, err)
	}
}

func TestPostgresProjectRelationshipAllowsEmailNodeAttach(t *testing.T) {
	raw, err := os.ReadFile("postgres_projects.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_projects.go: %v", err)
	}
	source := strings.ReplaceAll(string(raw), "\r\n", "\n")
	upsert := extractFunctionSourceForTest(t, source, "func (r *PostgresRepo) UpsertProjectRelationship")
	if strings.Contains(upsert, "postgresRejectEmailCollaborationNodeMutation") {
		t.Fatal("UpsertProjectRelationship must allow email-derived Nodes to use normal Project behavior")
	}

}
