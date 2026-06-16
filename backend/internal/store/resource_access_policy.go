package store

import "strings"

func usesDefaultResourceAccessPolicy(resourceType string) bool {
	resourceType, ok := NormalizeEntityType(resourceType)
	return ok && (resourceType == EntityTypeNode || resourceType == EntityTypeLogicGate || resourceType == EntityTypeProject || resourceType == EntityTypeCompanyExplorerFolder || resourceType == EntityTypeSharedInboxFolder || resourceType == EntityTypeSharedInbox)
}

func defaultResourceAccessOrEdit(access string) string {
	access, ok := NormalizeResourceDefaultAccess(access)
	if !ok {
		return ResourceDefaultAccessEdit
	}
	return access
}

func permissionInputAccessLevel(input EntityPermissionInput) string {
	accessLevel := strings.TrimSpace(input.AccessLevel)
	if accessLevel == "" {
		accessLevel = input.Permission
	}
	return accessLevel
}

func inferredResourceDefaultAccessFromPermissions(permissions []EntityPermissionInput) (string, bool, error) {
	if len(permissions) == 0 {
		return "", false, nil
	}
	hasPositiveGrant := false
	hasNoAccess := false
	for _, permission := range permissions {
		accessLevel, ok := NormalizeEntityPermission(permissionInputAccessLevel(permission))
		if !ok {
			return "", false, ErrInvalid
		}
		if accessLevel == EntityPermissionNoAccess {
			hasNoAccess = true
			continue
		}
		hasPositiveGrant = true
	}
	if hasPositiveGrant {
		return ResourceDefaultAccessNoAccess, true, nil
	}
	if hasNoAccess {
		return ResourceDefaultAccessEdit, true, nil
	}
	return "", false, nil
}
