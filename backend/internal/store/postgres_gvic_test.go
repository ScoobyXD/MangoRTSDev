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
	source := string(raw)
	ancestorBody := extractFunctionSourceForTest(t, source, "func gvicAncestorGroupIDsForGroupsTx")
	exactBody := extractFunctionSourceForTest(t, source, "func gvicResourceKeysForGroupPrincipalIDsTx")
	wrapperBody := extractFunctionSourceForTest(t, source, "func gvicResourceKeysForAffectedGroupsTx")
	ancestor := strings.ToLower(strings.Join(strings.Fields(ancestorBody), " "))
	exact := strings.ToLower(strings.Join(strings.Fields(exactBody), " "))
	wrapper := strings.ToLower(strings.Join(strings.Fields(wrapperBody), " "))

	for _, needle := range []string{
		"input_groups(group_id) as ( select distinct unnest($2::text[])::uuid )",
		"join input_groups input_group on closure.descendant_group_id=input_group.group_id",
		"select distinct closure.ancestor_group_id::text",
	} {
		if !strings.Contains(ancestor, needle) {
			t.Fatalf("gvicAncestorGroupIDsForGroupsTx missing scoped SQL fragment %q", needle)
		}
	}
	for _, needle := range []string{
		"input_groups(group_id) as ( select distinct unnest($2::text[])::uuid )",
		"join input_groups input_group on assignment.principal_id=input_group.group_id",
		"assignment.company_id=$1::uuid and assignment.principal_type='group'",
		"join node_logic_gate_assignments link on direct_key.resource_type='logic_gate'",
		"link.logic_gate_id=direct_key.resource_id",
		"union select link.company_id, 'node'::text as resource_type, link.node_id as resource_id",
	} {
		if !strings.Contains(exact, needle) {
			t.Fatalf("gvicResourceKeysForGroupPrincipalIDsTx missing scoped SQL fragment %q", needle)
		}
	}
	for _, needle := range []string{
		"gvicancestorgroupidsforgroupstx",
		"gvicresourcekeysforgroupprincipalidstx",
	} {
		if !strings.Contains(wrapper, needle) {
			t.Fatalf("gvicResourceKeysForAffectedGroupsTx missing wrapper call %q", needle)
		}
	}
	if strings.Contains(exact, "from resource_gvic_assignments where company_id=$1::uuid and principal_type='group'") {
		t.Fatalf("exact group-principal helper contains the broad company group-assignment scan")
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
	if !strings.Contains(source, "group membership and hierarchy writes should use targeted group-principal helpers instead") {
		t.Fatalf("broad group GVIC helper is not documented as a repair/backfill path")
	}
}
