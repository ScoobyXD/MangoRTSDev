package store

import (
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestV2PolicyEventsCarryPolicyActionAndResultingSequence(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "company-v2-policy-event-sequence"
	repo.EnsureCompany(companyID, "V2 Policy Event Sequence")
	user, err := repo.UpsertAuthUser("v2-policy-event-user", "v2-policy-event@example.com", "Policy Event User")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Policy Event Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}

	_, gvicEvents, err := repo.PutResourceGVICPolicy(ResourceGVICPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID,
		AssignmentMode: PolicyModeCustomized, DescendantAction: PolicyDescendantActionIncludingCustomized,
		Assignments: []ResourceGVICAssignmentInput{{
			Role: domain.GVICRoleResponsible, PrincipalType: EntityPermissionSubjectUser, PrincipalID: user.UserID,
		}},
	})
	if err != nil {
		t.Fatalf("PutResourceGVICPolicy: %v", err)
	}
	assertV2PolicyEventSequence(t, gvicEvents, "gvic", PolicyDescendantActionIncludingCustomized)

	defaultAccess := ResourceDefaultAccessNoAccess
	_, permissionEvents, err := repo.PutResourcePermissionPolicy(ResourcePermissionPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID,
		PermissionMode: PolicyModeCustomized, DefaultAccess: &defaultAccess,
		DescendantAction: PolicyDescendantActionIncludingCustomized,
		Permissions: []EntityPermissionInput{{
			SubjectType: EntityPermissionSubjectUser, SubjectID: user.UserID, AccessLevel: EntityPermissionEdit,
		}},
	})
	if err != nil {
		t.Fatalf("PutResourcePermissionPolicy: %v", err)
	}
	assertV2PolicyEventSequence(t, permissionEvents, "permission", PolicyDescendantActionIncludingCustomized)
}

func TestV2GVICPolicyRoleChangeTargetsExistingUser(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "company-v2-policy-role-change"
	repo.EnsureCompany(companyID, "V2 Policy Role Change")
	user, err := repo.UpsertAuthUser("v2-policy-role-change-user", "role-change@example.com", "Role Change User")
	if err != nil {
		t.Fatalf("UpsertAuthUser: %v", err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Policy Role Change Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}

	if _, _, err := repo.PutResourceGVICPolicy(ResourceGVICPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID,
		AssignmentMode: PolicyModeCustomized, DescendantAction: PolicyDescendantActionInheritedOnly,
		Assignments: []ResourceGVICAssignmentInput{{Role: domain.GVICRoleResponsible, PrincipalType: EntityPermissionSubjectUser, PrincipalID: user.UserID}},
	}); err != nil {
		t.Fatalf("initial PutResourceGVICPolicy: %v", err)
	}
	_, events, err := repo.PutResourceGVICPolicy(ResourceGVICPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID,
		AssignmentMode: PolicyModeCustomized, DescendantAction: PolicyDescendantActionInheritedOnly,
		Assignments: []ResourceGVICAssignmentInput{{Role: domain.GVICRoleConsulted, PrincipalType: EntityPermissionSubjectUser, PrincipalID: user.UserID}},
	})
	if err != nil {
		t.Fatalf("role-change PutResourceGVICPolicy: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("role-change events = %+v, want one", events)
	}
	userIDs, ok := events[0].Payload["assignment_user_ids"].([]string)
	if !ok || len(userIDs) != 1 || userIDs[0] != user.UserID {
		t.Fatalf("assignment_user_ids = %#v, want existing user %s after role change", events[0].Payload["assignment_user_ids"], user.UserID)
	}
}
func assertV2PolicyEventSequence(t *testing.T, events []domain.DomainEvent, policyType, action string) {
	t.Helper()
	if len(events) != 1 {
		t.Fatalf("events = %+v, want one", events)
	}
	payload := events[0].Payload
	sequence, ok := payload["sequence"].(int64)
	if payload["policy_type"] != policyType || payload["action"] != action || payload["descendant_action"] != action || !ok || sequence <= 0 {
		t.Fatalf("policy event payload = %+v, want type %q action %q and positive sequence", payload, policyType, action)
	}
}
