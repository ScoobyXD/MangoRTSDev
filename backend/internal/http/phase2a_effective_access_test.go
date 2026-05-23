package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEntityPermissionHandlersSkipFullRebuildForNodeAndLogicGateDirectGrants(t *testing.T) {
	t.Parallel()

	backing := store.NewMemoryRepo()
	companyID := "company-phase2a-direct-handler"
	backing.EnsureCompany(companyID, "Phase 2A Direct Handler Co")
	manager := mustHTTPPhase2AUser(t, backing, companyID, "phase2a-direct-handler-manager", domain.RoleCompanyAdmin)
	target := mustHTTPPhase2AUser(t, backing, companyID, "phase2a-direct-handler-target", domain.RoleCompanyUser)
	node, err := backing.CreateNode(companyID, "Direct handler node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	gate, err := backing.CreateLogicGate(companyID, "Direct handler gate")
	if err != nil {
		t.Fatalf("CreateLogicGate: %v", err)
	}

	repo := &noRebuildNodeAssigneeRepo{Repository: backing}
	handler := NewServer(repo).Routes()
	for _, tc := range []struct {
		name         string
		path         string
		resourceType string
		resourceID   string
	}{
		{name: "node", path: "/v1/nodes/" + node.NodeID + "/permissions", resourceType: store.EntityTypeNode, resourceID: node.NodeID},
		{name: "logic_gate", path: "/v1/logic-gates/" + gate.LogicGateID + "/permissions", resourceType: store.EntityTypeLogicGate, resourceID: gate.LogicGateID},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body, _ := json.Marshal(map[string]any{
				"company_id": companyID,
				"permissions": []map[string]string{{
					"subject_type": "user",
					"subject_id":   target.UserID,
					"access_level": store.EntityPermissionEdit,
				}},
			})
			req := httptest.NewRequest(http.MethodPut, tc.path, bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			req = requestWithHTTPPhase2AActor(req, manager, companyID, domain.RoleCompanyAdmin)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("PUT %s permissions status = %d, want %d body=%s", tc.name, rec.Code, http.StatusOK, rec.Body.String())
			}
			if repo.rebuildCalls != 0 {
				t.Fatalf("PUT %s permissions called full rebuild %d times, want 0", tc.name, repo.rebuildCalls)
			}
			assertHTTPPhase2AEffectiveAccess(t, backing, companyID, target.UserID, tc.resourceType, tc.resourceID, store.EntityPermissionEdit, true)
		})
	}
}

func TestLogicGateCreateProjectsCreatorAccessWithoutFullRebuild(t *testing.T) {
	t.Parallel()

	backing := store.NewMemoryRepo()
	companyID := "company-phase2a-gate-create-handler"
	backing.EnsureCompany(companyID, "Phase 2A Gate Create Handler Co")
	creator := mustHTTPPhase2AUser(t, backing, companyID, "phase2a-gate-create-creator", domain.RoleCompanyUser)
	repo := &noRebuildNodeAssigneeRepo{Repository: backing}
	handler := NewServer(repo).Routes()

	body, _ := json.Marshal(map[string]string{
		"company_id": companyID,
		"header":     "Scoped creator gate",
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/logic-gates", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = requestWithHTTPPhase2AActor(req, creator, companyID, domain.RoleCompanyUser)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST logic gate status = %d, want %d body=%s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if repo.rebuildCalls != 0 {
		t.Fatalf("POST logic gate called full rebuild %d times, want 0", repo.rebuildCalls)
	}
	var created domain.LogicGate
	if err := json.NewDecoder(rec.Body).Decode(&created); err != nil {
		t.Fatalf("decode created gate: %v", err)
	}
	assertHTTPPhase2AEffectiveAccess(t, backing, companyID, creator.UserID, store.EntityTypeLogicGate, created.LogicGateID, store.EntityPermissionAdmin, true)
}

func mustHTTPPhase2AUser(t *testing.T, repo *store.MemoryRepo, companyID, subject, role string) domain.User {
	t.Helper()
	user, err := repo.UpsertAuthUser(subject, subject+"@example.com", subject)
	if err != nil {
		t.Fatalf("UpsertAuthUser %s: %v", subject, err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, role); err != nil {
		t.Fatalf("AddCompanyMembership %s: %v", subject, err)
	}
	return user
}

func requestWithHTTPPhase2AActor(req *http.Request, user domain.User, companyID, role string) *http.Request {
	actor := ActorContext{
		User: user,
		Memberships: []domain.CompanyMembership{{
			CompanyID: companyID,
			UserID:    user.UserID,
			Role:      role,
		}},
		CompanyID:   companyID,
		CompanyRole: role,
	}
	return req.WithContext(context.WithValue(req.Context(), actorContextKey{}, actor))
}

func assertHTTPPhase2AEffectiveAccess(t *testing.T, repo *store.MemoryRepo, companyID, userID, resourceType, resourceID, accessLevel string, want bool) {
	t.Helper()
	got, err := repo.UserHasEffectiveAccess(companyID, userID, resourceType, resourceID, accessLevel)
	if err != nil {
		t.Fatalf("UserHasEffectiveAccess: %v", err)
	}
	if got != want {
		t.Fatalf("UserHasEffectiveAccess(%s, %s, %s, %s) = %v, want %v", userID, resourceType, resourceID, accessLevel, got, want)
	}
}
