package store

import "miraeopus/backend/internal/domain"

const (
	PolicyModeInherited  = "inherited"
	PolicyModeCustomized = "customized"

	PolicyDescendantActionInheritedOnly       = "inherited_only"
	PolicyDescendantActionIncludingCustomized = "including_customized"
)

type PolicySource struct {
	ResourceType string `json:"resource_type"`
	ResourceID   string `json:"resource_id"`
	ResourceName string `json:"resource_name,omitempty"`
}

type PolicyOverwrite struct {
	ResourceType string `json:"resource_type"`
	ResourceID   string `json:"resource_id"`
	Sequence     int64  `json:"sequence"`
}

type ResourceGVICPolicy struct {
	CompanyID               string                                   `json:"company_id"`
	ResourceType            string                                   `json:"resource_type"`
	ResourceID              string                                   `json:"resource_id"`
	AssignmentMode          string                                   `json:"assignment_mode"`
	EffectiveAssignmentMode string                                   `json:"effective_assignment_mode"`
	EffectiveSource         PolicySource                             `json:"effective_source"`
	OverwrittenByAncestor   *PolicyOverwrite                         `json:"overwritten_by_ancestor"`
	GVICAssignments         []domain.ResourceGVICAssignment          `json:"gvic_assignments"`
	EffectiveAssignments    []domain.ResourceGVICEffectiveAssignment `json:"effective_assignments"`
	Revision                string                                   `json:"revision"`
}

type ResourcePermissionPolicy struct {
	CompanyID               string                    `json:"company_id"`
	ResourceType            string                    `json:"resource_type"`
	ResourceID              string                    `json:"resource_id"`
	PermissionMode          string                    `json:"permission_mode"`
	EffectivePermissionMode string                    `json:"effective_permission_mode"`
	EffectiveSource         PolicySource              `json:"effective_source"`
	OverwrittenByAncestor   *PolicyOverwrite          `json:"overwritten_by_ancestor"`
	DefaultAccess           *string                   `json:"default_access"`
	EffectiveDefaultAccess  string                    `json:"effective_default_access"`
	Permissions             []domain.EntityPermission `json:"permissions"`
	EffectivePermissions    []domain.EntityPermission `json:"effective_permissions"`
	Revision                string                    `json:"revision"`
}

type ResourceGVICPolicyUpdateInput struct {
	CompanyID        string
	ResourceType     string
	ResourceID       string
	AssignmentMode   string
	Assignments      []ResourceGVICAssignmentInput
	DescendantAction string
	ExpectedRevision string
	ActorUserID      string
	IdempotencyKey   string
}

type ResourcePermissionPolicyUpdateInput struct {
	CompanyID        string
	ResourceType     string
	ResourceID       string
	PermissionMode   string
	DefaultAccess    *string
	Permissions      []EntityPermissionInput
	DescendantAction string
	ExpectedRevision string
	ActorUserID      string
	IdempotencyKey   string
}

type ResourcePolicyFingerprints struct {
	GVIC       string
	Permission string
}

type V2PolicyRepository interface {
	GetResourceGVICPolicy(companyID, resourceType, resourceID string) (ResourceGVICPolicy, error)
	PutResourceGVICPolicy(input ResourceGVICPolicyUpdateInput) (ResourceGVICPolicy, []domain.DomainEvent, error)
	GetResourcePermissionPolicy(companyID, resourceType, resourceID string) (ResourcePermissionPolicy, error)
	PutResourcePermissionPolicy(input ResourcePermissionPolicyUpdateInput) (ResourcePermissionPolicy, []domain.DomainEvent, error)
	ResourcePolicyFingerprints(companyID, resourceType, resourceID, userID string) (ResourcePolicyFingerprints, error)
}

func v2PolicyEventPayload(resourceType, resourceID string, values map[string]any) map[string]any {
	payload := map[string]any{"resource_type": resourceType, "resource_id": resourceID}
	for key, value := range values {
		payload[key] = value
	}
	switch resourceType {
	case EntityTypeNode:
		payload["node_id"] = resourceID
	case EntityTypeLogicGate:
		payload["logic_gate_id"] = resourceID
	case EntityTypeSharedInbox:
		payload["shared_inbox_id"] = resourceID
	case EntityTypeSharedInboxFolder:
		payload["folder_id"] = resourceID
	}
	return payload
}
