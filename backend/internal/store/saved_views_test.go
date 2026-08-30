package store

import (
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"os"
	"strings"
	"testing"
)

func TestSavedViewSettingsJSONPreservesExplicitEmptyMyWorkLists(t *testing.T) {
	encoded, err := json.Marshal(domain.SavedViewSettings{
		Ordering:        []domain.SavedViewGrouping{},
		DisplayedFields: []string{},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{`"ordering":[]`, `"displayed_fields":[]`} {
		if !strings.Contains(string(encoded), required) {
			t.Fatalf("saved view settings JSON = %s, want %s", encoded, required)
		}
	}
}

func TestNormalizeSavedViewGroupingsAllowsUpdatesPriorityAndStatus(t *testing.T) {
	groupings, ok := NormalizeSavedViewGroupings(SavedViewSurfaceUpdates, []domain.SavedViewGrouping{
		{Field: "project", Direction: "asc"},
		{Field: "priority", Direction: "desc"},
		{Field: "status", Direction: "asc"},
	})
	if !ok {
		t.Fatal("expected Updates priority and status grouping to be accepted")
	}
	if len(groupings) != 3 || groupings[1].Field != "priority" || groupings[1].Direction != "desc" || groupings[2].Field != "status" {
		t.Fatalf("normalized groupings = %+v, want project, priority, then status", groupings)
	}
}

func TestMyWorkSavedViewSchemaContract(t *testing.T) {
	canonical, err := os.ReadFile("../../db/schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile("../../db/migrations/20260830_my_work_action_item_preferences.sql")
	if err != nil {
		t.Fatal(err)
	}
	for name, source := range map[string]string{"canonical schema": string(canonical), "migration": string(migration)} {
		for _, required := range []string{SavedViewSurfaceMyWorkActionItemsMine, SavedViewSurfaceMyWorkActionItemsDelegated, "idx_saved_views_my_work_action_items_user_single"} {
			if !strings.Contains(source, required) {
				t.Fatalf("%s missing %q", name, required)
			}
		}
	}
}

func TestMyWorkSavedViewDefaultsValidationAndPerPerspectiveSingleton(t *testing.T) {
	groupings, ok := NormalizeSavedViewGroupings(SavedViewSurfaceMyWorkActionItemsMine, nil)
	if !ok || len(groupings) != 3 || groupings[0].Field != MyWorkActionItemGroupingColor || groupings[1].Field != MyWorkActionItemGroupingHuddleProcess || groupings[2].Field != MyWorkActionItemGroupingCompletionDueDate {
		t.Fatalf("Mine default groupings = %+v ok=%v", groupings, ok)
	}
	delegatedSettings, ok := NormalizeSavedViewSettings(SavedViewSurfaceMyWorkActionItemsDelegated, domain.SavedViewSettings{})
	if !ok || len(delegatedSettings.Ordering) != 1 || delegatedSettings.Ordering[0].Field != MyWorkActionItemGroupingPersonInCharge || len(delegatedSettings.DisplayedFields) != 2 || delegatedSettings.DisplayedFields[0] != "person_in_charge" || delegatedSettings.DisplayedFields[1] != "completion_due_date" {
		t.Fatalf("Delegated default settings = %+v ok=%v", delegatedSettings, ok)
	}
	if _, ok := NormalizeSavedViewSettings(SavedViewSurfaceMyWorkActionItemsMine, domain.SavedViewSettings{DisplayedFields: []string{"details"}}); ok {
		t.Fatal("Details must not be accepted as an inline field")
	}
	if _, ok := NormalizeSavedViewSettings(SavedViewSurfaceMyWorkActionItemsMine, domain.SavedViewSettings{DisplayedFields: []string{"status", "status"}}); ok {
		t.Fatal("duplicate inline fields must be rejected")
	}

	repo := NewMemoryRepo()
	companyID := "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	repo.EnsureCompany(companyID, "Saved View Company")
	user, err := repo.UpsertAuthUser("my-work-saved-view-user", "saved@example.test", "Saved User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("my-work-saved-view-user", companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	mineInput := SavedViewInput{
		CompanyID: companyID, Surface: SavedViewSurfaceMyWorkActionItemsMine, Principal: SavedViewPrincipalUser, PrincipalID: user.UserID, Name: "My Work Mine",
		Groupings: []domain.SavedViewGrouping{{Field: MyWorkActionItemGroupingColor, Direction: "asc"}},
		Settings: domain.SavedViewSettings{
			Ordering:        []domain.SavedViewGrouping{{Field: MyWorkActionItemGroupingCompletionDueDate, Direction: "desc"}},
			DisplayedFields: []string{"status", "assigned_by"},
		},
	}
	first, err := repo.UpsertSavedView(mineInput)
	if err != nil {
		t.Fatal(err)
	}
	mineInput.SavedViewID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	mineInput.Settings.DisplayedFields = []string{}
	second, err := repo.UpsertSavedView(mineInput)
	if err != nil {
		t.Fatal(err)
	}
	if second.SavedViewID != first.SavedViewID || len(second.Settings.DisplayedFields) != 0 {
		t.Fatalf("Mine singleton update = %+v, first=%+v", second, first)
	}
	mineViews, err := repo.ListSavedViews(SavedViewListInput{CompanyID: companyID, ViewerUserID: user.UserID, Surface: SavedViewSurfaceMyWorkActionItemsMine})
	if err != nil || len(mineViews) != 1 {
		t.Fatalf("Mine saved views = %+v err=%v", mineViews, err)
	}

	delegated, err := repo.UpsertSavedView(SavedViewInput{
		CompanyID: companyID, Surface: SavedViewSurfaceMyWorkActionItemsDelegated, Principal: SavedViewPrincipalUser, PrincipalID: user.UserID, Name: "My Work Delegated",
	})
	if err != nil {
		t.Fatal(err)
	}
	if delegated.SavedViewID == first.SavedViewID || len(delegated.Settings.Ordering) != 1 || delegated.Settings.Ordering[0].Field != MyWorkActionItemGroupingPersonInCharge {
		t.Fatalf("Delegated independent defaults = %+v", delegated)
	}

	overlap := mineInput
	overlap.SavedViewID = ""
	overlap.Groupings = []domain.SavedViewGrouping{{Field: MyWorkActionItemGroupingColor, Direction: "asc"}}
	overlap.Settings.Ordering = []domain.SavedViewGrouping{{Field: MyWorkActionItemGroupingColor, Direction: "desc"}}
	if _, err := repo.UpsertSavedView(overlap); err != ErrInvalid {
		t.Fatalf("overlapping saved grouping/ordering error = %v, want ErrInvalid", err)
	}
}
