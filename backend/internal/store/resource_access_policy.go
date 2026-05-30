package store

import "strings"

func usesDefaultResourceAccessPolicy(resourceType string) bool {
	resourceType, ok := NormalizeEntityType(resourceType)
	return ok && (resourceType == EntityTypeNode || resourceType == EntityTypeLogicGate)
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
