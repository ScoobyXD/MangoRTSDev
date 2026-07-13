package httpapi

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net"
	"os"
	"testing"
	"time"
)

func TestRealtimeDeliveryFailureClosesAndRemovesConnectionWithDistinctMetric(t *testing.T) {
	metrics := NewInMemoryMetricsRecorder()
	server := NewServerWithOptions(store.NewMemoryRepo(), ServerOptions{
		DisableNotificationCleanup: true,
		Metrics:                    metrics,
	})
	defer server.Close()

	companyID := "91919191-9191-4191-8191-919191919191"
	scope := realtimeNotificationScope("failed-delivery-user")
	stalledNetworkConn := &deadlineBlockingRealtimeNetConn{}
	stalledConn := &realtimeConnection{
		id:        "stalled-delivery-connection",
		companyID: companyID,
		conn:      stalledNetworkConn,
	}
	healthyNetworkConn := &recordingRealtimeNetConn{}
	healthyConn := &realtimeConnection{
		id:        "healthy-delivery-connection",
		companyID: companyID,
		conn:      healthyNetworkConn,
	}
	server.realtimeRegistry.subscribe(stalledConn, scope)
	server.realtimeRegistry.subscribe(healthyConn, scope)
	defer stalledConn.close()
	defer healthyConn.close()

	started := time.Now()
	server.publishRealtimeMessage(companyID, scope, map[string]any{"type": "test"})
	if !stalledNetworkConn.writeDeadlineSet {
		t.Fatal("stalled websocket write did not set a bounded deadline")
	}
	deadlineDelay := stalledNetworkConn.boundedWriteDeadline.Sub(started)
	if deadlineDelay < realtimeWebSocketWriteTimeout-100*time.Millisecond || deadlineDelay > realtimeWebSocketWriteTimeout+time.Second {
		t.Fatalf("write deadline delay = %s, want bounded near %s", deadlineDelay, realtimeWebSocketWriteTimeout)
	}
	if stalledNetworkConn.closeCalls != 1 {
		t.Fatalf("stalled connection close calls = %d, want 1", stalledNetworkConn.closeCalls)
	}
	if server.realtimeRegistry.connectionCount() != 1 || server.realtimeRegistry.scopeSubscriptionCount(companyID, scope) != 1 {
		t.Fatalf("registry after stalled delivery: connections=%d subscriptions=%d, want only healthy peer", server.realtimeRegistry.connectionCount(), server.realtimeRegistry.scopeSubscriptionCount(companyID, scope))
	}
	connections := server.realtimeRegistry.connectionsForScope(companyID, scope)
	if len(connections) != 1 || connections[0].id != healthyConn.id {
		t.Fatalf("remaining connections = %+v, want only %s", connections, healthyConn.id)
	}
	messages := healthyNetworkConn.messages(t)
	if len(messages) != 1 || messages[0]["type"] != "test" {
		t.Fatalf("healthy co-subscriber messages = %+v, want original publish", messages)
	}

	failureKey := OperationalMetricKey{Name: "realtime.delivery_failure_count", ScopeType: "notifications"}
	publishedKey := OperationalMetricKey{Name: "realtime.messages_published", ScopeType: "notifications"}
	noSubscriberKey := OperationalMetricKey{Name: "realtime.publish_skipped_no_subscribers_count", ScopeType: "notifications"}
	snapshot := metrics.Snapshot()
	if got := snapshot.Operational[failureKey]; got.Count != 1 || got.TotalValue != 1 {
		t.Fatalf("delivery failure metric = %+v, want one failed delivery", got)
	}
	if got := snapshot.Operational[publishedKey]; got.Count != 1 || got.TotalValue != 1 {
		t.Fatalf("published metric = %+v, want one healthy delivery", got)
	}
	if _, exists := snapshot.Operational[noSubscriberKey]; exists {
		t.Fatalf("failed attempted delivery was mislabeled as no subscribers: %+v", snapshot.Operational[noSubscriberKey])
	}

	stalledWritesAfterFailure := stalledNetworkConn.writeCalls
	server.publishRealtimeMessage(companyID, scope, map[string]any{"type": "retry"})
	if stalledNetworkConn.writeCalls != stalledWritesAfterFailure {
		t.Fatalf("removed stalled connection received another write: before=%d after=%d", stalledWritesAfterFailure, stalledNetworkConn.writeCalls)
	}
	messages = healthyNetworkConn.messages(t)
	if len(messages) != 2 || messages[1]["type"] != "retry" {
		t.Fatalf("healthy co-subscriber messages after retry = %+v, want retry publish", messages)
	}
	snapshot = metrics.Snapshot()
	if got := snapshot.Operational[publishedKey]; got.Count != 2 || got.TotalValue != 2 {
		t.Fatalf("published metric after retry = %+v, want two healthy deliveries", got)
	}
	if got := snapshot.Operational[failureKey]; got.Count != 1 || got.TotalValue != 1 {
		t.Fatalf("delivery failure metric after retry = %+v, want no repeated failure", got)
	}

	server.realtimeRegistry.removeConnection(healthyConn.id)
	healthyConn.close()
	server.publishRealtimeMessage(companyID, scope, map[string]any{"type": "after-unsubscribe"})
	snapshot = metrics.Snapshot()
	if got := snapshot.Operational[noSubscriberKey]; got.Count != 1 || got.TotalValue != 1 {
		t.Fatalf("no-subscriber metric after healthy removal = %+v, want one skipped publish", got)
	}
}

func TestRealtimeNodeUpdatedSkipsKanbanProjectionLookupWithoutLocalBoardSubscribers(t *testing.T) {
	base := store.NewMemoryRepo()
	repo := &recordingKanbanProjectionLookupRepo{Repository: base}
	server := NewServerWithOptions(repo, ServerOptions{DisableNotificationCleanup: true})
	defer server.Close()

	companyID := "92929292-9292-4292-8292-929292929292"
	event := domain.DomainEvent{
		CompanyID: companyID,
		Type:      "node_updated",
		Payload:   map[string]any{"node_id": "93939393-9393-4393-8393-939393939393"},
	}
	otherCompanyConn := &realtimeConnection{
		id:        "other-company-board-connection",
		companyID: "94949494-9494-4494-8494-949494949494",
		conn:      &recordingRealtimeNetConn{},
	}
	server.realtimeRegistry.subscribe(otherCompanyConn, realtimeBoardScope("other-company-board"))
	defer otherCompanyConn.close()

	server.publishKanbanChangesForEvents([]domain.DomainEvent{event})
	if repo.nodeLookups != 0 {
		t.Fatalf("Kanban projection node lookups = %d, want 0 without a same-company board subscriber", repo.nodeLookups)
	}

	localConn := &realtimeConnection{id: "local-board-connection", companyID: companyID, conn: &recordingRealtimeNetConn{}}
	server.realtimeRegistry.subscribe(localConn, realtimeBoardScope("local-board"))
	defer localConn.close()
	server.publishKanbanChangesForEvents([]domain.DomainEvent{event})
	if repo.nodeLookups != 1 {
		t.Fatalf("Kanban projection node lookups = %d, want 1 with a same-company board subscriber", repo.nodeLookups)
	}
}

type recordingKanbanProjectionLookupRepo struct {
	store.Repository
	nodeLookups int
}

func (r *recordingKanbanProjectionLookupRepo) ListKanbanBoardProjectionRowsForNode(companyID, nodeID string) ([]store.KanbanBoardProjectionRow, error) {
	r.nodeLookups++
	return r.Repository.ListKanbanBoardProjectionRowsForNode(companyID, nodeID)
}

type deadlineBlockingRealtimeNetConn struct {
	writeCalls           int
	closeCalls           int
	writeDeadlineSet     bool
	boundedWriteDeadline time.Time
}

func (c *deadlineBlockingRealtimeNetConn) Read([]byte) (int, error) { return 0, io.EOF }
func (c *deadlineBlockingRealtimeNetConn) Write([]byte) (int, error) {
	c.writeCalls++
	return 0, os.ErrDeadlineExceeded
}
func (c *deadlineBlockingRealtimeNetConn) Close() error                { c.closeCalls++; return nil }
func (c *deadlineBlockingRealtimeNetConn) LocalAddr() net.Addr         { return &net.TCPAddr{} }
func (c *deadlineBlockingRealtimeNetConn) RemoteAddr() net.Addr        { return &net.TCPAddr{} }
func (c *deadlineBlockingRealtimeNetConn) SetDeadline(time.Time) error { return nil }
func (c *deadlineBlockingRealtimeNetConn) SetReadDeadline(time.Time) error {
	return nil
}
func (c *deadlineBlockingRealtimeNetConn) SetWriteDeadline(deadline time.Time) error {
	if !deadline.IsZero() {
		c.writeDeadlineSet = true
		c.boundedWriteDeadline = deadline
	}
	return nil
}

type recordingRealtimeNetConn struct {
	written    bytes.Buffer
	closeCalls int
}

func (c *recordingRealtimeNetConn) Read([]byte) (int, error) { return 0, io.EOF }
func (c *recordingRealtimeNetConn) Write(payload []byte) (int, error) {
	return c.written.Write(payload)
}
func (c *recordingRealtimeNetConn) Close() error                    { c.closeCalls++; return nil }
func (c *recordingRealtimeNetConn) LocalAddr() net.Addr             { return &net.TCPAddr{} }
func (c *recordingRealtimeNetConn) RemoteAddr() net.Addr            { return &net.TCPAddr{} }
func (c *recordingRealtimeNetConn) SetDeadline(time.Time) error     { return nil }
func (c *recordingRealtimeNetConn) SetReadDeadline(time.Time) error { return nil }
func (c *recordingRealtimeNetConn) SetWriteDeadline(time.Time) error {
	return nil
}

func (c *recordingRealtimeNetConn) messages(t *testing.T) []map[string]any {
	t.Helper()
	raw := bytes.NewReader(c.written.Bytes())
	reader := bufio.NewReader(raw)
	messages := make([]map[string]any, 0)
	for raw.Len() > 0 || reader.Buffered() > 0 {
		frame, err := readWebSocketFrame(reader, false)
		if err != nil {
			t.Fatalf("read recorded websocket frame: %v", err)
		}
		if frame.opcode != webSocketOpcodeText {
			t.Fatalf("recorded websocket opcode = %d, want text", frame.opcode)
		}
		var message map[string]any
		if err := json.Unmarshal(frame.payload, &message); err != nil {
			t.Fatalf("decode recorded websocket payload: %v payload=%s", err, string(frame.payload))
		}
		messages = append(messages, message)
	}
	return messages
}
