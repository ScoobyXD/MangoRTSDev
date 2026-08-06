package store

import (
	"os"
	"strings"
	"testing"
)

func TestPostgresGroupMembershipWritesDoNotFanOutPolicyState(t *testing.T) {
	raw, err := os.ReadFile("postgres_entity_permissions.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, signature := range []string{
		"func (r *PostgresRepo) SetCompanyUserGroupMembers",
		"func (r *PostgresRepo) UpdateCompanyUserGroup",
	} {
		body := strings.ToLower(extractFunctionSourceForTest(t, string(raw), signature))
		for _, forbidden := range []string{
			"resource_gvic_assignments",
			"resource_permissions",
			"effective_resource_access",
			"gvic_matrix_projection",
			"recompute",
		} {
			if strings.Contains(body, forbidden) {
				t.Fatalf("%s fans out policy state through %q", signature, forbidden)
			}
		}
	}
}

func TestPostgresV2GVICExpandsNestedGroupsOnlyAtReadTime(t *testing.T) {
	raw, err := os.ReadFile("../../db/migrations/20260805_zzzc_v2_gvic_permissions_step2_cutover.sql")
	if err != nil {
		t.Fatal(err)
	}
	source := strings.ToLower(string(raw))
	for _, required := range []string{
		"create or replace function mangorts_v2_effective_gvic_assignments",
		"group_tree(role,source_principal_id,group_id,depth,path,updated_timestamp)",
		"company_user_groups",
		"company_user_group_members",
		"mangorts_v2_group_membership_version",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("V2 live group resolver missing %q", required)
		}
	}
	for _, forbidden := range []string{
		"insert into resource_gvic_effective_assignments",
		"update resource_gvic_effective_assignments",
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("Step 2 migration materializes group expansion through %q", forbidden)
		}
	}
}

func TestPostgresGVICRuntimeHasNoGroupRepairOrEffectiveProjection(t *testing.T) {
	raw, err := os.ReadFile("postgres_gvic.go")
	if err != nil {
		t.Fatal(err)
	}
	source := strings.ToLower(string(raw))
	for _, forbidden := range []string{
		"syncpostgresgvic",
		"gvicresourcekeysforaffectedgroups",
		"resource_gvic_effective_assignments",
		"resource_gvic_subtree_applications",
		"gvic_matrix_projection",
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("V2 GVIC runtime retained Step 1 path %q", forbidden)
		}
	}
}
