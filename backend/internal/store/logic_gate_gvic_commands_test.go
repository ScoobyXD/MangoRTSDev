package store

import (
	"errors"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestMemoryLogicGateGVICCommandsAreIdempotentAndInvalidateReadVersions(t *testing.T) {
	t.Parallel()

	repo := NewMemoryRepo()
	companyID := "company-GVIC-command-idempotent"
	repo.EnsureCompany(companyID, "GVIC Command Company")
	logicGate, err := repo.CreateLogicGate(companyID, "Command Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	responsible, err := repo.UpsertAuthUser("GVIC-command-responsible", "responsible-command@example.com", "Responsible Command")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership("GVIC-command-responsible", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}

	addInput := LogicGateGVICAssignmentCommandInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateGVICAssignmentInput{{
			Role:   domain.GVICRoleGenerated,
			UserID: responsible.UserID,
		}},
		ActorUserID:    responsible.UserID,
		IdempotencyKey: "GVIC-add-once",
	}
	added, err := repo.AddLogicGateGVICAssignments(addInput)
	if err != nil {
		t.Fatalf("AddLogicGateGVICAssignments: %v", err)
	}
	if !added.Changed || added.Operation != LogicGateGVICCommandAdd || len(added.GVICAssignments) != 1 || len(added.Events) != 1 {
		t.Fatalf("added result = %+v, want one changed assignment and event", added)
	}
	if added.Events[0].Type != LogicGateGVICUpdatedEventType || added.Events[0].Payload["logic_gate_id"] != logicGate.LogicGateID || added.Events[0].Payload["operation"] != LogicGateGVICCommandAdd {
		t.Fatalf("add event = %+v, want logic_gate_gvic_updated add payload", added.Events[0])
	}
	assertWorkspaceEventCount(t, repo, companyID, 1)
	assertWorkspaceReadVersion(t, repo, companyID, "logic-gates", "", 1, true)

	myGates, err := repo.ListMyLogicGates(WorkItemInboxQuery{CompanyID: companyID, UserID: responsible.UserID, Limit: 10})
	if err != nil {
		t.Fatalf("ListMyLogicGates after add: %v", err)
	}
	if len(myGates) != 1 || myGates[0].LogicGateID != logicGate.LogicGateID || !inboxReadRolesContain(myGates[0].Roles, domain.GVICRoleGenerated) {
		t.Fatalf("my gates after add = %+v, want responsible gate", myGates)
	}

	duplicateAdd, err := repo.AddLogicGateGVICAssignments(addInput)
	if err != nil {
		t.Fatalf("duplicate AddLogicGateGVICAssignments: %v", err)
	}
	if duplicateAdd.Changed || len(duplicateAdd.GVICAssignments) != 1 || len(duplicateAdd.Events) != 0 {
		t.Fatalf("duplicate add result = %+v, want no-op without event", duplicateAdd)
	}
	assertWorkspaceEventCount(t, repo, companyID, 1)
	assertWorkspaceReadVersion(t, repo, companyID, "logic-gates", "", 1, true)

	removeInput := LogicGateGVICAssignmentCommandInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateGVICAssignmentInput{{
			Role:   domain.GVICRoleGenerated,
			UserID: responsible.UserID,
		}},
	}
	removed, err := repo.RemoveLogicGateGVICAssignments(removeInput)
	if err != nil {
		t.Fatalf("RemoveLogicGateGVICAssignments: %v", err)
	}
	if !removed.Changed || removed.Operation != LogicGateGVICCommandRemove || len(removed.GVICAssignments) != 0 || len(removed.Events) != 1 {
		t.Fatalf("removed result = %+v, want changed removal and event", removed)
	}
	if removed.Events[0].Payload["operation"] != LogicGateGVICCommandRemove {
		t.Fatalf("remove event payload = %+v, want remove operation", removed.Events[0].Payload)
	}
	assertWorkspaceEventCount(t, repo, companyID, 2)
	assertWorkspaceReadVersion(t, repo, companyID, "logic-gates", "", 2, true)

	myGates, err = repo.ListMyLogicGates(WorkItemInboxQuery{CompanyID: companyID, UserID: responsible.UserID, Limit: 10})
	if err != nil {
		t.Fatalf("ListMyLogicGates after remove: %v", err)
	}
	if len(myGates) != 0 {
		t.Fatalf("my gates after remove = %+v, want none", myGates)
	}

	missingRemove, err := repo.RemoveLogicGateGVICAssignments(removeInput)
	if err != nil {
		t.Fatalf("missing RemoveLogicGateGVICAssignments: %v", err)
	}
	if missingRemove.Changed || len(missingRemove.GVICAssignments) != 0 || len(missingRemove.Events) != 0 {
		t.Fatalf("missing remove result = %+v, want no-op without event", missingRemove)
	}
	assertWorkspaceEventCount(t, repo, companyID, 2)
	assertWorkspaceReadVersion(t, repo, companyID, "logic-gates", "", 2, true)
}

func TestMemoryLogicGateResourceGVICUsesPointerEffectiveRowsForLinkedNodes(t *testing.T) {
	t.Parallel()

	repo := NewMemoryRepo()
	companyID := "company-GVIC-pointer-inheritance"
	repo.EnsureCompany(companyID, "GVIC Pointer Company")
	directUser := mustCreateGVICMembershipUser(t, repo, "GVIC-pointer-direct", companyID)
	gateUser := mustCreateGVICMembershipUser(t, repo, "GVIC-pointer-gate", companyID)
	node := mustCreateGVICMembershipNode(t, repo, companyID, "pointer node")
	logicGate, err := repo.CreateLogicGate(companyID, "Pointer Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}

	if _, err := repo.SetResourceGVICAssignments(ResourceGVICAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeNode,
		ResourceID:   node.NodeID,
		Assignments: []ResourceGVICAssignmentInput{{
			Role:          domain.GVICRoleGenerated,
			PrincipalType: EntityPermissionSubjectUser,
			PrincipalID:   directUser.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetResourceGVICAssignments node direct: %v", err)
	}

	priority := 1
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      node.NodeID,
		Status:      "pending",
		Priority:    &priority,
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}

	if _, err := repo.AddResourceGVICAssignments(ResourceGVICAssignmentCommandInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeLogicGate,
		ResourceID:   logicGate.LogicGateID,
		Assignments: []ResourceGVICAssignmentInput{{
			Role:          domain.GVICRoleGenerated,
			PrincipalType: EntityPermissionSubjectUser,
			PrincipalID:   gateUser.UserID,
		}},
	}); err != nil {
		t.Fatalf("AddResourceGVICAssignments logic gate: %v", err)
	}

	effective, err := repo.ListResourceGVICEffectiveAssignments(companyID, EntityTypeNode, node.NodeID)
	if err != nil {
		t.Fatalf("ListResourceGVICEffectiveAssignments linked node: %v", err)
	}
	if len(effective) != 1 || effective[0].UserID != gateUser.UserID || effective[0].InheritanceType != GVICInheritanceLogicGateInherited || effective[0].SourceResourceID != logicGate.LogicGateID {
		t.Fatalf("linked node effective = %+v, want pointer-inherited gate user", effective)
	}
	assertMemoryNoMaterializedNodeGVICEffectiveRows(t, repo, companyID, node.NodeID)

	rows, err := repo.ListMyWorkMatrixRows(WorkItemInboxQuery{CompanyID: companyID, UserID: gateUser.UserID, ViewerUserID: gateUser.UserID, Limit: 10})
	if err != nil {
		t.Fatalf("ListMyWorkMatrixRows gate user: %v", err)
	}
	if findMyWorkTestRow(rows, EntityTypeNode, node.NodeID) == nil {
		t.Fatalf("gate user My Work rows = %+v, want linked node", rows)
	}
	directRows, err := repo.ListMyWorkMatrixRows(WorkItemInboxQuery{CompanyID: companyID, UserID: directUser.UserID, ViewerUserID: directUser.UserID, Limit: 10})
	if err != nil {
		t.Fatalf("ListMyWorkMatrixRows direct user while linked: %v", err)
	}
	if findMyWorkTestRow(directRows, EntityTypeNode, node.NodeID) != nil {
		t.Fatalf("direct user My Work rows while linked = %+v, want node direct GVIC dormant", directRows)
	}

	if _, err := repo.RemoveResourceGVICAssignments(ResourceGVICAssignmentCommandInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeLogicGate,
		ResourceID:   logicGate.LogicGateID,
		Assignments: []ResourceGVICAssignmentInput{{
			Role:          domain.GVICRoleGenerated,
			PrincipalType: EntityPermissionSubjectUser,
			PrincipalID:   gateUser.UserID,
		}},
	}); err != nil {
		t.Fatalf("RemoveResourceGVICAssignments logic gate: %v", err)
	}
	effective, err = repo.ListResourceGVICEffectiveAssignments(companyID, EntityTypeNode, node.NodeID)
	if err != nil {
		t.Fatalf("ListResourceGVICEffectiveAssignments after gate remove: %v", err)
	}
	if len(effective) != 0 {
		t.Fatalf("linked node effective after gate remove = %+v, want none", effective)
	}
	assertMemoryNoMaterializedNodeGVICEffectiveRows(t, repo, companyID, node.NodeID)

	if _, err := repo.RemoveLogicGateNodeAssignment(LogicGateNodeAssignmentRemoveInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: node.NodeID}); err != nil {
		t.Fatalf("RemoveLogicGateNodeAssignment: %v", err)
	}
	effective, err = repo.ListResourceGVICEffectiveAssignments(companyID, EntityTypeNode, node.NodeID)
	if err != nil {
		t.Fatalf("ListResourceGVICEffectiveAssignments after unlink: %v", err)
	}
	if len(effective) != 1 || effective[0].UserID != directUser.UserID || effective[0].InheritanceType != GVICInheritanceDirect {
		t.Fatalf("unlinked node effective = %+v, want stored direct user", effective)
	}
}

func assertMemoryNoMaterializedNodeGVICEffectiveRows(t *testing.T, repo *MemoryRepo, companyID, nodeID string) {
	t.Helper()
	repo.mu.RLock()
	defer repo.mu.RUnlock()
	for _, assignment := range repo.gvicEffectiveAssignments {
		if assignment.CompanyID == companyID && assignment.ResourceType == EntityTypeNode && assignment.ResourceID == nodeID {
			t.Fatalf("materialized node effective assignment = %+v, want pointer-only inheritance", assignment)
		}
	}
}
func TestMemoryLogicGateGVICCommandsReplacePrimaryUsers(t *testing.T) {
	t.Parallel()

	repo := NewMemoryRepo()
	companyID := "company-GVIC-command-primary-replace"
	repo.EnsureCompany(companyID, "GVIC Command Primary Replace Company")
	logicGate, err := repo.CreateLogicGate(companyID, "Primary Replace Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	first := mustCreateGVICMembershipUser(t, repo, "GVIC-command-primary-first", companyID)
	next := mustCreateGVICMembershipUser(t, repo, "GVIC-command-primary-next", companyID)

	if _, err := repo.AddLogicGateGVICAssignments(LogicGateGVICAssignmentCommandInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleGenerated, UserID: first.UserID}},
	}); err != nil {
		t.Fatalf("AddLogicGateGVICAssignments first generated: %v", err)
	}
	result, err := repo.AddLogicGateGVICAssignments(LogicGateGVICAssignmentCommandInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleGenerated, UserID: next.UserID}},
	})
	if err != nil {
		t.Fatalf("AddLogicGateGVICAssignments replacement generated: %v", err)
	}
	generatedUsers := []string{}
	for _, assignment := range result.GVICAssignments {
		if assignment.Role == domain.GVICRoleGenerated {
			generatedUsers = append(generatedUsers, assignment.UserID)
		}
	}
	if len(generatedUsers) != 1 || generatedUsers[0] != next.UserID {
		t.Fatalf("generated users after replacement = %+v, want only %s", generatedUsers, next.UserID)
	}
}

func TestMemoryLogicGateGVICCommandsExpandGroupAssignments(t *testing.T) {
	t.Parallel()

	repo := NewMemoryRepo()
	companyID := "company-GVIC-command-group"
	repo.EnsureCompany(companyID, "GVIC Command Group Company")
	logicGate, err := repo.CreateLogicGate(companyID, "Group Command Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	member, err := repo.UpsertAuthUser("GVIC-command-group-member", "group-member-command@example.com", "Group Command Member")
	if err != nil {
		t.Fatalf("UpsertAuthUser member: %v", err)
	}
	if _, err := repo.AddCompanyMembership("GVIC-command-group-member", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership member: %v", err)
	}
	parentGroup, err := repo.CreateCompanyUserGroup(companyID, "", "Operations")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup parent: %v", err)
	}
	childGroup, err := repo.CreateCompanyUserGroup(companyID, parentGroup.GroupID, "Escalations")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup child: %v", err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, childGroup.GroupID, []string{member.UserID}); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers child: %v", err)
	}

	added, err := repo.AddLogicGateGVICAssignments(LogicGateGVICAssignmentCommandInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateGVICAssignmentInput{{
			Role:          domain.GVICRoleConsulted,
			PrincipalType: EntityPermissionSubjectGroup,
			PrincipalID:   parentGroup.GroupID,
		}},
	})
	if err != nil {
		t.Fatalf("AddLogicGateGVICAssignments group: %v", err)
	}
	if !added.Changed || len(added.GVICAssignments) != 1 ||
		added.GVICAssignments[0].PrincipalType != EntityPermissionSubjectGroup ||
		added.GVICAssignments[0].PrincipalID != parentGroup.GroupID {
		t.Fatalf("added group result = %+v, want configured group assignment", added)
	}
	effective, err := repo.ListResourceGVICEffectiveAssignments(companyID, EntityTypeLogicGate, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("ListResourceGVICEffectiveAssignments after group add: %v", err)
	}
	if len(effective) != 1 || effective[0].UserID != member.UserID || effective[0].SourcePrincipalType != EntityPermissionSubjectGroup || effective[0].SourcePrincipalID != parentGroup.GroupID {
		t.Fatalf("effective group result = %+v, want expanded member projection", effective)
	}

	removed, err := repo.RemoveLogicGateGVICAssignments(LogicGateGVICAssignmentCommandInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateGVICAssignmentInput{{
			Role:          domain.GVICRoleConsulted,
			PrincipalType: EntityPermissionSubjectGroup,
			PrincipalID:   parentGroup.GroupID,
		}},
	})
	if err != nil {
		t.Fatalf("RemoveLogicGateGVICAssignments group: %v", err)
	}
	if !removed.Changed || len(removed.GVICAssignments) != 0 {
		t.Fatalf("removed group result = %+v, want configured group removed", removed)
	}
}

func TestMemoryLogicGateGVICCommandsRejectInvalidRoleUserAndCompany(t *testing.T) {
	t.Parallel()

	repo := NewMemoryRepo()
	companyID := "company-GVIC-command-validation"
	otherCompanyID := "company-GVIC-command-validation-other"
	repo.EnsureCompany(companyID, "GVIC Validation Company")
	repo.EnsureCompany(otherCompanyID, "Other GVIC Validation Company")
	logicGate, err := repo.CreateLogicGate(companyID, "Validation Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	member, err := repo.UpsertAuthUser("GVIC-command-member", "member-command@example.com", "Member Command")
	if err != nil {
		t.Fatalf("UpsertAuthUser member: %v", err)
	}
	if _, err := repo.AddCompanyMembership("GVIC-command-member", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership member: %v", err)
	}
	outsider, err := repo.UpsertAuthUser("GVIC-command-outsider", "outsider-command@example.com", "Outsider Command")
	if err != nil {
		t.Fatalf("UpsertAuthUser outsider: %v", err)
	}
	if _, err := repo.AddCompanyMembership("GVIC-command-outsider", otherCompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership outsider: %v", err)
	}

	_, err = repo.AddLogicGateGVICAssignments(LogicGateGVICAssignmentCommandInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, Assignments: []LogicGateGVICAssignmentInput{{Role: "owner", UserID: member.UserID}}})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid add role err = %v, want ErrInvalid", err)
	}
	_, err = repo.RemoveLogicGateGVICAssignments(LogicGateGVICAssignmentCommandInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, Assignments: []LogicGateGVICAssignmentInput{{Role: "owner", UserID: member.UserID}}})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid remove role err = %v, want ErrInvalid", err)
	}
	group, err := repo.CreateCompanyUserGroup(companyID, "", "Invalid Primary Group")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup invalid primary: %v", err)
	}
	_, err = repo.AddLogicGateGVICAssignments(LogicGateGVICAssignmentCommandInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, Assignments: []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleGenerated, PrincipalType: EntityPermissionSubjectGroup, PrincipalID: group.GroupID}}})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("generated group add err = %v, want ErrInvalid", err)
	}
	_, err = repo.AddLogicGateGVICAssignments(LogicGateGVICAssignmentCommandInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, Assignments: []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleGenerated, UserID: outsider.UserID}}})
	if !errors.Is(err, ErrPrincipalNotInCompany) {
		t.Fatalf("outsider add err = %v, want ErrPrincipalNotInCompany", err)
	}
	_, err = repo.RemoveLogicGateGVICAssignments(LogicGateGVICAssignmentCommandInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, Assignments: []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleGenerated, UserID: outsider.UserID}}})
	if !errors.Is(err, ErrPrincipalNotInCompany) {
		t.Fatalf("outsider remove err = %v, want ErrPrincipalNotInCompany", err)
	}
	_, err = repo.AddLogicGateGVICAssignments(LogicGateGVICAssignmentCommandInput{CompanyID: otherCompanyID, LogicGateID: logicGate.LogicGateID, Assignments: []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleGenerated, UserID: outsider.UserID}}})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("wrong company add err = %v, want ErrNotFound", err)
	}
	assertWorkspaceEventCount(t, repo, companyID, 0)
}
