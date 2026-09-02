package store

import (
	"encoding/json"
	"errors"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestMemoryActionItemDueDatesAreOptional(t *testing.T) {
	repo := NewMemoryRepo()
	user, company := createActionItemTestCompany(t, repo, "action-item-dates")
	assertActionItemDueDates(t, repo, company.CompanyID, user.UserID)
}

func TestPostgresActionItemDueDatesAreOptional(t *testing.T) {
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
	undated, err := repo.CreateActionItem(ActionItemInput{CompanyID: companyID, BodyText: "No due date", CreatedByUserID: userID})
	if err != nil {
		t.Fatalf("undated Action Item create: %v", err)
	}
	assertActionItemFieldValue(t, undated, ActionItemAnalysisDueDateSystemKey, "null")
	assertActionItemFieldValue(t, undated, ActionItemCompletionDueDateSystemKey, "null")
	if _, err := repo.UpdateEntity(EntityInput{CompanyID: companyID, EntityID: undated.EntityID, Name: "Still optional", NameSet: true}); err != nil {
		t.Fatalf("undated Action Item edit: %v", err)
	}
	for _, field := range undated.EntityFields {
		if field.SystemKey == ActionItemStatusSystemKey {
			if _, err := repo.UpdateEntityField(EntityFieldInput{CompanyID: companyID, EntityID: undated.EntityID, EntityFieldID: field.EntityFieldID, ValueSet: true, Value: json.RawMessage(`"done"`)}); err != nil {
				t.Fatalf("complete undated Action Item: %v", err)
			}
		}
	}
	if _, err := repo.CreateEntity(EntityInput{CompanyID: companyID, EntityTypeID: ActionItemEntityTypeID, Name: "No due date", CreatedByUserID: userID}); err != nil {
		t.Fatalf("undated Entities create: %v", err)
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
	if _, err := repo.UpdateEntityField(clearAnalysis); err != nil {
		t.Fatalf("clearing only due date: %v", err)
	}
	cleared, err := repo.GetEntity(companyID, item.EntityID)
	if err != nil {
		t.Fatal(err)
	}
	assertActionItemFieldValue(t, cleared, ActionItemAnalysisDueDateSystemKey, "null")
	if _, err := repo.UpdateEntityField(EntityFieldInput{CompanyID: companyID, EntityID: item.EntityID, EntityFieldID: completionID, ValueSet: true, Value: json.RawMessage(`"2026-09-03"`)}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpdateEntityField(EntityFieldInput{CompanyID: companyID, EntityID: item.EntityID, EntityFieldID: completionID, ValueSet: true, Value: json.RawMessage(`null`)}); err != nil {
		t.Fatalf("clearing remaining completion: %v", err)
	}
	if _, err := repo.UpdateEntity(EntityInput{CompanyID: companyID, EntityID: item.EntityID, Name: "Dates cleared", NameSet: true}); err != nil {
		t.Fatal(err)
	}
	direct, err := repo.CreateEntity(EntityInput{CompanyID: companyID, EntityTypeID: ActionItemEntityTypeID, Name: "Completion only", CreatedByUserID: userID, CompletionDueDate: "2026-09-04"})
	if err != nil {
		t.Fatal(err)
	}
	assertActionItemFieldValue(t, direct, ActionItemCompletionDueDateSystemKey, `"2026-09-04"`)
}
