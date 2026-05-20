package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

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
	handler.ServeHTTP(errorRec, httptest.NewRequest(http.MethodGet, "/v1/work-items/responsible-inbox?company_id=bad&user_id="+userID, nil))
	if errorRec.Code != http.StatusBadRequest {
		t.Fatalf("invalid inbox status = %d, want %d body=%s", errorRec.Code, http.StatusBadRequest, errorRec.Body.String())
	}

	firstRec := httptest.NewRecorder()
	firstReq := httptest.NewRequest(http.MethodGet, "/v1/work-items/responsible-inbox?company_id="+companyID+"&user_id="+userID, nil)
	handler.ServeHTTP(firstRec, firstReq)
	if firstRec.Code != http.StatusOK {
		t.Fatalf("first inbox status = %d, want %d body=%s", firstRec.Code, http.StatusOK, firstRec.Body.String())
	}
	etag := firstRec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("first inbox ETag is empty")
	}

	conditionalRec := httptest.NewRecorder()
	conditionalReq := httptest.NewRequest(http.MethodGet, "/v1/work-items/responsible-inbox?company_id="+companyID+"&user_id="+userID, nil)
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
	assertHTTPMetricCount(t, snapshot, HTTPRequestMetricKey{Method: http.MethodGet, Route: "/v1/work-items/responsible-inbox", Status: http.StatusBadRequest}, 1)
	assertHTTPMetricCount(t, snapshot, HTTPRequestMetricKey{Method: http.MethodGet, Route: "/v1/work-items/responsible-inbox", Status: http.StatusOK}, 1)
	assertHTTPMetricCount(t, snapshot, HTTPRequestMetricKey{Method: http.MethodGet, Route: "/v1/work-items/responsible-inbox", Status: http.StatusNotModified, Conditional: true, NotModified: true}, 1)
}

func TestNormalizeHTTPRouteRemovesFallbackIDs(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/v1/nodes/11111111-1111-4111-8111-999999999999/details", nil)
	if got, want := normalizeHTTPRoute(req), "/v1/nodes/{id}/details"; got != want {
		t.Fatalf("normalized route = %q, want %q", got, want)
	}
}

func TestWorkspaceReplayMetricsRecordBatchesAndEvents(t *testing.T) {
	metrics := NewInMemoryMetricsRecorder()
	repo := store.NewMemoryRepo()
	server := NewServerWithOptions(repo, ServerOptions{Metrics: metrics, WorkspaceCatchupInterval: time.Hour})
	companyID := "workspace-metrics-company"

	for index := 1; index <= 3; index++ {
		if _, err := repo.AppendDomainEvent(store.DomainEventInput{
			CompanyID:  companyID,
			StreamType: workspaceDomainStreamType,
			StreamID:   companyID,
			Type:       fmt.Sprintf("metrics_replay_%d", index),
			Payload:    map[string]any{"index": index},
		}); err != nil {
			t.Fatalf("AppendDomainEvent %d: %v", index, err)
		}
	}

	reader, cancel := openWorkspaceStreamForTest(t, server.Routes(), "/v1/workspace/stream?company_id="+companyID+"&after_sequence=1", nil)
	defer cancel()
	ready := readWorkspaceReadyForTest(t, reader)
	if ready.AfterSequence != 1 {
		t.Fatalf("ready after_sequence = %d, want 1", ready.AfterSequence)
	}
	second := readWorkspaceSSEForTest(t, reader)
	third := readWorkspaceSSEForTest(t, reader)
	if second.Sequence != 2 || third.Sequence != 3 {
		t.Fatalf("replayed sequences = %d,%d want 2,3", second.Sequence, third.Sequence)
	}

	stats := waitForWorkspaceReplayMetric(t, metrics, WorkspaceReplayMetricKey{Source: workspaceReplaySourceInitial, Outcome: workspaceReplayOutcomeSuccess})
	if stats.LastBatches != 1 || stats.LastEvents != 2 {
		t.Fatalf("workspace replay stats batches/events = %d/%d, want 1/2", stats.LastBatches, stats.LastEvents)
	}
	if stats.LastStartAfterSequence != 1 || stats.LastSequence != 3 {
		t.Fatalf("workspace replay sequence stats = start %d last %d, want start 1 last 3", stats.LastStartAfterSequence, stats.LastSequence)
	}
}

func TestWorkspaceReplayMetricsRecordFailures(t *testing.T) {
	metrics := NewInMemoryMetricsRecorder()
	repo := &failingReplayRepo{Repository: store.NewMemoryRepo()}
	server := NewServerWithOptions(repo, ServerOptions{Metrics: metrics, WorkspaceCatchupInterval: time.Hour})
	companyID := "workspace-metrics-failure-company"

	reader, cancel := openWorkspaceStreamForTest(t, server.Routes(), "/v1/workspace/stream?company_id="+companyID+"&after_sequence=0", nil)
	defer cancel()
	ready := readWorkspaceReadyForTest(t, reader)
	if ready.AfterSequence != 0 {
		t.Fatalf("ready after_sequence = %d, want 0", ready.AfterSequence)
	}

	stats := waitForWorkspaceReplayMetric(t, metrics, WorkspaceReplayMetricKey{Source: workspaceReplaySourceInitial, Outcome: workspaceReplayOutcomeError})
	if stats.LastBatches != 1 || stats.LastEvents != 0 {
		t.Fatalf("workspace replay failure stats batches/events = %d/%d, want 1/0", stats.LastBatches, stats.LastEvents)
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

func waitForWorkspaceReplayMetric(t *testing.T, metrics *InMemoryMetricsRecorder, key WorkspaceReplayMetricKey) WorkspaceReplayMetricStats {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		stats, ok := metrics.Snapshot().WorkspaceReplays[key]
		if ok && stats.Count > 0 {
			return stats
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for workspace replay metric %+v", key)
	return WorkspaceReplayMetricStats{}
}

type failingReplayRepo struct {
	store.Repository
}

func (r *failingReplayRepo) ListDomainEventsAfter(store.DomainEventReplayQuery) ([]domain.DomainEvent, error) {
	return nil, errMetricsReplayFailure
}

var errMetricsReplayFailure = errors.New("metrics replay failure")
