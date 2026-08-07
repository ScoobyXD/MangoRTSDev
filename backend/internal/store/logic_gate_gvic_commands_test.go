package store

import (
	"errors"
	"testing"
	"time"

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
			Role:   domain.GVICRoleResponsible,
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
	addPayload := added.Events[0].Payload
	if added.Events[0].Type != LogicGateGVICUpdatedEventType || addPayload["resource_type"] != EntityTypeLogicGate || addPayload["resource_id"] != logicGate.LogicGateID ||
		addPayload["assignment_mode"] != PolicyModeCustomized || addPayload["descendant_action"] != PolicyDescendantActionInheritedOnly ||
		addPayload["policy_type"] != "gvic" || addPayload["action"] != PolicyDescendantActionInheritedOnly || addPayload["sequence"].(int64) <= 0 {
		t.Fatalf("add event = %+v, want canonical V2 policy audit payload", added.Events[0])
	}
	assertWorkspaceEventCount(t, repo, companyID, 1)
	assertWorkspaceReadVersion(t, repo, companyID, "logic-gates", "", 1, true)

	myGates, err := repo.ListMyLogicGates(WorkItemInboxQuery{CompanyID: companyID, UserID: responsible.UserID, Limit: 10})
	if err != nil {
		t.Fatalf("ListMyLogicGates after add: %v", err)
	}
	if len(myGates) != 1 || myGates[0].LogicGateID != logicGate.LogicGateID || !inboxReadRolesContain(myGates[0].Roles, domain.GVICRoleResponsible) {
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
			Role:   domain.GVICRoleResponsible,
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
	removePayload := removed.Events[0].Payload
	if removePayload["resource_type"] != EntityTypeLogicGate || removePayload["resource_id"] != logicGate.LogicGateID ||
		removePayload["assignment_mode"] != PolicyModeCustomized || removePayload["descendant_action"] != PolicyDescendantActionInheritedOnly {
		t.Fatalf("remove event payload = %+v, want canonical V2 policy audit payload", removePayload)
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

func TestMemoryLogicGateResourceGVICResolvesInheritedAndCustomizedNodesLive(t *testing.T) {
	t.Parallel()

	repo := NewMemoryRepo()
	companyID := "company-GVIC-snapshot-entry"
	repo.EnsureCompany(companyID, "GVIC Snapshot Company")
	directUser := mustCreateGVICMembershipUser(t, repo, "GVIC-snapshot-direct", companyID)
	gateUser := mustCreateGVICMembershipUser(t, repo, "GVIC-snapshot-gate", companyID)
	nextGateUser := mustCreateGVICMembershipUser(t, repo, "GVIC-snapshot-next-gate", companyID)
	node := mustCreateGVICMembershipNode(t, repo, companyID, "snapshot node")
	logicGate, err := repo.CreateLogicGate(companyID, "Pointer Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}

	if _, err := repo.SetResourceGVICAssignments(ResourceGVICAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeLogicGate,
		ResourceID:   logicGate.LogicGateID,
		Assignments: []ResourceGVICAssignmentInput{{
			Role:          domain.GVICRoleResponsible,
			PrincipalType: EntityPermissionSubjectUser,
			PrincipalID:   gateUser.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetResourceGVICAssignments logic gate initial: %v", err)
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
	if _, _, err := repo.PutResourceGVICPolicy(ResourceGVICPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID,
		AssignmentMode: PolicyModeInherited, DescendantAction: PolicyDescendantActionInheritedOnly,
	}); err != nil {
		t.Fatalf("PutResourceGVICPolicy node inherited: %v", err)
	}
	assertMemoryNodeGVICResolution(t, repo, companyID, node.NodeID, PolicyModeInherited, "", gateUser.UserID, EntityTypeLogicGate, logicGate.LogicGateID, false)

	if _, err := repo.SetResourceGVICAssignments(ResourceGVICAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeLogicGate,
		ResourceID:   logicGate.LogicGateID,
		Assignments: []ResourceGVICAssignmentInput{{
			Role:          domain.GVICRoleResponsible,
			PrincipalType: EntityPermissionSubjectUser,
			PrincipalID:   nextGateUser.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetResourceGVICAssignments logic gate next: %v", err)
	}
	assertMemoryNodeGVICResolution(t, repo, companyID, node.NodeID, PolicyModeInherited, "", nextGateUser.UserID, EntityTypeLogicGate, logicGate.LogicGateID, false)

	nextNode := mustCreateGVICMembershipNode(t, repo, companyID, "snapshot next node")
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		NodeID:      nextNode.NodeID,
		Status:      "pending",
		Priority:    &priority,
		PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus next node: %v", err)
	}
	if _, _, err := repo.PutResourceGVICPolicy(ResourceGVICPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: nextNode.NodeID,
		AssignmentMode: PolicyModeInherited, DescendantAction: PolicyDescendantActionInheritedOnly,
	}); err != nil {
		t.Fatalf("PutResourceGVICPolicy next node inherited: %v", err)
	}
	assertMemoryNodeGVICResolution(t, repo, companyID, nextNode.NodeID, PolicyModeInherited, "", nextGateUser.UserID, EntityTypeLogicGate, logicGate.LogicGateID, false)

	if _, err := repo.SetResourceGVICAssignments(ResourceGVICAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeNode,
		ResourceID:   node.NodeID,
		Assignments: []ResourceGVICAssignmentInput{{
			Role:          domain.GVICRoleResponsible,
			PrincipalType: EntityPermissionSubjectUser,
			PrincipalID:   directUser.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetResourceGVICAssignments linked node direct: %v", err)
	}
	assertMemoryNodeGVICResolution(t, repo, companyID, node.NodeID, PolicyModeCustomized, directUser.UserID, directUser.UserID, EntityTypeNode, node.NodeID, false)

	rows, err := repo.ListMyWorkMatrixRows(WorkItemInboxQuery{CompanyID: companyID, UserID: directUser.UserID, ViewerUserID: directUser.UserID, Limit: 10})
	if err != nil {
		t.Fatalf("ListMyWorkMatrixRows direct user: %v", err)
	}
	if findMyWorkTestRow(rows, EntityTypeNode, node.NodeID) == nil {
		t.Fatalf("direct user My Work rows = %+v, want linked node after node edit", rows)
	}
	gateRows, err := repo.ListMyWorkMatrixRows(WorkItemInboxQuery{CompanyID: companyID, UserID: gateUser.UserID, ViewerUserID: gateUser.UserID, Limit: 10})
	if err != nil {
		t.Fatalf("ListMyWorkMatrixRows old gate user: %v", err)
	}
	if findMyWorkTestRow(gateRows, EntityTypeNode, node.NodeID) != nil {
		t.Fatalf("old gate user My Work rows = %+v, want node edit to remove old user", gateRows)
	}

	if _, err := repo.RemoveLogicGateNodeAssignment(LogicGateNodeAssignmentRemoveInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: node.NodeID}); err != nil {
		t.Fatalf("RemoveLogicGateNodeAssignment: %v", err)
	}
	assertMemoryNodeGVICResolution(t, repo, companyID, node.NodeID, PolicyModeCustomized, directUser.UserID, directUser.UserID, EntityTypeNode, node.NodeID, false)
}

func TestMemoryLogicGateResourceGVICIncludingCustomizedResetSupersedesDescendant(t *testing.T) {
	t.Parallel()

	repo := NewMemoryRepo()
	companyID := "company-GVIC-apply-descendants"
	repo.EnsureCompany(companyID, "GVIC Apply Descendants Company")
	initialUser := mustCreateGVICMembershipUser(t, repo, "GVIC-apply-descendants-initial", companyID)
	nextUser := mustCreateGVICMembershipUser(t, repo, "GVIC-apply-descendants-next", companyID)
	node := mustCreateGVICMembershipNode(t, repo, companyID, "apply descendants node")
	logicGate, err := repo.CreateLogicGate(companyID, "Apply Descendants Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if _, err := repo.SetResourceGVICAssignments(ResourceGVICAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeLogicGate,
		ResourceID:   logicGate.LogicGateID,
		Assignments: []ResourceGVICAssignmentInput{{
			Role:          domain.GVICRoleResponsible,
			PrincipalType: EntityPermissionSubjectUser,
			PrincipalID:   initialUser.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetResourceGVICAssignments initial gate: %v", err)
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
	if _, err := repo.SetResourceGVICAssignments(ResourceGVICAssignmentUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID,
		Assignments: []ResourceGVICAssignmentInput{{
			Role: domain.GVICRoleResponsible, PrincipalType: EntityPermissionSubjectUser, PrincipalID: initialUser.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetResourceGVICAssignments customized node: %v", err)
	}
	assertMemoryNodeGVICResolution(t, repo, companyID, node.NodeID, PolicyModeCustomized, initialUser.UserID, initialUser.UserID, EntityTypeNode, node.NodeID, false)

	result, err := repo.SetResourceGVICAssignments(ResourceGVICAssignmentUpdateInput{
		CompanyID:          companyID,
		ResourceType:       EntityTypeLogicGate,
		ResourceID:         logicGate.LogicGateID,
		ApplyToDescendants: true,
		Assignments: []ResourceGVICAssignmentInput{{
			Role:          domain.GVICRoleResponsible,
			PrincipalType: EntityPermissionSubjectUser,
			PrincipalID:   nextUser.UserID,
		}},
	})
	if err != nil {
		t.Fatalf("SetResourceGVICAssignments apply descendants: %v", err)
	}
	if !result.Changed {
		t.Fatalf("SetResourceGVICAssignments apply descendants changed = false, want true")
	}
	if len(result.GVICAssignments) != 1 || result.GVICAssignments[0].UserID != nextUser.UserID {
		t.Fatalf("gate source assignments = %+v, want next responsible user", result.GVICAssignments)
	}
	assertMemoryNodeGVICResolution(t, repo, companyID, node.NodeID, PolicyModeCustomized, initialUser.UserID, nextUser.UserID, EntityTypeLogicGate, logicGate.LogicGateID, true)
}

func TestMemoryLogicGateResourceGVICApplyToDescendantsUsesCurrentUnchangedSnapshot(t *testing.T) {
	t.Parallel()

	repo := NewMemoryRepo()
	companyID := "company-GVIC-current-snapshot"
	repo.EnsureCompany(companyID, "GVIC Current Snapshot Company")
	gateUser := mustCreateGVICMembershipUser(t, repo, "GVIC-current-snapshot-gate", companyID)
	descendantUser := mustCreateGVICMembershipUser(t, repo, "GVIC-current-snapshot-descendant", companyID)
	consultedUser := mustCreateGVICMembershipUser(t, repo, "GVIC-current-snapshot-consulted", companyID)
	node := mustCreateGVICMembershipNode(t, repo, companyID, "current snapshot node")
	logicGate, err := repo.CreateLogicGate(companyID, "Current Snapshot Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	gateAssignments := []ResourceGVICAssignmentInput{{
		Role:          domain.GVICRoleResponsible,
		PrincipalType: EntityPermissionSubjectUser,
		PrincipalID:   gateUser.UserID,
	}}
	if _, err := repo.SetResourceGVICAssignments(ResourceGVICAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeLogicGate,
		ResourceID:   logicGate.LogicGateID,
		Assignments:  gateAssignments,
	}); err != nil {
		t.Fatalf("SetResourceGVICAssignments gate template: %v", err)
	}
	priority := 1
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: node.NodeID,
		Status: "pending", Priority: &priority, PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	if _, err := repo.SetResourceGVICAssignments(ResourceGVICAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeNode,
		ResourceID:   node.NodeID,
		Assignments: []ResourceGVICAssignmentInput{
			{Role: domain.GVICRoleResponsible, PrincipalType: EntityPermissionSubjectUser, PrincipalID: descendantUser.UserID},
			{Role: domain.GVICRoleConsulted, PrincipalType: EntityPermissionSubjectUser, PrincipalID: consultedUser.UserID},
		},
	}); err != nil {
		t.Fatalf("SetResourceGVICAssignments descendant custom snapshot: %v", err)
	}

	// Business rule: clicking Apply replaces the descendant snapshot with the
	// gate's current assignments even though the gate assignments did not change.
	result, err := repo.SetResourceGVICAssignments(ResourceGVICAssignmentUpdateInput{
		CompanyID:          companyID,
		ResourceType:       EntityTypeLogicGate,
		ResourceID:         logicGate.LogicGateID,
		ApplyToDescendants: true,
		Assignments:        gateAssignments,
	})
	if err != nil {
		t.Fatalf("SetResourceGVICAssignments reapply current gate snapshot: %v", err)
	}
	if !result.Changed {
		t.Fatal("reapplying the current gate snapshot should report a descendant change")
	}
	policy, err := repo.GetResourceGVICPolicy(companyID, EntityTypeNode, node.NodeID)
	if err != nil {
		t.Fatalf("GetResourceGVICPolicy after reset: %v", err)
	}
	if policy.AssignmentMode != PolicyModeCustomized || policy.EffectiveAssignmentMode != PolicyModeInherited || policy.OverwrittenByAncestor == nil ||
		policy.EffectiveSource.ResourceType != EntityTypeLogicGate || policy.EffectiveSource.ResourceID != logicGate.LogicGateID || len(policy.EffectiveAssignments) != 1 || policy.EffectiveAssignments[0].UserID != gateUser.UserID {
		t.Fatalf("node policy after reset = %+v, want dormant customization superseded by gate", policy)
	}

	// An empty current gate policy is still a complete snapshot and therefore
	// clears assignments on current descendants.
	if _, err := repo.SetResourceGVICAssignments(ResourceGVICAssignmentUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: logicGate.LogicGateID,
	}); err != nil {
		t.Fatalf("SetResourceGVICAssignments clear gate: %v", err)
	}
	if _, err := repo.SetResourceGVICAssignments(ResourceGVICAssignmentUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID,
		Assignments: []ResourceGVICAssignmentInput{{Role: domain.GVICRoleResponsible, PrincipalType: EntityPermissionSubjectUser, PrincipalID: descendantUser.UserID}},
	}); err != nil {
		t.Fatalf("SetResourceGVICAssignments restore descendant custom snapshot: %v", err)
	}
	if _, err := repo.SetResourceGVICAssignments(ResourceGVICAssignmentUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: logicGate.LogicGateID, ApplyToDescendants: true,
	}); err != nil {
		t.Fatalf("SetResourceGVICAssignments apply empty current snapshot: %v", err)
	}
	policy, err = repo.GetResourceGVICPolicy(companyID, EntityTypeNode, node.NodeID)
	if err != nil {
		t.Fatalf("GetResourceGVICPolicy after empty reset: %v", err)
	}
	if policy.AssignmentMode != PolicyModeCustomized || len(policy.GVICAssignments) != 1 || policy.GVICAssignments[0].UserID != descendantUser.UserID ||
		len(policy.EffectiveAssignments) != 0 || policy.OverwrittenByAncestor == nil {
		t.Fatalf("node policy after empty reset = %+v, want dormant source edge and empty effective policy", policy)
	}
}

func assertMemoryNodeGVICResolution(t *testing.T, repo *MemoryRepo, companyID, nodeID, storedMode, storedUserID, effectiveUserID, sourceType, sourceID string, overwritten bool) {
	t.Helper()
	policy, err := repo.GetResourceGVICPolicy(companyID, EntityTypeNode, nodeID)
	if err != nil {
		t.Fatalf("GetResourceGVICPolicy node: %v", err)
	}
	if policy.AssignmentMode != storedMode {
		t.Fatalf("node assignment mode = %q, want %q: %+v", policy.AssignmentMode, storedMode, policy)
	}
	if storedUserID == "" {
		if len(policy.GVICAssignments) != 0 {
			t.Fatalf("node stored assignments = %+v, want none", policy.GVICAssignments)
		}
	} else if len(policy.GVICAssignments) != 1 || policy.GVICAssignments[0].UserID != storedUserID {
		t.Fatalf("node stored assignments = %+v, want %s", policy.GVICAssignments, storedUserID)
	}
	if len(policy.EffectiveAssignments) != 1 || policy.EffectiveAssignments[0].UserID != effectiveUserID ||
		policy.EffectiveSource.ResourceType != sourceType || policy.EffectiveSource.ResourceID != sourceID ||
		policy.EffectiveAssignments[0].SourceResourceType != sourceType || policy.EffectiveAssignments[0].SourceResourceID != sourceID {
		t.Fatalf("node effective policy = %+v, want user %s from %s/%s", policy, effectiveUserID, sourceType, sourceID)
	}
	if (policy.OverwrittenByAncestor != nil) != overwritten {
		t.Fatalf("node overwrite marker = %+v, want present=%v", policy.OverwrittenByAncestor, overwritten)
	}
}
func TestMemoryLogicGateRCVICommandsAddMultipleResponsibleUsers(t *testing.T) {
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
		Assignments: []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleResponsible, UserID: first.UserID}},
	}); err != nil {
		t.Fatalf("AddLogicGateGVICAssignments first Responsible: %v", err)
	}
	result, err := repo.AddLogicGateGVICAssignments(LogicGateGVICAssignmentCommandInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleResponsible, UserID: next.UserID}},
	})
	if err != nil {
		t.Fatalf("AddLogicGateGVICAssignments second Responsible: %v", err)
	}
	responsibleUsers := []string{}
	for _, assignment := range result.GVICAssignments {
		if assignment.Role == domain.GVICRoleResponsible {
			responsibleUsers = append(responsibleUsers, assignment.UserID)
		}
	}
	if len(responsibleUsers) != 2 || !stringSliceContains(responsibleUsers, first.UserID) || !stringSliceContains(responsibleUsers, next.UserID) {
		t.Fatalf("Responsible users after add = %+v, want %s and %s", responsibleUsers, first.UserID, next.UserID)
	}
}

func TestMemoryLogicGateGVICDeltaDoesNotRetimestampUnchangedEffectiveRows(t *testing.T) {
	t.Parallel()

	repo := NewMemoryRepo()
	companyID := "company-GVIC-delta-effective-stability"
	repo.EnsureCompany(companyID, "GVIC Delta Effective Stability Company")
	logicGate, err := repo.CreateLogicGate(companyID, "Delta Effective Stability Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	responsible := mustCreateGVICMembershipUser(t, repo, "GVIC-delta-responsible", companyID)
	verifier := mustCreateGVICMembershipUser(t, repo, "GVIC-delta-verifier", companyID)
	consulted := mustCreateGVICMembershipUser(t, repo, "GVIC-delta-consulted", companyID)

	if _, err := repo.SetResourceGVICAssignments(ResourceGVICAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeLogicGate,
		ResourceID:   logicGate.LogicGateID,
		Assignments: []ResourceGVICAssignmentInput{
			{Role: domain.GVICRoleResponsible, PrincipalType: EntityPermissionSubjectUser, PrincipalID: responsible.UserID},
			{Role: domain.GVICRoleVerifier, PrincipalType: EntityPermissionSubjectUser, PrincipalID: verifier.UserID},
			{Role: domain.GVICRoleConsulted, PrincipalType: EntityPermissionSubjectUser, PrincipalID: consulted.UserID},
		},
	}); err != nil {
		t.Fatalf("SetResourceGVICAssignments initial: %v", err)
	}
	before, err := repo.ListResourceGVICEffectiveAssignments(companyID, EntityTypeLogicGate, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("ListResourceGVICEffectiveAssignments before remove: %v", err)
	}
	beforeResponsible := mustFindEffectiveGVICForUserRole(t, before, responsible.UserID, domain.GVICRoleResponsible).UpdatedTimestamp
	beforeConsulted := mustFindEffectiveGVICForUserRole(t, before, consulted.UserID, domain.GVICRoleConsulted).UpdatedTimestamp

	time.Sleep(time.Millisecond)
	if _, err := repo.RemoveResourceGVICAssignments(ResourceGVICAssignmentCommandInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeLogicGate,
		ResourceID:   logicGate.LogicGateID,
		Assignments: []ResourceGVICAssignmentInput{{
			Role:          domain.GVICRoleVerifier,
			PrincipalType: EntityPermissionSubjectUser,
			PrincipalID:   verifier.UserID,
		}},
	}); err != nil {
		t.Fatalf("RemoveResourceGVICAssignments verifier: %v", err)
	}
	after, err := repo.ListResourceGVICEffectiveAssignments(companyID, EntityTypeLogicGate, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("ListResourceGVICEffectiveAssignments after remove: %v", err)
	}
	if got := findEffectiveGVICForUserRole(after, verifier.UserID, domain.GVICRoleVerifier); got != nil {
		t.Fatalf("verifier effective assignment still exists after remove: %+v", *got)
	}
	if got := mustFindEffectiveGVICForUserRole(t, after, responsible.UserID, domain.GVICRoleResponsible); !got.UpdatedTimestamp.Equal(beforeResponsible) {
		t.Fatalf("responsible updated_timestamp = %s, want unchanged %s", got.UpdatedTimestamp, beforeResponsible)
	}
	if got := mustFindEffectiveGVICForUserRole(t, after, consulted.UserID, domain.GVICRoleConsulted); !got.UpdatedTimestamp.Equal(beforeConsulted) {
		t.Fatalf("consulted updated_timestamp = %s, want unchanged %s", got.UpdatedTimestamp, beforeConsulted)
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

func findEffectiveGVICForUserRole(items []domain.ResourceGVICEffectiveAssignment, userID, role string) *domain.ResourceGVICEffectiveAssignment {
	for i := range items {
		if items[i].UserID == userID && items[i].Role == role {
			return &items[i]
		}
	}
	return nil
}

func mustFindEffectiveGVICForUserRole(t *testing.T, items []domain.ResourceGVICEffectiveAssignment, userID, role string) domain.ResourceGVICEffectiveAssignment {
	t.Helper()
	item := findEffectiveGVICForUserRole(items, userID, role)
	if item == nil {
		t.Fatalf("effective assignment for user %s role %s not found in %+v", userID, role, items)
	}
	return *item
}

func TestMemoryLogicGateGVICCommandsRejectInvalidRoleUserAndCompanyAndAllowsGroup(t *testing.T) {
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
	group, err := repo.CreateCompanyUserGroup(companyID, "", "Responsible Team")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup Responsible team: %v", err)
	}
	_, err = repo.AddLogicGateGVICAssignments(LogicGateGVICAssignmentCommandInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, Assignments: []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleResponsible, PrincipalType: EntityPermissionSubjectGroup, PrincipalID: group.GroupID}}})
	if err != nil {
		t.Fatalf("Responsible group add rejected: %v", err)
	}
	_, err = repo.AddLogicGateGVICAssignments(LogicGateGVICAssignmentCommandInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, Assignments: []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleResponsible, UserID: outsider.UserID}}})
	if !errors.Is(err, ErrPrincipalNotInCompany) {
		t.Fatalf("outsider add err = %v, want ErrPrincipalNotInCompany", err)
	}
	removed, err := repo.RemoveLogicGateGVICAssignments(LogicGateGVICAssignmentCommandInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, Assignments: []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleResponsible, UserID: outsider.UserID}}})
	if err != nil {
		t.Fatalf("stale outsider remove: %v", err)
	}
	if removed.Changed || len(removed.Events) != 0 {
		t.Fatalf("stale outsider remove = %+v, want idempotent cleanup no-op", removed)
	}
	_, err = repo.AddLogicGateGVICAssignments(LogicGateGVICAssignmentCommandInput{CompanyID: otherCompanyID, LogicGateID: logicGate.LogicGateID, Assignments: []LogicGateGVICAssignmentInput{{Role: domain.GVICRoleResponsible, UserID: outsider.UserID}}})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("wrong company add err = %v, want ErrNotFound", err)
	}
	assertWorkspaceEventCount(t, repo, companyID, 1)
}
