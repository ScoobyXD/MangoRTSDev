package store

import (
	"os"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestMemoryV2RACICustomizeWithoutAssignmentsReturnsToInheritedWhenItMatchesParent(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "a1000000-0000-4000-8000-000000000001"
	repo.EnsureCompany(companyID, "Customize Source Co")
	group, err := repo.CreateCompanyUserGroup(companyID, "", "Consulted team")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup: %v", err)
	}
	gate, err := repo.CreateLogicGate(companyID, "Source gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Inherited node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	priority := 1
	if _, err := repo.AssignNodeToLogicGateStatus(LogicGateNodeAssignmentInput{
		CompanyID: companyID, LogicGateID: gate.LogicGateID, NodeID: node.NodeID,
		Status: "pending", Priority: &priority, PrioritySet: true,
	}); err != nil {
		t.Fatalf("AssignNodeToLogicGateStatus: %v", err)
	}
	if _, _, err := repo.PutResourceRACIPolicy(ResourceRACIPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: gate.LogicGateID,
		AssignmentMode: PolicyModeCustomized, DescendantAction: PolicyDescendantActionInheritedOnly,
		Assignments: []ResourceRACIAssignmentInput{{
			Role: domain.RACIRoleConsulted, PrincipalType: EntityPermissionSubjectGroup, PrincipalID: group.GroupID,
		}},
	}); err != nil {
		t.Fatalf("customize gate: %v", err)
	}
	if _, _, err := repo.PutResourceRACIPolicy(ResourceRACIPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID,
		AssignmentMode: PolicyModeInherited, DescendantAction: PolicyDescendantActionInheritedOnly,
	}); err != nil {
		t.Fatalf("inherit node: %v", err)
	}
	current, err := repo.GetResourceRACIPolicy(companyID, EntityTypeNode, node.NodeID)
	if err != nil {
		t.Fatalf("GetResourceRACIPolicy: %v", err)
	}
	customized, _, err := repo.PutResourceRACIPolicy(ResourceRACIPolicyUpdateInput{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID,
		AssignmentMode: PolicyModeCustomized, DescendantAction: PolicyDescendantActionInheritedOnly,
		ExpectedRevision: current.Revision,
	})
	if err != nil {
		t.Fatalf("customize inherited node: %v", err)
	}
	if customized.AssignmentMode != PolicyModeInherited || len(customized.RACIAssignments) != 0 {
		t.Fatalf("automatic policy mode = %+v, want inherited", customized)
	}
	if customized.ParentPolicy == nil || len(customized.ParentPolicy.Assignments) != 1 {
		t.Fatalf("parent policy = %+v, want one raw group pointer", customized.ParentPolicy)
	}
	assignment := customized.ParentPolicy.Assignments[0]
	if assignment.Role != domain.RACIRoleConsulted || assignment.PrincipalType != EntityPermissionSubjectGroup || assignment.PrincipalID != group.GroupID {
		t.Fatalf("copied assignment = %+v, want raw group pointer", assignment)
	}
}

func TestPostgresV2RACICustomizeCopiesEffectiveSourceBeforePrincipalValidation(t *testing.T) {
	raw, err := os.ReadFile("postgres_policy_v2.go")
	if err != nil {
		t.Fatal(err)
	}
	body := extractFunctionSourceForTest(t, string(raw), "func (r *PostgresRepo) PutResourceRACIPolicy")
	copySource := strings.Index(body, "if mode == PolicyModeCustomized && input.Assignments == nil")
	validateAssignments := strings.Index(body, "for _, assignment := range normalized")
	if copySource < 0 {
		t.Fatal("Postgres V2 RACI customize no longer copies the raw effective source when assignments are omitted")
	}
	if validateAssignments < 0 {
		t.Fatal("Postgres V2 RACI customize no longer validates normalized assignments")
	}
	if copySource > validateAssignments {
		t.Fatal("Postgres V2 RACI customize validates an empty assignment slice before copying the effective source")
	}
}
