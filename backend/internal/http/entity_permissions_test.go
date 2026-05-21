package httpapi

import (
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNodePermissionsFilterListsAndDirectReads(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111111"
	repo.EnsureCompany(companyID, "Permission Co")

	allowedUser, err := repo.UpsertAuthUser("allowed-user", "allowed@example.com", "Allowed User")
	if err != nil {
		t.Fatalf("UpsertAuthUser allowed: %v", err)
	}
	deniedUser, err := repo.UpsertAuthUser("denied-user", "denied@example.com", "Denied User")
	if err != nil {
		t.Fatalf("UpsertAuthUser denied: %v", err)
	}
	if _, err := repo.AddCompanyMembership("allowed-user", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership allowed: %v", err)
	}
	if _, err := repo.AddCompanyMembership("denied-user", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership denied: %v", err)
	}

	openNode, err := repo.CreateNode(companyID, "Open node")
	if err != nil {
		t.Fatalf("CreateNode open: %v", err)
	}
	restrictedNode, err := repo.CreateNode(companyID, "Restricted node")
	if err != nil {
		t.Fatalf("CreateNode restricted: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeNode,
		EntityID:   openNode.NodeID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   deniedUser.UserID,
			AccessLevel: store.EntityPermissionView,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions open: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeNode,
		EntityID:   restrictedNode.NodeID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   allowedUser.UserID,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}

	handler := NewServerWithOptions(repo, ServerOptions{AuthValidator: testValidator(t, "kid", key)}).Routes()
	deniedToken := "Bearer " + testJWT(t, key, "kid", "denied-user", "denied@example.com")

	listReq := httptest.NewRequest(http.MethodGet, "/v1/nodes?company_id="+companyID, nil)
	listReq.Header.Set("Authorization", deniedToken)
	listRes := httptest.NewRecorder()
	handler.ServeHTTP(listRes, listReq)
	if listRes.Code != http.StatusOK {
		t.Fatalf("list status = %d, want %d body=%s", listRes.Code, http.StatusOK, strings.TrimSpace(listRes.Body.String()))
	}
	var listPayload struct {
		Nodes []domain.Node `json:"nodes"`
	}
	if err := json.Unmarshal(listRes.Body.Bytes(), &listPayload); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(listPayload.Nodes) != 1 || listPayload.Nodes[0].NodeID != openNode.NodeID {
		t.Fatalf("visible nodes = %+v, want only open node %s", listPayload.Nodes, openNode.NodeID)
	}

	directReq := httptest.NewRequest(http.MethodGet, "/v1/nodes/"+restrictedNode.NodeID+"?company_id="+companyID, nil)
	directReq.Header.Set("Authorization", deniedToken)
	directRes := httptest.NewRecorder()
	handler.ServeHTTP(directRes, directReq)
	if directRes.Code != http.StatusNotFound {
		t.Fatalf("restricted direct status = %d, want %d body=%s", directRes.Code, http.StatusNotFound, strings.TrimSpace(directRes.Body.String()))
	}

	allowedReq := httptest.NewRequest(http.MethodGet, "/v1/nodes/"+restrictedNode.NodeID+"?company_id="+companyID, nil)
	allowedReq.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", "allowed-user", "allowed@example.com"))
	allowedRes := httptest.NewRecorder()
	handler.ServeHTTP(allowedRes, allowedReq)
	if allowedRes.Code != http.StatusOK {
		t.Fatalf("allowed direct status = %d, want %d body=%s", allowedRes.Code, http.StatusOK, strings.TrimSpace(allowedRes.Body.String()))
	}
}
