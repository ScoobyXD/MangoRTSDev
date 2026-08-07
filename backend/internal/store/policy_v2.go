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

type ResourceRACIPolicyParent struct {
	Source      PolicySource                    `json:"source"`
	Assignments []domain.ResourceRACIAssignment `json:"gvic_assignments"`
}

type ResourcePermissionPolicyParent struct {
	Source        PolicySource              `json:"source"`
	DefaultAccess string                    `json:"default_access"`
	Permissions   []domain.EntityPermission `json:"permissions"`
}

type ResourceRACIPolicy struct {
	CompanyID               string                                   `json:"company_id"`
	ResourceType            string                                   `json:"resource_type"`
	ResourceID              string                                   `json:"resource_id"`
	AssignmentMode          string                                   `json:"assignment_mode"`
	EffectiveAssignmentMode string                                   `json:"effective_assignment_mode"`
	EffectiveSource         PolicySource                             `json:"effective_source"`
	OverwrittenByAncestor   *PolicyOverwrite                         `json:"overwritten_by_ancestor"`
	RACIAssignments         []domain.ResourceRACIAssignment          `json:"gvic_assignments"`
	EffectiveAssignments    []domain.ResourceRACIEffectiveAssignment `json:"effective_assignments"`
	ParentPolicy            *ResourceRACIPolicyParent                `json:"parent_policy,omitempty"`
	HasDescendants          bool                                     `json:"has_descendants"`
	Revision                string                                   `json:"revision"`
}

type ResourcePermissionPolicy struct {
	CompanyID               string                          `json:"company_id"`
	ResourceType            string                          `json:"resource_type"`
	ResourceID              string                          `json:"resource_id"`
	PermissionMode          string                          `json:"permission_mode"`
	EffectivePermissionMode string                          `json:"effective_permission_mode"`
	EffectiveSource         PolicySource                    `json:"effective_source"`
	OverwrittenByAncestor   *PolicyOverwrite                `json:"overwritten_by_ancestor"`
	DefaultAccess           *string                         `json:"default_access"`
	EffectiveDefaultAccess  string                          `json:"effective_default_access"`
	Permissions             []domain.EntityPermission       `json:"permissions"`
	EffectivePermissions    []domain.EntityPermission       `json:"effective_permissions"`
	ParentPolicy            *ResourcePermissionPolicyParent `json:"parent_policy,omitempty"`
	HasDescendants          bool                            `json:"has_descendants"`
	Revision                string                          `json:"revision"`
}

type ResourceRACIPolicyUpdateInput struct {
	CompanyID        string
	ResourceType     string
	ResourceID       string
	AssignmentMode   string
	Assignments      []ResourceRACIAssignmentInput
	DescendantAction string
	ExpectedRevision string
	ActorUserID      string
	IdempotencyKey   string
}

type ResourcePermissionPolicyUpdateInput struct {
	CompanyID         string
	ResourceType      string
	ResourceID        string
	PermissionMode    string
	DefaultAccess     *string
	Permissions       []EntityPermissionInput
	DescendantAction  string
	ExpectedRevision  string
	ActorUserID       string
	PreserveActorEdit bool
	IdempotencyKey    string
}

type ResourcePolicyFingerprints struct {
	RACI       string
	Permission string
}

type V2PolicyRepository interface {
	GetResourceRACIPolicy(companyID, resourceType, resourceID string) (ResourceRACIPolicy, error)
	PutResourceRACIPolicy(input ResourceRACIPolicyUpdateInput) (ResourceRACIPolicy, []domain.DomainEvent, error)
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
