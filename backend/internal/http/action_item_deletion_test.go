package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestActionItemDeleteUsesExistingCompanyAuthorization(t *testing.T) {
	repo := store.NewMemoryRepo()
	actor, err := repo.UpsertAuthUser("delete-action-item-member", "delete-action-item-member@example.test", "Member")
	if err != nil {
		t.Fatal(err)
	}
	outsider, err := repo.UpsertAuthUser("delete-action-item-outsider", "delete-action-item-outsider@example.test", "Outsider")
	if err != nil {
		t.Fatal(err)
	}
	company, err := repo.CreateCompany("Action Item deletion")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(actor.CognitoSubject, company.CompanyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	item, err := repo.CreateActionItem(store.ActionItemInput{
		CompanyID: company.CompanyID, CreatedByUserID: actor.UserID, BodyText: "Delete from shared editor", CompletionDueDate: "2026-09-04",
	})
	if err != nil {
		t.Fatal(err)
	}
	handler := NewServer(repo).Routes()
	path := "/v1/entities/" + item.EntityID + "?company_id=" + company.CompanyID
	deniedRequest := httptest.NewRequest(http.MethodDelete, path, nil)
	denied := httptest.NewRecorder()
	handler.ServeHTTP(denied, deniedRequest.WithContext(context.WithValue(deniedRequest.Context(), actorContextKey{}, ActorContext{User: outsider})))
	if denied.Code != http.StatusForbidden {
		t.Fatalf("outsider delete status=%d body=%s", denied.Code, denied.Body.String())
	}
	if _, err := repo.GetEntity(company.CompanyID, item.EntityID); err != nil {
		t.Fatalf("denied delete changed the Action Item: %v", err)
	}
	allowedRequest := httptest.NewRequest(http.MethodDelete, path, nil)
	allowed := httptest.NewRecorder()
	memberContext := ActorContext{
		User: actor, CompanyID: company.CompanyID, CompanyRole: domain.RoleCompanyUser,
		Memberships: []domain.CompanyMembership{{CompanyID: company.CompanyID, UserID: actor.UserID, Role: domain.RoleCompanyUser}},
	}
	handler.ServeHTTP(allowed, allowedRequest.WithContext(context.WithValue(allowedRequest.Context(), actorContextKey{}, memberContext)))
	if allowed.Code != http.StatusOK {
		t.Fatalf("member delete status=%d body=%s", allowed.Code, allowed.Body.String())
	}
	if _, err := repo.GetEntity(company.CompanyID, item.EntityID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("deleted Action Item lookup error=%v", err)
	}
}
