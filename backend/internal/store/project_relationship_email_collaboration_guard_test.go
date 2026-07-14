package store

import (
	"errors"
	"miraeopus/backend/internal/domain"
	"os"
	"strings"
	"testing"
	"time"
)

func TestMemoryProjectRelationshipRejectsEmailCollaborationNodeAttachAndAllowsCleanup(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-701300000101"
	repo.EnsureCompany(companyID, "Project relationship guard company")
	user, err := repo.UpsertAuthUser("project-relationship-guard-user", "guard@example.com", "Project Relationship Guard")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership("project-relationship-guard-user", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}
	projectResult, err := repo.CreateProject(ProjectInput{
		CompanyID: companyID, Name: "Guard target", Status: "Active", ActorUserID: user.UserID,
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	collaborationResult, err := repo.EnsureCommunicationsEmailCollaboration(CommunicationsEmailCollaborationEnsureInput{
		CompanyID:            companyID,
		PersonalUserID:       user.UserID,
		PersonalAccountEmail: user.Email,
		AccountEmail:         user.Email,
		CreatedByUserID:      user.UserID,
		Message: domain.EmailMessageSnapshot{
			ID: "project-guard-message", ThreadID: "project-guard-thread", Subject: "Protected standalone email",
		},
	})
	if err != nil {
		t.Fatalf("EnsureCommunicationsEmailCollaboration: %v", err)
	}

	if _, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{
		CompanyID:      companyID,
		RelationshipID: NewUUIDv7String(),
		ProjectID:      projectResult.Project.ProjectID,
		ResourceType:   EntityTypeNode,
		ResourceID:     collaborationResult.Collaboration.NodeID,
	}); !errors.Is(err, ErrProtectedEmailCollaborationResource) {
		t.Fatalf("UpsertProjectRelationship collaboration Node error = %v, want protected", err)
	}
	if relationships, err := repo.ListProjectRelationshipProjections(companyID, projectResult.Project.ProjectID); err != nil || len(relationships) != 0 {
		t.Fatalf("relationships after rejected attach = %+v err=%v, want none", relationships, err)
	}

	ordinaryNode, err := repo.CreateNode(companyID, "Ordinary project Node")
	if err != nil {
		t.Fatalf("CreateNode ordinary: %v", err)
	}
	ordinaryResult, err := repo.UpsertProjectRelationship(ProjectRelationshipInput{
		CompanyID:      companyID,
		RelationshipID: NewUUIDv7String(),
		ProjectID:      projectResult.Project.ProjectID,
		ResourceType:   EntityTypeNode,
		ResourceID:     ordinaryNode.NodeID,
	})
	if err != nil {
		t.Fatalf("UpsertProjectRelationship ordinary Node: %v", err)
	}
	if ordinaryResult.Relationship == nil || ordinaryResult.Relationship.NodeID == nil || *ordinaryResult.Relationship.NodeID != ordinaryNode.NodeID {
		t.Fatalf("ordinary relationship = %+v, want Node %s", ordinaryResult.Relationship, ordinaryNode.NodeID)
	}

	// Seed the shape of a legacy/erroneous relation to prove the delete path is
	// intentionally still available for cleanup. New generic attaches cannot
	// create this state.
	legacyRelationshipID := NewUUIDv7String()
	now := time.Now().UTC()
	repo.mu.Lock()
	repo.projectRelationships[projectRelationshipKey(companyID, legacyRelationshipID)] = domain.ProjectRelationship{
		CompanyID:        companyID,
		RelationshipID:   legacyRelationshipID,
		ProjectID:        projectResult.Project.ProjectID,
		ResourceType:     EntityTypeNode,
		ResourceID:       collaborationResult.Collaboration.NodeID,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	repo.mu.Unlock()
	deleted, err := repo.DeleteProjectRelationship(ProjectRelationshipDeleteInput{
		CompanyID: companyID, ProjectID: projectResult.Project.ProjectID, RelationshipID: legacyRelationshipID,
	})
	if err != nil {
		t.Fatalf("DeleteProjectRelationship legacy collaboration relation: %v", err)
	}
	if deleted.DeletedRelationshipID != legacyRelationshipID {
		t.Fatalf("deleted relationship = %s, want %s", deleted.DeletedRelationshipID, legacyRelationshipID)
	}
	repo.mu.RLock()
	_, stillStored := repo.projectRelationships[projectRelationshipKey(companyID, legacyRelationshipID)]
	repo.mu.RUnlock()
	if stillStored {
		t.Fatal("legacy collaboration project relationship remained after cleanup delete")
	}
}

func TestPostgresProjectRelationshipGuardsCollaborationAttachButNotCleanup(t *testing.T) {
	raw, err := os.ReadFile("postgres_projects.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_projects.go: %v", err)
	}
	source := strings.ReplaceAll(string(raw), "\r\n", "\n")
	upsert := strings.ToLower(strings.Join(strings.Fields(emailCollaborationPostgresFunctionBodyForTest(
		t, source, "func (r *PostgresRepo) UpsertProjectRelationship",
	)), " "))
	for _, want := range []string{
		"if input.resourcetype == entitytypenode",
		"postgresrejectemailcollaborationnodemutation(ctx, tx, input.companyid, input.resourceid)",
	} {
		if !strings.Contains(upsert, want) {
			t.Fatalf("UpsertProjectRelationship missing collaboration-scoped attach guard %q", want)
		}
	}
	guardIndex := strings.Index(upsert, "postgresrejectemailcollaborationnodemutation")
	insertIndex := strings.Index(upsert, "insert into project_relationships")
	if guardIndex < 0 || insertIndex < 0 || guardIndex > insertIndex {
		t.Fatalf("UpsertProjectRelationship guard must run before write: guard=%d insert=%d", guardIndex, insertIndex)
	}

	deleteBody := emailCollaborationPostgresFunctionBodyForTest(t, source, "func (r *PostgresRepo) DeleteProjectRelationship")
	if strings.Contains(deleteBody, "postgresRejectEmailCollaborationNodeMutation") || strings.Contains(deleteBody, "ErrProtectedEmailCollaborationResource") {
		t.Fatal("DeleteProjectRelationship must remain available to clean up a legacy collaboration relation")
	}
}
