package store

import (
	"errors"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestMemoryLogicGateRaciCommandsAreIdempotentAndInvalidateReadVersions(t *testing.T) {
	t.Parallel()

	repo := NewMemoryRepo()
	companyID := "company-raci-command-idempotent"
	repo.EnsureCompany(companyID, "RACI Command Company")
	logicGate, err := repo.CreateLogicGate(companyID, "Command Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	responsible, err := repo.UpsertAuthUser("raci-command-responsible", "responsible-command@example.com", "Responsible Command")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership("raci-command-responsible", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}

	addInput := LogicGateRaciAssignmentCommandInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateRaciAssignmentInput{{
			Role:   domain.GVICRoleGenerated,
			UserID: responsible.UserID,
		}},
		ActorUserID:    responsible.UserID,
		IdempotencyKey: "raci-add-once",
	}
	added, err := repo.AddLogicGateRaciAssignments(addInput)
	if err != nil {
		t.Fatalf("AddLogicGateRaciAssignments: %v", err)
	}
	if !added.Changed || added.Operation != LogicGateRaciCommandAdd || len(added.RaciAssignments) != 1 || len(added.Events) != 1 {
		t.Fatalf("added result = %+v, want one changed assignment and event", added)
	}
	if added.Events[0].Type != LogicGateRaciUpdatedEventType || added.Events[0].Payload["logic_gate_id"] != logicGate.LogicGateID || added.Events[0].Payload["operation"] != LogicGateRaciCommandAdd {
		t.Fatalf("add event = %+v, want logic_gate_raci_updated add payload", added.Events[0])
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

	duplicateAdd, err := repo.AddLogicGateRaciAssignments(addInput)
	if err != nil {
		t.Fatalf("duplicate AddLogicGateRaciAssignments: %v", err)
	}
	if duplicateAdd.Changed || len(duplicateAdd.RaciAssignments) != 1 || len(duplicateAdd.Events) != 0 {
		t.Fatalf("duplicate add result = %+v, want no-op without event", duplicateAdd)
	}
	assertWorkspaceEventCount(t, repo, companyID, 1)
	assertWorkspaceReadVersion(t, repo, companyID, "logic-gates", "", 1, true)

	removeInput := LogicGateRaciAssignmentCommandInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateRaciAssignmentInput{{
			Role:   domain.GVICRoleGenerated,
			UserID: responsible.UserID,
		}},
	}
	removed, err := repo.RemoveLogicGateRaciAssignments(removeInput)
	if err != nil {
		t.Fatalf("RemoveLogicGateRaciAssignments: %v", err)
	}
	if !removed.Changed || removed.Operation != LogicGateRaciCommandRemove || len(removed.RaciAssignments) != 0 || len(removed.Events) != 1 {
		t.Fatalf("removed result = %+v, want changed removal and event", removed)
	}
	if removed.Events[0].Payload["operation"] != LogicGateRaciCommandRemove {
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

	missingRemove, err := repo.RemoveLogicGateRaciAssignments(removeInput)
	if err != nil {
		t.Fatalf("missing RemoveLogicGateRaciAssignments: %v", err)
	}
	if missingRemove.Changed || len(missingRemove.RaciAssignments) != 0 || len(missingRemove.Events) != 0 {
		t.Fatalf("missing remove result = %+v, want no-op without event", missingRemove)
	}
	assertWorkspaceEventCount(t, repo, companyID, 2)
	assertWorkspaceReadVersion(t, repo, companyID, "logic-gates", "", 2, true)
}

func TestMemoryLogicGateRaciCommandsExpandGroupAssignments(t *testing.T) {
	t.Parallel()

	repo := NewMemoryRepo()
	companyID := "company-raci-command-group"
	repo.EnsureCompany(companyID, "RACI Command Group Company")
	logicGate, err := repo.CreateLogicGate(companyID, "Group Command Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	member, err := repo.UpsertAuthUser("raci-command-group-member", "group-member-command@example.com", "Group Command Member")
	if err != nil {
		t.Fatalf("UpsertAuthUser member: %v", err)
	}
	if _, err := repo.AddCompanyMembership("raci-command-group-member", companyID, domain.RoleCompanyUser); err != nil {
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

	added, err := repo.AddLogicGateRaciAssignments(LogicGateRaciAssignmentCommandInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateRaciAssignmentInput{{
			Role:        domain.GVICRoleGenerated,
			SubjectType: EntityPermissionSubjectGroup,
			SubjectID:   parentGroup.GroupID,
		}},
	})
	if err != nil {
		t.Fatalf("AddLogicGateRaciAssignments group: %v", err)
	}
	if !added.Changed || len(added.RaciAssignments) != 1 ||
		added.RaciAssignments[0].SubjectType != EntityPermissionSubjectGroup ||
		added.RaciAssignments[0].SubjectID != parentGroup.GroupID {
		t.Fatalf("added group result = %+v, want configured group assignment", added)
	}
	effective, err := repo.ListResourceGVICEffectiveAssignments(companyID, EntityTypeLogicGate, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("ListResourceGVICEffectiveAssignments after group add: %v", err)
	}
	if len(effective) != 1 || effective[0].UserID != member.UserID || effective[0].SourcePrincipalType != EntityPermissionSubjectGroup || effective[0].SourcePrincipalID != parentGroup.GroupID {
		t.Fatalf("effective group result = %+v, want expanded member projection", effective)
	}

	removed, err := repo.RemoveLogicGateRaciAssignments(LogicGateRaciAssignmentCommandInput{
		CompanyID:   companyID,
		LogicGateID: logicGate.LogicGateID,
		Assignments: []LogicGateRaciAssignmentInput{{
			Role:        domain.GVICRoleGenerated,
			SubjectType: EntityPermissionSubjectGroup,
			SubjectID:   parentGroup.GroupID,
		}},
	})
	if err != nil {
		t.Fatalf("RemoveLogicGateRaciAssignments group: %v", err)
	}
	if !removed.Changed || len(removed.RaciAssignments) != 0 {
		t.Fatalf("removed group result = %+v, want configured group removed", removed)
	}
}

func TestMemoryLogicGateRaciCommandsRejectInvalidRoleUserAndCompany(t *testing.T) {
	t.Parallel()

	repo := NewMemoryRepo()
	companyID := "company-raci-command-validation"
	otherCompanyID := "company-raci-command-validation-other"
	repo.EnsureCompany(companyID, "RACI Validation Company")
	repo.EnsureCompany(otherCompanyID, "Other RACI Validation Company")
	logicGate, err := repo.CreateLogicGate(companyID, "Validation Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	member, err := repo.UpsertAuthUser("raci-command-member", "member-command@example.com", "Member Command")
	if err != nil {
		t.Fatalf("UpsertAuthUser member: %v", err)
	}
	if _, err := repo.AddCompanyMembership("raci-command-member", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership member: %v", err)
	}
	outsider, err := repo.UpsertAuthUser("raci-command-outsider", "outsider-command@example.com", "Outsider Command")
	if err != nil {
		t.Fatalf("UpsertAuthUser outsider: %v", err)
	}
	if _, err := repo.AddCompanyMembership("raci-command-outsider", otherCompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership outsider: %v", err)
	}

	_, err = repo.AddLogicGateRaciAssignments(LogicGateRaciAssignmentCommandInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, Assignments: []LogicGateRaciAssignmentInput{{Role: "owner", UserID: member.UserID}}})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid add role err = %v, want ErrInvalid", err)
	}
	_, err = repo.RemoveLogicGateRaciAssignments(LogicGateRaciAssignmentCommandInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, Assignments: []LogicGateRaciAssignmentInput{{Role: "owner", UserID: member.UserID}}})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid remove role err = %v, want ErrInvalid", err)
	}
	_, err = repo.AddLogicGateRaciAssignments(LogicGateRaciAssignmentCommandInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, Assignments: []LogicGateRaciAssignmentInput{{Role: domain.GVICRoleGenerated, UserID: outsider.UserID}}})
	if !errors.Is(err, ErrAssigneeNotInCompany) {
		t.Fatalf("outsider add err = %v, want ErrAssigneeNotInCompany", err)
	}
	_, err = repo.RemoveLogicGateRaciAssignments(LogicGateRaciAssignmentCommandInput{CompanyID: companyID, LogicGateID: logicGate.LogicGateID, Assignments: []LogicGateRaciAssignmentInput{{Role: domain.GVICRoleGenerated, UserID: outsider.UserID}}})
	if !errors.Is(err, ErrAssigneeNotInCompany) {
		t.Fatalf("outsider remove err = %v, want ErrAssigneeNotInCompany", err)
	}
	_, err = repo.AddLogicGateRaciAssignments(LogicGateRaciAssignmentCommandInput{CompanyID: otherCompanyID, LogicGateID: logicGate.LogicGateID, Assignments: []LogicGateRaciAssignmentInput{{Role: domain.GVICRoleGenerated, UserID: outsider.UserID}}})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("wrong company add err = %v, want ErrNotFound", err)
	}
	assertWorkspaceEventCount(t, repo, companyID, 0)
}
