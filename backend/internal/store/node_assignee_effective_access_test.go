package store

import (
	"errors"
	"miraeopus/backend/internal/domain"
	"slices"
	"testing"
	"time"
)

func TestMemoryNodeAssigneeScopedEffectiveAccessCreateUpdateClear(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "33333333-3333-4333-8333-333333333301"
	repo.EnsureCompany(companyID, "Node Assignee Effective Co")

	first := mustEffectiveAccessUser(t, repo, companyID, "node-assignee-first")
	second := mustEffectiveAccessUser(t, repo, companyID, "node-assignee-second")

	node, err := repo.CreateNodeWithAssignee(companyID, "Assigned node", first.UserID)
	if err != nil {
		t.Fatalf("CreateNodeWithAssignee: %v", err)
	}
	mustSetVisibleQueryPermission(t, repo, companyID, EntityTypeNode, node.NodeID, second.UserID, EntityPermissionNoAccess)
	assertEffectiveAccess(t, repo, companyID, first.UserID, EntityTypeNode, node.NodeID, EntityPermissionEdit, true)
	assertEffectiveAccess(t, repo, companyID, second.UserID, EntityTypeNode, node.NodeID, EntityPermissionView, false)

	updated, err := repo.UpdateNode(UpdateNodeInput{
		CompanyID:         companyID,
		NodeID:            node.NodeID,
		AssigneeUserID:    &second.UserID,
		AssigneeUserIDSet: true,
	})
	if err != nil {
		t.Fatalf("UpdateNode reassign: %v", err)
	}
	if updated.AssigneeUserID == nil || *updated.AssigneeUserID != second.UserID {
		t.Fatalf("updated assignee = %+v, want %s", updated.AssigneeUserID, second.UserID)
	}
	assertEffectiveAccess(t, repo, companyID, first.UserID, EntityTypeNode, node.NodeID, EntityPermissionView, false)
	assertEffectiveAccess(t, repo, companyID, second.UserID, EntityTypeNode, node.NodeID, EntityPermissionEdit, true)

	clear := ""
	cleared, err := repo.UpdateNode(UpdateNodeInput{
		CompanyID:         companyID,
		NodeID:            node.NodeID,
		AssigneeUserID:    &clear,
		AssigneeUserIDSet: true,
	})
	if err != nil {
		t.Fatalf("UpdateNode clear: %v", err)
	}
	if cleared.AssigneeUserID != nil {
		t.Fatalf("cleared assignee = %+v, want nil", cleared.AssigneeUserID)
	}
	assertEffectiveAccess(t, repo, companyID, first.UserID, EntityTypeNode, node.NodeID, EntityPermissionView, false)
	assertEffectiveAccess(t, repo, companyID, second.UserID, EntityTypeNode, node.NodeID, EntityPermissionView, false)
}

func TestMemoryNodeAssigneeScopedRemovalPreservesOtherSourceAccess(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "33333333-3333-4333-8333-333333333302"
	repo.EnsureCompany(companyID, "Node Assignee Overlap Co")

	first := mustEffectiveAccessUser(t, repo, companyID, "node-assignee-overlap-first")
	second := mustEffectiveAccessUser(t, repo, companyID, "node-assignee-overlap-second")

	node, err := repo.CreateNodeWithAssignee(companyID, "Overlap node", first.UserID)
	if err != nil {
		t.Fatalf("CreateNodeWithAssignee: %v", err)
	}
	mustSetVisibleQueryPermission(t, repo, companyID, EntityTypeNode, node.NodeID, second.UserID, EntityPermissionNoAccess)
	now := time.Now().UTC()
	otherSourceID := effectiveAccessSourceID(EntityTypeNode, node.NodeID, EntityPermissionSubjectUser, first.UserID)
	repo.effectiveAccess[effectiveAccessKey(companyID, first.UserID, EntityTypeNode, node.NodeID, "direct_user_grant", otherSourceID)] = domain.EffectiveResourceAccess{
		CompanyID:        companyID,
		UserID:           first.UserID,
		ResourceType:     EntityTypeNode,
		ResourceID:       node.NodeID,
		AccessLevel:      EntityPermissionView,
		SourceType:       "direct_user_grant",
		SourceID:         otherSourceID,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}

	if _, err := repo.UpdateNode(UpdateNodeInput{
		CompanyID:         companyID,
		NodeID:            node.NodeID,
		AssigneeUserID:    &second.UserID,
		AssigneeUserIDSet: true,
	}); err != nil {
		t.Fatalf("UpdateNode reassign: %v", err)
	}

	assertEffectiveAccess(t, repo, companyID, first.UserID, EntityTypeNode, node.NodeID, EntityPermissionView, true)
	assertEffectiveAccess(t, repo, companyID, first.UserID, EntityTypeNode, node.NodeID, EntityPermissionEdit, false)
	assertEffectiveAccess(t, repo, companyID, second.UserID, EntityTypeNode, node.NodeID, EntityPermissionEdit, true)
	users, err := repo.ListEffectiveUsersForResource(companyID, EntityTypeNode, node.NodeID, EntityPermissionView)
	if err != nil {
		t.Fatalf("ListEffectiveUsersForResource: %v", err)
	}
	if !slices.Contains(users, first.UserID) || !slices.Contains(users, second.UserID) {
		t.Fatalf("effective users = %+v, want both preserved source and new assignee", users)
	}
}

func TestMemoryNodeAssigneeEffectiveAccessFailureRollsBackSourceMutation(t *testing.T) {
	errEffective := errors.New("effective access failed")
	companyID := "33333333-3333-4333-8333-333333333303"

	t.Run("create", func(t *testing.T) {
		repo := NewMemoryRepo()
		repo.EnsureCompany(companyID, "Node Assignee Failure Create Co")
		assignee := mustEffectiveAccessUser(t, repo, companyID, "node-assignee-failure-create")
		repo.effectiveAccessErr = errEffective

		_, err := repo.CreateNodeWithAssignee(companyID, "No commit", assignee.UserID)
		if !errors.Is(err, errEffective) {
			t.Fatalf("err = %v, want effective access failure", err)
		}
		nodes, err := repo.ListNodes(companyID)
		if err != nil || len(nodes) != 0 {
			t.Fatalf("nodes after failed create = %+v err=%v, want none", nodes, err)
		}
	})

	t.Run("update", func(t *testing.T) {
		repo := NewMemoryRepo()
		repo.EnsureCompany(companyID, "Node Assignee Failure Update Co")
		first := mustEffectiveAccessUser(t, repo, companyID, "node-assignee-failure-first")
		second := mustEffectiveAccessUser(t, repo, companyID, "node-assignee-failure-second")
		node, err := repo.CreateNodeWithAssignee(companyID, "Keep assignee", first.UserID)
		if err != nil {
			t.Fatalf("CreateNodeWithAssignee setup: %v", err)
		}
		mustSetVisibleQueryPermission(t, repo, companyID, EntityTypeNode, node.NodeID, second.UserID, EntityPermissionNoAccess)
		repo.effectiveAccessErr = errEffective

		_, err = repo.UpdateNode(UpdateNodeInput{
			CompanyID:         companyID,
			NodeID:            node.NodeID,
			AssigneeUserID:    &second.UserID,
			AssigneeUserIDSet: true,
		})
		if !errors.Is(err, errEffective) {
			t.Fatalf("err = %v, want effective access failure", err)
		}
		got, err := repo.GetNode(companyID, node.NodeID)
		if err != nil {
			t.Fatalf("GetNode after failed update: %v", err)
		}
		if got.AssigneeUserID == nil || *got.AssigneeUserID != first.UserID {
			t.Fatalf("assignee after failed update = %+v, want original %s", got.AssigneeUserID, first.UserID)
		}
		repo.effectiveAccessErr = nil
		assertEffectiveAccess(t, repo, companyID, first.UserID, EntityTypeNode, node.NodeID, EntityPermissionEdit, true)
		assertEffectiveAccess(t, repo, companyID, second.UserID, EntityTypeNode, node.NodeID, EntityPermissionView, false)
	})
}
