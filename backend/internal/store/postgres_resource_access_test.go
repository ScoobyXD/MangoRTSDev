package store

import (
	"os"
	"strings"
	"testing"
)

func TestPostgresResourcePermissionAssignmentsUseResolvedPointerRows(t *testing.T) {
	raw, err := os.ReadFile("postgres_resource_access.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_resource_access.go: %v", err)
	}
	body := postgresResourceAccessFunctionBodyForTest(t, string(raw), "func postgresResourcePermissionAssignmentsTx")
	if !strings.Contains(body, "postgresResolvedResourcePermissionAssignments(ctx, queryer, companyID, resourceType, resourceID)") {
		t.Fatal("resource permission assignment reads should use the pointer-aware resolver")
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
		"policySequence",
		"postgresRecordPermissionSubtreeApplicationsTx",
	} {
		if !strings.Contains(applyBody, required) {
			t.Fatalf("descendant permission apply missing %q", required)
		}
	}
	recordRaw, err := os.ReadFile("postgres_resource_policy_pointers.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_resource_policy_pointers.go: %v", err)
	}
	recordBody := postgresResourceAccessFunctionBodyForTest(t, strings.ReplaceAll(string(recordRaw), "\r\n", "\n"), "func postgresRecordPermissionSubtreeApplicationsTx")
	for _, required := range []string{
		"resourcePermissionSnapshotRuleKey",
		"resourcePermissionDefaultRuleKey",
		"for _, current := range currentAssignments",
	} {
		if !strings.Contains(recordBody, required) {
			t.Fatalf("descendant permission snapshot recording missing %q", required)
		}
	}
	for _, forbidden := range []string{"beforeDefault != afterDefault", "before == after"} {
		if strings.Contains(recordBody, forbidden) {
			t.Fatalf("descendant Apply must not depend on request-local changes, found %q", forbidden)
		}
	}
	for _, path := range []string{"../../db/schema.sql", "../../db/migrations/20260722_zz_full_descendant_policy_snapshots.sql"} {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("ReadFile %s: %v", path, err)
		}
		schemaContract := string(raw)
		for _, required := range []string{
			"rule_key = '__snapshot__'",
			"snapshot boolean not null default false",
			"latest_snapshot_application(policy_sequence)",
			"app.rule_key not in ('__default__', '__snapshot__')",
		} {
			if !strings.Contains(schemaContract, required) {
				t.Fatalf("%s missing full-snapshot contract %q", path, required)
			}
		}
	}
	for _, forbidden := range []string{
		"setPostgresResourceDefaultAccessForTargetsTx(ctx, tx",
		"deletePostgresResourcePermissionForTargetsTx(ctx, tx",
		"upsertPostgresResourcePermissionForTargetsTx(ctx, tx",
	} {
		if strings.Contains(applyBody, forbidden) {
			t.Fatalf("descendant permission apply should not fan out target rows, found %q", forbidden)
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
		"policySequence",
		"changedTargets = append(changedTargets, descendantTargets...)",
	} {
		if !strings.Contains(entityBody, required) {
			t.Fatalf("SetEntityPermissions descendant refresh path missing %q", required)
		}
	}
	if strings.Contains(entityBody, "appendEventRows") || strings.Contains(entityBody, "PermissionChangedEventInput") {
		t.Fatal("permission writes must not append generic realtime event rows")
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
