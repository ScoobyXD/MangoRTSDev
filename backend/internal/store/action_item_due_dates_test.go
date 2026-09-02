package store

import (
	"encoding/json"
	"errors"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestMemoryActionItemDueDates(t *testing.T) {
	repo := NewMemoryRepo()
	user, company := createActionItemTestCompany(t, repo, "action-item-dates")
	assertActionItemDueDates(t, repo, company.CompanyID, user.UserID)
}

func TestPostgresActionItemDueDates(t *testing.T) {
	_, repo := openPostgresProcessMapIntegration(t)
	user, err := repo.UpsertAuthUser("action-item-dates", "dates@example.test", "Date owner")
	if err != nil {
		t.Fatal(err)
	}
	company, err := repo.CreateCompany("Action Item dates")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	assertActionItemDueDates(t, repo, company.CompanyID, user.UserID)
}

func assertActionItemDueDates(t *testing.T, repo Repository, companyID, userID string) {
	t.Helper()
	if _, err := repo.CreateActionItem(ActionItemInput{CompanyID: companyID, BodyText: "Missing dates", CreatedByUserID: userID}); !errors.Is(err, ErrActionItemDueDateRequired) {
		t.Fatalf("missing date on Action Item create: %v", err)
	}
	if _, err := repo.CreateEntity(EntityInput{CompanyID: companyID, EntityTypeID: ActionItemEntityTypeID, Name: "Missing dates", CreatedByUserID: userID}); !errors.Is(err, ErrActionItemDueDateRequired) {
		t.Fatalf("missing date on Entities create: %v", err)
	}
	if _, err := repo.CreateActionItem(ActionItemInput{CompanyID: companyID, BodyText: "Invalid date", CreatedByUserID: userID, AnalysisDueDate: "2026-02-30"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid calendar date: %v", err)
	}
	item, err := repo.CreateActionItem(ActionItemInput{CompanyID: companyID, BodyText: "Analysis only", CreatedByUserID: userID, AnalysisDueDate: "2026-09-02"})
	if err != nil {
		t.Fatal(err)
	}
	assertActionItemFieldValue(t, item, ActionItemAnalysisDueDateSystemKey, `"2026-09-02"`)
	var analysisID, completionID string
	for _, field := range item.EntityFields {
		switch field.SystemKey {
		case ActionItemAnalysisDueDateSystemKey:
			analysisID = field.EntityFieldID
		case ActionItemCompletionDueDateSystemKey:
			completionID = field.EntityFieldID
		}
	}
	clearAnalysis := EntityFieldInput{CompanyID: companyID, EntityID: item.EntityID, EntityFieldID: analysisID, ValueSet: true, Value: json.RawMessage(`null`)}
	if _, err := repo.UpdateEntityField(clearAnalysis); !errors.Is(err, ErrActionItemDueDateRequired) {
		t.Fatalf("clearing only due date: %v", err)
	}
	unchanged, err := repo.GetEntity(companyID, item.EntityID)
	if err != nil {
		t.Fatal(err)
	}
	assertActionItemFieldValue(t, unchanged, ActionItemAnalysisDueDateSystemKey, `"2026-09-02"`)
	if _, err := repo.UpdateEntityField(EntityFieldInput{CompanyID: companyID, EntityID: item.EntityID, EntityFieldID: completionID, ValueSet: true, Value: json.RawMessage(`"2026-09-03"`)}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpdateEntityField(clearAnalysis); err != nil {
		t.Fatalf("clearing analysis with completion present: %v", err)
	}
	if _, err := repo.UpdateEntityField(EntityFieldInput{CompanyID: companyID, EntityID: item.EntityID, EntityFieldID: completionID, ValueSet: true, Value: json.RawMessage(`null`)}); !errors.Is(err, ErrActionItemDueDateRequired) {
		t.Fatalf("clearing remaining completion: %v", err)
	}
	if _, err := repo.UpdateEntity(EntityInput{CompanyID: companyID, EntityID: item.EntityID, Name: "Still dated", NameSet: true}); err != nil {
		t.Fatal(err)
	}
	direct, err := repo.CreateEntity(EntityInput{CompanyID: companyID, EntityTypeID: ActionItemEntityTypeID, Name: "Completion only", CreatedByUserID: userID, CompletionDueDate: "2026-09-04"})
	if err != nil {
		t.Fatal(err)
	}
	assertActionItemFieldValue(t, direct, ActionItemCompletionDueDateSystemKey, `"2026-09-04"`)

	if _, err := repo.UpdateEntityField(EntityFieldInput{CompanyID: companyID, EntityID: item.EntityID, EntityFieldID: analysisID, ValueSet: true, Value: json.RawMessage(`"2026-09-02"`)}); err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	for _, fieldID := range []string{analysisID, completionID} {
		go func() {
			<-start
			_, err := repo.UpdateEntityField(EntityFieldInput{CompanyID: companyID, EntityID: item.EntityID, EntityFieldID: fieldID, ValueSet: true, Value: json.RawMessage(`null`)})
			results <- err
		}()
	}
	close(start)
	first, second := <-results, <-results
	if !((first == nil && errors.Is(second, ErrActionItemDueDateRequired)) || (second == nil && errors.Is(first, ErrActionItemDueDateRequired))) {
		t.Fatalf("concurrent clears must keep one date: %v, %v", first, second)
	}
}
