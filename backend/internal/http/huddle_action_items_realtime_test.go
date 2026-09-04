package httpapi

import (
	"context"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestHuddleActionItemsRealtimeAdmissionUsesExactNodeAndBoardEditAccess(t *testing.T) {
	repo := store.NewMemoryRepo()
	const companyID = "41414141-4141-4141-8141-410000000001"
	repo.EnsureCompany(companyID, "Huddle realtime admission")
	editor := mustRealtimeAuthUser(t, repo, companyID, "huddle-realtime-editor", domain.RoleCompanyUser)
	memberWithoutEdit := mustRealtimeAuthUser(t, repo, companyID, "huddle-realtime-viewer", domain.RoleCompanyUser)
	board, err := repo.CreateHuddleLogicGate(store.HuddleCreateInput{CompanyID: companyID, Name: "Daily", ActorID: editor.UserID})
	if err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateHuddleNode(store.HuddleCreateInput{CompanyID: companyID, OwnerID: board.HuddleLogicGateID, Name: "Today", ActorID: editor.UserID})
	if err != nil {
		t.Fatal(err)
	}
	for _, resource := range []struct {
		resourceType string
		resourceID   string
	}{
		{resourceType: store.EntityTypeHuddleLogicGate, resourceID: board.HuddleLogicGateID},
		{resourceType: store.EntityTypeHuddleNode, resourceID: node.HuddleNodeID},
	} {
		if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
			CompanyID: companyID, EntityType: resource.resourceType, EntityID: resource.resourceID,
			DefaultAccess: store.EntityPermissionNoAccess, DefaultAccessSet: true,
			Permissions: []store.EntityPermissionInput{
				{SubjectType: store.EntityPermissionSubjectUser, SubjectID: editor.UserID, AccessLevel: store.EntityPermissionEdit},
				{SubjectType: store.EntityPermissionSubjectUser, SubjectID: memberWithoutEdit.UserID, AccessLevel: store.EntityPermissionNoAccess},
			},
			ActorUserID: editor.UserID,
		}); err != nil {
			t.Fatal(err)
		}
	}

	server := NewServer(repo)
	defer server.Close()
	actorFor := func(user domain.User, activeCompanyID string) ActorContext {
		t.Helper()
		memberships, err := repo.ListUserMemberships(user.UserID)
		if err != nil {
			t.Fatal(err)
		}
		return ActorContext{User: user, Memberships: memberships, CompanyID: activeCompanyID, CompanyRole: actorRoleForCompany(ActorContext{Memberships: memberships}, activeCompanyID)}
	}
	editorActor := actorFor(editor, companyID)
	viewerActor := actorFor(memberWithoutEdit, companyID)
	nodeScope := store.HuddleActionItemsRealtimeScopePrefix + node.HuddleNodeID
	boardScope := store.HuddleBoardActionItemsRealtimeScopePrefix + board.HuddleLogicGateID

	for _, scope := range []string{nodeScope, boardScope} {
		authorized, rejectCode, err := server.authorizeRealtimeSubscription(context.Background(), editorActor, companyID, scope)
		if err != nil || !authorized || rejectCode != "" {
			t.Fatalf("editor admission for %q = authorized %v reject %q err %v", scope, authorized, rejectCode, err)
		}
		authorized, rejectCode, err = server.authorizeRealtimeSubscription(context.Background(), viewerActor, companyID, scope)
		if err != nil || authorized || rejectCode != "access_denied" {
			t.Fatalf("member without exact edit admission for %q = authorized %v reject %q err %v", scope, authorized, rejectCode, err)
		}
	}

	otherCompany, err := repo.CreateCompany("Other Huddle realtime company")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(editor.CognitoSubject, otherCompany.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	editorWithBothCompanies := actorFor(editor, otherCompany.CompanyID)
	for _, scope := range []string{nodeScope, boardScope} {
		authorized, rejectCode, err := server.authorizeRealtimeSubscription(context.Background(), editorWithBothCompanies, otherCompany.CompanyID, scope)
		if err != nil || authorized || rejectCode != "resource_not_found" {
			t.Fatalf("wrong-company admission for %q = authorized %v reject %q err %v", scope, authorized, rejectCode, err)
		}
	}

	for _, scope := range []string{
		store.HuddleActionItemsRealtimeScopePrefix + "not-a-uuid",
		store.HuddleActionItemsRealtimeScopePrefix + node.HuddleNodeID + ":extra",
		store.HuddleBoardActionItemsRealtimeScopePrefix + "not-a-uuid",
		store.HuddleBoardActionItemsRealtimeScopePrefix + board.HuddleLogicGateID + ":extra",
	} {
		authorized, rejectCode, err := server.authorizeRealtimeSubscription(context.Background(), editorActor, companyID, scope)
		if err != nil || authorized || rejectCode != "invalid_scope" {
			t.Fatalf("invalid admission for %q = authorized %v reject %q err %v", scope, authorized, rejectCode, err)
		}
	}
}
