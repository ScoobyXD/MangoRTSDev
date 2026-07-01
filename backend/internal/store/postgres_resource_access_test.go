package store

import (
	"os"
	"strings"
	"testing"
)

func TestPostgresResourcePermissionAssignmentsClosesPermissionRowsBeforeReturn(t *testing.T) {
	raw, err := os.ReadFile("postgres_resource_access.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_resource_access.go: %v", err)
	}
	body := postgresResourceAccessFunctionBodyForTest(t, string(raw), "func postgresResourcePermissionAssignmentsTx")
	if strings.Contains(body, "defer rows.Close()") {
		t.Fatal("resource permission reads should close permission rows before returning buffered assignments")
	}
	appendIndex := strings.Index(body, "assignments = append(assignments, assignment)")
	rowsErrIndex := strings.Index(body, "if err := rows.Err(); err != nil")
	closeIndex := strings.Index(body, "if err := rows.Close(); err != nil")
	returnIndex := strings.Index(body, "return assignments, nil")
	if appendIndex < 0 || rowsErrIndex < 0 || closeIndex < 0 || returnIndex < 0 {
		t.Fatal("resource permission reads should buffer assignments, check rows, close rows, then return assignments")
	}
	if !(appendIndex < rowsErrIndex && rowsErrIndex < closeIndex && closeIndex < returnIndex) {
		t.Fatal("resource permission reads return before closing permission rows")
	}
}

func TestPostgresResourceAccessPolicySnapshotComparesExactPolicy(t *testing.T) {
	raw, err := os.ReadFile("postgres_resource_access.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_resource_access.go: %v", err)
	}
	body := postgresResourceAccessFunctionBodyForTest(t, string(raw), "func snapshotPostgresResourceAccessPolicyTx")
	if !strings.Contains(body, "sourceDefaultAccess == targetDefaultAccess") {
		t.Fatal("policy snapshot must compare source and target default_access before rewriting")
	}
	if !strings.Contains(body, "orderedResourcePermissionAssignmentsEqual(sourceAssignments, targetAssignments)") {
		t.Fatal("policy snapshot must compare exact permission assignments before rewriting")
	}
	if !strings.Contains(body, "setPostgresResourceDefaultAccessTx(ctx, tx, companyID, targetType, targetID, sourceDefaultAccess)") {
		t.Fatal("policy snapshot must set the target default_access from the source")
	}
	if !strings.Contains(body, "deletePostgresResourceOverridesTx(ctx, tx, companyID, targetType, targetID)") {
		t.Fatal("policy snapshot must replace target override rows atomically")
	}
	if !strings.Contains(body, "insertPostgresResourcePermissionTx(ctx, tx, companyID, targetType, targetID, assignment)") {
		t.Fatal("policy snapshot must copy source permission assignments onto the target resource type")
	}
}

func TestPostgresResourcePermissionGroupRowsAndDescendantApplyStaySourceShaped(t *testing.T) {
	raw, err := os.ReadFile("postgres_resource_access.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_resource_access.go: %v", err)
	}
	source := strings.ReplaceAll(string(raw), "\r\n", "\n")
	inputBody := postgresResourceAccessFunctionBodyForTest(t, source, "func postgresResourcePermissionAssignmentsFromInput")
	for _, required := range []string{
		"case EntityPermissionSubjectGroup:",
		"company_user_groups",
		"assignment := resourcePermissionAssignment{SubjectType: subjectType, SubjectID: subjectID, AccessLevel: accessLevel}",
	} {
		if !strings.Contains(inputBody, required) {
			t.Fatalf("resource permission input normalization missing %q", required)
		}
	}
	for _, forbidden := range []string{
		"company_user_group_members member",
		"append(out, userID)",
	} {
		if strings.Contains(inputBody, forbidden) {
			t.Fatalf("resource permission group input should keep group source rows, found %q", forbidden)
		}
	}
	applyBody := postgresResourceAccessFunctionBodyForTest(t, source, "func applyPostgresResourcePermissionPolicyToDescendantsTx")
	for _, required := range []string{
		"postgresResourcePermissionDescendantTargetsTx",
		"setPostgresResourceDefaultAccessForTargetsTx",
		"deletePostgresResourcePermissionForTargetsTx",
		"upsertPostgresResourcePermissionForTargetsTx",
	} {
		if !strings.Contains(applyBody, required) {
			t.Fatalf("descendant permission apply missing %q", required)
		}
	}

	entityRaw, err := os.ReadFile("postgres_entity_permissions.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_entity_permissions.go: %v", err)
	}
	entityBody := postgresResourceAccessFunctionBodyForTest(t, strings.ReplaceAll(string(entityRaw), "\r\n", "\n"), "func (r *PostgresRepo) SetEntityPermissions")
	for _, required := range []string{
		"changedTargets := []resourcePermissionTarget",
		"descendantTargets, err := applyPostgresResourcePermissionPolicyToDescendantsTx",
		"changedTargets = append(changedTargets, descendantTargets...)",
		"applyResourcePermissionProjectionDeltaDependenciesTx",
		"PermissionChangedEventInput(companyID, target.ResourceType, target.ResourceID",
	} {
		if !strings.Contains(entityBody, required) {
			t.Fatalf("SetEntityPermissions descendant refresh path missing %q", required)
		}
	}
}

func postgresResourceAccessFunctionBodyForTest(t *testing.T, source, signature string) string {
	t.Helper()
	start := strings.Index(source, signature)
	if start < 0 {
		t.Fatalf("missing function %q", signature)
	}
	remaining := source[start+len(signature):]
	end := strings.Index(remaining, "\nfunc ")
	if end < 0 {
		return remaining
	}
	return remaining[:end]
}
