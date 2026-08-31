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
	for _, required := range []string{SavedViewSurfaceMyWorkActionItemsMine, SavedViewSurfaceMyWorkActionItemsDelegated, "idx_saved_views_my_work_action_items_user_single"} {
		if !strings.Contains(string(migration), required) {
			t.Fatalf("historical My Work migration missing %q", required)
		}
	}
	for _, required := range []string{SavedViewSurfaceMyWorkActionItemsMine, SavedViewSurfaceMyWorkActionItemsDelegated, "idx_saved_views_action_items_user_single"} {
		if !strings.Contains(string(canonical), required) {
			t.Fatalf("canonical schema missing %q", required)
		}
	}
}

func TestHuddleActionItemSavedViewSchemaContract(t *testing.T) {
	canonical, err := os.ReadFile("../../db/schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile("../../db/migrations/20260830_z_huddle_action_item_preferences.sql")
	if err != nil {
		t.Fatal(err)
	}
	for name, source := range map[string]string{"canonical schema": string(canonical), "migration": string(migration)} {
		for _, required := range []string{
			SavedViewSurfaceHuddleLogicGateActionItems,
			SavedViewSurfaceHuddleNodeActionItems,
			"idx_saved_views_action_items_user_single",
		} {
			if !strings.Contains(source, required) {
				t.Fatalf("%s missing %q", name, required)
			}
		}
	}
}

func TestMyWorkSavedViewDefaultsValidationAndPerPerspectiveSingleton(t *testing.T) {
	mineGroupings, ok := NormalizeSavedViewGroupings(SavedViewSurfaceMyWorkActionItemsMine, nil)
	if !ok || len(mineGroupings) != 2 || mineGroupings[0].Field != MyWorkActionItemGroupingColor || mineGroupings[1].Field != MyWorkActionItemGroupingHuddleProcess {
		t.Fatalf("Mine default groupings = %+v ok=%v", mineGroupings, ok)
	}
	mineSettings, ok := NormalizeSavedViewSettings(SavedViewSurfaceMyWorkActionItemsMine, domain.SavedViewSettings{})
	if !ok || len(mineSettings.Ordering) != 1 || mineSettings.Ordering[0].Field != MyWorkActionItemGroupingCompletionDueDate || len(mineSettings.DisplayedFields) != 1 || mineSettings.DisplayedFields[0] != "completion_due_date" {
		t.Fatalf("Mine default settings = %+v ok=%v", mineSettings, ok)
	}
	delegatedGroupings, ok := NormalizeSavedViewGroupings(SavedViewSurfaceMyWorkActionItemsDelegated, nil)
	if !ok || len(delegatedGroupings) != 3 || delegatedGroupings[0].Field != MyWorkActionItemGroupingColor || delegatedGroupings[1].Field != MyWorkActionItemGroupingPersonInCharge || delegatedGroupings[2].Field != MyWorkActionItemGroupingHuddleProcess {
		t.Fatalf("Delegated default groupings = %+v ok=%v", delegatedGroupings, ok)
	}
	delegatedSettings, ok := NormalizeSavedViewSettings(SavedViewSurfaceMyWorkActionItemsDelegated, domain.SavedViewSettings{})
	if !ok || len(delegatedSettings.Ordering) != 1 || delegatedSettings.Ordering[0].Field != MyWorkActionItemGroupingCompletionDueDate || len(delegatedSettings.DisplayedFields) != 2 || delegatedSettings.DisplayedFields[0] != "person_in_charge" || delegatedSettings.DisplayedFields[1] != "completion_due_date" {
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
	if delegated.SavedViewID == first.SavedViewID || len(delegated.Settings.Ordering) != 1 || delegated.Settings.Ordering[0].Field != MyWorkActionItemGroupingCompletionDueDate {
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

func TestHuddleActionItemSavedViewDefaultsValidationAndIndependentSingletons(t *testing.T) {
	for _, surface := range []string{SavedViewSurfaceHuddleLogicGateActionItems, SavedViewSurfaceHuddleNodeActionItems} {
		groupings, ok := NormalizeSavedViewGroupings(surface, nil)
		if !ok || len(groupings) != 2 || groupings[0] != (domain.SavedViewGrouping{Field: MyWorkActionItemGroupingColor, Direction: "asc"}) || groupings[1] != (domain.SavedViewGrouping{Field: MyWorkActionItemGroupingPersonInCharge, Direction: "asc"}) {
			t.Fatalf("%s default groupings = %+v ok=%v", surface, groupings, ok)
		}
		settings, ok := NormalizeSavedViewSettings(surface, domain.SavedViewSettings{})
		if !ok || len(settings.Ordering) != 1 || settings.Ordering[0] != (domain.SavedViewGrouping{Field: MyWorkActionItemGroupingCompletionDueDate, Direction: "asc"}) || !equalStrings(settings.DisplayedFields, []string{"person_in_charge", "completion_due_date"}) {
			t.Fatalf("%s default settings = %+v ok=%v", surface, settings, ok)
		}
		if _, ok := NormalizeSavedViewGroupings(surface, []domain.SavedViewGrouping{{Field: MyWorkActionItemGroupingHuddleProcess, Direction: "asc"}}); ok {
			t.Fatalf("%s accepted redundant Huddle Process arrangement", surface)
		}
		for _, field := range []string{MyWorkActionItemGroupingColor, MyWorkActionItemGroupingPersonInCharge, MyWorkActionItemGroupingCompletionDueDate} {
			if _, ok := NormalizeSavedViewGroupings(surface, []domain.SavedViewGrouping{{Field: field, Direction: "desc"}}); !ok {
				t.Fatalf("%s rejected arrangement field %q", surface, field)
			}
		}
		if _, ok := NormalizeSavedViewSettings(surface, domain.SavedViewSettings{DisplayedFields: []string{"huddle_process"}}); ok {
			t.Fatalf("%s accepted redundant Huddle Process inline field", surface)
		}
		for _, field := range []string{"person_in_charge", "assigned_by", "created_timestamp", "source", "color", "analysis_due_date", "completion_due_date", "status"} {
			if _, ok := NormalizeSavedViewSettings(surface, domain.SavedViewSettings{Ordering: []domain.SavedViewGrouping{}, DisplayedFields: []string{field}}); !ok {
				t.Fatalf("%s rejected inline field %q", surface, field)
			}
		}
	}

	repo := NewMemoryRepo()
	companyID := "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
	repo.EnsureCompany(companyID, "Huddle Saved View Company")
	user, err := repo.UpsertAuthUser("huddle-saved-view-user", "huddle-saved@example.test", "Huddle Saved User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	processInput := SavedViewInput{
		CompanyID: companyID, Surface: SavedViewSurfaceHuddleLogicGateActionItems, Principal: SavedViewPrincipalUser, PrincipalID: user.UserID, Name: "Huddle Process Action Items",
		Groupings: []domain.SavedViewGrouping{{Field: MyWorkActionItemGroupingColor, Direction: "desc"}},
		Settings: domain.SavedViewSettings{
			Ordering:        []domain.SavedViewGrouping{{Field: MyWorkActionItemGroupingCompletionDueDate, Direction: "desc"}},
			DisplayedFields: []string{"source", "status"},
		},
	}
	firstProcess, err := repo.UpsertSavedView(processInput)
	if err != nil {
		t.Fatal(err)
	}
	processInput.SavedViewID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
	processInput.Settings.DisplayedFields = []string{}
	secondProcess, err := repo.UpsertSavedView(processInput)
	if err != nil {
		t.Fatal(err)
	}
	if secondProcess.SavedViewID != firstProcess.SavedViewID || len(secondProcess.Settings.DisplayedFields) != 0 {
		t.Fatalf("Huddle Process singleton update = %+v, first=%+v", secondProcess, firstProcess)
	}

	node, err := repo.UpsertSavedView(SavedViewInput{
		CompanyID: companyID, Surface: SavedViewSurfaceHuddleNodeActionItems, Principal: SavedViewPrincipalUser, PrincipalID: user.UserID, Name: "Huddle Node Action Items",
	})
	if err != nil {
		t.Fatal(err)
	}
	if node.SavedViewID == firstProcess.SavedViewID || !equalStrings(node.Settings.DisplayedFields, []string{"person_in_charge", "completion_due_date"}) {
		t.Fatalf("Huddle Node independent singleton defaults = %+v", node)
	}
	for _, surface := range []string{SavedViewSurfaceHuddleLogicGateActionItems, SavedViewSurfaceHuddleNodeActionItems} {
		items, err := repo.ListSavedViews(SavedViewListInput{CompanyID: companyID, ViewerUserID: user.UserID, Surface: surface})
		if err != nil || len(items) != 1 {
			t.Fatalf("%s saved views = %+v err=%v", surface, items, err)
		}
	}
	if _, err := repo.UpsertSavedView(SavedViewInput{
		CompanyID: companyID, Surface: SavedViewSurfaceHuddleNodeActionItems, Principal: SavedViewPrincipalGroup, PrincipalID: user.UserID, Name: "Invalid shared Huddle view",
	}); err != ErrInvalid {
		t.Fatalf("Huddle group-principal error = %v, want ErrInvalid", err)
	}
	if _, err := repo.UpsertSavedView(SavedViewInput{
		CompanyID: companyID, Surface: SavedViewSurfaceHuddleNodeActionItems, Principal: SavedViewPrincipalUser, PrincipalID: user.UserID, Name: "Overlapping Huddle view",
		Groupings: []domain.SavedViewGrouping{{Field: MyWorkActionItemGroupingColor, Direction: "asc"}},
		Settings:  domain.SavedViewSettings{Ordering: []domain.SavedViewGrouping{{Field: MyWorkActionItemGroupingColor, Direction: "desc"}}},
	}); err != ErrInvalid {
		t.Fatalf("Huddle overlapping grouping/ordering error = %v, want ErrInvalid", err)
	}
}

func equalStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
