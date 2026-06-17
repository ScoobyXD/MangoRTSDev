package store

import (
	"crypto/md5"
	"encoding/hex"
	"strings"
)

func NormalizeCompanyExplorerV2View(value string) (string, bool) {
	return NormalizeCompanyExplorerLazyScope(value)
}

func normalizeCompanyExplorerV2RowsQuery(query CompanyExplorerV2RowsQuery, requireParent bool) (CompanyExplorerV2RowsQuery, error) {
	query.CompanyID = cleanUUIDText(query.CompanyID)
	query.ScopeUserID = cleanUUIDText(query.ScopeUserID)
	query.PermissionUserID = cleanUUIDText(query.PermissionUserID)
	query.ParentEntityID = cleanUUIDText(query.ParentEntityID)
	view, ok := NormalizeCompanyExplorerV2View(query.View)
	if !ok {
		return CompanyExplorerV2RowsQuery{}, ErrInvalid
	}
	query.View = view
	if query.CompanyID == "" || (requireParent && query.ParentEntityID == "") {
		return CompanyExplorerV2RowsQuery{}, ErrInvalid
	}
	if (query.View == CompanyExplorerLazyScopeMe || query.View == CompanyExplorerLazyScopeTeam) && query.ScopeUserID == "" {
		return CompanyExplorerV2RowsQuery{}, ErrInvalid
	}
	return query, nil
}

func normalizeCompanyExplorerV2EntityType(value string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case CompanyExplorerV2EntityCompany:
		return CompanyExplorerV2EntityCompany, true
	case CompanyExplorerV2EntityUserGroup:
		return CompanyExplorerV2EntityUserGroup, true
	case CompanyExplorerV2EntityUser:
		return CompanyExplorerV2EntityUser, true
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
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.ParentEntityID = cleanUUIDText(input.ParentEntityID)
	input.Name = strings.TrimSpace(input.Name)
	input.ActorUserID = cleanUUIDText(input.ActorUserID)
	input.PermissionUserID = cleanUUIDText(input.PermissionUserID)
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
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.EntityID = cleanUUIDText(input.EntityID)
	input.Name = strings.TrimSpace(input.Name)
	input.ActorUserID = cleanUUIDText(input.ActorUserID)
	input.PermissionUserID = cleanUUIDText(input.PermissionUserID)
	if input.CompanyID == "" || input.EntityID == "" || input.Name == "" {
		return CompanyExplorerV2FolderUpdateInput{}, ErrInvalid
	}
	return input, nil
}

func normalizeCompanyExplorerV2EdgeInput(input CompanyExplorerV2EdgeInput) (CompanyExplorerV2EdgeInput, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.ParentEntityID = cleanUUIDText(input.ParentEntityID)
	input.ChildEntityID = cleanUUIDText(input.ChildEntityID)
	input.ChildResourceID = cleanUUIDText(input.ChildResourceID)
	input.ActorUserID = cleanUUIDText(input.ActorUserID)
	input.PermissionUserID = cleanUUIDText(input.PermissionUserID)
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
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.EdgeID = cleanUUIDText(input.EdgeID)
	input.ParentEntityID = cleanUUIDText(input.ParentEntityID)
	input.ActorUserID = cleanUUIDText(input.ActorUserID)
	input.PermissionUserID = cleanUUIDText(input.PermissionUserID)
	if input.CompanyID == "" || input.EdgeID == "" || input.ParentEntityID == "" {
		return CompanyExplorerV2MoveEdgeInput{}, ErrInvalid
	}
	return input, nil
}

func companyExplorerV2NativeEntityID(companyID, entityType, resourceID string) string {
	sum := md5.Sum([]byte(companyID + ":company_explorer_v2_entity:" + strings.ToLower(strings.TrimSpace(entityType)) + ":" + resourceID))
	return uuidStringFromMD5(sum[:])
}

func companyExplorerV2EdgeID(companyID, parentEntityID, childEntityID string) string {
	sum := md5.Sum([]byte(companyID + ":company_explorer_v2_edge:" + parentEntityID + ":" + childEntityID))
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
	case CompanyExplorerV2EntityUserGroup:
		context["user_group_id"] = resourceID
	case CompanyExplorerV2EntityUser:
		context["user_id"] = resourceID
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
