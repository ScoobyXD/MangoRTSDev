package store

import (
	"miraeopus/backend/internal/domain"
	"testing"
)

func TestNormalizeSavedViewGroupingsAllowsUpdatesStatus(t *testing.T) {
	groupings, ok := NormalizeSavedViewGroupings(SavedViewSurfaceUpdates, []domain.SavedViewGrouping{
		{Field: "project", Direction: "asc"},
		{Field: "status", Direction: "asc"},
	})
	if !ok {
		t.Fatal("expected Updates status grouping to be accepted")
	}
	if len(groupings) != 2 || groupings[1].Field != "status" || groupings[1].Direction != "asc" {
		t.Fatalf("normalized groupings = %+v, want project then status", groupings)
	}
}
