package httpapi

import (
	"testing"

	"miraeopus/backend/internal/store"
)

func TestWorkspaceEventPayloadWithAffectedScopesAddsCompanyExplorerTargets(t *testing.T) {
	companyID := "11111111-1111-4111-8111-444444444401"
	folderID := "22222222-2222-4222-8222-444444444402"
	nodeID := "33333333-3333-4333-8333-444444444403"
	payload := map[string]any{
		"folder_id": folderID,
		"item_type": store.EntityTypeNode,
		"item_id":   nodeID,
	}

	out := workspaceEventPayloadWithAffectedScopes(companyID, "company_explorer_folder_item_assigned", payload)

	if _, mutated := payload["affected_scopes"]; mutated {
		t.Fatalf("workspaceEventPayloadWithAffectedScopes mutated the caller payload")
	}
	scopes, ok := out["affected_scopes"].([]string)
	if !ok {
		t.Fatalf("affected_scopes = %#v, want []string", out["affected_scopes"])
	}
	if !httpScopeContains(scopes, store.CompanyExplorerRootScope(companyID)) ||
		!httpScopeContains(scopes, store.CompanyExplorerFolderScope(folderID)) ||
		!httpScopeContains(scopes, store.CompanyExplorerNodeScope(nodeID)) {
		t.Fatalf("affected scopes = %+v, want root/folder/node scopes", scopes)
	}
}

func httpScopeContains(scopes []string, want string) bool {
	for _, scope := range scopes {
		if scope == want {
			return true
		}
	}
	return false
}
