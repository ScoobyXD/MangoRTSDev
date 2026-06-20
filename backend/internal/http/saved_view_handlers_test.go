package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestSavedViewsPersonalLifecycle(t *testing.T) {
	repo := store.NewMemoryRepo()
	handler := NewServer(repo).Routes()
	companyID := "11111111-1111-4111-8111-111111111111"
	user := mustCreateSavedViewUser(t, repo, "saved-view-user", companyID, "saved-view@example.com", domain.RoleCompanyUser)

	createBody := `{
		"company_id":"` + companyID + `",
		"surface":"my_work",
		"principal":"user",
		"principal_id":"` + user.UserID + `",
		"name":"Project by Person",
		"groupings":[{"field":"project","direction":"asc"},{"field":"person","direction":"desc"}]
	}`
	createRec := httptest.NewRecorder()
	createReq := httptest.NewRequest(http.MethodPost, "/v1/saved-views", bytes.NewBufferString(createBody))
	handler.ServeHTTP(createRec, savedViewRequestWithActor(createReq, user, companyID, domain.RoleCompanyUser))
	if createRec.Code != http.StatusCreated {
		t.Fatalf("create status = %d body=%s", createRec.Code, createRec.Body.String())
	}
	var created domain.SavedView
	if err := json.NewDecoder(createRec.Body).Decode(&created); err != nil {
		t.Fatalf("decode created: %v", err)
	}
	if created.SavedViewID == "" || created.Surface != store.SavedViewSurfaceMyWork || created.Principal != store.SavedViewPrincipalUser {
		t.Fatalf("created saved view = %+v", created)
	}

	listRec := httptest.NewRecorder()
	listReq := httptest.NewRequest(http.MethodGet, "/v1/saved-views?company_id="+companyID+"&surface=my_work", nil)
	handler.ServeHTTP(listRec, savedViewRequestWithActor(listReq, user, companyID, domain.RoleCompanyUser))
	if listRec.Code != http.StatusOK {
		t.Fatalf("list status = %d body=%s", listRec.Code, listRec.Body.String())
	}
	var listPayload struct {
		SavedViews []domain.SavedView `json:"saved_views"`
	}
	if err := json.NewDecoder(listRec.Body).Decode(&listPayload); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(listPayload.SavedViews) != 1 || listPayload.SavedViews[0].SavedViewID != created.SavedViewID {
		t.Fatalf("list saved views = %+v", listPayload.SavedViews)
	}

	updateBody := `{
		"company_id":"` + companyID + `",
		"surface":"my_work",
		"principal":"user",
		"principal_id":"` + user.UserID + `",
		"name":"Status",
		"groupings":[{"field":"status","direction":"asc"}]
	}`
	updateRec := httptest.NewRecorder()
	updateReq := httptest.NewRequest(http.MethodPut, "/v1/saved-views/"+created.SavedViewID, bytes.NewBufferString(updateBody))
	handler.ServeHTTP(updateRec, savedViewRequestWithActor(updateReq, user, companyID, domain.RoleCompanyUser))
	if updateRec.Code != http.StatusOK {
		t.Fatalf("update status = %d body=%s", updateRec.Code, updateRec.Body.String())
	}
	var updated domain.SavedView
	if err := json.NewDecoder(updateRec.Body).Decode(&updated); err != nil {
		t.Fatalf("decode updated: %v", err)
	}
	if updated.Name != "Status" || len(updated.Groupings) != 1 || updated.Groupings[0].Field != "status" {
		t.Fatalf("updated saved view = %+v", updated)
	}

	deleteRec := httptest.NewRecorder()
	deleteReq := httptest.NewRequest(http.MethodDelete, "/v1/saved-views/"+created.SavedViewID+"?company_id="+companyID, nil)
	handler.ServeHTTP(deleteRec, savedViewRequestWithActor(deleteReq, user, companyID, domain.RoleCompanyUser))
	if deleteRec.Code != http.StatusOK {
		t.Fatalf("delete status = %d body=%s", deleteRec.Code, deleteRec.Body.String())
	}
}

func TestSavedViewsGroupVisibility(t *testing.T) {
	repo := store.NewMemoryRepo()
	handler := NewServer(repo).Routes()
	companyID := "22222222-2222-4222-8222-222222222222"
	member := mustCreateSavedViewUser(t, repo, "saved-view-member", companyID, "member@example.com", domain.RoleCompanyUser)
	other := mustCreateSavedViewUser(t, repo, "saved-view-other", companyID, "other@example.com", domain.RoleCompanyUser)
	group, err := repo.CreateCompanyUserGroup(companyID, "", "Operations")
	if err != nil {
		t.Fatalf("CreateCompanyUserGroup: %v", err)
	}
	if _, err := repo.SetCompanyUserGroupMembers(companyID, group.GroupID, []string{member.UserID}); err != nil {
		t.Fatalf("SetCompanyUserGroupMembers: %v", err)
	}

	body := `{
		"company_id":"` + companyID + `",
		"surface":"updates",
		"principal":"group",
		"principal_id":"` + group.GroupID + `",
		"name":"Updates by Type",
		"groupings":[{"field":"type","direction":"asc"}]
	}`
	createRec := httptest.NewRecorder()
	createReq := httptest.NewRequest(http.MethodPost, "/v1/saved-views", bytes.NewBufferString(body))
	handler.ServeHTTP(createRec, savedViewRequestWithActor(createReq, member, companyID, domain.RoleCompanyUser))
	if createRec.Code != http.StatusCreated {
		t.Fatalf("create status = %d body=%s", createRec.Code, createRec.Body.String())
	}

	memberListRec := httptest.NewRecorder()
	memberListReq := httptest.NewRequest(http.MethodGet, "/v1/saved-views?company_id="+companyID+"&surface=updates", nil)
	handler.ServeHTTP(memberListRec, savedViewRequestWithActor(memberListReq, member, companyID, domain.RoleCompanyUser))
	if memberListRec.Code != http.StatusOK {
		t.Fatalf("member list status = %d body=%s", memberListRec.Code, memberListRec.Body.String())
	}
	var memberList struct {
		SavedViews []domain.SavedView `json:"saved_views"`
	}
	if err := json.NewDecoder(memberListRec.Body).Decode(&memberList); err != nil {
		t.Fatalf("decode member list: %v", err)
	}
	if len(memberList.SavedViews) != 1 {
		t.Fatalf("member saved views = %+v", memberList.SavedViews)
	}

	otherListRec := httptest.NewRecorder()
	otherListReq := httptest.NewRequest(http.MethodGet, "/v1/saved-views?company_id="+companyID+"&surface=updates", nil)
	handler.ServeHTTP(otherListRec, savedViewRequestWithActor(otherListReq, other, companyID, domain.RoleCompanyUser))
	if otherListRec.Code != http.StatusOK {
		t.Fatalf("other list status = %d body=%s", otherListRec.Code, otherListRec.Body.String())
	}
	var otherList struct {
		SavedViews []domain.SavedView `json:"saved_views"`
	}
	if err := json.NewDecoder(otherListRec.Body).Decode(&otherList); err != nil {
		t.Fatalf("decode other list: %v", err)
	}
	if len(otherList.SavedViews) != 0 {
		t.Fatalf("other saved views = %+v, want none", otherList.SavedViews)
	}
}

func TestSavedViewsRejectInvalidPrincipalAndGrouping(t *testing.T) {
	repo := store.NewMemoryRepo()
	handler := NewServer(repo).Routes()
	companyID := "33333333-3333-4333-8333-333333333333"
	user := mustCreateSavedViewUser(t, repo, "saved-view-invalid", companyID, "invalid@example.com", domain.RoleCompanyUser)

	companyPrincipalBody := `{
		"company_id":"` + companyID + `",
		"surface":"my_work",
		"principal":"company",
		"principal_id":"` + companyID + `",
		"name":"Company",
		"groupings":[{"field":"project","direction":"asc"}]
	}`
	companyPrincipalRec := httptest.NewRecorder()
	companyPrincipalReq := httptest.NewRequest(http.MethodPost, "/v1/saved-views", bytes.NewBufferString(companyPrincipalBody))
	handler.ServeHTTP(companyPrincipalRec, savedViewRequestWithActor(companyPrincipalReq, user, companyID, domain.RoleCompanyUser))
	if companyPrincipalRec.Code != http.StatusBadRequest {
		t.Fatalf("company principal status = %d body=%s", companyPrincipalRec.Code, companyPrincipalRec.Body.String())
	}

	invalidGroupingBody := `{
		"company_id":"` + companyID + `",
		"surface":"updates",
		"principal":"user",
		"principal_id":"` + user.UserID + `",
		"name":"Bad Updates",
		"groupings":[{"field":"project","direction":"asc"}]
	}`
	invalidGroupingRec := httptest.NewRecorder()
	invalidGroupingReq := httptest.NewRequest(http.MethodPost, "/v1/saved-views", bytes.NewBufferString(invalidGroupingBody))
	handler.ServeHTTP(invalidGroupingRec, savedViewRequestWithActor(invalidGroupingReq, user, companyID, domain.RoleCompanyUser))
	if invalidGroupingRec.Code != http.StatusBadRequest {
		t.Fatalf("invalid grouping status = %d body=%s", invalidGroupingRec.Code, invalidGroupingRec.Body.String())
	}
}

func mustCreateSavedViewUser(t *testing.T, repo *store.MemoryRepo, subject, companyID, email, role string) domain.User {
	t.Helper()
	repo.EnsureCompany(companyID, "Saved Views Company")
	user, err := repo.UpsertAuthUser(subject, email, subject)
	if err != nil {
		t.Fatalf("UpsertAuthUser %s: %v", subject, err)
	}
	if _, err := repo.AddCompanyMembership(subject, companyID, role); err != nil {
		t.Fatalf("AddCompanyMembership %s: %v", subject, err)
	}
	return user
}

func savedViewRequestWithActor(req *http.Request, user domain.User, companyID, role string) *http.Request {
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
