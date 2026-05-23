package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"testing"
)

type noRebuildNodeAssigneeRepo struct {
	store.Repository
	rebuildCalls int
}

func (r *noRebuildNodeAssigneeRepo) RebuildEffectiveResourceAccessForCompany(companyID string) error {
	r.rebuildCalls++
	return errors.New("unexpected full-company effective access rebuild")
}

func TestNodeAssigneeHandlersMaintainEffectiveAccessWithoutFullRebuild(t *testing.T) {
	t.Parallel()

	backing := store.NewMemoryRepo()
	companyID := "company-node-assignee-no-rebuild"
	backing.EnsureCompany(companyID, "No Rebuild Co")
	creator := mustHTTPNodeAssigneeUser(t, backing, companyID, "node-assignee-handler-creator")
	nextAssignee := mustHTTPNodeAssigneeUser(t, backing, companyID, "node-assignee-handler-next")
	repo := &noRebuildNodeAssigneeRepo{Repository: backing}
	handler := NewServer(repo).Routes()

	createBody, _ := json.Marshal(map[string]string{
		"company_id": companyID,
		"title":      "Scoped assignee node",
	})
	createReq := httptest.NewRequest(http.MethodPost, "/v1/nodes", bytes.NewReader(createBody))
	createReq.Header.Set("Content-Type", "application/json")
	createReq = requestWithCompanyUserActorForNodeAssigneeTest(createReq, creator, companyID)
	createRec := httptest.NewRecorder()
	handler.ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusCreated {
		t.Fatalf("POST node status = %d, want %d body=%s", createRec.Code, http.StatusCreated, createRec.Body.String())
	}
	var created domain.Node
	if err := json.NewDecoder(createRec.Body).Decode(&created); err != nil {
		t.Fatalf("decode created node: %v", err)
	}
	if repo.rebuildCalls != 0 {
		t.Fatalf("node create called full-company rebuild %d times, want 0", repo.rebuildCalls)
	}
	assertHTTPNodeAssigneeEffectiveAccess(t, backing, companyID, creator.UserID, created.NodeID, store.EntityPermissionEdit, true)

	assignBody, _ := json.Marshal(map[string]any{
		"company_id":       companyID,
		"assignee_user_id": nextAssignee.UserID,
	})
	assignReq := httptest.NewRequest(http.MethodPut, "/v1/nodes/"+created.NodeID, bytes.NewReader(assignBody))
	assignReq.Header.Set("Content-Type", "application/json")
	assignReq = requestWithCompanyUserActorForNodeAssigneeTest(assignReq, creator, companyID)
	assignRec := httptest.NewRecorder()
	handler.ServeHTTP(assignRec, assignReq)
	if assignRec.Code != http.StatusOK {
		t.Fatalf("PUT assignee status = %d, want %d body=%s", assignRec.Code, http.StatusOK, assignRec.Body.String())
	}
	if repo.rebuildCalls != 0 {
		t.Fatalf("node reassign called full-company rebuild %d times, want 0", repo.rebuildCalls)
	}
	assertHTTPNodeAssigneeEffectiveAccess(t, backing, companyID, creator.UserID, created.NodeID, store.EntityPermissionView, false)
	assertHTTPNodeAssigneeEffectiveAccess(t, backing, companyID, nextAssignee.UserID, created.NodeID, store.EntityPermissionEdit, true)

	clearBody, _ := json.Marshal(map[string]any{
		"company_id":       companyID,
		"assignee_user_id": nil,
	})
	clearReq := httptest.NewRequest(http.MethodPut, "/v1/nodes/"+created.NodeID, bytes.NewReader(clearBody))
	clearReq.Header.Set("Content-Type", "application/json")
	clearReq = requestWithCompanyUserActorForNodeAssigneeTest(clearReq, nextAssignee, companyID)
	clearRec := httptest.NewRecorder()
	handler.ServeHTTP(clearRec, clearReq)
	if clearRec.Code != http.StatusOK {
		t.Fatalf("PUT clear assignee status = %d, want %d body=%s", clearRec.Code, http.StatusOK, clearRec.Body.String())
	}
	if repo.rebuildCalls != 0 {
		t.Fatalf("node clear called full-company rebuild %d times, want 0", repo.rebuildCalls)
	}
	assertHTTPNodeAssigneeEffectiveAccess(t, backing, companyID, nextAssignee.UserID, created.NodeID, store.EntityPermissionView, false)
}

func TestNodeGETVisibilityUsesAssigneeDerivedEffectiveAccess(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	companyID := "company-node-assignee-get-visibility"
	repo.EnsureCompany(companyID, "Assignee Visibility Co")
	assignee := mustHTTPNodeAssigneeUser(t, repo, companyID, "node-assignee-get-visible")
	visible, err := repo.CreateNodeWithAssignee(companyID, "Visible assigned node", assignee.UserID)
	if err != nil {
		t.Fatalf("CreateNodeWithAssignee visible: %v", err)
	}
	hidden, err := repo.CreateNode(companyID, "Hidden unassigned node")
	if err != nil {
		t.Fatalf("CreateNode hidden: %v", err)
	}

	handler := NewServer(repo).Routes()
	listReq := httptest.NewRequest(http.MethodGet, "/v1/nodes?company_id="+companyID, nil)
	listReq = requestWithCompanyUserActorForNodeAssigneeTest(listReq, assignee, companyID)
	listRec := httptest.NewRecorder()
	handler.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("GET nodes status = %d, want %d body=%s", listRec.Code, http.StatusOK, listRec.Body.String())
	}
	var listPayload struct {
		Nodes []domain.Node `json:"nodes"`
	}
	if err := json.NewDecoder(listRec.Body).Decode(&listPayload); err != nil {
		t.Fatalf("decode nodes payload: %v", err)
	}
	if len(listPayload.Nodes) != 1 || listPayload.Nodes[0].NodeID != visible.NodeID {
		t.Fatalf("visible nodes = %+v, want only %s", listPayload.Nodes, visible.NodeID)
	}

	visibleReq := httptest.NewRequest(http.MethodGet, "/v1/nodes/"+visible.NodeID+"?company_id="+companyID, nil)
	visibleReq = requestWithCompanyUserActorForNodeAssigneeTest(visibleReq, assignee, companyID)
	visibleRec := httptest.NewRecorder()
	handler.ServeHTTP(visibleRec, visibleReq)
	if visibleRec.Code != http.StatusOK {
		t.Fatalf("GET assigned node status = %d, want %d body=%s", visibleRec.Code, http.StatusOK, visibleRec.Body.String())
	}

	hiddenReq := httptest.NewRequest(http.MethodGet, "/v1/nodes/"+hidden.NodeID+"?company_id="+companyID, nil)
	hiddenReq = requestWithCompanyUserActorForNodeAssigneeTest(hiddenReq, assignee, companyID)
	hiddenRec := httptest.NewRecorder()
	handler.ServeHTTP(hiddenRec, hiddenReq)
	if hiddenRec.Code != http.StatusNotFound {
		t.Fatalf("GET unassigned node status = %d, want %d body=%s", hiddenRec.Code, http.StatusNotFound, hiddenRec.Body.String())
	}
}

func mustHTTPNodeAssigneeUser(t *testing.T, repo *store.MemoryRepo, companyID, subject string) domain.User {
	t.Helper()
	user, err := repo.UpsertAuthUser(subject, subject+"@example.com", subject)
	if err != nil {
		t.Fatalf("UpsertAuthUser %s: %v", subject, err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatalf("AddCompanyMembership %s: %v", subject, err)
	}
	return user
}

func requestWithCompanyUserActorForNodeAssigneeTest(req *http.Request, user domain.User, companyID string) *http.Request {
	actor := ActorContext{
		User: user,
		Memberships: []domain.CompanyMembership{{
			CompanyID: companyID,
			UserID:    user.UserID,
			Role:      domain.RoleCompanyUser,
		}},
		CompanyID:   companyID,
		CompanyRole: domain.RoleCompanyUser,
	}
	return req.WithContext(contextWithActorForNodeAssigneeTest(req, actor))
}

func contextWithActorForNodeAssigneeTest(req *http.Request, actor ActorContext) context.Context {
	return context.WithValue(req.Context(), actorContextKey{}, actor)
}

func assertHTTPNodeAssigneeEffectiveAccess(t *testing.T, repo *store.MemoryRepo, companyID, userID, nodeID, accessLevel string, want bool) {
	t.Helper()
	got, err := repo.UserHasEffectiveAccess(companyID, userID, store.EntityTypeNode, nodeID, accessLevel)
	if err != nil {
		t.Fatalf("UserHasEffectiveAccess: %v", err)
	}
	if got != want {
		t.Fatalf("UserHasEffectiveAccess(%s, %s, %s) = %v, want %v", userID, nodeID, accessLevel, got, want)
	}
}
