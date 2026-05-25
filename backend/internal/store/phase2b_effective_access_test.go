package store

import (
	"miraeopus/backend/internal/domain"
	"reflect"
	"testing"
)

func TestMemoryDerivedAccessSourcesDoNotCreateCompatibilityResourceGrants(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "55555555-5555-4555-8555-555555555507"
	repo.EnsureCompany(companyID, "Phase 3 Compatibility Cleanup Co")

	raciUser := mustEffectiveAccessUser(t, repo, companyID, "phase3-raci-user")
	commandUser := mustEffectiveAccessUser(t, repo, companyID, "phase3-raci-command-user")
	assignee := mustEffectiveAccessUser(t, repo, companyID, "phase3-assignee-user")
	gate, err := repo.CreateLogicGate(companyID, "Compatibility cleanup gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Compatibility cleanup node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}

	if _, err := repo.SetLogicGateRaciAssignments(LogicGateRaciAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: gate.LogicGateID,
		Assignments: []LogicGateRaciAssignmentInput{{
			Role:   domain.LogicGateRaciRoleResponsible,
			UserID: raciUser.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetLogicGateRaciAssignments: %v", err)
	}
	if _, err := repo.AddLogicGateRaciAssignments(LogicGateRaciAssignmentCommandInput{
		CompanyID:   companyID,
		LogicGateID: gate.LogicGateID,
		Assignments: []LogicGateRaciAssignmentInput{{
			Role:   domain.LogicGateRaciRoleConsulted,
			UserID: commandUser.UserID,
		}},
	}); err != nil {
		t.Fatalf("AddLogicGateRaciAssignments: %v", err)
	}
	gatePermissions, err := repo.ListEntityPermissions(companyID, EntityTypeLogicGate, gate.LogicGateID)
	if err != nil {
		t.Fatalf("ListEntityPermissions gate: %v", err)
	}
	if len(gatePermissions) != 0 {
		t.Fatalf("Logic Gate RACI created compatibility resource grants: %+v", gatePermissions)
	}
	assertEffectiveAccess(t, repo, companyID, raciUser.UserID, EntityTypeLogicGate, gate.LogicGateID, EntityPermissionEdit, true)
	assertEffectiveAccess(t, repo, companyID, commandUser.UserID, EntityTypeLogicGate, gate.LogicGateID, EntityPermissionEdit, true)

	if _, err := repo.UpdateNode(UpdateNodeInput{
		CompanyID:         companyID,
		NodeID:            node.NodeID,
		AssigneeUserID:    &assignee.UserID,
		AssigneeUserIDSet: true,
	}); err != nil {
		t.Fatalf("UpdateNode assignee: %v", err)
	}
	nodePermissions, err := repo.ListEntityPermissions(companyID, EntityTypeNode, node.NodeID)
	if err != nil {
		t.Fatalf("ListEntityPermissions node: %v", err)
	}
	if len(nodePermissions) != 0 {
		t.Fatalf("node assignee created compatibility resource grants: %+v", nodePermissions)
	}
	assertEffectiveAccess(t, repo, companyID, assignee.UserID, EntityTypeNode, node.NodeID, EntityPermissionEdit, true)
}

func TestMemorySharedInboxRaciIsNotificationOnlyForEffectiveAccess(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "55555555-5555-4555-8555-555555555502"
	repo.EnsureCompany(companyID, "Phase 2B Shared RACI Co")

	user := mustEffectiveAccessUser(t, repo, companyID, "phase2b-shared-user")
	parentMember := mustEffectiveAccessUser(t, repo, companyID, "phase2b-shared-parent-member")
	childMember := mustEffectiveAccessUser(t, repo, companyID, "phase2b-shared-child-member")
	parentGroup, err := repo.CreateCompanyUserGroup(companyID, "", "Operations")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup parent: %v", err)
	}
	childGroup, err := repo.CreateCompanyUserGroup(companyID, parentGroup.GroupID, "Night Shift")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup child: %v", err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, parentGroup.GroupID, []string{parentMember.UserID}); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers parent: %v", err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, childGroup.GroupID, []string{childMember.UserID}); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers child: %v", err)
	}
	parent, err := repo.CreateCompanyExplorerFolder(companyID, "", "communications", "Inbox")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder parent: %v", err)
	}
	child, err := repo.CreateCompanyExplorerFolder(companyID, parent.FolderID, "communications", "Child")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder child: %v", err)
	}
	grandchild, err := repo.CreateCompanyExplorerFolder(companyID, child.FolderID, "communications", "Grandchild")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder grandchild: %v", err)
	}

	if _, err := repo.SetCommunicationsSharedInboxRaciAssignments(SharedInboxRaciAssignmentUpdateInput{
		CompanyID: companyID,
		FolderID:  parent.FolderID,
		Assignments: []SharedInboxRaciAssignmentInput{
			{Role: domain.LogicGateRaciRoleResponsible, SubjectType: EntityPermissionSubjectUser, SubjectID: user.UserID},
			{Role: domain.LogicGateRaciRoleConsulted, SubjectType: EntityPermissionSubjectGroup, SubjectID: parentGroup.GroupID},
		},
	}); err != nil {
		t.Fatalf("SetCommunicationsSharedInboxRaciAssignments: %v", err)
	}

	for _, folderID := range []string{parent.FolderID, child.FolderID, grandchild.FolderID} {
		assertNoEffectiveSourceRows(t, repo, companyID, EntityTypeSharedTriageFolder, folderID, effectiveAccessSourceSharedTriageRaci)
		assertEffectiveAccess(t, repo, companyID, user.UserID, EntityTypeSharedTriageFolder, folderID, EntityPermissionView, false)
		assertEffectiveAccess(t, repo, companyID, parentMember.UserID, EntityTypeSharedTriageFolder, folderID, EntityPermissionView, false)
		assertEffectiveAccess(t, repo, companyID, childMember.UserID, EntityTypeSharedTriageFolder, folderID, EntityPermissionView, false)
	}

	if _, err := repo.SetCompanyUserGroupMembers(companyID, childGroup.GroupID, nil); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers remove child: %v", err)
	}
	assertEffectiveAccess(t, repo, companyID, childMember.UserID, EntityTypeSharedTriageFolder, grandchild.FolderID, EntityPermissionView, false)
	assertEffectiveAccess(t, repo, companyID, parentMember.UserID, EntityTypeSharedTriageFolder, grandchild.FolderID, EntityPermissionView, false)

	if _, err := repo.SetCommunicationsSharedInboxRaciAssignments(SharedInboxRaciAssignmentUpdateInput{
		CompanyID: companyID,
		FolderID:  parent.FolderID,
	}); err != nil {
		t.Fatalf("SetCommunicationsSharedInboxRaciAssignments clear: %v", err)
	}
	assertNoEffectiveSourceRows(t, repo, companyID, EntityTypeSharedTriageFolder, parent.FolderID, effectiveAccessSourceSharedTriageRaci)
	assertNoEffectiveSourceRows(t, repo, companyID, EntityTypeSharedTriageFolder, child.FolderID, effectiveAccessSourceSharedTriageRaci)
	assertNoEffectiveSourceRows(t, repo, companyID, EntityTypeSharedTriageFolder, grandchild.FolderID, effectiveAccessSourceSharedTriageRaci)
	assertEffectiveAccess(t, repo, companyID, user.UserID, EntityTypeSharedTriageFolder, grandchild.FolderID, EntityPermissionView, false)
	assertEffectiveAccess(t, repo, companyID, parentMember.UserID, EntityTypeSharedTriageFolder, grandchild.FolderID, EntityPermissionView, false)
}

func TestMemoryLogicGateAssignedNodeVisibilityAssignmentRemovalAndNoOpMoves(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "55555555-5555-4555-8555-555555555503"
	repo.EnsureCompany(companyID, "Phase 2B Gate Visibility Co")

	viewer := mustEffectiveAccessUser(t, repo, companyID, "phase2b-gate-viewer")
	responsible := mustEffectiveAccessUser(t, repo, companyID, "phase2b-gate-responsible")
	gate, err := repo.CreateLogicGate(companyID, "Visibility gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Visibility node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeLogicGate,
		EntityID:   gate.LogicGateID,
		Permissions: []EntityPermissionInput{{
			SubjectType: EntityPermissionSubjectUser,
			SubjectID:   viewer.UserID,
			AccessLevel: EntityPermissionView,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions gate: %v", err)
	}
	if _, err := repo.SetLogicGateRaciAssignments(LogicGateRaciAssignmentUpdateInput{
		CompanyID:   companyID,
		LogicGateID: gate.LogicGateID,
		Assignments: []LogicGateRaciAssignmentInput{{
			Role:   domain.LogicGateRaciRoleResponsible,
			UserID: responsible.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetLogicGateRaciAssignments responsible: %v", err)
	}
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: gate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "pending",
		NodeTitle:   node.Title,
		Priority:    testPriority(3),
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	assertEffectiveAccess(t, repo, companyID, viewer.UserID, EntityTypeNode, node.NodeID, EntityPermissionView, true)
	assertEffectiveAccess(t, repo, companyID, responsible.UserID, EntityTypeNode, node.NodeID, EntityPermissionView, true)

	before := effectiveSourceRowsByKey(repo, companyID, effectiveAccessSourceGateVisibility)
	if _, err := repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{
		CompanyID:   companyID,
		LogicGateID: gate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "done",
	}); err != nil {
		t.Fatalf("MoveLogicGateNodeAssignment status: %v", err)
	}
	afterStatusMove := effectiveSourceRowsByKey(repo, companyID, effectiveAccessSourceGateVisibility)
	if !reflect.DeepEqual(afterStatusMove, before) {
		t.Fatalf("status-only move rewrote gate visibility facts\nbefore=%+v\nafter=%+v", before, afterStatusMove)
	}
	if _, err := repo.SetLogicGateNodeAssignmentIssue(LogicGateNodeAssignmentIssueInput{
		CompanyID:   companyID,
		LogicGateID: gate.LogicGateID,
		NodeID:      node.NodeID,
		IsIssue:     true,
	}); err != nil {
		t.Fatalf("SetLogicGateNodeAssignmentIssue: %v", err)
	}
	afterIssueToggle := effectiveSourceRowsByKey(repo, companyID, effectiveAccessSourceGateVisibility)
	if !reflect.DeepEqual(afterIssueToggle, before) {
		t.Fatalf("issue toggle rewrote gate visibility facts\nbefore=%+v\nafter=%+v", before, afterIssueToggle)
	}

	if _, err := repo.MoveLogicGateNodeAssignment(LogicGateNodeAssignmentMoveInput{
		CompanyID:         companyID,
		LogicGateID:       gate.LogicGateID,
		NodeID:            node.NodeID,
		AssigneePolicy:    LogicGateAssignmentAssigneePolicyFirstResponsible,
		AssigneePolicySet: true,
	}); err != nil {
		t.Fatalf("MoveLogicGateNodeAssignment assignee policy: %v", err)
	}
	assertEffectiveAccess(t, repo, companyID, responsible.UserID, EntityTypeNode, node.NodeID, EntityPermissionEdit, true)

	if _, err := repo.RemoveLogicGateNodeAssignment(LogicGateNodeAssignmentRemoveInput{
		CompanyID:   companyID,
		LogicGateID: gate.LogicGateID,
		NodeID:      node.NodeID,
	}); err != nil {
		t.Fatalf("RemoveLogicGateNodeAssignment: %v", err)
	}
	assertNoEffectiveSourceRows(t, repo, companyID, EntityTypeNode, node.NodeID, effectiveAccessSourceGateVisibility)
	assertEffectiveAccess(t, repo, companyID, responsible.UserID, EntityTypeNode, node.NodeID, EntityPermissionEdit, true)
}

func TestMemoryGroupHierarchyUpdatesGroupDerivedEffectiveFacts(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "55555555-5555-4555-8555-555555555504"
	repo.EnsureCompany(companyID, "Phase 2B Group Hierarchy Co")

	parentUser := mustEffectiveAccessUser(t, repo, companyID, "phase2b-group-parent-user")
	childUser := mustEffectiveAccessUser(t, repo, companyID, "phase2b-group-child-user")
	parentGroup, err := repo.CreateCompanyUserGroup(companyID, "", "Parent")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup parent: %v", err)
	}
	childGroup, err := repo.CreateCompanyUserGroup(companyID, parentGroup.GroupID, "Child")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup child: %v", err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, parentGroup.GroupID, []string{parentUser.UserID}); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers parent: %v", err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, childGroup.GroupID, []string{childUser.UserID}); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers child: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Group grant node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	folder, err := repo.CreateCompanyExplorerFolder(companyID, "", "communications", "Group RACI inbox")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder: %v", err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeNode,
		EntityID:   node.NodeID,
		Permissions: []EntityPermissionInput{{
			SubjectType: EntityPermissionSubjectGroup,
			SubjectID:   parentGroup.GroupID,
			AccessLevel: EntityPermissionView,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions group grant: %v", err)
	}
	if _, err := repo.SetCommunicationsSharedInboxRaciAssignments(SharedInboxRaciAssignmentUpdateInput{
		CompanyID: companyID,
		FolderID:  folder.FolderID,
		Assignments: []SharedInboxRaciAssignmentInput{{
			Role:        domain.LogicGateRaciRoleResponsible,
			SubjectType: EntityPermissionSubjectGroup,
			SubjectID:   parentGroup.GroupID,
		}},
	}); err != nil {
		t.Fatalf("SetCommunicationsSharedInboxRaciAssignments: %v", err)
	}
	assertEffectiveAccess(t, repo, companyID, parentUser.UserID, EntityTypeNode, node.NodeID, EntityPermissionView, true)
	assertEffectiveAccess(t, repo, companyID, childUser.UserID, EntityTypeNode, node.NodeID, EntityPermissionView, true)
	assertEffectiveAccess(t, repo, companyID, parentUser.UserID, EntityTypeSharedTriageFolder, folder.FolderID, EntityPermissionView, false)
	assertEffectiveAccess(t, repo, companyID, childUser.UserID, EntityTypeSharedTriageFolder, folder.FolderID, EntityPermissionView, false)

	rootParent := ""
	if _, err := repo.UpdateCompanyUserGroup(companyID, childGroup.GroupID, &rootParent, "", 0); err != nil {
		t.Fatalf("UpdateCompanyUserGroup move child to root: %v", err)
	}
	assertEffectiveAccess(t, repo, companyID, parentUser.UserID, EntityTypeNode, node.NodeID, EntityPermissionView, true)
	assertEffectiveAccess(t, repo, companyID, childUser.UserID, EntityTypeNode, node.NodeID, EntityPermissionView, false)
	assertEffectiveAccess(t, repo, companyID, parentUser.UserID, EntityTypeSharedTriageFolder, folder.FolderID, EntityPermissionView, false)
	assertEffectiveAccess(t, repo, companyID, childUser.UserID, EntityTypeSharedTriageFolder, folder.FolderID, EntityPermissionView, false)

	if err := repo.DeleteCompanyUserGroup(companyID, parentGroup.GroupID); err != nil {
		t.Fatalf("DeleteCompanyUserGroup: %v", err)
	}
	assertEffectiveAccess(t, repo, companyID, parentUser.UserID, EntityTypeNode, node.NodeID, EntityPermissionEdit, true)
	assertEffectiveAccess(t, repo, companyID, parentUser.UserID, EntityTypeSharedTriageFolder, folder.FolderID, EntityPermissionView, false)
	assertNoEffectiveSourceRows(t, repo, companyID, EntityTypeNode, node.NodeID, effectiveAccessSourceDirectGroupGrant)
	assertNoEffectiveSourceRows(t, repo, companyID, EntityTypeSharedTriageFolder, folder.FolderID, effectiveAccessSourceSharedTriageRaci)
}

func TestMemorySharedTriageFolderHierarchyCreateMoveDeleteMaintainsInheritedFacts(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "55555555-5555-4555-8555-555555555505"
	repo.EnsureCompany(companyID, "Phase 2B Folder Hierarchy Co")

	oldGrantUser := mustEffectiveAccessUser(t, repo, companyID, "phase2b-folder-old-grant")
	oldRaciUser := mustEffectiveAccessUser(t, repo, companyID, "phase2b-folder-old-raci")
	newGrantUser := mustEffectiveAccessUser(t, repo, companyID, "phase2b-folder-new-grant")
	newRaciUser := mustEffectiveAccessUser(t, repo, companyID, "phase2b-folder-new-raci")
	oldParent, err := repo.CreateCompanyExplorerFolder(companyID, "", "communications", "Old parent")
	if err != nil {
		t.Fatalf("Create old parent: %v", err)
	}
	newParent, err := repo.CreateCompanyExplorerFolder(companyID, "", "communications", "New parent")
	if err != nil {
		t.Fatalf("Create new parent: %v", err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeSharedTriageFolder,
		EntityID:   oldParent.FolderID,
		Permissions: []EntityPermissionInput{{
			SubjectType: EntityPermissionSubjectUser,
			SubjectID:   oldGrantUser.UserID,
			AccessLevel: EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatalf("Set old parent permissions: %v", err)
	}
	if _, err := repo.SetCommunicationsSharedInboxRaciAssignments(SharedInboxRaciAssignmentUpdateInput{
		CompanyID: companyID,
		FolderID:  oldParent.FolderID,
		Assignments: []SharedInboxRaciAssignmentInput{{
			Role:        domain.LogicGateRaciRoleResponsible,
			SubjectType: EntityPermissionSubjectUser,
			SubjectID:   oldRaciUser.UserID,
		}},
	}); err != nil {
		t.Fatalf("Set old parent RACI: %v", err)
	}
	if _, err := repo.SetEntityPermissions(EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: EntityTypeSharedTriageFolder,
		EntityID:   newParent.FolderID,
		Permissions: []EntityPermissionInput{{
			SubjectType: EntityPermissionSubjectUser,
			SubjectID:   newGrantUser.UserID,
			AccessLevel: EntityPermissionAdmin,
		}},
	}); err != nil {
		t.Fatalf("Set new parent permissions: %v", err)
	}
	if _, err := repo.SetCommunicationsSharedInboxRaciAssignments(SharedInboxRaciAssignmentUpdateInput{
		CompanyID: companyID,
		FolderID:  newParent.FolderID,
		Assignments: []SharedInboxRaciAssignmentInput{{
			Role:        domain.LogicGateRaciRoleConsulted,
			SubjectType: EntityPermissionSubjectUser,
			SubjectID:   newRaciUser.UserID,
		}},
	}); err != nil {
		t.Fatalf("Set new parent RACI: %v", err)
	}

	child, err := repo.CreateCompanyExplorerFolder(companyID, oldParent.FolderID, "communications", "Inherited child")
	if err != nil {
		t.Fatalf("Create child: %v", err)
	}
	grandchild, err := repo.CreateCompanyExplorerFolder(companyID, child.FolderID, "communications", "Inherited grandchild")
	if err != nil {
		t.Fatalf("Create grandchild: %v", err)
	}
	for _, folderID := range []string{child.FolderID, grandchild.FolderID} {
		assertEffectiveAccess(t, repo, companyID, oldGrantUser.UserID, EntityTypeSharedTriageFolder, folderID, EntityPermissionEdit, true)
		assertEffectiveAccess(t, repo, companyID, oldRaciUser.UserID, EntityTypeSharedTriageFolder, folderID, EntityPermissionView, false)
		assertEffectiveAccess(t, repo, companyID, newGrantUser.UserID, EntityTypeSharedTriageFolder, folderID, EntityPermissionView, false)
	}

	if _, err := repo.MoveCompanyExplorerFolder(companyID, child.FolderID, &newParent.FolderID, 0); err != nil {
		t.Fatalf("MoveCompanyExplorerFolder: %v", err)
	}
	for _, folderID := range []string{child.FolderID, grandchild.FolderID} {
		assertEffectiveAccess(t, repo, companyID, oldGrantUser.UserID, EntityTypeSharedTriageFolder, folderID, EntityPermissionView, false)
		assertEffectiveAccess(t, repo, companyID, oldRaciUser.UserID, EntityTypeSharedTriageFolder, folderID, EntityPermissionView, false)
		assertEffectiveAccess(t, repo, companyID, newGrantUser.UserID, EntityTypeSharedTriageFolder, folderID, EntityPermissionAdmin, true)
		assertEffectiveAccess(t, repo, companyID, newRaciUser.UserID, EntityTypeSharedTriageFolder, folderID, EntityPermissionView, false)
	}

	if err := repo.DeleteCompanyExplorerFolder(companyID, child.FolderID); err != nil {
		t.Fatalf("DeleteCompanyExplorerFolder: %v", err)
	}
	assertNoEffectiveResourceRows(t, repo, companyID, EntityTypeSharedTriageFolder, child.FolderID)
	assertNoEffectiveResourceRows(t, repo, companyID, EntityTypeSharedTriageFolder, grandchild.FolderID)
}

func assertEffectiveAccessSource(t *testing.T, repo *MemoryRepo, companyID, userID, resourceType, resourceID, sourceType, sourceID, accessLevel string, want bool) {
	t.Helper()
	ok := false
	for _, fact := range repo.effectiveAccess {
		if fact.CompanyID == companyID &&
			fact.UserID == userID &&
			fact.ResourceType == resourceType &&
			fact.ResourceID == resourceID &&
			fact.SourceType == sourceType &&
			fact.SourceID == sourceID {
			if !EntityPermissionSatisfies(fact.AccessLevel, accessLevel) {
				t.Fatalf("effective source fact = %+v, want at least %s", fact, accessLevel)
			}
			ok = true
			break
		}
	}
	if ok != want {
		t.Fatalf("effective source fact %s/%s/%s/%s/%s/%s present = %v, want %v", userID, resourceType, resourceID, sourceType, sourceID, accessLevel, ok, want)
	}
}

func assertEffectiveSourceRows(t *testing.T, repo *MemoryRepo, companyID, resourceType, resourceID, sourceType string, want bool) {
	t.Helper()
	for _, fact := range repo.effectiveAccess {
		if fact.CompanyID == companyID && fact.ResourceType == resourceType && fact.ResourceID == resourceID && fact.SourceType == sourceType {
			if !want {
				t.Fatalf("effective source row survived for %s/%s source %s: %+v", resourceType, resourceID, sourceType, fact)
			}
			return
		}
	}
	if want {
		t.Fatalf("no effective source row for %s/%s source %s", resourceType, resourceID, sourceType)
	}
}

func assertNoEffectiveSourceRows(t *testing.T, repo *MemoryRepo, companyID, resourceType, resourceID, sourceType string) {
	t.Helper()
	assertEffectiveSourceRows(t, repo, companyID, resourceType, resourceID, sourceType, false)
}

func effectiveSourceRowsByKey(repo *MemoryRepo, companyID, sourceType string) map[string]domain.EffectiveResourceAccess {
	out := map[string]domain.EffectiveResourceAccess{}
	for accessKey, fact := range repo.effectiveAccess {
		if fact.CompanyID == companyID && fact.SourceType == sourceType {
			out[accessKey] = fact
		}
	}
	return out
}
