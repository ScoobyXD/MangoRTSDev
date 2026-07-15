package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestProjectionRevisionConflictResponseReturnsCanonicalCurrentRecord(t *testing.T) {
	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	companyID := "revision-http-company"
	node, err := repo.CreateNode(companyID, "revision response node")
	if err != nil {
		t.Fatal(err)
	}
	informationID := "44444444-4444-4444-8444-444444444444"
	handler := handlerWithCompanyAdminForTest(server.Routes(), companyID)

	post := func(text string, expected int64) *httptest.ResponseRecorder {
		body, marshalErr := json.Marshal(map[string]any{"company_id": companyID, "type": "Text box", "information": text, "information_id": informationID, "expected_revision": expected})
		if marshalErr != nil {
			t.Fatal(marshalErr)
		}
		req := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+node.NodeID+"/projection", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}
	if rec := post("first", 0); rec.Code != http.StatusOK {
		t.Fatalf("create status=%d body=%s", rec.Code, rec.Body.String())
	}
	if rec := post("second", 1); rec.Code != http.StatusOK {
		t.Fatalf("update status=%d body=%s", rec.Code, rec.Body.String())
	}
	stale := post("stale overwrite", 1)
	if stale.Code != http.StatusConflict {
		t.Fatalf("stale status=%d want 409 body=%s", stale.Code, stale.Body.String())
	}
	var payload struct {
		Error   string                 `json:"error"`
		Current *domain.NodeProjection `json:"current"`
	}
	if err := json.NewDecoder(stale.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Error != "projection_revision_conflict" || payload.Current == nil {
		t.Fatalf("conflict payload=%+v", payload)
	}
	if payload.Current.Information != "second" || payload.Current.Revision != 2 || payload.Current.InformationID != informationID {
		t.Fatalf("canonical current=%+v, want second/revision 2/%s", payload.Current, informationID)
	}
	staleDeleteReq := httptest.NewRequest(http.MethodDelete, "/v1/nodes/"+node.NodeID+"/projection/"+informationID+"?company_id="+companyID+"&expected_revision=1", nil)
	staleDelete := httptest.NewRecorder()
	handler.ServeHTTP(staleDelete, staleDeleteReq)
	if staleDelete.Code != http.StatusConflict {
		t.Fatalf("stale delete status=%d want 409 body=%s", staleDelete.Code, staleDelete.Body.String())
	}
	var staleDeletePayload struct {
		Current *domain.NodeProjection `json:"current"`
	}
	if err := json.NewDecoder(staleDelete.Body).Decode(&staleDeletePayload); err != nil {
		t.Fatal(err)
	}
	if staleDeletePayload.Current == nil || staleDeletePayload.Current.Information != "second" || staleDeletePayload.Current.Revision != 2 {
		t.Fatalf("stale delete current=%+v, want second/revision 2", staleDeletePayload.Current)
	}

	deleteReq := httptest.NewRequest(http.MethodDelete, "/v1/nodes/"+node.NodeID+"/projection/"+informationID+"?company_id="+companyID+"&expected_revision=2", nil)
	deleteRec := httptest.NewRecorder()
	handler.ServeHTTP(deleteRec, deleteReq)
	if deleteRec.Code != http.StatusOK {
		t.Fatalf("current delete status=%d body=%s", deleteRec.Code, deleteRec.Body.String())
	}
	deletedConflict := post("stale after delete", 2)
	var deletedPayload struct {
		Current *domain.NodeProjection `json:"current"`
	}
	if deletedConflict.Code != http.StatusConflict {
		t.Fatalf("post-delete stale status=%d body=%s", deletedConflict.Code, deletedConflict.Body.String())
	}
	if err := json.NewDecoder(deletedConflict.Body).Decode(&deletedPayload); err != nil {
		t.Fatal(err)
	}
	if deletedPayload.Current == nil || !deletedPayload.Current.IsDeleted || deletedPayload.Current.Revision != 3 {
		t.Fatalf("post-delete canonical current=%+v, want deleted revision 3", deletedPayload.Current)
	}
}

func TestProjectionRevisionConflictIsNotDisclosedBeforeEditAuthorization(t *testing.T) {
	repo := store.NewMemoryRepo()
	companyID := "revision-auth-company"
	const subject = "revision-viewer-subject"
	user, err := repo.UpsertAuthUser(subject, "viewer@example.com", "Viewer")
	if err != nil {
		t.Fatal(err)
	}
	repo.EnsureCompany(companyID, "Revision auth company")
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(companyID, "private revision node")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetEntityPermissions(store.EntityPermissionUpdateInput{
		CompanyID: companyID, EntityType: store.EntityTypeNode, EntityID: node.NodeID,
		Permissions: []store.EntityPermissionInput{{SubjectType: store.EntityPermissionSubjectUser, SubjectID: user.UserID, AccessLevel: store.EntityPermissionView}},
	}); err != nil {
		t.Fatal(err)
	}
	informationID := "55555555-5555-4555-8555-555555555555"
	zero := int64(0)
	one := int64(1)
	if _, err := repo.UpsertNodeProjectionWithActor(store.NodeInformationInput{CompanyID: companyID, NodeID: node.NodeID, Type: "Text box", Information: "secret first", InformationID: informationID, ExpectedRevision: &zero}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertNodeProjectionWithActor(store.NodeInformationInput{CompanyID: companyID, NodeID: node.NodeID, Type: "Text box", Information: "secret current", InformationID: informationID, ExpectedRevision: &one}); err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]any{"company_id": companyID, "type": "Text box", "information": "stale attempt", "information_id": informationID, "expected_revision": 1})
	req := httptest.NewRequest(http.MethodPost, "/v1/nodes/"+node.NodeID+"/projection", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	actor := ActorContext{
		User:        user,
		Memberships: []domain.CompanyMembership{{CompanyID: companyID, UserID: user.UserID, Role: domain.RoleCompanyUser}},
		CompanyID:   companyID,
		CompanyRole: domain.RoleCompanyUser,
	}
	req = req.WithContext(context.WithValue(req.Context(), actorContextKey{}, actor))
	rec := httptest.NewRecorder()
	NewServer(repo).Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden && rec.Code != http.StatusNotFound {
		t.Fatalf("unauthorized status=%d body=%s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "secret current") || strings.Contains(rec.Body.String(), "\"current\"") {
		t.Fatalf("authorization failure disclosed canonical projection: %s", rec.Body.String())
	}
}
