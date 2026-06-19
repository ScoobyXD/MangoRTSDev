package store

import (
	"os"
	"strings"
	"testing"
)

func TestPostgresSetCompanyUserGroupMembersUsesAffectedGroupGVICSync(t *testing.T) {
	raw, err := os.ReadFile("postgres_entity_permissions.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_entity_permissions.go: %v", err)
	}
	body := extractFunctionSourceForTest(t, string(raw), "func (r *PostgresRepo) SetCompanyUserGroupMembers")
	normalized := strings.ToLower(strings.Join(strings.Fields(body), " "))

	if !strings.Contains(normalized, "recomputegroupdependenteffectiveaccessforgroupstx(ctx, tx, companyid, []string{groupid})") {
		t.Fatalf("SetCompanyUserGroupMembers does not use affected-group GVIC sync")
	}
	if strings.Contains(normalized, "recomputegroupdependenteffectiveaccessforcompanytx") {
		t.Fatalf("SetCompanyUserGroupMembers still calls the company-wide group GVIC recompute")
	}
}

func TestPostgresAffectedGroupGVICResourceKeyQueryIsScoped(t *testing.T) {
	raw, err := os.ReadFile("postgres_gvic.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_gvic.go: %v", err)
	}
	body := extractFunctionSourceForTest(t, string(raw), "func gvicResourceKeysForAffectedGroupsTx")
	normalized := strings.ToLower(strings.Join(strings.Fields(body), " "))

	required := []string{
		"input_groups(group_id) as ( select distinct unnest($2::text[])::uuid )",
		"join input_groups input_group on closure.descendant_group_id=input_group.group_id",
		"select distinct closure.ancestor_group_id as group_id",
		"join affected_groups affected_group on assignment.principal_id=affected_group.group_id",
		"assignment.company_id=$1::uuid and assignment.principal_type='group'",
		"join node_logic_gate_assignments link on direct_key.resource_type='logic_gate'",
		"link.logic_gate_id=direct_key.resource_id",
		"union select link.company_id, 'node'::text as resource_type, link.node_id as resource_id",
	}
	for _, needle := range required {
		if !strings.Contains(normalized, needle) {
			t.Fatalf("gvicResourceKeysForAffectedGroupsTx missing scoped SQL fragment %q", needle)
		}
	}
	if strings.Contains(normalized, "from resource_gvic_assignments where company_id=$1::uuid and principal_type='group'") {
		t.Fatalf("affected-group helper contains the broad company group-assignment scan")
	}
}

func TestPostgresBroadGroupGVICSyncIsNotUsedByMembershipWrites(t *testing.T) {
	raw, err := os.ReadFile("postgres_gvic.go")
	if err != nil {
		t.Fatalf("ReadFile postgres_gvic.go: %v", err)
	}
	source := strings.ToLower(strings.Join(strings.Fields(string(raw)), " "))
	if !strings.Contains(source, "func syncpostgresgvicforallgroupassignmentstx") {
		t.Fatalf("broad group GVIC repair helper not found")
	}
	if !strings.Contains(source, "group membership writes should use gvicresourcekeysforaffectedgroupstx instead") {
		t.Fatalf("broad group GVIC helper is not documented as a repair/backfill path")
	}
}
