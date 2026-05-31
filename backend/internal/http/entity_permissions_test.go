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

func TestDevAdminPermissionUpdatesRoundTrip(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111115"
	adminCompanyID := "11111111-1111-4111-8111-111111111116"
	repo.EnsureCompany(companyID, "Permission Save Co")
	repo.EnsureCompany(adminCompanyID, "Admin Co")

	targetUser, err := repo.UpsertAuthUser("permission-target-user", "target@example.com", "Target User")
	if err != nil {
		t.Fatalf("UpsertAuthUser target: %v", err)
	}
	if _, err := repo.AddCompanyMembership("permission-target-user", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership target: %v", err)
	}
	if _, err := repo.UpsertAuthUser("permission-dev-admin", "dev-admin@example.com", "Dev Admin"); err != nil {
		t.Fatalf("UpsertAuthUser dev admin: %v", err)
	}
	if _, err := repo.AddCompanyMembership("permission-dev-admin", adminCompanyID, domain.RoleDevAdmin); err != nil {
		t.Fatalf("AddCompanyMembership dev admin: %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Saved permission gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}

	handler := NewServerWithOptions(repo, ServerOptions{AuthValidator: testValidator(t, "kid", key)}).Routes()
	token := "Bearer " + testJWT(t, key, "kid", "permission-dev-admin", "dev-admin@example.com")
	body, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"permissions": []map[string]string{{
			"subject_type": "user",
			"subject_id":   targetUser.UserID,
			"access_level": store.EntityPermissionEdit,
		}},
	})
	putReq := httptest.NewRequest(http.MethodPut, "/v1/logic-gates/"+logicGate.LogicGateID+"/permissions", strings.NewReader(string(body)))
	putReq.Header.Set("Authorization", token)
	putReq.Header.Set("Content-Type", "application/json")
	putRes := httptest.NewRecorder()
	handler.ServeHTTP(putRes, putReq)
	if putRes.Code != http.StatusOK {
		t.Fatalf("PUT permissions status = %d, want %d body=%s", putRes.Code, http.StatusOK, strings.TrimSpace(putRes.Body.String()))
	}

	getReq := httptest.NewRequest(http.MethodGet, "/v1/logic-gates/"+logicGate.LogicGateID+"/permissions?company_id="+companyID, nil)
	getReq.Header.Set("Authorization", token)
	getRes := httptest.NewRecorder()
	handler.ServeHTTP(getRes, getReq)
	if getRes.Code != http.StatusOK {
		t.Fatalf("GET permissions status = %d, want %d body=%s", getRes.Code, http.StatusOK, strings.TrimSpace(getRes.Body.String()))
	}
	var payload struct {
		Permissions []domain.EntityPermission `json:"permissions"`
	}
	if err := json.Unmarshal(getRes.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode permissions: %v", err)
	}
	if len(payload.Permissions) != 1 || payload.Permissions[0].SubjectID != targetUser.UserID || payload.Permissions[0].AccessLevel != store.EntityPermissionEdit {
		t.Fatalf("permissions = %+v, want saved edit grant for target", payload.Permissions)
	}
}

func TestResourceAdminCanViewButCannotEditPermissions(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111117"
	repo.EnsureCompany(companyID, "Permission Company Manager Co")

	resourceAdmin, err := repo.UpsertAuthUser("permission-resource-admin", "resource-admin@example.com", "Resource Admin")
	if err != nil {
		t.Fatalf("UpsertAuthUser resource admin: %v", err)
	}
	if _, err := repo.UpsertAuthUser("permission-company-admin", "company-admin@example.com", "Company Admin"); err != nil {
		t.Fatalf("UpsertAuthUser company admin: %v", err)
	}
	targetUser, err := repo.UpsertAuthUser("permission-view-target", "view-target@example.com", "View Target")
	if err != nil {
		t.Fatalf("UpsertAuthUser target: %v", err)
	}
	if _, err := repo.AddCompanyMembership("permission-resource-admin", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership resource admin: %v", err)
	}
	if _, err := repo.AddCompanyMembership("permission-company-admin", companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatalf("AddCompanyMembership company admin: %v", err)
	}
	if _, err := repo.AddCompanyMembership("permission-view-target", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership target: %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "View-only permission gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeLogicGate,
		EntityID:   logicGate.LogicGateID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   resourceAdmin.UserID,
			AccessLevel: store.EntityPermissionAdmin,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}

	handler := NewServerWithOptions(repo, ServerOptions{AuthValidator: testValidator(t, "kid", key)}).Routes()
	resourceAdminToken := "Bearer " + testJWT(t, key, "kid", "permission-resource-admin", "resource-admin@example.com")

	getReq := httptest.NewRequest(http.MethodGet, "/v1/logic-gates/"+logicGate.LogicGateID+"/permissions?company_id="+companyID, nil)
	getReq.Header.Set("Authorization", resourceAdminToken)
	getRes := httptest.NewRecorder()
	handler.ServeHTTP(getRes, getReq)
	if getRes.Code != http.StatusOK {
		t.Fatalf("resource admin GET permissions status = %d, want %d body=%s", getRes.Code, http.StatusOK, strings.TrimSpace(getRes.Body.String()))
	}
	var getPayload struct {
		CanEditPermissions bool `json:"can_edit_permissions"`
	}
	if err := json.Unmarshal(getRes.Body.Bytes(), &getPayload); err != nil {
		t.Fatalf("decode permissions: %v", err)
	}
	if getPayload.CanEditPermissions {
		t.Fatalf("resource admin can_edit_permissions = true, want false for non-company-admin")
	}

	body, _ := json.Marshal(map[string]any{
		"company_id": companyID,
		"permissions": []map[string]string{{
			"subject_type": "user",
			"subject_id":   targetUser.UserID,
			"access_level": store.EntityPermissionView,
		}},
	})
	putReq := httptest.NewRequest(http.MethodPut, "/v1/logic-gates/"+logicGate.LogicGateID+"/permissions", strings.NewReader(string(body)))
	putReq.Header.Set("Authorization", resourceAdminToken)
	putReq.Header.Set("Content-Type", "application/json")
	putRes := httptest.NewRecorder()
	handler.ServeHTTP(putRes, putReq)
	if putRes.Code != http.StatusForbidden {
		t.Fatalf("resource admin PUT permissions status = %d, want %d body=%s", putRes.Code, http.StatusForbidden, strings.TrimSpace(putRes.Body.String()))
	}

	companyAdminToken := "Bearer " + testJWT(t, key, "kid", "permission-company-admin", "company-admin@example.com")
	companyGetReq := httptest.NewRequest(http.MethodGet, "/v1/logic-gates/"+logicGate.LogicGateID+"/permissions?company_id="+companyID, nil)
	companyGetReq.Header.Set("Authorization", companyAdminToken)
	companyGetRes := httptest.NewRecorder()
	handler.ServeHTTP(companyGetRes, companyGetReq)
	if companyGetRes.Code != http.StatusOK {
		t.Fatalf("company admin GET permissions status = %d, want %d body=%s", companyGetRes.Code, http.StatusOK, strings.TrimSpace(companyGetRes.Body.String()))
	}
	var companyPayload struct {
		CanEditPermissions bool `json:"can_edit_permissions"`
	}
	if err := json.Unmarshal(companyGetRes.Body.Bytes(), &companyPayload); err != nil {
		t.Fatalf("decode company permissions: %v", err)
	}
	if !companyPayload.CanEditPermissions {
		t.Fatalf("company admin can_edit_permissions = false, want true")
	}
}

func TestEntityPermissionsEffectiveAccessReportsNoAccess(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111118"
	repo.EnsureCompany(companyID, "Permission Effective No Access Co")

	if _, err := repo.UpsertAuthUser("permission-effective-admin", "admin@example.com", "Admin User"); err != nil {
		t.Fatalf("UpsertAuthUser admin: %v", err)
	}
	targetUser, err := repo.UpsertAuthUser("permission-effective-target", "target@example.com", "Target User")
	if err != nil {
		t.Fatalf("UpsertAuthUser target: %v", err)
	}
	if _, err := repo.AddCompanyMembership("permission-effective-admin", companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatalf("AddCompanyMembership admin: %v", err)
	}
	if _, err := repo.AddCompanyMembership("permission-effective-target", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership target: %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Effective no access gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeLogicGate,
		EntityID:   logicGate.LogicGateID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   targetUser.UserID,
			AccessLevel: store.EntityPermissionNoAccess,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}

	handler := NewServerWithOptions(repo, ServerOptions{AuthValidator: testValidator(t, "kid", key)}).Routes()
	getReq := httptest.NewRequest(http.MethodGet, "/v1/logic-gates/"+logicGate.LogicGateID+"/permissions?company_id="+companyID, nil)
	getReq.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", "permission-effective-admin", "admin@example.com"))
	getRes := httptest.NewRecorder()
	handler.ServeHTTP(getRes, getReq)
	if getRes.Code != http.StatusOK {
		t.Fatalf("GET permissions status = %d, want %d body=%s", getRes.Code, http.StatusOK, strings.TrimSpace(getRes.Body.String()))
	}
	var payload struct {
		EffectiveAccess []struct {
			UserID      string `json:"user_id"`
			AccessLevel string `json:"access_level"`
		} `json:"effective_access"`
	}
	if err := json.Unmarshal(getRes.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode permissions: %v", err)
	}
	for _, item := range payload.EffectiveAccess {
		if item.UserID == targetUser.UserID {
			if item.AccessLevel != store.EntityPermissionNoAccess {
				t.Fatalf("target effective access = %q, want no_access", item.AccessLevel)
			}
			return
		}
	}
	t.Fatalf("effective_access missing target user: %+v", payload.EffectiveAccess)
}
