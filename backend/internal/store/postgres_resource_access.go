package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

type postgresResourceAccessQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func postgresResourceDefaultAccess(ctx context.Context, q postgresResourceAccessQueryer, companyID, resourceType, resourceID string) (string, error) {
	companyID = cleanUUIDText(companyID)
	resourceID = cleanUUIDText(resourceID)
	resourceType, ok := NormalizeEntityType(resourceType)
	if ctx == nil || q == nil || companyID == "" || resourceID == "" || !ok {
		return "", ErrInvalid
	}
	var access string
	err := q.QueryRowContext(ctx, `
select resolved.default_access
from mangorts_v2_resolve_permission_policy($1::uuid,$2::text,$3::uuid) resolved`, companyID, resourceType, resourceID).Scan(&access)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return access, nil
}

type resourcePermissionAssignment struct {
	SubjectType string
	SubjectID   string
	AccessLevel string
}

type resourcePermissionTarget struct {
	ResourceType string
	ResourceID   string
}

func orderedStringSlicesEqual(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func orderedResourcePermissionAssignmentsEqual(left, right []resourcePermissionAssignment) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func resourcePermissionAssignmentKey(assignment resourcePermissionAssignment) string {
	return assignment.SubjectType + ":" + assignment.SubjectID
}

func resourcePermissionAssignmentMap(assignments []resourcePermissionAssignment) map[string]resourcePermissionAssignment {
	out := make(map[string]resourcePermissionAssignment, len(assignments))
	for _, assignment := range assignments {
		out[resourcePermissionAssignmentKey(assignment)] = assignment
	}
	return out
}

func (r *PostgresRepo) effectiveAccessLevelForUserTx(ctx context.Context, tx *sql.Tx, companyID, userID, resourceType, resourceID string) (string, error) {
	companyID = cleanUUIDText(companyID)
	userID = cleanUUIDText(userID)
	resourceID = cleanUUIDText(resourceID)
	resourceType, ok := NormalizeEntityType(resourceType)
	if ctx == nil || tx == nil || companyID == "" || userID == "" || resourceID == "" || !ok {
		return "", ErrInvalid
	}
	var accessLevel string
	err := tx.QueryRowContext(ctx, `
select case
  when mangorts_user_can_access_resource($1::uuid,$3::text,$4::uuid,$2::uuid,'edit') then 'edit'
  else 'no_access'
end`, companyID, userID, resourceType, resourceID).Scan(&accessLevel)
	return accessLevel, err
}

func postgresResourceAccessCheckSQL(resourceAlias, idColumn, resourceType, userParam, requiredParam string) string {
	resourceAlias = strings.TrimSpace(resourceAlias)
	idColumn = strings.TrimSpace(idColumn)
	resourceType = strings.TrimSpace(resourceType)
	userParam = strings.TrimSpace(userParam)
	requiredParam = strings.TrimSpace(requiredParam)
	if resourceAlias == "" || idColumn == "" || resourceType == "" || userParam == "" || requiredParam == "" {
		return "false"
	}
	return `mangorts_user_can_access_resource(` + resourceAlias + `.company_id, '` + resourceType + `', ` + resourceAlias + `.` + idColumn + `, ` + userParam + `::uuid, ` + requiredParam + `)`
}
