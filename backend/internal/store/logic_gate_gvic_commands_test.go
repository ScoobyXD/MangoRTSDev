package store

import (
	"errors"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
)

func TestMemoryLogicGateRACICommandsAreIdempotentAndInvalidateReadVersions(t *testing.T) {
	t.Parallel()

	repo := NewMemoryRepo()
	companyID := "company-RACI-command-idempotent"
	repo.EnsureCompany(companyID, "RACI Command Company")
	logicGate, err := repo.CreateLogicGate(companyID, "Command Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	responsible, err := repo.UpsertAuthUser("RACI-command-responsible", "responsible-command@example.com", "Responsible Command")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership("RACI-command-responsible", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}

	addInput := LogicGateRACIAssignmentCommandInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateRACIAssignmentInput{{
			Role:   domain.RACIRoleResponsible,
			UserID: responsible.UserID,
		}},
		ActorUserID:    responsible.UserID,
		IdempotencyKey: "RACI-add-once",
	}
	added, err := repo.AddLogicGateRACIAssignments(addInput)
	if err != nil {
		t.Fatalf("AddLogicGateRACIAssignments: %v", err)
	}
	if !added.Changed || added.Operation != LogicGateRACICommandAdd || len(added.RACIAssignments) != 1 || len(added.Events) != 1 {
		t.Fatalf("added result = %+v, want one changed assignment and event", added)
	}
	addPayload := added.Events[0].Payload
	if added.Events[0].Type != LogicGateRACIUpdatedEventType || addPayload["resource_type"] != EntityTypeLogicGate || addPayload["resource_id"] != logicGate.LogicGateID ||
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
	if len(myGates) != 1 || myGates[0].LogicGateID != logicGate.LogicGateID || !inboxReadRolesContain(myGates[0].Roles, domain.RACIRoleResponsible) {
		t.Fatalf("my gates after add = %+v, want responsible gate", myGates)
	}

	duplicateAdd, err := repo.AddLogicGateRACIAssignments(addInput)
	if err != nil {
		t.Fatalf("duplicate AddLogicGateRACIAssignments: %v", err)
	}
	if duplicateAdd.Changed || len(duplicateAdd.RACIAssignments) != 1 || len(duplicateAdd.Events) != 0 {
		t.Fatalf("duplicate add result = %+v, want no-op without event", duplicateAdd)
	}
	assertWorkspaceEventCount(t, repo, companyID, 1)
	assertWorkspaceReadVersion(t, repo, companyID, "logic-gates", "", 1, true)

	removeInput := LogicGateRACIAssignmentCommandInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateRACIAssignmentInput{{
			Role:   domain.RACIRoleResponsible,
			UserID: responsible.UserID,
		}},
	}
	removed, err := repo.RemoveLogicGateRACIAssignments(removeInput)
	if err != nil {
		t.Fatalf("RemoveLogicGateRACIAssignments: %v", err)
	}
	if !removed.Changed || removed.Operation != LogicGateRACICommandRemove || len(removed.RACIAssignments) != 0 || len(removed.Events) != 1 {
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

	missingRemove, err := repo.RemoveLogicGateRACIAssignments(removeInput)
	if err != nil {
		t.Fatalf("missing RemoveLogicGateRACIAssignments: %v", err)
	}
	if missingRemove.Changed || len(missingRemove.RACIAssignments) != 0 || len(missingRemove.Events) != 0 {
		t.Fatalf("missing remove result = %+v, want no-op without event", missingRemove)
	}
	assertWorkspaceEventCount(t, repo, companyID, 2)
	assertWorkspaceReadVersion(t, repo, companyID, "logic-gates", "", 2, true)
}

func TestMemoryLogicGateResourceRACIResolvesInheritedAndCustomizedNodesLive(t *testing.T) {
	t.Parallel()

	repo := NewMemoryRepo()
	companyID := "company-RACI-snapshot-entry"
	repo.EnsureCompany(companyID, "RACI Snapshot Company")
	directUser := mustCreateRACIMembershipUser(t, repo, "RACI-snapshot-direct", companyID)
	gateUser := mustCreateRACIMembershipUser(t, repo, "RACI-snapshot-gate", companyID)
	nextGateUser := mustCreateRACIMembershipUser(t, repo, "RACI-snapshot-next-gate", companyID)
	node := mustCreateRACIMembershipNode(t, repo, companyID, "snapshot node")
	logicGate, err := repo.CreateLogicGate(companyID, "Pointer Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}

	if _, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeLogicGate,
		ResourceID:   logicGate.LogicGateID,
		Assignments: []ResourceRACIAssignmentInput{{
			Role:          domain.RACIRoleResponsible,
			PrincipalType: EntityPermissionSubjectUser,
			PrincipalID:   gateUser.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetResourceRACIAssignments logic gate initial: %v", err)
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
	if _, _, err := repo.PutResourceRACIPolicy(ResourceRACIPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID,
		AssignmentMode: PolicyModeInherited, DescendantAction: PolicyDescendantActionInheritedOnly,
	}); err != nil {
		t.Fatalf("PutResourceRACIPolicy node inherited: %v", err)
	}
	assertMemoryNodeRACIResolution(t, repo, companyID, node.NodeID, PolicyModeInherited, "", gateUser.UserID, EntityTypeLogicGate, logicGate.LogicGateID, false)

	if _, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeLogicGate,
		ResourceID:   logicGate.LogicGateID,
		Assignments: []ResourceRACIAssignmentInput{{
			Role:          domain.RACIRoleResponsible,
			PrincipalType: EntityPermissionSubjectUser,
			PrincipalID:   nextGateUser.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetResourceRACIAssignments logic gate next: %v", err)
	}
	assertMemoryNodeRACIResolution(t, repo, companyID, node.NodeID, PolicyModeInherited, "", nextGateUser.UserID, EntityTypeLogicGate, logicGate.LogicGateID, false)

	nextNode := mustCreateRACIMembershipNode(t, repo, companyID, "snapshot next node")
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
	if _, _, err := repo.PutResourceRACIPolicy(ResourceRACIPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: nextNode.NodeID,
		AssignmentMode: PolicyModeInherited, DescendantAction: PolicyDescendantActionInheritedOnly,
	}); err != nil {
		t.Fatalf("PutResourceRACIPolicy next node inherited: %v", err)
	}
	assertMemoryNodeRACIResolution(t, repo, companyID, nextNode.NodeID, PolicyModeInherited, "", nextGateUser.UserID, EntityTypeLogicGate, logicGate.LogicGateID, false)

	if _, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeNode,
		ResourceID:   node.NodeID,
		Assignments: []ResourceRACIAssignmentInput{{
			Role:          domain.RACIRoleResponsible,
			PrincipalType: EntityPermissionSubjectUser,
			PrincipalID:   directUser.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetResourceRACIAssignments linked node direct: %v", err)
	}
	assertMemoryNodeRACIResolution(t, repo, companyID, node.NodeID, PolicyModeCustomized, directUser.UserID, directUser.UserID, EntityTypeNode, node.NodeID, false)

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
	assertMemoryNodeRACIResolution(t, repo, companyID, node.NodeID, PolicyModeCustomized, directUser.UserID, directUser.UserID, EntityTypeNode, node.NodeID, false)
}

func TestMemoryLogicGateResourceRACIIncludingCustomizedResetSupersedesDescendant(t *testing.T) {
	t.Parallel()

	repo := NewMemoryRepo()
	companyID := "company-RACI-apply-descendants"
	repo.EnsureCompany(companyID, "RACI Apply Descendants Company")
	initialUser := mustCreateRACIMembershipUser(t, repo, "RACI-apply-descendants-initial", companyID)
	nextUser := mustCreateRACIMembershipUser(t, repo, "RACI-apply-descendants-next", companyID)
	node := mustCreateRACIMembershipNode(t, repo, companyID, "apply descendants node")
	logicGate, err := repo.CreateLogicGate(companyID, "Apply Descendants Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if _, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeLogicGate,
		ResourceID:   logicGate.LogicGateID,
		Assignments: []ResourceRACIAssignmentInput{{
			Role:          domain.RACIRoleResponsible,
			PrincipalType: EntityPermissionSubjectUser,
			PrincipalID:   initialUser.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetResourceRACIAssignments initial gate: %v", err)
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
	if _, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID,
		Assignments: []ResourceRACIAssignmentInput{{
			Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectUser, PrincipalID: nextUser.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetResourceRACIAssignments customized node: %v", err)
	}
	assertMemoryNodeRACIResolution(t, repo, companyID, node.NodeID, PolicyModeCustomized, nextUser.UserID, nextUser.UserID, EntityTypeNode, node.NodeID, false)

	result, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID:          companyID,
		ResourceType:       EntityTypeLogicGate,
		ResourceID:         logicGate.LogicGateID,
		ApplyToDescendants: true,
		Assignments: []ResourceRACIAssignmentInput{{
			Role:          domain.RACIRoleResponsible,
			PrincipalType: EntityPermissionSubjectUser,
			PrincipalID:   nextUser.UserID,
		}},
	})
	if err != nil {
		t.Fatalf("SetResourceRACIAssignments apply descendants: %v", err)
	}
	if !result.Changed {
		t.Fatalf("SetResourceRACIAssignments apply descendants changed = false, want true")
	}
	if len(result.RACIAssignments) != 1 || result.RACIAssignments[0].UserID != nextUser.UserID {
		t.Fatalf("gate source assignments = %+v, want next responsible user", result.RACIAssignments)
	}
	assertMemoryNodeRACIResolution(t, repo, companyID, node.NodeID, PolicyModeCustomized, nextUser.UserID, nextUser.UserID, EntityTypeLogicGate, logicGate.LogicGateID, true)
}

func TestMemoryLogicGateResourceRACIApplyToDescendantsUsesCurrentUnchangedSnapshot(t *testing.T) {
	t.Parallel()

	repo := NewMemoryRepo()
	companyID := "company-RACI-current-snapshot"
	repo.EnsureCompany(companyID, "RACI Current Snapshot Company")
	gateUser := mustCreateRACIMembershipUser(t, repo, "RACI-current-snapshot-gate", companyID)
	descendantUser := mustCreateRACIMembershipUser(t, repo, "RACI-current-snapshot-descendant", companyID)
	consultedUser := mustCreateRACIMembershipUser(t, repo, "RACI-current-snapshot-consulted", companyID)
	node := mustCreateRACIMembershipNode(t, repo, companyID, "current snapshot node")
	logicGate, err := repo.CreateLogicGate(companyID, "Current Snapshot Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	gateAssignments := []ResourceRACIAssignmentInput{{
		Role:          domain.RACIRoleResponsible,
		PrincipalType: EntityPermissionSubjectUser,
		PrincipalID:   gateUser.UserID,
	}}
	if _, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeLogicGate,
		ResourceID:   logicGate.LogicGateID,
		Assignments:  gateAssignments,
	}); err != nil {
		t.Fatalf("SetResourceRACIAssignments gate template: %v", err)
	}
	priority := 1
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID: companyID, LogicGateID: logicGate.LogicGateID, NodeID: node.NodeID,
		Status: "pending", Priority: &priority, PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	if _, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeNode,
		ResourceID:   node.NodeID,
		Assignments: []ResourceRACIAssignmentInput{
			{Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectUser, PrincipalID: descendantUser.UserID},
			{Role: domain.RACIRoleConsulted, PrincipalType: EntityPermissionSubjectUser, PrincipalID: consultedUser.UserID},
		},
	}); err != nil {
		t.Fatalf("SetResourceRACIAssignments descendant custom snapshot: %v", err)
	}

	// Business rule: clicking Apply replaces the descendant snapshot with the
	// gate's current assignments even though the gate assignments did not change.
	result, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID:          companyID,
		ResourceType:       EntityTypeLogicGate,
		ResourceID:         logicGate.LogicGateID,
		ApplyToDescendants: true,
		Assignments:        gateAssignments,
	})
	if err != nil {
		t.Fatalf("SetResourceRACIAssignments reapply current gate snapshot: %v", err)
	}
	if !result.Changed {
		t.Fatal("reapplying the current gate snapshot should report a descendant change")
	}
	policy, err := repo.GetResourceRACIPolicy(companyID, EntityTypeNode, node.NodeID)
	if err != nil {
		t.Fatalf("GetResourceRACIPolicy after reset: %v", err)
	}
	if policy.AssignmentMode != PolicyModeCustomized || policy.EffectiveAssignmentMode != PolicyModeInherited || policy.OverwrittenByAncestor == nil ||
		policy.EffectiveSource.ResourceType != EntityTypeLogicGate || policy.EffectiveSource.ResourceID != logicGate.LogicGateID || len(policy.EffectiveAssignments) != 1 || policy.EffectiveAssignments[0].UserID != gateUser.UserID {
		t.Fatalf("node policy after reset = %+v, want dormant customization superseded by gate", policy)
	}

	// An empty current gate policy is still a complete snapshot and therefore
	// clears assignments on current descendants.
	if _, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: logicGate.LogicGateID,
	}); err != nil {
		t.Fatalf("SetResourceRACIAssignments clear gate: %v", err)
	}
	if _, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID,
		Assignments: []ResourceRACIAssignmentInput{{Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectUser, PrincipalID: descendantUser.UserID}},
	}); err != nil {
		t.Fatalf("SetResourceRACIAssignments restore descendant custom snapshot: %v", err)
	}
	if _, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: logicGate.LogicGateID, ApplyToDescendants: true,
	}); err != nil {
		t.Fatalf("SetResourceRACIAssignments apply empty current snapshot: %v", err)
	}
	policy, err = repo.GetResourceRACIPolicy(companyID, EntityTypeNode, node.NodeID)
	if err != nil {
		t.Fatalf("GetResourceRACIPolicy after empty reset: %v", err)
	}
	if policy.AssignmentMode != PolicyModeCustomized || len(policy.RACIAssignments) != 1 || policy.RACIAssignments[0].UserID != descendantUser.UserID ||
		len(policy.EffectiveAssignments) != 0 || policy.OverwrittenByAncestor == nil {
		t.Fatalf("node policy after empty reset = %+v, want dormant source edge and empty effective policy", policy)
	}
}

func assertMemoryNodeRACIResolution(t *testing.T, repo *MemoryRepo, companyID, nodeID, storedMode, storedUserID, effectiveUserID, sourceType, sourceID string, overwritten bool) {
	t.Helper()
	policy, err := repo.GetResourceRACIPolicy(companyID, EntityTypeNode, nodeID)
	if err != nil {
		t.Fatalf("GetResourceRACIPolicy node: %v", err)
	}
	if policy.AssignmentMode != storedMode {
		t.Fatalf("node assignment mode = %q, want %q: %+v", policy.AssignmentMode, storedMode, policy)
	}
	if storedUserID == "" {
		if len(policy.RACIAssignments) != 0 {
			t.Fatalf("node stored assignments = %+v, want none", policy.RACIAssignments)
		}
	} else if len(policy.RACIAssignments) != 1 || policy.RACIAssignments[0].UserID != storedUserID {
		t.Fatalf("node stored assignments = %+v, want %s", policy.RACIAssignments, storedUserID)
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
func TestMemoryLogicGateRACICommandsAddMultipleResponsibleUsers(t *testing.T) {
	t.Parallel()

	repo := NewMemoryRepo()
	companyID := "company-RACI-command-primary-replace"
	repo.EnsureCompany(companyID, "RACI Command Primary Replace Company")
	logicGate, err := repo.CreateLogicGate(companyID, "Primary Replace Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	first := mustCreateRACIMembershipUser(t, repo, "RACI-command-primary-first", companyID)
	next := mustCreateRACIMembershipUser(t, repo, "RACI-command-primary-next", companyID)

	if _, err := repo.AddLogicGateRACIAssignments(LogicGateRACIAssignmentCommandInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateRACIAssignmentInput{{Role: domain.RACIRoleResponsible, UserID: first.UserID}},
	}); err != nil {
		t.Fatalf("AddLogicGateRACIAssignments first Responsible: %v", err)
	}
	result, err := repo.AddLogicGateRACIAssignments(LogicGateRACIAssignmentCommandInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateRACIAssignmentInput{{Role: domain.RACIRoleResponsible, UserID: next.UserID}},
	})
	if err != nil {
		t.Fatalf("AddLogicGateRACIAssignments second Responsible: %v", err)
	}
	responsibleUsers := []string{}
	for _, assignment := range result.RACIAssignments {
		if assignment.Role == domain.RACIRoleResponsible {
			responsibleUsers = append(responsibleUsers, assignment.UserID)
		}
	}
	if len(responsibleUsers) != 2 || !stringSliceContains(responsibleUsers, first.UserID) || !stringSliceContains(responsibleUsers, next.UserID) {
		t.Fatalf("Responsible users after add = %+v, want %s and %s", responsibleUsers, first.UserID, next.UserID)
	}
}

func TestMemoryLogicGateRACIDeltaDoesNotRetimestampUnchangedEffectiveRows(t *testing.T) {
	t.Parallel()

	repo := NewMemoryRepo()
	companyID := "company-RACI-delta-effective-stability"
	repo.EnsureCompany(companyID, "RACI Delta Effective Stability Company")
	logicGate, err := repo.CreateLogicGate(companyID, "Delta Effective Stability Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	responsible := mustCreateRACIMembershipUser(t, repo, "RACI-delta-responsible", companyID)
	accountable := mustCreateRACIMembershipUser(t, repo, "RACI-delta-accountable", companyID)
	consulted := mustCreateRACIMembershipUser(t, repo, "RACI-delta-consulted", companyID)

	if _, err := repo.SetResourceRACIAssignments(ResourceRACIAssignmentUpdateInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeLogicGate,
		ResourceID:   logicGate.LogicGateID,
		Assignments: []ResourceRACIAssignmentInput{
			{Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectUser, PrincipalID: responsible.UserID},
			{Role: domain.RACIRoleAccountable, PrincipalType: EntityPermissionSubjectUser, PrincipalID: accountable.UserID},
			{Role: domain.RACIRoleConsulted, PrincipalType: EntityPermissionSubjectUser, PrincipalID: consulted.UserID},
		},
	}); err != nil {
		t.Fatalf("SetResourceRACIAssignments initial: %v", err)
	}
	before, err := repo.ListResourceRACIEffectiveAssignments(companyID, EntityTypeLogicGate, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("ListResourceRACIEffectiveAssignments before remove: %v", err)
	}
	beforeResponsible := mustFindEffectiveRACIForUserRole(t, before, responsible.UserID, domain.RACIRoleResponsible).UpdatedTimestamp
	beforeConsulted := mustFindEffectiveRACIForUserRole(t, before, consulted.UserID, domain.RACIRoleConsulted).UpdatedTimestamp

	time.Sleep(time.Millisecond)
	if _, err := repo.RemoveResourceRACIAssignments(ResourceRACIAssignmentCommandInput{
		CompanyID:    companyID,
		ResourceType: EntityTypeLogicGate,
		ResourceID:   logicGate.LogicGateID,
		Assignments: []ResourceRACIAssignmentInput{{
			Role:          domain.RACIRoleAccountable,
			PrincipalType: EntityPermissionSubjectUser,
			PrincipalID:   accountable.UserID,
		}},
	}); err != nil {
		t.Fatalf("RemoveResourceRACIAssignments accountable: %v", err)
	}
	after, err := repo.ListResourceRACIEffectiveAssignments(companyID, EntityTypeLogicGate, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("ListResourceRACIEffectiveAssignments after remove: %v", err)
	}
	if got := findEffectiveRACIForUserRole(after, accountable.UserID, domain.RACIRoleAccountable); got != nil {
		t.Fatalf("accountable effective assignment still exists after remove: %+v", *got)
	}
	if got := mustFindEffectiveRACIForUserRole(t, after, responsible.UserID, domain.RACIRoleResponsible); !got.UpdatedTimestamp.Equal(beforeResponsible) {
		t.Fatalf("responsible updated_timestamp = %s, want unchanged %s", got.UpdatedTimestamp, beforeResponsible)
	}
	if got := mustFindEffectiveRACIForUserRole(t, after, consulted.UserID, domain.RACIRoleConsulted); !got.UpdatedTimestamp.Equal(beforeConsulted) {
		t.Fatalf("consulted updated_timestamp = %s, want unchanged %s", got.UpdatedTimestamp, beforeConsulted)
	}
}

func TestMemoryLogicGateRACICommandsExpandGroupAssignments(t *testing.T) {
	t.Parallel()

	repo := NewMemoryRepo()
	companyID := "company-RACI-command-group"
	repo.EnsureCompany(companyID, "RACI Command Group Company")
	logicGate, err := repo.CreateLogicGate(companyID, "Group Command Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	member, err := repo.UpsertAuthUser("RACI-command-group-member", "group-member-command@example.com", "Group Command Member")
	if err != nil {
		t.Fatalf("UpsertAuthUser member: %v", err)
	}
	if _, err := repo.AddCompanyMembership("RACI-command-group-member", companyID, domain.RoleCompanyUser); err != nil {
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

	added, err := repo.AddLogicGateRACIAssignments(LogicGateRACIAssignmentCommandInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateRACIAssignmentInput{{
			Role:          domain.RACIRoleConsulted,
			PrincipalType: EntityPermissionSubjectGroup,
			PrincipalID:   parentGroup.GroupID,
		}},
	})
	if err != nil {
		t.Fatalf("AddLogicGateRACIAssignments group: %v", err)
	}
	if !added.Changed || len(added.RACIAssignments) != 1 ||
		added.RACIAssignments[0].PrincipalType != EntityPermissionSubjectGroup ||
		added.RACIAssignments[0].PrincipalID != parentGroup.GroupID {
		t.Fatalf("added group result = %+v, want configured group assignment", added)
	}
	effective, err := repo.ListResourceRACIEffectiveAssignments(companyID, EntityTypeLogicGate, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("ListResourceRACIEffectiveAssignments after group add: %v", err)
	}
	if len(effective) != 1 || effective[0].UserID != member.UserID || effective[0].SourcePrincipalType != EntityPermissionSubjectGroup || effective[0].SourcePrincipalID != parentGroup.GroupID {
		t.Fatalf("effective group result = %+v, want expanded member projection", effective)
	}

	removed, err := repo.RemoveLogicGateRACIAssignments(LogicGateRACIAssignmentCommandInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateRACIAssignmentInput{{
			Role:          domain.RACIRoleConsulted,
			PrincipalType: EntityPermissionSubjectGroup,
			PrincipalID:   parentGroup.GroupID,
		}},
	})
	if err != nil {
		t.Fatalf("RemoveLogicGateRACIAssignments group: %v", err)
	}
	if !removed.Changed || len(removed.RACIAssignments) != 0 {
		t.Fatalf("removed group result = %+v, want configured group removed", removed)
	}
}

func findEffectiveRACIForUserRole(items []domain.ResourceRACIEffectiveAssignment, userID, role string) *domain.ResourceRACIEffectiveAssignment {
	for i := range items {
		if items[i].UserID == userID && items[i].Role == role {
			return &items[i]
		}
	}
	return nil
}

func mustFindEffectiveRACIForUserRole(t *testing.T, items []domain.ResourceRACIEffectiveAssignment, userID, role string) domain.ResourceRACIEffectiveAssignment {
	t.Helper()
	item := findEffectiveRACIForUserRole(items, userID, role)
	if item == nil {
		t.Fatalf("effective assignment for user %s role %s not found in %+v", userID, role, items)
	}
	return *item
}

func TestMemoryLogicGateRACICommandsRejectInvalidRoleUserAndCompanyAndAllowsGroup(t *testing.T) {
	t.Parallel()

	repo := NewMemoryRepo()
	companyID := "company-RACI-command-validation"
	otherCompanyID := "company-RACI-command-validation-other"
	repo.EnsureCompany(companyID, "RACI Validation Company")
	repo.EnsureCompany(otherCompanyID, "Other RACI Validation Company")
	logicGate, err := repo.CreateLogicGate(companyID, "Validation Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	member, err := repo.UpsertAuthUser("RACI-command-member", "member-command@example.com", "Member Command")
	if err != nil {
		t.Fatalf("UpsertAuthUser member: %v", err)
	}
	if _, err := repo.AddCompanyMembership("RACI-command-member", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership member: %v", err)
	}
	outsider, err := repo.UpsertAuthUser("RACI-command-outsider", "outsider-command@example.com", "Outsider Command")
	if err != nil {
		t.Fatalf("UpsertAuthUser outsider: %v", err)
	}
	if _, err := repo.AddCompanyMembership("RACI-command-outsider", otherCompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership outsider: %v", err)
	}

	_, err = repo.AddLogicGateRACIAssignments(LogicGateRACIAssignmentCommandInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, Assignments: []LogicGateRACIAssignmentInput{{Role: "owner", UserID: member.UserID}}})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid add role err = %v, want ErrInvalid", err)
	}
	_, err = repo.RemoveLogicGateRACIAssignments(LogicGateRACIAssignmentCommandInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, Assignments: []LogicGateRACIAssignmentInput{{Role: "owner", UserID: member.UserID}}})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid remove role err = %v, want ErrInvalid", err)
	}
	group, err := repo.CreateCompanyUserGroup(companyID, "", "Responsible Team")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup Responsible team: %v", err)
	}
	_, err = repo.AddLogicGateRACIAssignments(LogicGateRACIAssignmentCommandInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, Assignments: []LogicGateRACIAssignmentInput{{Role: domain.RACIRoleResponsible, PrincipalType: EntityPermissionSubjectGroup, PrincipalID: group.GroupID}}})
	if err != nil {
		t.Fatalf("Responsible group add rejected: %v", err)
	}
	_, err = repo.AddLogicGateRACIAssignments(LogicGateRACIAssignmentCommandInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, Assignments: []LogicGateRACIAssignmentInput{{Role: domain.RACIRoleResponsible, UserID: outsider.UserID}}})
	if !errors.Is(err, ErrPrincipalNotInCompany) {
		t.Fatalf("outsider add err = %v, want ErrPrincipalNotInCompany", err)
	}
	removed, err := repo.RemoveLogicGateRACIAssignments(LogicGateRACIAssignmentCommandInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, Assignments: []LogicGateRACIAssignmentInput{{Role: domain.RACIRoleResponsible, UserID: outsider.UserID}}})
	if err != nil {
		t.Fatalf("stale outsider remove: %v", err)
	}
	if removed.Changed || len(removed.Events) != 0 {
		t.Fatalf("stale outsider remove = %+v, want idempotent cleanup no-op", removed)
	}
	_, err = repo.AddLogicGateRACIAssignments(LogicGateRACIAssignmentCommandInput{CompanyID: otherCompanyID, LogicGateID: logicGate.LogicGateID, Assignments: []LogicGateRACIAssignmentInput{{Role: domain.RACIRoleResponsible, UserID: outsider.UserID}}})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("wrong company add err = %v, want ErrNotFound", err)
	}
	assertWorkspaceEventCount(t, repo, companyID, 1)
}
