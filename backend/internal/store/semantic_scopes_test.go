package store

import "testing"

func TestCompanyExplorerAffectedScopesUseManualPlacementAndCanonicalResourceTargets(t *testing.T) {
	companyID := "11111111-1111-4111-8111-111111111111"
	folderID := "22222222-2222-4222-8222-222222222222"
	nodeID := "33333333-3333-4333-8333-333333333333"

	scopes := CompanyExplorerAffectedScopes(companyID, "company_explorer_folder_item_assigned", map[string]any{
		"folder_id": folderID,
		"item_type": EntityTypeNode,
		"item_id":   nodeID,
	})

	requireScope(t, scopes, CompanyExplorerRootScope(companyID))
	requireScope(t, scopes, CompanyExplorerFolderScope(folderID))
	requireScope(t, scopes, CompanyExplorerNodeScope(nodeID))
}

func TestCompanyExplorerAffectedScopesPreferCanonicalResourceIDForV2Rows(t *testing.T) {
	companyID := "11111111-1111-4111-8111-111111111112"
	entityID := "22222222-2222-4222-8222-222222222223"
	logicGateID := "33333333-3333-4333-8333-333333333334"

	scopes := CompanyExplorerAffectedScopes(companyID, "company_explorer_v2_edge_moved", map[string]any{
		"entity_type": CompanyExplorerV2EntityLogicGate,
		"entity_id":   entityID,
		"resource_id": logicGateID,
	})

	requireScope(t, scopes, CompanyExplorerRootScope(companyID))
	requireScope(t, scopes, CompanyExplorerLogicGateScope(logicGateID))
	rejectScope(t, scopes, CompanyExplorerLogicGateScope(entityID))
}

func requireScope(t *testing.T, scopes []string, want string) {
	t.Helper()
	if !scopeListContains(scopes, want) {
		t.Fatalf("scopes = %+v, missing %s", scopes, want)
	}
}

func rejectScope(t *testing.T, scopes []string, want string) {
	t.Helper()
	if scopeListContains(scopes, want) {
		t.Fatalf("scopes = %+v, unexpectedly contained %s", scopes, want)
	}
}

func scopeListContains(scopes []string, want string) bool {
	for _, scope := range scopes {
		if scope == want {
			return true
		}
	}
	return false
}
