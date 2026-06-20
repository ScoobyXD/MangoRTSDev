package store

import (
	"crypto/md5"
	"encoding/hex"
	"strings"
)

func NormalizeCompanyExplorerV2View(value string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", CompanyExplorerLazyScopeAll:
		return CompanyExplorerLazyScopeAll, true
	default:
		return "", false
	}
}

func normalizeCompanyExplorerV2RowsQuery(query CompanyExplorerV2RowsQuery, requireParent bool) (CompanyExplorerV2RowsQuery, error) {
	query.CompanyID = strings.TrimSpace(query.CompanyID)
	query.ScopeUserID = strings.TrimSpace(query.ScopeUserID)
	query.PermissionUserID = strings.TrimSpace(query.PermissionUserID)
	query.ParentEntityID = strings.TrimSpace(query.ParentEntityID)
	view, ok := NormalizeCompanyExplorerV2View(query.View)
	if !ok {
		return CompanyExplorerV2RowsQuery{}, ErrInvalid
	}
	query.View = view
	if query.CompanyID == "" || (requireParent && query.ParentEntityID == "") {
		return CompanyExplorerV2RowsQuery{}, ErrInvalid
	}
	return query, nil
}

func normalizeCompanyExplorerV2EntityType(value string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case CompanyExplorerV2EntityCompany:
		return CompanyExplorerV2EntityCompany, true
	case CompanyExplorerV2EntityFolder:
		return CompanyExplorerV2EntityFolder, true
	case CompanyExplorerV2EntityProject:
		return CompanyExplorerV2EntityProject, true
	case CompanyExplorerV2EntityLogicGate:
		return CompanyExplorerV2EntityLogicGate, true
	case CompanyExplorerV2EntityNode:
		return CompanyExplorerV2EntityNode, true
	default:
		return "", false
	}
}

func normalizeCompanyExplorerV2FolderInput(input CompanyExplorerV2FolderInput) (CompanyExplorerV2FolderInput, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.ParentEntityID = strings.TrimSpace(input.ParentEntityID)
	input.Name = strings.TrimSpace(input.Name)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.PermissionUserID = strings.TrimSpace(input.PermissionUserID)
	input.DefaultAccess = strings.TrimSpace(input.DefaultAccess)
	if input.DefaultAccess == "" {
		input.DefaultAccess = ResourceDefaultAccessEdit
	}
	if input.CompanyID == "" || input.ParentEntityID == "" || input.Name == "" {
		return CompanyExplorerV2FolderInput{}, ErrInvalid
	}
	if input.DefaultAccess != ResourceDefaultAccessEdit && input.DefaultAccess != ResourceDefaultAccessNoAccess {
		return CompanyExplorerV2FolderInput{}, ErrInvalid
	}
	return input, nil
}

func normalizeCompanyExplorerV2FolderUpdateInput(input CompanyExplorerV2FolderUpdateInput) (CompanyExplorerV2FolderUpdateInput, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.EntityID = strings.TrimSpace(input.EntityID)
	input.Name = strings.TrimSpace(input.Name)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.PermissionUserID = strings.TrimSpace(input.PermissionUserID)
	if input.CompanyID == "" || input.EntityID == "" || input.Name == "" {
		return CompanyExplorerV2FolderUpdateInput{}, ErrInvalid
	}
	return input, nil
}

func normalizeCompanyExplorerV2EdgeInput(input CompanyExplorerV2EdgeInput) (CompanyExplorerV2EdgeInput, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.ParentEntityID = strings.TrimSpace(input.ParentEntityID)
	input.ChildEntityID = strings.TrimSpace(input.ChildEntityID)
	input.ChildResourceID = strings.TrimSpace(input.ChildResourceID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.PermissionUserID = strings.TrimSpace(input.PermissionUserID)
	entityType, ok := normalizeCompanyExplorerV2EntityType(input.ChildEntityType)
	if input.ChildEntityID == "" && (!ok || input.ChildResourceID == "") {
		return CompanyExplorerV2EdgeInput{}, ErrInvalid
	}
	input.ChildEntityType = entityType
	if input.CompanyID == "" || input.ParentEntityID == "" {
		return CompanyExplorerV2EdgeInput{}, ErrInvalid
	}
	return input, nil
}

func normalizeCompanyExplorerV2MoveEdgeInput(input CompanyExplorerV2MoveEdgeInput) (CompanyExplorerV2MoveEdgeInput, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.EdgeID = strings.TrimSpace(input.EdgeID)
	input.ParentEntityID = strings.TrimSpace(input.ParentEntityID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.PermissionUserID = strings.TrimSpace(input.PermissionUserID)
	if input.CompanyID == "" || input.EdgeID == "" || input.ParentEntityID == "" {
		return CompanyExplorerV2MoveEdgeInput{}, ErrInvalid
	}
	return input, nil
}

func normalizeCompanyExplorerV2SubscriptionInput(input CompanyExplorerV2SubscriptionInput) (CompanyExplorerV2SubscriptionInput, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.OwnerType = strings.ToLower(strings.TrimSpace(input.OwnerType))
	input.OwnerID = strings.TrimSpace(input.OwnerID)
	input.AnchorEntityID = strings.TrimSpace(input.AnchorEntityID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.PermissionUserID = strings.TrimSpace(input.PermissionUserID)
	if input.OwnerType == "" {
		input.OwnerType = CompanyExplorerV2SubscriptionOwnerUser
	}
	if input.OwnerType != CompanyExplorerV2SubscriptionOwnerUser && input.OwnerType != CompanyExplorerV2SubscriptionOwnerTeam {
		return CompanyExplorerV2SubscriptionInput{}, ErrInvalid
	}
	if input.OwnerType == CompanyExplorerV2SubscriptionOwnerUser && input.OwnerID == "" {
		input.OwnerID = input.ActorUserID
	}
	if input.CompanyID == "" || input.OwnerID == "" || input.AnchorEntityID == "" || input.ActorUserID == "" {
		return CompanyExplorerV2SubscriptionInput{}, ErrInvalid
	}
	return input, nil
}
func companyExplorerV2NativeEntityID(companyID, entityType, resourceID string) string {
	switch strings.ToLower(strings.TrimSpace(entityType)) {
	case CompanyExplorerV2EntityCompany, CompanyExplorerV2EntityProject, CompanyExplorerV2EntityLogicGate, CompanyExplorerV2EntityNode:
		return strings.TrimSpace(resourceID)
	}
	sum := md5.Sum([]byte(companyID + ":company_explorer_v2_entity:" + strings.ToLower(strings.TrimSpace(entityType)) + ":" + resourceID))
	return uuidStringFromMD5(sum[:])
}

func companyExplorerV2EdgeID(companyID, parentEntityID, childEntityID string) string {
	sum := md5.Sum([]byte(companyID + ":company_explorer_v2_edge:" + parentEntityID + ":" + childEntityID))
	return uuidStringFromMD5(sum[:])
}
func companyExplorerV2SubscriptionID(companyID, ownerType, ownerID, anchorEntityID string) string {
	sum := md5.Sum([]byte(companyID + ":company_explorer_v2_subscription:" + ownerType + ":" + ownerID + ":" + anchorEntityID))
	return uuidStringFromMD5(sum[:])
}

func uuidStringFromMD5(raw []byte) string {
	encoded := hex.EncodeToString(raw)
	if len(encoded) != 32 {
		return encoded
	}
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:32]
}

func companyExplorerV2ResourcePermissionType(entityType string) string {
	switch entityType {
	case CompanyExplorerV2EntityFolder:
		return EntityTypeCompanyExplorerFolder
	case CompanyExplorerV2EntityNode:
		return EntityTypeNode
	case CompanyExplorerV2EntityLogicGate:
		return EntityTypeLogicGate
	case CompanyExplorerV2EntityProject:
		return EntityTypeProject
	default:
		return ""
	}
}

func companyExplorerV2NativeContext(entityType, entityID, resourceID string) map[string]string {
	context := map[string]string{
		"entity_id": entityID,
	}
	if resourceID != "" {
		context["resource_id"] = resourceID
	}
	switch entityType {
	case CompanyExplorerV2EntityCompany:
		context["company_id"] = resourceID
	case CompanyExplorerV2EntityFolder:
		context["folder_id"] = entityID
	case CompanyExplorerV2EntityProject:
		context["project_id"] = resourceID
	case CompanyExplorerV2EntityLogicGate:
		context["logic_gate_id"] = resourceID
	case CompanyExplorerV2EntityNode:
		context["node_id"] = resourceID
	}
	return context
}
