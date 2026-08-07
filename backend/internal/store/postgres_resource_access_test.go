package store

import (
	"os"
	"strings"
	"testing"
)

func TestPostgresResourceAccessUsesOnlyV2ResolvedPolicy(t *testing.T) {
	raw, err := os.ReadFile("postgres_resource_access.go")
	if err != nil {
		t.Fatal(err)
	}
	source := strings.ToLower(string(raw))
	for _, required := range []string{
		"mangorts_v2_resolve_permission_policy",
		"mangorts_user_can_access_resource",
		"select source_setting.default_access",
		"join resource_permission_settings source_setting",
		"source_setting.resource_type=resolved.source_resource_type",
		"source_setting.resource_id=resolved.source_resource_id",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("V2 resource access reader missing %q", required)
		}
	}
	for _, forbidden := range []string{
		"select resolved.default_access",
		"resource_permission_policy_revisions",
		"resource_permission_subtree_applications",
		"effective_resource_access",
		"snapshotpostgresresourceaccesspolicytx",
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("V2 resource access reader retained Step 1 authority %q", forbidden)
		}
	}

	migrationRaw, err := os.ReadFile("../../db/migrations/20260805_zzzc_v2_gvic_permissions_step2_cutover.sql")
	if err != nil {
		t.Fatal(err)
	}
	migration := strings.ToLower(string(migrationRaw))
	for _, required := range []string{
		"create or replace function mangorts_v2_resolve_permission_policy",
		"from resource_permission_settings",
		"from resource_permissions",
	} {
		if !strings.Contains(migration, required) {
			t.Fatalf("V2 permission resolver missing %q", required)
		}
	}
}

func TestPostgresEntityPermissionBridgeUsesCompleteV2PolicyWrites(t *testing.T) {
	entityRaw, err := os.ReadFile("postgres_entity_permissions.go")
	if err != nil {
		t.Fatal(err)
	}
	entityBody := postgresResourceAccessFunctionBodyForTest(t, string(entityRaw), "func (r *PostgresRepo) SetEntityPermissions")
	for _, required := range []string{
		"GetResourcePermissionPolicy",
		"PutResourcePermissionPolicy",
		"PolicyDescendantActionInheritedOnly",
		"PolicyDescendantActionIncludingCustomized",
		"ExpectedRevision: current.Revision",
	} {
		if !strings.Contains(entityBody, required) {
			t.Fatalf("SetEntityPermissions V2 bridge missing %q", required)
		}
	}

	policyRaw, err := os.ReadFile("postgres_policy_v2.go")
	if err != nil {
		t.Fatal(err)
	}
	putBody := postgresResourceAccessFunctionBodyForTest(t, string(policyRaw), "func (r *PostgresRepo) PutResourcePermissionPolicy")
	for _, required := range []string{
		"nextval('resource_permission_change_sequence')",
		"Scan(&resultingSequence)",
		"descendant_reset_sequence=$4",
		"delete from resource_permissions",
		"insert into resource_permissions",
		"ErrVersionConflict",
	} {
		if !strings.Contains(putBody, required) {
			t.Fatalf("PutResourcePermissionPolicy constant-size V2 write missing %q", required)
		}
	}
	for _, forbidden := range []string{
		"resource_permission_subtree_applications",
		"applyPostgresResourcePermissionPolicyToDescendantsTx",
		"resource_permission_policy_revisions",
	} {
		if strings.Contains(putBody, forbidden) {
			t.Fatalf("PutResourcePermissionPolicy retained Step 1 path %q", forbidden)
		}
	}
}

func TestPostgresV2PermissionGraphKeepsGroupSourceEdges(t *testing.T) {
	raw, err := os.ReadFile("postgres_policy_v2.go")
	if err != nil {
		t.Fatal(err)
	}
	putBody := postgresResourceAccessFunctionBodyForTest(t, string(raw), "func (r *PostgresRepo) PutResourcePermissionPolicy")
	for _, required := range []string{
		"validatePostgresRACIPrincipalTx",
		"permission.SubjectType",
		"permission.SubjectID",
		"insert into resource_permissions",
	} {
		if !strings.Contains(putBody, required) {
			t.Fatalf("V2 permission graph write missing %q", required)
		}
	}
	for _, forbidden := range []string{
		"company_user_group_members",
		"company_user_group_closure",
		"resource_permission_subtree_applications",
	} {
		if strings.Contains(putBody, forbidden) {
			t.Fatalf("V2 permission graph write expands or fans out through %q", forbidden)
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
