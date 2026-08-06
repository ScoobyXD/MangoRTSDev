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
			AccessLevel: store.EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions open: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeNode,
		EntityID:         restrictedNode.NodeID,
		DefaultAccess:    store.EntityPermissionNoAccess,
		DefaultAccessSet: true,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   allowedUser.UserID,
			AccessLevel: store.EntityPermissionEdit,
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

func TestNodeDeleteRequiresEditAndMovesToActorRecycleBin(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111119"
	repo.EnsureCompany(companyID, "Permission Delete Co")

	editor, err := repo.UpsertAuthUser("delete-editor", "delete-editor@example.com", "Delete Editor")
	if err != nil {
		t.Fatalf("UpsertAuthUser editor: %v", err)
	}
	viewer, err := repo.UpsertAuthUser("delete-viewer", "delete-viewer@example.com", "Delete Viewer")
	if err != nil {
		t.Fatalf("UpsertAuthUser viewer: %v", err)
	}
	if _, err := repo.AddCompanyMembership("delete-editor", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership editor: %v", err)
	}
	if _, err := repo.AddCompanyMembership("delete-viewer", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership viewer: %v", err)
	}
	node, err := repo.CreateNode(companyID, "Editor deletable node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:        companyID,
		EntityType:       store.EntityTypeNode,
		EntityID:         node.NodeID,
		DefaultAccess:    store.EntityPermissionNoAccess,
		DefaultAccessSet: true,
		Permissions: []store.EntityPermissionInput{
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: editor.UserID, AccessLevel: store.EntityPermissionEdit},
			{SubjectType: store.EntityPermissionSubjectUser, SubjectID: viewer.UserID, AccessLevel: store.EntityPermissionNoAccess},
		},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}

	handler := NewServerWithOptions(repo, ServerOptions{AuthValidator: testValidator(t, "kid", key)}).Routes()
	viewerReq := httptest.NewRequest(http.MethodDelete, "/v1/nodes/"+node.NodeID+"?company_id="+companyID, nil)
	viewerReq.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", "delete-viewer", "delete-viewer@example.com"))
	viewerReq.Header.Set(confirmationDisplayNameHeader, viewer.DisplayName)
	viewerRes := httptest.NewRecorder()
	handler.ServeHTTP(viewerRes, viewerReq)
	if viewerRes.Code != http.StatusNotFound {
		t.Fatalf("no-access delete status = %d, want %d body=%s", viewerRes.Code, http.StatusNotFound, strings.TrimSpace(viewerRes.Body.String()))
	}

	editorReq := httptest.NewRequest(http.MethodDelete, "/v1/nodes/"+node.NodeID+"?company_id="+companyID, nil)
	editorReq.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", "delete-editor", "delete-editor@example.com"))
	editorReq.Header.Set(confirmationDisplayNameHeader, editor.DisplayName)
	editorRes := httptest.NewRecorder()
	handler.ServeHTTP(editorRes, editorReq)
	if editorRes.Code != http.StatusOK {
		t.Fatalf("editor delete status = %d, want %d body=%s", editorRes.Code, http.StatusOK, strings.TrimSpace(editorRes.Body.String()))
	}
	items, err := repo.ListRecycleBinItems(companyID, editor.UserID)
	if err != nil {
		t.Fatalf("ListRecycleBinItems editor: %v", err)
	}
	if len(items) != 1 || items[0].ObjectID != node.NodeID || items[0].DeletedByUserID != editor.UserID {
		t.Fatalf("editor recycle items = %+v, want deleted node in editor recycle bin", items)
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
		"company_id":      companyID,
		"permission_mode": store.PolicyModeCustomized,
		"default_access":  store.ResourceDefaultAccessNoAccess,
		"permissions": []map[string]string{{
			"subject_type": "user",
			"subject_id":   targetUser.UserID,
			"access_level": store.EntityPermissionEdit,
		}},
	})
	putReq := httptest.NewRequest(http.MethodPut, "/v1/resources/logic_gate/"+logicGate.LogicGateID+"/permissions", strings.NewReader(string(body)))
	putReq.Header.Set("Authorization", token)
	putReq.Header.Set("Content-Type", "application/json")
	putRes := httptest.NewRecorder()
	handler.ServeHTTP(putRes, putReq)
	if putRes.Code != http.StatusOK {
		t.Fatalf("PUT permissions status = %d, want %d body=%s", putRes.Code, http.StatusOK, strings.TrimSpace(putRes.Body.String()))
	}

	getReq := httptest.NewRequest(http.MethodGet, "/v1/resources/logic_gate/"+logicGate.LogicGateID+"/permissions?company_id="+companyID, nil)
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

	legacyReq := httptest.NewRequest(http.MethodGet, "/v1/logic-gates/"+logicGate.LogicGateID+"/permissions?company_id="+companyID, nil)
	legacyReq.Header.Set("Authorization", token)
	legacyRes := httptest.NewRecorder()
	handler.ServeHTTP(legacyRes, legacyReq)
	if legacyRes.Code != http.StatusNotFound {
		t.Fatalf("obsolete permissions route status = %d, want %d body=%s", legacyRes.Code, http.StatusNotFound, strings.TrimSpace(legacyRes.Body.String()))
	}
}

func TestResourceEditorCannotManagePermissionRules(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111117"
	repo.EnsureCompany(companyID, "Permission Company Manager Co")

	resourceEditor, err := repo.UpsertAuthUser("permission-resource-editor", "resource-editor@example.com", "Resource Editor")
	if err != nil {
		t.Fatalf("UpsertAuthUser resource editor: %v", err)
	}
	if _, err := repo.UpsertAuthUser("permission-company-admin", "company-admin@example.com", "Company Admin"); err != nil {
		t.Fatalf("UpsertAuthUser company admin: %v", err)
	}
	targetUser, err := repo.UpsertAuthUser("permission-rule-target", "rule-target@example.com", "Rule Target")
	if err != nil {
		t.Fatalf("UpsertAuthUser target: %v", err)
	}
	if _, err := repo.AddCompanyMembership("permission-resource-editor", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership resource editor: %v", err)
	}
	if _, err := repo.AddCompanyMembership("permission-company-admin", companyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatalf("AddCompanyMembership company admin: %v", err)
	}
	if _, err := repo.AddCompanyMembership("permission-rule-target", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership target: %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Resource editor permission gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID:  companyID,
		EntityType: store.EntityTypeLogicGate,
		EntityID:   logicGate.LogicGateID,
		Permissions: []store.EntityPermissionInput{{
			SubjectType: store.EntityPermissionSubjectUser,
			SubjectID:   resourceEditor.UserID,
			AccessLevel: store.EntityPermissionEdit,
		}},
	}); err != nil {
		t.Fatalf("SetEntityPermissions: %v", err)
	}

	handler := NewServerWithOptions(repo, ServerOptions{AuthValidator: testValidator(t, "kid", key)}).Routes()
	resourceEditorToken := "Bearer " + testJWT(t, key, "kid", "permission-resource-editor", "resource-editor@example.com")

	getReq := httptest.NewRequest(http.MethodGet, "/v1/resources/logic_gate/"+logicGate.LogicGateID+"/permissions?company_id="+companyID, nil)
	getReq.Header.Set("Authorization", resourceEditorToken)
	getRes := httptest.NewRecorder()
	handler.ServeHTTP(getRes, getReq)
	if getRes.Code != http.StatusForbidden {
		t.Fatalf("resource editor GET permissions status = %d, want %d body=%s", getRes.Code, http.StatusForbidden, strings.TrimSpace(getRes.Body.String()))
	}

	body, _ := json.Marshal(map[string]any{
		"company_id":      companyID,
		"permission_mode": store.PolicyModeCustomized,
		"default_access":  store.ResourceDefaultAccessEdit,
		"permissions": []map[string]string{{
			"subject_type": "user",
			"subject_id":   targetUser.UserID,
			"access_level": store.EntityPermissionEdit,
		}},
	})
	putReq := httptest.NewRequest(http.MethodPut, "/v1/resources/logic_gate/"+logicGate.LogicGateID+"/permissions", strings.NewReader(string(body)))
	putReq.Header.Set("Authorization", resourceEditorToken)
	putReq.Header.Set("Content-Type", "application/json")
	putRes := httptest.NewRecorder()
	handler.ServeHTTP(putRes, putReq)
	if putRes.Code != http.StatusForbidden {
		t.Fatalf("resource editor PUT permissions status = %d, want %d body=%s", putRes.Code, http.StatusForbidden, strings.TrimSpace(putRes.Body.String()))
	}

	companyAdminToken := "Bearer " + testJWT(t, key, "kid", "permission-company-admin", "company-admin@example.com")
	companyGetReq := httptest.NewRequest(http.MethodGet, "/v1/resources/logic_gate/"+logicGate.LogicGateID+"/permissions?company_id="+companyID, nil)
	companyGetReq.Header.Set("Authorization", companyAdminToken)
	companyGetRes := httptest.NewRecorder()
	handler.ServeHTTP(companyGetRes, companyGetReq)
	if companyGetRes.Code != http.StatusOK {
		t.Fatalf("company admin GET permissions status = %d, want %d body=%s", companyGetRes.Code, http.StatusOK, strings.TrimSpace(companyGetRes.Body.String()))
	}
	var companyPayload store.ResourcePermissionPolicy
	if err := json.Unmarshal(companyGetRes.Body.Bytes(), &companyPayload); err != nil {
		t.Fatalf("decode company permissions: %v", err)
	}
	if companyPayload.CompanyID != companyID || companyPayload.ResourceType != store.EntityTypeLogicGate || companyPayload.ResourceID != logicGate.LogicGateID || companyPayload.PermissionMode != store.PolicyModeCustomized {
		t.Fatalf("company admin canonical permission policy = %+v", companyPayload)
	}
}

func TestCompanyManagerCanEditUserPermissionsButNotManagerRows(t *testing.T) {
	t.Parallel()

	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-11111111111a"
	repo.EnsureCompany(companyID, "Permission Manager Co")

	if _, err := repo.UpsertAuthUser("permission-manager", "manager@example.com", "Manager User"); err != nil {
		t.Fatalf("UpsertAuthUser manager: %v", err)
	}
	peerManager, err := repo.UpsertAuthUser("permission-peer-manager", "peer-manager@example.com", "Peer Manager")
	if err != nil {
		t.Fatalf("UpsertAuthUser peer manager: %v", err)
	}
	targetUser, err := repo.UpsertAuthUser("permission-manager-target", "target@example.com", "Target User")
	if err != nil {
		t.Fatalf("UpsertAuthUser target: %v", err)
	}
	if _, err := repo.AddCompanyMembership("permission-manager", companyID, domain.RoleCompanyManager); err != nil {
		t.Fatalf("AddCompanyMembership manager: %v", err)
	}
	if _, err := repo.AddCompanyMembership("permission-peer-manager", companyID, domain.RoleCompanyManager); err != nil {
		t.Fatalf("AddCompanyMembership peer manager: %v", err)
	}
	if _, err := repo.AddCompanyMembership("permission-manager-target", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership target: %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Manager permission gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}

	handler := NewServerWithOptions(repo, ServerOptions{AuthValidator: testValidator(t, "kid", key)}).Routes()
	managerToken := "Bearer " + testJWT(t, key, "kid", "permission-manager", "manager@example.com")

	getReq := httptest.NewRequest(http.MethodGet, "/v1/resources/logic_gate/"+logicGate.LogicGateID+"/permissions?company_id="+companyID, nil)
	getReq.Header.Set("Authorization", managerToken)
	getRes := httptest.NewRecorder()
	handler.ServeHTTP(getRes, getReq)
	if getRes.Code != http.StatusOK {
		t.Fatalf("manager GET permissions status = %d, want %d body=%s", getRes.Code, http.StatusOK, strings.TrimSpace(getRes.Body.String()))
	}
	var getPayload store.ResourcePermissionPolicy
	if err := json.Unmarshal(getRes.Body.Bytes(), &getPayload); err != nil {
		t.Fatalf("decode manager permissions: %v", err)
	}
	if getPayload.ResourceID != logicGate.LogicGateID || getPayload.PermissionMode != store.PolicyModeCustomized || getPayload.EffectiveDefaultAccess != store.ResourceDefaultAccessEdit {
		t.Fatalf("manager canonical permission policy = %+v", getPayload)
	}

	body, _ := json.Marshal(map[string]any{
		"company_id":      companyID,
		"permission_mode": store.PolicyModeCustomized,
		"default_access":  store.ResourceDefaultAccessEdit,
		"permissions": []map[string]string{
			{"subject_type": "user", "subject_id": peerManager.UserID, "access_level": store.EntityPermissionNoAccess},
			{"subject_type": "user", "subject_id": targetUser.UserID, "access_level": store.EntityPermissionNoAccess},
		},
	})
	putReq := httptest.NewRequest(http.MethodPut, "/v1/resources/logic_gate/"+logicGate.LogicGateID+"/permissions", strings.NewReader(string(body)))
	putReq.Header.Set("Authorization", managerToken)
	putReq.Header.Set("Content-Type", "application/json")
	putRes := httptest.NewRecorder()
	handler.ServeHTTP(putRes, putReq)
	if putRes.Code != http.StatusForbidden || !strings.Contains(putRes.Body.String(), "company_admin_required") {
		t.Fatalf("manager PUT containing manager row status = %d body=%s, want company_admin_required", putRes.Code, strings.TrimSpace(putRes.Body.String()))
	}

	body, _ = json.Marshal(map[string]any{
		"company_id": companyID, "permission_mode": store.PolicyModeCustomized, "default_access": store.ResourceDefaultAccessEdit,
		"permissions": []map[string]string{{"subject_type": "user", "subject_id": targetUser.UserID, "access_level": store.EntityPermissionNoAccess}},
	})
	putReq = httptest.NewRequest(http.MethodPut, "/v1/resources/logic_gate/"+logicGate.LogicGateID+"/permissions", strings.NewReader(string(body)))
	putReq.Header.Set("Authorization", managerToken)
	putReq.Header.Set("Content-Type", "application/json")
	putRes = httptest.NewRecorder()
	handler.ServeHTTP(putRes, putReq)
	if putRes.Code != http.StatusOK {
		t.Fatalf("manager canonical user-only PUT status = %d, want %d body=%s", putRes.Code, http.StatusOK, strings.TrimSpace(putRes.Body.String()))
	}
	if access, err := repo.UserCanAccessEntity(companyID, store.EntityTypeLogicGate, logicGate.LogicGateID, peerManager.UserID, store.EntityPermissionEdit); err != nil || !access {
		t.Fatalf("peer manager access = %v err=%v, want true", access, err)
	}
	if access, err := repo.UserCanAccessEntity(companyID, store.EntityTypeLogicGate, logicGate.LogicGateID, targetUser.UserID, store.EntityPermissionEdit); err != nil || access {
		t.Fatalf("target user access = %v err=%v, want false", access, err)
	}
	permissions, err := repo.ListEntityPermissions(companyID, store.EntityTypeLogicGate, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("ListEntityPermissions: %v", err)
	}
	if len(permissions) != 1 || permissions[0].SubjectID != targetUser.UserID || permissions[0].AccessLevel != store.EntityPermissionNoAccess {
		t.Fatalf("permissions = %+v, want only target no_access row", permissions)
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
	getReq := httptest.NewRequest(http.MethodGet, "/v1/resources/logic_gate/"+logicGate.LogicGateID+"/permissions?company_id="+companyID, nil)
	getReq.Header.Set("Authorization", "Bearer "+testJWT(t, key, "kid", "permission-effective-admin", "admin@example.com"))
	getRes := httptest.NewRecorder()
	handler.ServeHTTP(getRes, getReq)
	if getRes.Code != http.StatusOK {
		t.Fatalf("GET permissions status = %d, want %d body=%s", getRes.Code, http.StatusOK, strings.TrimSpace(getRes.Body.String()))
	}
	var payload store.ResourcePermissionPolicy
	if err := json.Unmarshal(getRes.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode permissions: %v", err)
	}
	if payload.EffectiveDefaultAccess != store.ResourceDefaultAccessEdit || len(payload.EffectivePermissions) != 1 || payload.EffectivePermissions[0].SubjectID != targetUser.UserID || payload.EffectivePermissions[0].AccessLevel != store.EntityPermissionNoAccess {
		t.Fatalf("canonical effective permission policy = %+v, want target no_access exception", payload)
	}
	allowed, err := repo.UserCanAccessEntity(companyID, store.EntityTypeLogicGate, logicGate.LogicGateID, targetUser.UserID, store.EntityPermissionEdit)
	if err != nil {
		t.Fatalf("UserCanAccessEntity target: %v", err)
	}
	if allowed {
		t.Fatalf("target effective edit access = true, want false")
	}
}
