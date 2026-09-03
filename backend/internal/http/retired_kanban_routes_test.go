package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"miraeopus/backend/internal/store"
)

func TestRetiredKanbanRoutesAreAbsent(t *testing.T) {
	server := NewServer(store.NewMemoryRepo())
	defer server.Close()
	for _, path := range []string{
		"/v1/kanban/boards", "/v1/kanban/columns", "/v1/kanban/cards",
		"/v1/logic-gate-arena", "/v1/work-items/logic-gate-assignments",
		"/v1/work-items/logic-gate-assignments/move",
	} {
		for _, method := range []string{http.MethodGet, http.MethodPost} {
			rec := httptest.NewRecorder()
			server.Routes().ServeHTTP(rec, httptest.NewRequest(method, path, nil))
			if rec.Code != http.StatusNotFound {
				t.Errorf("%s %s = %d, want 404", method, path, rec.Code)
			}
		}
	}
}
