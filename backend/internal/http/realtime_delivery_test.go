package httpapi

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net"
	"os"
	"runtime"
	"sync"
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
	scope := realtimeNotificationScope("90919191-9191-4191-8191-919191919191")
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
	attemptedKey := OperationalMetricKey{Name: "realtime.delivery_attempt_count", ScopeType: "notifications"}
	publishedKey := OperationalMetricKey{Name: "realtime.messages_published", ScopeType: "notifications"}
	noSubscriberKey := OperationalMetricKey{Name: "realtime.publish_skipped_no_subscribers_count", ScopeType: "notifications"}
	snapshot := metrics.Snapshot()
	if got := snapshot.Operational[failureKey]; got.Count != 1 || got.TotalValue != 1 {
		t.Fatalf("delivery failure metric = %+v, want one failed delivery", got)
	}
	if got := snapshot.Operational[attemptedKey]; got.Count != 1 || got.TotalValue != 2 {
		t.Fatalf("delivery attempt metric = %+v, want two attempted deliveries", got)
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
	if got := snapshot.Operational[attemptedKey]; got.Count != 2 || got.TotalValue != 3 {
		t.Fatalf("delivery attempt metric after retry = %+v, want three total attempts", got)
	}

	server.realtimeRegistry.removeConnection(healthyConn.id)
	healthyConn.close()
	server.publishRealtimeMessage(companyID, scope, map[string]any{"type": "after-unsubscribe"})
	snapshot = metrics.Snapshot()
	if got := snapshot.Operational[noSubscriberKey]; got.Count != 1 || got.TotalValue != 1 {
		t.Fatalf("no-subscriber metric after healthy removal = %+v, want one skipped publish", got)
	}
}

func TestRealtimePublishFanoutIsBoundedAndConcurrent(t *testing.T) {
	metrics := NewInMemoryMetricsRecorder()
	server := NewServerWithOptions(store.NewMemoryRepo(), ServerOptions{
		DisableNotificationCleanup: true,
		Metrics:                    metrics,
	})
	defer server.Close()

	companyID := "97979797-9797-4797-8797-979797979797"
	scope := realtimeNotificationScope("98989898-9898-4898-8898-989898989898")
	connectionCount := realtimePublishFanoutLimit + 3
	entered := make(chan string, connectionCount)
	release := make(chan struct{})
	for index := 0; index < connectionCount; index++ {
		networkConn := &controlledStalledRealtimeNetConn{
			id:      fmt.Sprintf("stalled-%02d", index),
			entered: entered,
			release: release,
		}
		conn := &realtimeConnection{
			id:        networkConn.id,
			companyID: companyID,
			conn:      networkConn,
		}
		server.realtimeRegistry.subscribe(conn, scope)
		defer conn.close()
	}

	done := make(chan struct{})
	go func() {
		server.publishRealtimeMessage(companyID, scope, map[string]any{"type": "fanout.test"})
		close(done)
	}()

	seen := map[string]bool{}
	for len(seen) < realtimePublishFanoutLimit {
		select {
		case id := <-entered:
			seen[id] = true
		case <-time.After(time.Second):
			t.Fatalf("only %d stalled writes started before release, want %d concurrent workers", len(seen), realtimePublishFanoutLimit)
		}
	}
	select {
	case id := <-entered:
		t.Fatalf("write %s started before a bounded worker was released", id)
	default:
	}
	close(release)
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("bounded fan-out did not finish after stalled writes were released")
	}
	for len(entered) > 0 {
		seen[<-entered] = true
	}
	if len(seen) != connectionCount {
		t.Fatalf("attempted stalled connections = %d, want %d", len(seen), connectionCount)
	}
	if server.realtimeRegistry.connectionCount() != 0 || server.realtimeRegistry.scopeSubscriptionCount(companyID, scope) != 0 {
		t.Fatalf("failed connections remain registered: connections=%d subscriptions=%d", server.realtimeRegistry.connectionCount(), server.realtimeRegistry.scopeSubscriptionCount(companyID, scope))
	}
	snapshot := metrics.Snapshot()
	attemptedKey := OperationalMetricKey{Name: "realtime.delivery_attempt_count", ScopeType: "notifications"}
	failureKey := OperationalMetricKey{Name: "realtime.delivery_failure_count", ScopeType: "notifications"}
	if got := snapshot.Operational[attemptedKey]; got.Count != 1 || got.TotalValue != int64(connectionCount) {
		t.Fatalf("delivery attempt metric = %+v, want %d", got, connectionCount)
	}
	if got := snapshot.Operational[failureKey]; got.Count != 1 || got.TotalValue != int64(connectionCount) {
		t.Fatalf("delivery failure metric = %+v, want %d", got, connectionCount)
	}
}

func TestRealtimeConcurrentPublishesPreservePerConnectionEventOrder(t *testing.T) {
	server := NewServerWithOptions(store.NewMemoryRepo(), ServerOptions{DisableNotificationCleanup: true})
	defer server.Close()

	companyID := "99999999-9999-4999-8999-999999999998"
	scope := realtimeNotificationScope("99999999-9999-4999-8999-999999999997")
	networkConn := &gatedRecordingRealtimeNetConn{
		entered: make(chan struct{}),
		release: make(chan struct{}),
	}
	conn := &realtimeConnection{id: "ordered-connection", companyID: companyID, conn: networkConn}
	server.realtimeRegistry.subscribe(conn, scope)
	defer conn.close()

	firstDone := make(chan struct{})
	go func() {
		server.publishRealtimeMessage(companyID, scope, map[string]any{"sequence": 1})
		close(firstDone)
	}()
	select {
	case <-networkConn.entered:
	case <-time.After(time.Second):
		t.Fatal("first publish did not reach the controlled connection")
	}
	secondDone := make(chan struct{})
	go func() {
		server.publishRealtimeMessage(companyID, scope, map[string]any{"sequence": 2})
		close(secondDone)
	}()
	close(networkConn.release)
	for _, done := range []<-chan struct{}{firstDone, secondDone} {
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Fatal("ordered publish did not complete")
		}
	}
	messages := networkConn.messages(t)
	if len(messages) != 2 || messages[0]["sequence"] != float64(1) || messages[1]["sequence"] != float64(2) {
		t.Fatalf("published order = %+v, want sequence 1 then 2", messages)
	}
}

func TestRealtimeStalledScopeDoesNotBlockUnrelatedScopePublish(t *testing.T) {
	server := NewServerWithOptions(store.NewMemoryRepo(), ServerOptions{DisableNotificationCleanup: true})
	defer server.Close()

	companyID := "99999999-9999-4999-8999-999999999990"
	stalledScope := realtimeNotificationScope("99999999-9999-4999-8999-999999999991")
	healthyScope := realtimeNotificationScope("99999999-9999-4999-8999-999999999992")
	stalledNetworkConn := &gatedRecordingRealtimeNetConn{
		entered: make(chan struct{}),
		release: make(chan struct{}),
	}
	stalledConn := &realtimeConnection{id: "stalled-scope-connection", companyID: companyID, conn: stalledNetworkConn}
	healthyNetworkConn := &recordingRealtimeNetConn{}
	healthyConn := &realtimeConnection{id: "healthy-scope-connection", companyID: companyID, conn: healthyNetworkConn}
	server.realtimeRegistry.subscribe(stalledConn, stalledScope)
	server.realtimeRegistry.subscribe(healthyConn, healthyScope)
	defer stalledConn.close()
	defer healthyConn.close()

	stalledDone := make(chan struct{})
	go func() {
		server.publishRealtimeMessage(companyID, stalledScope, map[string]any{"scope": "stalled"})
		close(stalledDone)
	}()
	select {
	case <-stalledNetworkConn.entered:
	case <-time.After(time.Second):
		t.Fatal("stalled-scope publish did not reach its controlled connection")
	}

	healthyDone := make(chan struct{})
	go func() {
		server.publishRealtimeMessage(companyID, healthyScope, map[string]any{"scope": "healthy"})
		close(healthyDone)
	}()
	select {
	case <-healthyDone:
	case <-time.After(time.Second):
		t.Fatal("unrelated healthy scope was head-of-line blocked by stalled publish")
	}
	messages := healthyNetworkConn.messages(t)
	if len(messages) != 1 || messages[0]["scope"] != "healthy" {
		t.Fatalf("healthy scope messages=%+v, want immediate healthy delivery", messages)
	}

	close(stalledNetworkConn.release)
	select {
	case <-stalledDone:
	case <-time.After(time.Second):
		t.Fatal("stalled scope did not finish after release")
	}
}

func TestRealtimeQueuedPublicationsReauthorizeInsideExactScopeOrdering(t *testing.T) {
	for _, surface := range []string{"chat", "kanban", "shared_mailbox"} {
		t.Run(surface, func(t *testing.T) {
			base := store.NewMemoryRepo()
			companyID := "71717171-7171-4171-8171-717171717171"
			base.EnsureCompany(companyID, "Queued realtime authorization company")
			user := mustRealtimeAuthUser(t, base, companyID, "queued-realtime-"+surface, domain.RoleCompanyUser)

			resourceType := ""
			resourceID := ""
			permission := store.EntityPermissionView
			scope := ""
			var publish func(*Server)
			switch surface {
			case "chat":
				node, err := base.CreateNode(companyID, "Queued chat node")
				if err != nil {
					t.Fatal(err)
				}
				resourceType = store.EntityTypeNode
				resourceID = node.NodeID
				permission = store.EntityPermissionEdit
				scope = realtimeChatScope(node.NodeID)
				publish = func(server *Server) {
					server.publishNodeChatCreated(companyID, node.NodeID, "queued-chat-message", domain.NodeInformation{
						Type: "Text block chat", Information: `{"block_id":"queued-chat-block"}`,
					})
				}
			case "kanban":
				gate, err := base.CreateLogicGate(companyID, "Queued board")
				if err != nil {
					t.Fatal(err)
				}
				resourceType = store.EntityTypeLogicGate
				resourceID = gate.LogicGateID
				boardID := store.LogicGateKanbanBoardID(gate.LogicGateID)
				scope = realtimeBoardScope(boardID)
				publish = func(server *Server) {
					server.publishKanbanChanged(companyID, boardID, "queued-change")
				}
			case "shared_mailbox":
				if _, err := base.UpsertCompanyEmailConnection(store.CompanyEmailConnectionInput{
					CompanyID: companyID, Provider: "google", AccountEmail: "queued-shared@example.com",
					GrantID: "queued-shared-grant", Status: "connected", ConnectedByUserID: user.UserID,
				}); err != nil {
					t.Fatal(err)
				}
				folder, err := base.CreateCommunicationsSharedInboxFolder(companyID, "", "Queued shared mailbox", "queued-shared@example.com")
				if err != nil {
					t.Fatal(err)
				}
				resourceType = store.EntityTypeSharedInbox
				resourceID = folder.FolderID
				scope = realtimeSharedMailboxScope(folder.FolderID)
				publish = func(server *Server) {
					server.publishSharedMailboxWebhookHint(companyID, folder.FolderID, nylasWebhookChange{
						Trigger: "message.created", MessageID: "queued-shared-message",
					})
				}
			}

			if _, err := base.SetEntityPermissions(store.EntityPermissionUpdateInput{
				CompanyID: companyID, EntityType: resourceType, EntityID: resourceID,
				DefaultAccess: store.ResourceDefaultAccessNoAccess, DefaultAccessSet: true,
				Permissions: []store.EntityPermissionInput{{
					SubjectType: store.EntityPermissionSubjectUser, SubjectID: user.UserID, AccessLevel: permission,
				}},
			}); err != nil {
				t.Fatal(err)
			}

			audienceLookups := make(chan struct{}, 2)
			repo := &recordingRealtimeAudienceRepo{Repository: base, lookups: audienceLookups}
			server := NewServerWithOptions(repo, ServerOptions{DisableNotificationCleanup: true})
			defer server.Close()
			networkConn := &recordingRealtimeNetConn{}
			conn := &realtimeConnection{id: "queued-" + surface, companyID: companyID, userID: user.UserID, conn: networkConn}
			server.realtimeRegistry.subscribe(conn, scope)
			defer conn.close()

			// Hold the exact-scope ordering boundary so the publication queues.
			// The current audience must not be sampled until this boundary is
			// acquired, or a later revocation can leave a stale queued audience.
			releaseScope := server.realtimeRegistry.lockPublishScope(companyID, scope)
			done := make(chan struct{})
			go func() {
				publish(server)
				close(done)
			}()

			queued := false
			lookupBeforeQueue := false
			deadline := time.Now().Add(time.Second)
			for !queued && !lookupBeforeQueue && time.Now().Before(deadline) {
				select {
				case <-audienceLookups:
					lookupBeforeQueue = true
				default:
				}
				server.realtimeRegistry.publishLocksMu.Lock()
				lock := server.realtimeRegistry.publishLocks[realtimeScopeKey{companyID: companyID, scope: scope}]
				queued = lock != nil && lock.refs >= 2
				server.realtimeRegistry.publishLocksMu.Unlock()
				if !queued && !lookupBeforeQueue {
					runtime.Gosched()
				}
			}
			if lookupBeforeQueue || !queued {
				releaseScope()
				select {
				case <-done:
				case <-time.After(time.Second):
				}
				if lookupBeforeQueue {
					t.Fatal("current audience was resolved before the publication acquired its exact-scope ordering boundary")
				}
				t.Fatal("publication did not queue behind the held exact-scope ordering boundary")
			}

			if _, err := base.SetEntityPermissions(store.EntityPermissionUpdateInput{
				CompanyID: companyID, EntityType: resourceType, EntityID: resourceID,
				DefaultAccess: store.ResourceDefaultAccessNoAccess, DefaultAccessSet: true,
			}); err != nil {
				releaseScope()
				t.Fatal(err)
			}
			releaseScope()

			select {
			case <-audienceLookups:
			case <-time.After(time.Second):
				t.Fatal("queued publication did not resolve its audience after acquiring the scope boundary")
			}
			select {
			case <-done:
			case <-time.After(time.Second):
				t.Fatal("queued publication did not finish")
			}
			if messages := networkConn.messages(t); len(messages) != 0 {
				t.Fatalf("revoked queued subscriber received messages: %+v", messages)
			}
			if server.realtimeRegistry.scopeSubscriptionCount(companyID, scope) != 1 {
				t.Fatal("queued revocation test unexpectedly removed the existing subscription")
			}
		})
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
	server.realtimeRegistry.subscribe(otherCompanyConn, realtimeBoardScope(store.LogicGateKanbanBoardID("95959595-9595-4595-8595-959595959595")))
	defer otherCompanyConn.close()

	server.publishKanbanChangesForEvents([]domain.DomainEvent{event})
	if repo.nodeLookups != 0 {
		t.Fatalf("Kanban projection node lookups = %d, want 0 without a same-company board subscriber", repo.nodeLookups)
	}

	localConn := &realtimeConnection{id: "local-board-connection", companyID: companyID, conn: &recordingRealtimeNetConn{}}
	server.realtimeRegistry.subscribe(localConn, realtimeBoardScope(store.LogicGateKanbanBoardID("96969696-9696-4696-8696-969696969696")))
	defer localConn.close()
	server.publishKanbanChangesForEvents([]domain.DomainEvent{event})
	if repo.nodeLookups != 1 {
		t.Fatalf("Kanban projection node lookups = %d, want 1 with a same-company board subscriber", repo.nodeLookups)
	}
}

func TestRealtimePublicationRejectsMissingResourceBeforePermissiveAudienceLookup(t *testing.T) {
	base := store.NewMemoryRepo()
	repo := &missingRealtimeEntityPermissiveAudienceRepo{Repository: base}
	server := NewServerWithOptions(repo, ServerOptions{DisableNotificationCleanup: true})
	defer server.Close()

	companyID := "81818181-8181-4181-8181-818181818181"
	nodeID := "82828282-8282-4282-8282-828282828282"
	scope := realtimeChatScope(nodeID)
	networkConn := &recordingRealtimeNetConn{}
	conn := &realtimeConnection{
		id:        "missing-resource-admin",
		companyID: companyID,
		userID:    "83838383-8383-4383-8383-838383838383",
		conn:      networkConn,
	}
	server.realtimeRegistry.subscribe(conn, scope)
	defer conn.close()

	delivered := server.publishRealtimeMessageToCurrentEntityAudience(
		companyID,
		scope,
		store.EntityTypeNode,
		nodeID,
		store.EntityPermissionEdit,
		map[string]any{"type": "chat.created"},
	)
	if delivered != 0 {
		t.Fatalf("missing-resource delivery count = %d, want 0", delivered)
	}
	if repo.audienceLookups != 0 {
		t.Fatalf("audience lookups = %d, want 0 before missing resource is rejected", repo.audienceLookups)
	}
	if messages := networkConn.messages(t); len(messages) != 0 {
		t.Fatalf("missing-resource subscriber received messages: %+v", messages)
	}
}

type recordingKanbanProjectionLookupRepo struct {
	store.Repository
	nodeLookups int
}

type missingRealtimeEntityPermissiveAudienceRepo struct {
	store.Repository
	audienceLookups int
}

type recordingRealtimeAudienceRepo struct {
	store.Repository
	lookups chan<- struct{}
}

func (r *recordingRealtimeAudienceRepo) ListEffectiveUsersForResource(companyID, resourceType, resourceID, accessLevel string) ([]string, error) {
	select {
	case r.lookups <- struct{}{}:
	default:
	}
	return r.Repository.ListEffectiveUsersForResource(companyID, resourceType, resourceID, accessLevel)
}

func (r *missingRealtimeEntityPermissiveAudienceRepo) GetNode(string, string) (domain.Node, error) {
	return domain.Node{}, store.ErrNotFound
}

func (r *missingRealtimeEntityPermissiveAudienceRepo) ListEffectiveUsersForResource(string, string, string, string) ([]string, error) {
	r.audienceLookups++
	return []string{"83838383-8383-4383-8383-838383838383"}, nil
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

type controlledStalledRealtimeNetConn struct {
	id      string
	entered chan<- string
	release <-chan struct{}
	once    sync.Once
}

func (c *controlledStalledRealtimeNetConn) Read([]byte) (int, error) { return 0, io.EOF }
func (c *controlledStalledRealtimeNetConn) Write([]byte) (int, error) {
	c.once.Do(func() {
		c.entered <- c.id
		<-c.release
	})
	return 0, os.ErrDeadlineExceeded
}
func (c *controlledStalledRealtimeNetConn) Close() error                { return nil }
func (c *controlledStalledRealtimeNetConn) LocalAddr() net.Addr         { return &net.TCPAddr{} }
func (c *controlledStalledRealtimeNetConn) RemoteAddr() net.Addr        { return &net.TCPAddr{} }
func (c *controlledStalledRealtimeNetConn) SetDeadline(time.Time) error { return nil }
func (c *controlledStalledRealtimeNetConn) SetReadDeadline(time.Time) error {
	return nil
}
func (c *controlledStalledRealtimeNetConn) SetWriteDeadline(time.Time) error {
	return nil
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

type gatedRecordingRealtimeNetConn struct {
	recordingRealtimeNetConn
	entered chan struct{}
	release chan struct{}
	once    sync.Once
}

func (c *gatedRecordingRealtimeNetConn) Write(payload []byte) (int, error) {
	c.once.Do(func() {
		close(c.entered)
		<-c.release
	})
	return c.recordingRealtimeNetConn.Write(payload)
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
