package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type failingNodeCreateWorkspaceEventRepo struct {
	*store.MemoryRepo
	err error
}

func (r *failingNodeCreateWorkspaceEventRepo) CreateNodeWithAssigneeAndWorkspaceEvent(companyID, title, assigneeUserID string) (domain.Node, domain.DomainEvent, error) {
	return domain.Node{}, domain.DomainEvent{}, r.err
}

func TestNodeCreateAtomicWorkspaceEventReplaysFromCursor(t *testing.T) {
	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "33333333-3333-3333-3333-333333333333"

	body, _ := json.Marshal(map[string]any{"company_id": companyID, "title": "Replayable node"})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/nodes", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /v1/nodes status = %d body=%s", rec.Code, rec.Body.String())
	}
	var node domain.Node
	if err := json.NewDecoder(rec.Body).Decode(&node); err != nil {
		t.Fatalf("decode node: %v", err)
	}

	durable, err := repo.ListDomainEventsAfter(store.DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: 0, Limit: 10})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter: %v", err)
	}
	if len(durable) != 1 || durable[0].Type != "node_created" || durable[0].Payload["node_id"] != node.NodeID {
		t.Fatalf("durable events = %+v, want node_created for %q", durable, node.NodeID)
	}

	reader, cancel := openWorkspaceStreamForTest(t, handler, "/v1/workspace/stream?company_id="+companyID+"&after_sequence=0", nil)
	defer cancel()
	ready := readWorkspaceReadyForTest(t, reader)
	if ready.AfterSequence != 0 {
		t.Fatalf("ready after_sequence = %d, want explicit 0", ready.AfterSequence)
	}
	event := readWorkspaceSSEForTest(t, reader)
	if event.Sequence != durable[0].Sequence || event.Type != "node_created" || event.Data["node_id"] != node.NodeID {
		t.Fatalf("replayed event = %+v, want durable node_created for %q", event, node.NodeID)
	}
}

func TestNodeCreateDoesNotPublishHubEventWhenAtomicMutationFails(t *testing.T) {
	companyID := "44444444-4444-4444-4444-444444444444"
	repo := &failingNodeCreateWorkspaceEventRepo{MemoryRepo: store.NewMemoryRepo(), err: errors.New("commit failed")}
	server := NewServer(repo)
	stream := server.hub.subscribe(companyID)
	defer server.hub.unsubscribe(companyID, stream)

	body, _ := json.Marshal(map[string]any{"company_id": companyID, "title": "Should not publish"})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/nodes", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	server.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("POST /v1/nodes status = %d body=%s, want 500", rec.Code, rec.Body.String())
	}

	select {
	case payload := <-stream:
		t.Fatalf("hub published payload before failed commit completed: %s", string(payload))
	case <-time.After(100 * time.Millisecond):
	}
}
