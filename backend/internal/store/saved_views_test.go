package store

import (
	"miraeopus/backend/internal/domain"
	"testing"
)

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
