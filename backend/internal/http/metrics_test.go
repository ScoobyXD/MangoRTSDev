package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestHTTPMetricsRecordStatusConditionalAndRoute(t *testing.T) {
	metrics := NewInMemoryMetricsRecorder()
	repo := store.NewMemoryRepo()
	handler := NewServerWithOptions(repo, ServerOptions{Metrics: metrics}).Routes()
	companyID := "11111111-1111-4111-8111-888888888888"
	userID := "22222222-2222-4222-8222-888888888888"

	successRec := httptest.NewRecorder()
	handler.ServeHTTP(successRec, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if successRec.Code != http.StatusOK {
		t.Fatalf("health status = %d, want %d body=%s", successRec.Code, http.StatusOK, successRec.Body.String())
	}

	errorRec := httptest.NewRecorder()
	handler.ServeHTTP(errorRec, httptest.NewRequest(http.MethodGet, "/v1/work-items/generated-inbox?company_id=bad&user_id="+userID, nil))
	if errorRec.Code != http.StatusBadRequest {
		t.Fatalf("invalid inbox status = %d, want %d body=%s", errorRec.Code, http.StatusBadRequest, errorRec.Body.String())
	}

	firstRec := httptest.NewRecorder()
	firstReq := httptest.NewRequest(http.MethodGet, "/v1/work-items/generated-inbox?company_id="+companyID, nil)
	firstReq = workItemInboxReadRequestWithActor(firstReq, userID, companyID, domain.RoleCompanyUser, false)
	handler.ServeHTTP(firstRec, firstReq)
	if firstRec.Code != http.StatusOK {
		t.Fatalf("first inbox status = %d, want %d body=%s", firstRec.Code, http.StatusOK, firstRec.Body.String())
	}
	etag := firstRec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("first inbox ETag is empty")
	}

	conditionalRec := httptest.NewRecorder()
	conditionalReq := httptest.NewRequest(http.MethodGet, "/v1/work-items/generated-inbox?company_id="+companyID, nil)
	conditionalReq = workItemInboxReadRequestWithActor(conditionalReq, userID, companyID, domain.RoleCompanyUser, false)
	conditionalReq.Header.Set("If-None-Match", etag)
	handler.ServeHTTP(conditionalRec, conditionalReq)
	if conditionalRec.Code != http.StatusNotModified {
		t.Fatalf("conditional inbox status = %d, want %d body=%s", conditionalRec.Code, http.StatusNotModified, conditionalRec.Body.String())
	}
	if conditionalRec.Body.Len() != 0 {
		t.Fatalf("conditional inbox body = %q, want empty", conditionalRec.Body.String())
	}

	snapshot := metrics.Snapshot()
	assertHTTPMetricCount(t, snapshot, HTTPRequestMetricKey{Method: http.MethodGet, Route: "/healthz", Status: http.StatusOK}, 1)
	assertHTTPMetricCount(t, snapshot, HTTPRequestMetricKey{Method: http.MethodGet, Route: "/v1/work-items/generated-inbox", Status: http.StatusBadRequest}, 1)
	assertHTTPMetricCount(t, snapshot, HTTPRequestMetricKey{Method: http.MethodGet, Route: "/v1/work-items/generated-inbox", Status: http.StatusOK}, 1)
	assertHTTPMetricCount(t, snapshot, HTTPRequestMetricKey{Method: http.MethodGet, Route: "/v1/work-items/generated-inbox", Status: http.StatusNotModified, Conditional: true, NotModified: true}, 1)
}

func TestNormalizeHTTPRouteRemovesFallbackIDs(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/v1/nodes/11111111-1111-4111-8111-999999999999/details", nil)
	if got, want := normalizeHTTPRoute(req), "/v1/nodes/{id}/details"; got != want {
		t.Fatalf("normalized route = %q, want %q", got, want)
	}
}

func assertHTTPMetricCount(t *testing.T, snapshot MetricsSnapshot, key HTTPRequestMetricKey, want int64) {
	t.Helper()
	stats, ok := snapshot.HTTPRequests[key]
	if !ok {
		t.Fatalf("missing HTTP metric %+v in snapshot %+v", key, snapshot.HTTPRequests)
	}
	if stats.Count != want {
		t.Fatalf("HTTP metric %+v count = %d, want %d", key, stats.Count, want)
	}
}
