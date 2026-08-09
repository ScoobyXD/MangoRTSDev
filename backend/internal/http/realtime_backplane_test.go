package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"miraeopus/backend/internal/auth"
	"miraeopus/backend/internal/domain"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	rt "miraeopus/backend/internal/realtime"
	"miraeopus/backend/internal/store"
)

type countingRealtimeRepository struct {
	store.Repository
	claimCalls   atomic.Int64
	listCalls    atomic.Int64
	currentCalls atomic.Int64
}

type failingRealtimeBootstrapRepository struct {
	store.Repository
	failures      int64
	blockFailures bool
	currentCalls  atomic.Int64
	claimCalls    atomic.Int64
	listCalls     atomic.Int64
}

type gatedRealtimeBootstrapRepository struct {
	store.Repository
	allowCurrent chan struct{}
	currentCalls atomic.Int64
}

type blockingRealtimeRecoveryRepository struct {
	store.Repository
	listCalls    atomic.Int64
	listStarted  chan struct{}
	listTimedOut chan struct{}
}

type failingRealtimeClaimRepository struct {
	store.Repository
	claimFailures int64
	claimCalls    atomic.Int64
	releaseCalls  atomic.Int64
	failRelease   bool
}

func (r *failingRealtimeClaimRepository) ClaimRealtimeOutbox(ctx context.Context, query store.RealtimeOutboxClaimQuery) ([]store.RealtimeOutboxEvent, error) {
	call := r.claimCalls.Add(1)
	if call <= r.claimFailures {
		return nil, errors.New("transient claim failure")
	}
	return r.Repository.ClaimRealtimeOutbox(ctx, query)
}

func (r *failingRealtimeClaimRepository) MarkRealtimeOutboxFailed(ctx context.Context, eventID, claimToken, category string) error {
	r.releaseCalls.Add(1)
	if r.failRelease {
		return errors.New("claim release timed out")
	}
	return r.Repository.MarkRealtimeOutboxFailed(ctx, eventID, claimToken, category)
}

func (r *blockingRealtimeRecoveryRepository) ListPublishedRealtimeOutboxAfter(ctx context.Context, sequence int64, limit int) ([]store.RealtimeOutboxEvent, error) {
	if r.listCalls.Add(1) == 1 {
		close(r.listStarted)
		<-ctx.Done()
		close(r.listTimedOut)
		return nil, ctx.Err()
	}
	return r.Repository.ListPublishedRealtimeOutboxAfter(ctx, sequence, limit)
}

func (r *failingRealtimeBootstrapRepository) CurrentPublishedRealtimeOutboxSequence(ctx context.Context) (int64, error) {
	call := r.currentCalls.Add(1)
	if call <= r.failures {
		if r.blockFailures {
			<-ctx.Done()
			return 0, ctx.Err()
		}
		return 0, errors.New("transient initial cursor failure")
	}
	return r.Repository.CurrentPublishedRealtimeOutboxSequence(ctx)
}

func (r *gatedRealtimeBootstrapRepository) CurrentPublishedRealtimeOutboxSequence(ctx context.Context) (int64, error) {
	r.currentCalls.Add(1)
	select {
	case <-r.allowCurrent:
		return r.Repository.CurrentPublishedRealtimeOutboxSequence(ctx)
	case <-ctx.Done():
		return 0, ctx.Err()
	}
}

func (r *failingRealtimeBootstrapRepository) ClaimRealtimeOutbox(ctx context.Context, query store.RealtimeOutboxClaimQuery) ([]store.RealtimeOutboxEvent, error) {
	r.claimCalls.Add(1)
	return r.Repository.ClaimRealtimeOutbox(ctx, query)
}

func (r *failingRealtimeBootstrapRepository) ListPublishedRealtimeOutboxAfter(ctx context.Context, sequence int64, limit int) ([]store.RealtimeOutboxEvent, error) {
	r.listCalls.Add(1)
	return r.Repository.ListPublishedRealtimeOutboxAfter(ctx, sequence, limit)
}

type fixedRealtimeRecoveryRepository struct {
	store.Repository
	events []store.RealtimeOutboxEvent
}

func (r *fixedRealtimeRecoveryRepository) ListPublishedRealtimeOutboxAfter(ctx context.Context, sequence int64, limit int) ([]store.RealtimeOutboxEvent, error) {
	items := make([]store.RealtimeOutboxEvent, 0, limit)
	for _, event := range r.events {
		if event.Sequence > sequence && len(items) < limit {
			items = append(items, event)
		}
	}
	return items, nil
}

func (r *countingRealtimeRepository) ClaimRealtimeOutbox(ctx context.Context, query store.RealtimeOutboxClaimQuery) ([]store.RealtimeOutboxEvent, error) {
	r.claimCalls.Add(1)
	return r.Repository.ClaimRealtimeOutbox(ctx, query)
}

func (r *countingRealtimeRepository) ListPublishedRealtimeOutboxAfter(ctx context.Context, sequence int64, limit int) ([]store.RealtimeOutboxEvent, error) {
	r.listCalls.Add(1)
	return r.Repository.ListPublishedRealtimeOutboxAfter(ctx, sequence, limit)
}

func (r *countingRealtimeRepository) CurrentPublishedRealtimeOutboxSequence(ctx context.Context) (int64, error) {
	r.currentCalls.Add(1)
	return r.Repository.CurrentPublishedRealtimeOutboxSequence(ctx)
}

func (r *countingRealtimeRepository) totalReads() int64 {
	return r.claimCalls.Load() + r.listCalls.Load() + r.currentCalls.Load()
}

type controllableBackplane struct {
	mu              sync.Mutex
	down            bool
	onMessage       func([]byte)
	onReady         func()
	closed          chan struct{}
	closeOnce       sync.Once
	publishCalls    atomic.Int64
	subscribeCalls  atomic.Int64
	failNextPublish atomic.Bool
}

// delayedReadyBackplane models a healthy broker while this API task's
// subscription is not ready. Other tasks can publish successfully, but this
// task must recover those published rows from its certified database cursor
// when connect marks the subscription ready.
type delayedReadyBackplane struct {
	mu             sync.Mutex
	connected      bool
	onMessage      func([]byte)
	onReady        func()
	closed         chan struct{}
	closeOnce      sync.Once
	publishCalls   atomic.Int64
	subscribeCalls atomic.Int64
}

func newDelayedReadyBackplane() *delayedReadyBackplane {
	return &delayedReadyBackplane{closed: make(chan struct{})}
}

func (b *delayedReadyBackplane) Publish(ctx context.Context, payload []byte) error {
	b.publishCalls.Add(1)
	if err := ctx.Err(); err != nil {
		return err
	}
	b.mu.Lock()
	connected, onMessage := b.connected, b.onMessage
	b.mu.Unlock()
	if connected && onMessage != nil {
		onMessage(append([]byte(nil), payload...))
	}
	return nil
}

func (b *delayedReadyBackplane) Subscribe(ctx context.Context, onMessage func([]byte), onReady func()) error {
	b.subscribeCalls.Add(1)
	b.mu.Lock()
	b.onMessage, b.onReady = onMessage, onReady
	connected := b.connected
	b.mu.Unlock()
	if connected && onReady != nil {
		onReady()
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-b.closed:
		return rt.ErrBackplaneClosed
	}
}

func (b *delayedReadyBackplane) connect() {
	b.mu.Lock()
	b.connected = true
	onReady := b.onReady
	b.mu.Unlock()
	if onReady != nil {
		onReady()
	}
}

func (b *delayedReadyBackplane) Close() {
	b.closeOnce.Do(func() { close(b.closed) })
}

func newControllableBackplane(down bool) *controllableBackplane {
	return &controllableBackplane{down: down, closed: make(chan struct{})}
}

func (b *controllableBackplane) Publish(ctx context.Context, payload []byte) error {
	b.publishCalls.Add(1)
	if err := ctx.Err(); err != nil {
		return err
	}
	if b.failNextPublish.Swap(false) {
		return errors.New("one-shot Valkey publish failure")
	}
	b.mu.Lock()
	down, onMessage := b.down, b.onMessage
	b.mu.Unlock()
	if down {
		return errors.New("Valkey unavailable")
	}
	if onMessage != nil {
		onMessage(append([]byte(nil), payload...))
	}
	return nil
}

type blockingPublishBackplane struct {
	publishCalls atomic.Int64
	closed       chan struct{}
	closeOnce    sync.Once
}

func newBlockingPublishBackplane() *blockingPublishBackplane {
	return &blockingPublishBackplane{closed: make(chan struct{})}
}

func (b *blockingPublishBackplane) Publish(ctx context.Context, payload []byte) error {
	b.publishCalls.Add(1)
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-b.closed:
		return rt.ErrBackplaneClosed
	}
}

func (b *blockingPublishBackplane) Subscribe(ctx context.Context, onMessage func([]byte), onReady func()) error {
	if onReady != nil {
		onReady()
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-b.closed:
		return rt.ErrBackplaneClosed
	}
}

func (b *blockingPublishBackplane) Close() {
	b.closeOnce.Do(func() { close(b.closed) })
}

func (b *controllableBackplane) Subscribe(ctx context.Context, onMessage func([]byte), onReady func()) error {
	b.subscribeCalls.Add(1)
	b.mu.Lock()
	b.onMessage, b.onReady = onMessage, onReady
	down := b.down
	b.mu.Unlock()
	if !down && onReady != nil {
		onReady()
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-b.closed:
		return rt.ErrBackplaneClosed
	}
}

func (b *controllableBackplane) reconnect() {
	b.mu.Lock()
	b.down = false
	onReady := b.onReady
	b.mu.Unlock()
	if onReady != nil {
		onReady()
	}
}

func (b *controllableBackplane) Close() {
	b.closeOnce.Do(func() { close(b.closed) })
}

func realtimeBackplaneTestOptions(backplane rt.Backplane) ServerOptions {
	return ServerOptions{
		RealtimeBackplane: backplane, RealtimeSpineSafetyInterval: time.Hour,
		DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true,
	}
}

func waitForBackplaneCondition(t *testing.T, condition func() bool, description string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", description)
}

func TestRealtimeBackplaneDeliversAcrossAPITasksThroughExactLocalRegistries(t *testing.T) {
	base := store.NewMemoryRepo()
	userID := "11111111-1111-4111-8111-111111111111"
	repo := &controlledRealtimeAudienceRepo{Repository: base, exists: true, allowed: []string{userID}}
	backplane := rt.NewLocalBackplane()
	first := NewServerWithOptions(repo, realtimeBackplaneTestOptions(backplane))
	second := NewServerWithOptions(repo, realtimeBackplaneTestOptions(backplane))
	defer first.Close()
	defer second.Close()

	companyID := "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	nodeID := "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	scope := realtimeChatScope(nodeID)
	firstConnection := subscribeRecordingRealtimeConnection(t, first, "api-task-1", companyID, userID, scope)
	secondConnection := subscribeRecordingRealtimeConnection(t, second, "api-task-2", companyID, userID, scope)

	enqueueRealtimeEntityTestMessage(t, first, companyID, scope, store.EntityTypeNode, nodeID, store.EntityPermissionEdit,
		map[string]any{"type": "chat.message.created", "message_id": "message-1"},
	)
	waitForBackplaneCondition(t, func() bool {
		return len(firstConnection.messages(t)) == 1 && len(secondConnection.messages(t)) == 1
	}, "both API task deliveries")
	if got := len(firstConnection.messages(t)); got != 1 {
		t.Fatalf("publisher API task deliveries=%d want 1", got)
	}
}

func TestRealtimeBackplaneOutageKeepsDurableEventAndDoesNotPoll(t *testing.T) {
	base := store.NewMemoryRepo()
	userID := "22222222-2222-4222-8222-222222222222"
	audience := &controlledRealtimeAudienceRepo{Repository: base, exists: true, allowed: []string{userID}}
	repo := &countingRealtimeRepository{Repository: audience}
	backplane := newControllableBackplane(true)
	server := NewServerWithOptions(repo, realtimeBackplaneTestOptions(backplane))
	defer server.Close()

	companyID := "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
	nodeID := "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
	scope := realtimeChatScope(nodeID)
	connection := subscribeRecordingRealtimeConnection(t, server, "outage", companyID, userID, scope)

	enqueueRealtimeEntityTestMessage(t, server, companyID, scope, store.EntityTypeNode, nodeID, store.EntityPermissionEdit,
		map[string]any{"type": "chat.message.created", "message_id": "durable-during-outage"},
	)
	enqueueRealtimeEntityTestMessage(t, server, companyID, scope, store.EntityTypeNode, nodeID, store.EntityPermissionEdit,
		map[string]any{"type": "chat.message.updated", "message_id": "second-durable-during-outage"},
	)
	waitForBackplaneCondition(t, func() bool { return backplane.publishCalls.Load() >= 1 }, "initial failed broker publish")
	sequence, err := base.CurrentPublishedRealtimeOutboxSequence(context.Background())
	if err != nil || sequence != 0 {
		t.Fatalf("outage published sequence=%d err=%v, want durable unpublished row", sequence, err)
	}

	readsAfterFailure := repo.totalReads()
	time.Sleep(250 * time.Millisecond)
	if got := repo.totalReads(); got-readsAfterFailure > 2 {
		t.Fatalf("outage caused an unbounded realtime DB retry loop: reads %d -> %d", readsAfterFailure, got)
	}

	backplane.reconnect()
	waitForBackplaneCondition(t, func() bool { return len(connection.messages(t)) == 2 }, "all claimed events after Valkey reconnect")
	sequence, err = base.CurrentPublishedRealtimeOutboxSequence(context.Background())
	if err != nil || sequence != 2 {
		t.Fatalf("reconnected published sequence=%d err=%v", sequence, err)
	}
}

func TestRealtimeMutationAcknowledgementsDoNotWaitOrSerializeBehindBrokerOutage(t *testing.T) {
	base := store.NewMemoryRepo()
	backplane := newBlockingPublishBackplane()
	server := NewServerWithOptions(base, realtimeBackplaneTestOptions(backplane))
	defer server.Close()

	const producers = 24
	companyID := "29292929-2929-4292-8292-292929292929"
	scope := realtimeNotificationScope("30303030-3030-4303-8303-303030303030")
	start := time.Now()
	done := make(chan struct{}, producers)
	for index := range producers {
		go func(index int) {
			enqueueRealtimeTestMessage(t, server, companyID, scope, map[string]any{"type": "outage.ack", "index": index})
			done <- struct{}{}
		}(index)
	}
	for range producers {
		select {
		case <-done:
		case <-time.After(500 * time.Millisecond):
			t.Fatal("mutation acknowledgement serialized behind broker I/O")
		}
	}
	if elapsed := time.Since(start); elapsed > 500*time.Millisecond {
		t.Fatalf("all mutation acknowledgements took %s, want under 500ms while publish is blocked", elapsed)
	}
	waitForBackplaneCondition(t, func() bool { return backplane.publishCalls.Load() == 1 }, "one lifecycle-owned blocked publish")
}

func TestRealtimePublishFailureRetriesWhileSubscriptionRemainsHealthy(t *testing.T) {
	base := store.NewMemoryRepo()
	backplane := newControllableBackplane(false)
	server := NewServerWithOptions(base, realtimeBackplaneTestOptions(backplane))
	defer server.Close()
	companyID := "33333333-3333-4333-8333-333333333330"
	scope := realtimeNotificationScope("33333333-3333-4333-8333-333333333331")
	connection := subscribeRecordingRealtimeConnection(t, server, "healthy-subscribe-publish-failure", companyID, "33333333-3333-4333-8333-333333333332", scope)

	// The subscription goroutine is already ready and remains connected. Only
	// PUBLISH fails, so recovery must come from the controlled publish scheduler.
	backplane.mu.Lock()
	backplane.down = true
	backplane.mu.Unlock()
	enqueueRealtimeTestMessage(t, server, companyID, scope, map[string]any{"type": "publish.retry"})
	waitForBackplaneCondition(t, func() bool { return backplane.publishCalls.Load() == 1 }, "failed publish on a healthy subscription")
	backplane.mu.Lock()
	backplane.down = false
	backplane.mu.Unlock()
	waitForBackplaneCondition(t, func() bool { return len(connection.messages(t)) == 1 }, "timer-owned publish retry without subscriber reconnect")
	if calls := backplane.publishCalls.Load(); calls != 2 {
		t.Fatalf("publish calls=%d want one failure and one bounded retry", calls)
	}
}

func TestRealtimeCanceledPublishReleasesClaimWithServerLifecycleContext(t *testing.T) {
	base := store.NewMemoryRepo()
	backplane := newBlockingPublishBackplane()
	options := realtimeBackplaneTestOptions(backplane)
	options.DisableRealtimeSpine = true
	server := NewServerWithOptions(base, options)
	defer server.Close()
	_, err := base.EnqueueRealtimeOutbox(context.Background(), store.RealtimeOutboxInput{
		EventID: "34343434-3434-4343-8343-343434343434", CompanyID: "35353535-3535-4353-8353-353535353535",
		Scope: "notifications:canceled", EventType: "publish.canceled", Payload: json.RawMessage(`{"type":"publish.canceled"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	requestCtx, cancelRequest := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		server.publishPendingRealtimeOutbox(requestCtx)
		close(done)
	}()
	waitForBackplaneCondition(t, func() bool { return backplane.publishCalls.Load() == 1 }, "request-owned publish attempt")
	cancelRequest()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("canceled publish did not return")
	}
	claimed, err := base.ClaimRealtimeOutbox(context.Background(), store.RealtimeOutboxClaimQuery{Limit: 1, LeaseDuration: time.Minute})
	if err != nil || len(claimed) != 1 {
		t.Fatalf("claim after canceled publish: count=%d err=%v; lifecycle cleanup did not release lease", len(claimed), err)
	}
}

func enqueueRealtimeBatchFixtures(t *testing.T, repo *store.MemoryRepo, count int, published bool) {
	t.Helper()
	companyID := "31313131-3131-4313-8313-313131313131"
	for index := 1; index <= count; index++ {
		_, err := repo.EnqueueRealtimeOutbox(context.Background(), store.RealtimeOutboxInput{
			EventID: fmt.Sprintf("32323232-3232-4323-8323-%012d", index), CompanyID: companyID,
			Scope: "notifications:batch", EventType: "batch.event", Payload: json.RawMessage(`{"type":"batch.event"}`),
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if !published {
		return
	}
	remaining := count
	for remaining > 0 {
		claimed, err := repo.ClaimRealtimeOutbox(context.Background(), store.RealtimeOutboxClaimQuery{Limit: realtimeSpineBatchLimit, LeaseDuration: time.Minute})
		if err != nil || len(claimed) == 0 {
			t.Fatalf("claim published fixtures: count=%d err=%v", len(claimed), err)
		}
		for _, event := range claimed {
			if err := repo.MarkRealtimeOutboxPublished(context.Background(), event.EventID, event.ClaimToken); err != nil {
				t.Fatal(err)
			}
		}
		remaining -= len(claimed)
	}
}

func TestRealtimePublisherChainsBoundedPassAfterFourFullBatches(t *testing.T) {
	base := store.NewMemoryRepo()
	repo := &countingRealtimeRepository{Repository: base}
	server := NewServerWithOptions(repo, realtimeBackplaneTestOptions(rt.NewLocalBackplane()))
	defer server.Close()
	time.Sleep(50 * time.Millisecond)
	baselineClaims := repo.claimCalls.Load()

	enqueueRealtimeBatchFixtures(t, base, 401, false)
	server.wakeRealtimeSpine()
	waitForBackplaneCondition(t, func() bool {
		sequence, err := base.CurrentPublishedRealtimeOutboxSequence(context.Background())
		return err == nil && sequence == 401
	}, "401 events published from one initial wake plus chained bounded pass")
	if calls := repo.claimCalls.Load() - baselineClaims; calls < 5 || calls > 6 {
		t.Fatalf("publisher claim calls=%d want five bounded batches (allowing one coalesced empty wake)", calls)
	}
}

func TestRealtimeBootstrapRetriesOnlyCursorBeforeStartingLoops(t *testing.T) {
	base := store.NewMemoryRepo()
	enqueueRealtimeBatchFixtures(t, base, 401, true)
	repo := &failingRealtimeBootstrapRepository{Repository: base, failures: 2, blockFailures: true}
	backplane := newControllableBackplane(false)
	options := realtimeBackplaneTestOptions(backplane)
	options.RealtimeSpineStorageTimeout = 50 * time.Millisecond
	server := NewServerWithOptions(repo, options)
	defer server.Close()

	_, err := base.EnqueueRealtimeOutbox(context.Background(), store.RealtimeOutboxInput{
		EventID: "39393939-3939-4393-8393-393939393939", CompanyID: "40404040-4040-4404-8404-404040404040",
		Scope: "notifications:bootstrap", EventType: "bootstrap.pending", Payload: json.RawMessage(`{"type":"bootstrap.pending"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	server.wakeRealtimeSpine()

	waitForBackplaneCondition(t, func() bool { return repo.currentCalls.Load() == 1 }, "first initial cursor attempt")
	time.Sleep(75 * time.Millisecond)
	if calls := repo.currentCalls.Load(); calls != 1 {
		t.Fatalf("initial cursor retried without bounded delay: calls=%d", calls)
	}
	waitForBackplaneCondition(t, func() bool { return repo.currentCalls.Load() == 2 }, "second bounded initial cursor attempt")
	time.Sleep(100 * time.Millisecond)
	if calls := repo.currentCalls.Load(); calls != 2 {
		t.Fatalf("second initial cursor retry was not backed off: calls=%d", calls)
	}
	if claims, lists, subscribes, publishes := repo.claimCalls.Load(), repo.listCalls.Load(), backplane.subscribeCalls.Load(), backplane.publishCalls.Load(); claims != 0 || lists != 0 || subscribes != 0 || publishes != 0 {
		t.Fatalf("uncertified cursor started realtime loops: claims=%d lists=%d subscribes=%d publishes=%d", claims, lists, subscribes, publishes)
	}

	waitForBackplaneCondition(t, func() bool {
		sequence, sequenceErr := base.CurrentPublishedRealtimeOutboxSequence(context.Background())
		return sequenceErr == nil && sequence == 402 && backplane.publishCalls.Load() == 1
	}, "certified bootstrap and pending durable event drain")
	if calls := repo.currentCalls.Load(); calls != 3 {
		t.Fatalf("initial cursor calls=%d want two failures and one success", calls)
	}
	if lists := repo.listCalls.Load(); lists > 2 {
		t.Fatalf("bootstrap replayed retained history after cursor certification: list calls=%d", lists)
	}
}

func publishRealtimeFixtureFromOtherTask(t *testing.T, repo *store.MemoryRepo, backplane rt.Backplane, input store.RealtimeOutboxInput) store.RealtimeOutboxEvent {
	t.Helper()
	event, err := repo.EnqueueRealtimeOutbox(context.Background(), input)
	if err != nil {
		t.Fatalf("enqueue other-task realtime event: %v", err)
	}
	payload, err := json.Marshal(newRealtimeBackplaneEvent(event))
	if err != nil {
		t.Fatalf("marshal other-task realtime event: %v", err)
	}
	if err := backplane.Publish(context.Background(), payload); err != nil {
		t.Fatalf("publish other-task realtime event: %v", err)
	}
	claimed, err := repo.ClaimRealtimeOutbox(context.Background(), store.RealtimeOutboxClaimQuery{Limit: 1, LeaseDuration: time.Minute})
	if err != nil || len(claimed) != 1 || claimed[0].EventID != event.EventID {
		t.Fatalf("claim other-task realtime event: event_id=%s count=%d err=%v", event.EventID, len(claimed), err)
	}
	if err := repo.MarkRealtimeOutboxPublished(context.Background(), claimed[0].EventID, claimed[0].ClaimToken); err != nil {
		t.Fatalf("mark other-task realtime event published: %v", err)
	}
	return event
}

func TestRealtimeAdmissionWaitsForCertifiedCursorAndRecoversAfterSubscriberReady(t *testing.T) {
	base := store.NewMemoryRepo()
	companyID := "50505050-5050-4050-8050-505050505050"
	base.EnsureCompany(companyID, "Realtime bootstrap admission")
	user := mustRealtimeAuthUser(t, base, companyID, "realtime-bootstrap-admission", domain.RoleCompanyUser)
	token := "realtime-bootstrap-admission-token"
	actor := ActorContext{
		Claims: auth.Claims{Subject: user.CognitoSubject, Email: user.Email, Name: user.DisplayName},
		User:   user,
		Memberships: []domain.CompanyMembership{{
			CompanyID: companyID, UserID: user.UserID, Role: domain.RoleCompanyUser,
		}},
	}

	allowCurrent := make(chan struct{})
	repo := &gatedRealtimeBootstrapRepository{Repository: base, allowCurrent: allowCurrent}
	backplane := newDelayedReadyBackplane()
	options := realtimeBackplaneTestOptions(backplane)
	options.RealtimeSpineStorageTimeout = 25 * time.Millisecond
	options.AuthValidator = &tokenClaimsValidator{claims: map[string]auth.Claims{token: actor.Claims}}
	server := NewServerWithOptions(repo, options)
	defer server.Close()
	handler := server.Routes()

	scope := realtimeNotificationScope(user.UserID)
	first := publishRealtimeFixtureFromOtherTask(t, base, backplane, store.RealtimeOutboxInput{
		EventID: "51515151-5151-4151-8151-515151515151", CompanyID: companyID,
		Scope: scope, EventType: "bootstrap.before_cursor", ResourceRevision: 1,
		AllowedUserIDs: []string{user.UserID}, AudienceRestricted: true,
		Payload: json.RawMessage(`{"type":"bootstrap.before_cursor","scope":"` + scope + `"}`),
	})
	if first.Sequence != 1 {
		t.Fatalf("other-task pre-cursor sequence=%d want 1", first.Sequence)
	}

	ticketRequest := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/v1/realtime/ticket", strings.NewReader(`{"company_id":"`+companyID+`"}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}
	beforeReadyTicket := ticketRequest()
	if beforeReadyTicket.Code != http.StatusServiceUnavailable || beforeReadyTicket.Header().Get("Retry-After") != "1" || !strings.Contains(beforeReadyTicket.Body.String(), "realtime_not_ready") {
		t.Fatalf("uncertified ticket response status=%d retry_after=%q body=%s", beforeReadyTicket.Code, beforeReadyTicket.Header().Get("Retry-After"), beforeReadyTicket.Body.String())
	}
	if cookies := beforeReadyTicket.Header().Values("Set-Cookie"); len(cookies) != 0 {
		t.Fatalf("uncertified ticket response minted cookies: %v", cookies)
	}

	preexistingTicket, _ := server.realtimeTickets.mint(actor, companyID)
	preexistingCookie := &http.Cookie{Name: realtimeTicketCookieName, Value: preexistingTicket}
	conn, _, response := openRealtimeHandshakeForTestWithCookie(t, handler, "/v1/realtime/ws?company_id="+companyID, "", preexistingCookie)
	body, _ := io.ReadAll(response.Body)
	_ = response.Body.Close()
	_ = conn.Close()
	if response.StatusCode != http.StatusServiceUnavailable || response.Header.Get("Retry-After") != "1" || !strings.Contains(string(body), "realtime_not_ready") {
		t.Fatalf("uncertified websocket response status=%d retry_after=%q body=%s", response.StatusCode, response.Header.Get("Retry-After"), string(body))
	}
	if connections := server.realtimeRegistry.connectionCount(); connections != 0 {
		t.Fatalf("uncertified websocket registered connections=%d want 0", connections)
	}

	close(allowCurrent)
	waitForBackplaneCondition(t, func() bool {
		return server.realtimeAdmissionReady() && backplane.subscribeCalls.Load() == 1
	}, "certified cursor, started spine, and pending subscriber")
	server.realtimeSpineMu.Lock()
	certifiedCursor := server.realtimeSpineCursor
	server.realtimeSpineMu.Unlock()
	if certifiedCursor != first.Sequence {
		t.Fatalf("certified cursor=%d want pre-admission event sequence %d", certifiedCursor, first.Sequence)
	}

	afterReadyTicket := ticketRequest()
	if afterReadyTicket.Code != http.StatusOK || len(afterReadyTicket.Header().Values("Set-Cookie")) != 1 {
		t.Fatalf("ready ticket response status=%d cookies=%v body=%s", afterReadyTicket.Code, afterReadyTicket.Header().Values("Set-Cookie"), afterReadyTicket.Body.String())
	}

	client := openRealtimeWebSocketWithCookieForTest(t, handler, "/v1/realtime/ws?company_id="+companyID, preexistingCookie)
	defer client.close()
	ready := client.readJSON(t)
	if ready["type"] != realtimeMessageReady {
		t.Fatalf("ready websocket message=%+v", ready)
	}
	client.writeJSON(t, map[string]any{"type": realtimeMessageSubscribe, "scope": scope})
	accepted := client.readJSON(t)
	if accepted["type"] != realtimeMessageSubscriptionAccepted || accepted["scope"] != scope {
		t.Fatalf("subscription response=%+v", accepted)
	}

	second := publishRealtimeFixtureFromOtherTask(t, base, backplane, store.RealtimeOutboxInput{
		EventID: "52525252-5252-4252-8252-525252525252", CompanyID: companyID,
		Scope: scope, EventType: "bootstrap.after_cursor", ResourceRevision: 2,
		AllowedUserIDs: []string{user.UserID}, AudienceRestricted: true,
		Payload: json.RawMessage(`{"type":"bootstrap.after_cursor","scope":"` + scope + `"}`),
	})
	if second.Sequence != first.Sequence+1 {
		t.Fatalf("other-task post-cursor sequence=%d want %d", second.Sequence, first.Sequence+1)
	}
	backplane.connect()
	recovered := client.readJSON(t)
	if recovered["type"] != "bootstrap.after_cursor" || recovered["scope"] != scope {
		t.Fatalf("post-cursor recovery message=%+v", recovered)
	}
	client.assertNoMessage(t)
}

func TestRealtimeBlockedRecoveryIsBoundedAndRetriesOnce(t *testing.T) {
	base := store.NewMemoryRepo()
	enqueueRealtimeBatchFixtures(t, base, 100, true)
	repo := &blockingRealtimeRecoveryRepository{
		Repository: base, listStarted: make(chan struct{}), listTimedOut: make(chan struct{}),
	}
	backplane := newControllableBackplane(false)
	options := realtimeBackplaneTestOptions(backplane)
	options.RealtimeSpineStorageTimeout = 150 * time.Millisecond
	server := NewServerWithOptions(repo, options)
	defer server.Close()

	companyID := "41414141-4141-4414-8414-414141414141"
	userID := "42424242-4242-4424-8424-424242424242"
	scope := realtimeNotificationScope(userID)
	connection := subscribeRecordingRealtimeConnection(t, server, "blocked-recovery", companyID, userID, scope)
	select {
	case <-repo.listStarted:
	case <-time.After(time.Second):
		t.Fatal("initial recovery list did not start")
	}

	first, err := base.EnqueueRealtimeOutbox(context.Background(), store.RealtimeOutboxInput{
		EventID: "43434343-4343-4434-8434-434343434343", CompanyID: companyID,
		Scope: scope, EventType: "bootstrap.first", Payload: json.RawMessage(`{"type":"bootstrap.first"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	claimed, err := base.ClaimRealtimeOutbox(context.Background(), store.RealtimeOutboxClaimQuery{Limit: 1, LeaseDuration: time.Minute})
	if err != nil || len(claimed) != 1 || claimed[0].EventID != first.EventID {
		t.Fatalf("claim first recovery event: count=%d err=%v", len(claimed), err)
	}
	if err := base.MarkRealtimeOutboxPublished(context.Background(), claimed[0].EventID, claimed[0].ClaimToken); err != nil {
		t.Fatal(err)
	}

	ackStarted := time.Now()
	_, err = server.enqueueRealtimeOutboxAndWake(context.Background(), store.RealtimeOutboxInput{
		EventID: "44444444-4444-4444-8444-444444444445", CompanyID: companyID,
		Scope: scope, EventType: "bootstrap.second", Payload: json.RawMessage(`{"type":"bootstrap.second"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(ackStarted); elapsed >= 100*time.Millisecond {
		t.Fatalf("durable enqueue waited for blocked recovery: %s", elapsed)
	}

	select {
	case <-repo.listTimedOut:
	case <-time.After(time.Second):
		t.Fatal("blocked recovery ignored its storage deadline")
	}
	time.Sleep(75 * time.Millisecond)
	if calls := repo.listCalls.Load(); calls != 1 {
		t.Fatalf("blocked recovery hot-looped before retry deadline: calls=%d", calls)
	}
	waitForBackplaneCondition(t, func() bool {
		server.realtimeSpineMu.Lock()
		cursor := server.realtimeSpineCursor
		server.realtimeSpineMu.Unlock()
		return cursor == 102 && len(connection.messages(t)) == 2
	}, "bounded recovery retry and ordered pending delivery")
	if calls := repo.listCalls.Load(); calls < 2 || calls > 3 {
		t.Fatalf("recovery list calls=%d want one timeout and one bounded retry", calls)
	}
	messages := connection.messages(t)
	if messages[0]["type"] != "bootstrap.first" || messages[1]["type"] != "bootstrap.second" {
		t.Fatalf("recovery order=%+v", messages)
	}
}

func TestRealtimeClaimFailureSchedulesOneBoundedPublishRetry(t *testing.T) {
	base := store.NewMemoryRepo()
	_, err := base.EnqueueRealtimeOutbox(context.Background(), store.RealtimeOutboxInput{
		EventID: "45454545-4545-4454-8454-454545454545", CompanyID: "46464646-4646-4464-8464-464646464646",
		Scope: "notifications:claim-retry", EventType: "claim.retry", Payload: json.RawMessage(`{"type":"claim.retry"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	repo := &failingRealtimeClaimRepository{Repository: base, claimFailures: 1}
	backplane := newControllableBackplane(false)
	server := NewServerWithOptions(repo, realtimeBackplaneTestOptions(backplane))
	defer server.Close()

	waitForBackplaneCondition(t, func() bool { return repo.claimCalls.Load() == 1 }, "initial failed outbox claim")
	time.Sleep(75 * time.Millisecond)
	if calls := repo.claimCalls.Load(); calls != 1 {
		t.Fatalf("claim failure hot-looped before retry deadline: calls=%d", calls)
	}
	waitForBackplaneCondition(t, func() bool {
		sequence, sequenceErr := base.CurrentPublishedRealtimeOutboxSequence(context.Background())
		return sequenceErr == nil && sequence == 1
	}, "pending event publication after claim retry")
	if calls := repo.claimCalls.Load(); calls != 2 {
		t.Fatalf("claim calls=%d want one failure and one scheduled retry", calls)
	}
}

func TestRealtimeIncompleteClaimReleaseRetriesAfterLeaseExpiry(t *testing.T) {
	base := store.NewMemoryRepo()
	_, err := base.EnqueueRealtimeOutbox(context.Background(), store.RealtimeOutboxInput{
		EventID: "47474747-4747-4474-8474-474747474747", CompanyID: "48484848-4848-4484-8484-484848484848",
		Scope: "notifications:lease-retry", EventType: "lease.retry", Payload: json.RawMessage(`{"type":"lease.retry"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	repo := &failingRealtimeClaimRepository{Repository: base, failRelease: true}
	backplane := newControllableBackplane(false)
	backplane.failNextPublish.Store(true)
	options := realtimeBackplaneTestOptions(backplane)
	options.RealtimeSpineClaimLease = 250 * time.Millisecond
	server := NewServerWithOptions(repo, options)
	defer server.Close()

	waitForBackplaneCondition(t, func() bool { return backplane.publishCalls.Load() == 1 && repo.releaseCalls.Load() == 1 }, "failed publish and incomplete claim release")
	for range 10 {
		server.wakeRealtimeSpine()
	}
	time.Sleep(150 * time.Millisecond)
	if calls := repo.claimCalls.Load(); calls != 1 {
		t.Fatalf("producer wakes bypassed lease-safe retry deadline: claim calls=%d", calls)
	}
	waitForBackplaneCondition(t, func() bool {
		sequence, sequenceErr := base.CurrentPublishedRealtimeOutboxSequence(context.Background())
		return sequenceErr == nil && sequence == 1 && backplane.publishCalls.Load() == 2
	}, "publish retry after unreleased claim lease expiry")
	if calls := repo.claimCalls.Load(); calls != 2 {
		t.Fatalf("claim calls=%d want initial lease plus one post-expiry retry", calls)
	}
}

func TestRealtimeRecoveryChainsBoundedPassAfterFourFullBatches(t *testing.T) {
	base := store.NewMemoryRepo()
	repo := &countingRealtimeRepository{Repository: base}
	server := NewServerWithOptions(repo, realtimeBackplaneTestOptions(rt.NewLocalBackplane()))
	defer server.Close()
	time.Sleep(50 * time.Millisecond)
	baselineLists := repo.listCalls.Load()

	enqueueRealtimeBatchFixtures(t, base, 401, true)
	server.signalRealtimeRecovery()
	waitForBackplaneCondition(t, func() bool {
		server.realtimeSpineMu.Lock()
		defer server.realtimeSpineMu.Unlock()
		return server.realtimeSpineCursor == 401
	}, "401 published events recovered from one signal plus chained bounded pass")
	if calls := repo.listCalls.Load() - baselineLists; calls < 5 || calls > 6 {
		t.Fatalf("recovery list calls=%d want five bounded batches (allowing one coalesced empty recovery)", calls)
	}
}

func TestIdleAPITaskCountDoesNotMultiplyRealtimeOutboxQueries(t *testing.T) {
	base := store.NewMemoryRepo()
	repo := &countingRealtimeRepository{Repository: base}
	servers := make([]*Server, 0, 4)
	for range 4 {
		server := NewServerWithOptions(repo, realtimeBackplaneTestOptions(rt.NewLocalBackplane()))
		servers = append(servers, server)
	}
	defer func() {
		for _, server := range servers {
			server.Close()
		}
	}()

	// Initial cursor and subscription-ready recovery are bounded startup work.
	time.Sleep(150 * time.Millisecond)
	startupReads := repo.totalReads()
	time.Sleep(300 * time.Millisecond)
	if got := repo.totalReads(); got != startupReads {
		t.Fatalf("four idle API tasks queried realtime_outbox after startup: reads %d -> %d", startupReads, got)
	}
	if repo.currentCalls.Load() != int64(len(servers)) {
		t.Fatalf("startup cursor reads=%d want exactly one per API task", repo.currentCalls.Load())
	}
}

func TestRealtimeBackplaneGapOrderingAndEventRevisionDeduplication(t *testing.T) {
	base := store.NewMemoryRepo()
	userID := "33333333-3333-4333-8333-333333333333"
	repo := &controlledRealtimeAudienceRepo{Repository: base, exists: true, allowed: []string{userID}}
	options := realtimeBackplaneTestOptions(nil)
	options.DisableRealtimeSpine = true
	server := NewServerWithOptions(repo, options)
	defer server.Close()

	companyID := "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
	nodeID := "ffffffff-ffff-4fff-8fff-ffffffffffff"
	scope := realtimeChatScope(nodeID)
	connection := subscribeRecordingRealtimeConnection(t, server, "ordered", companyID, userID, scope)
	first := enqueueRealtimeRetryTestEvent(t, base, companyID, scope, nodeID, "44444444-4444-4444-8444-444444444444")
	second := enqueueRealtimeRetryTestEvent(t, base, companyID, scope, nodeID, "55555555-5555-4555-8555-555555555555")

	server.acceptRealtimeOutboxEvent(context.Background(), second)
	if server.realtimeSpineCursor != 0 || len(connection.messages(t)) != 0 {
		t.Fatal("gap event crossed the missing sequence")
	}
	server.acceptRealtimeOutboxEvent(context.Background(), first)
	if server.realtimeSpineCursor != second.Sequence || len(connection.messages(t)) != 2 {
		t.Fatalf("gap recovery cursor=%d deliveries=%d", server.realtimeSpineCursor, len(connection.messages(t)))
	}

	duplicate := first
	duplicate.Sequence = second.Sequence + 1
	server.acceptRealtimeOutboxEvent(context.Background(), duplicate)
	if server.realtimeSpineCursor != duplicate.Sequence || len(connection.messages(t)) != 2 {
		t.Fatalf("event ID/revision duplicate replayed: cursor=%d deliveries=%d", server.realtimeSpineCursor, len(connection.messages(t)))
	}
	distinctRevision := duplicate
	distinctRevision.Sequence++
	distinctRevision.ResourceRevision++
	distinctRevision.Payload = json.RawMessage(`{"type":"chat.message.updated"}`)
	server.acceptRealtimeOutboxEvent(context.Background(), distinctRevision)
	if len(connection.messages(t)) != 3 {
		t.Fatalf("distinct event revision deliveries=%d want 3", len(connection.messages(t)))
	}
}

func TestRealtimeRecoveryCertifiedSequenceGapDeliversNextAndLaterEvents(t *testing.T) {
	companyID := "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
	scope := realtimeNotificationScope("33333333-3333-4333-8333-333333333333")
	makeEvent := func(sequence int64, eventID, eventType string) store.RealtimeOutboxEvent {
		publishedAt := time.Now()
		return store.RealtimeOutboxEvent{
			Sequence: sequence, EventID: eventID, CompanyID: companyID, Scope: scope,
			EventType: eventType, Payload: json.RawMessage(`{"type":"` + eventType + `"}`),
			CreatedTimestamp: time.Now(), PublishedTimestamp: &publishedAt,
		}
	}
	first := makeEvent(102, "77777777-7777-4777-8777-777777777777", "test.next")
	later := makeEvent(104, "88888888-8888-4888-8888-888888888888", "test.later")
	repo := &fixedRealtimeRecoveryRepository{Repository: store.NewMemoryRepo(), events: []store.RealtimeOutboxEvent{first, later}}
	options := realtimeBackplaneTestOptions(nil)
	options.DisableRealtimeSpine = true
	server := NewServerWithOptions(repo, options)
	defer server.Close()
	server.realtimeSpineCursor = 100
	connection := subscribeRecordingRealtimeConnection(t, server, "sequence-gap", companyID, "99999999-9999-4999-8999-999999999999", scope)

	server.acceptRealtimeOutboxEvent(context.Background(), first)
	if server.realtimeSpineCursor != 100 || len(connection.messages(t)) != 0 {
		t.Fatal("broker hint crossed an uncertified sequence gap")
	}
	server.recoverPublishedRealtimeOutbox(context.Background())
	messages := connection.messages(t)
	if server.realtimeSpineCursor != 104 || len(messages) != 2 || messages[0]["type"] != "test.next" || messages[1]["type"] != "test.later" {
		t.Fatalf("certified gap recovery cursor=%d messages=%+v", server.realtimeSpineCursor, messages)
	}
}

func TestRealtimeOutboxRepositoryCallsHonorCanceledContext(t *testing.T) {
	server := NewServerWithOptions(store.NewMemoryRepo(), ServerOptions{DisableRealtimeSpine: true})
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := server.enqueueRealtimeOutboxAndWake(ctx, store.RealtimeOutboxInput{
		CompanyID: "66666666-6666-4666-8666-666666666666", Scope: "notifications:user:test",
		EventType: "notification.created", Payload: json.RawMessage(`{"type":"notification.created"}`),
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("enqueue error=%v want context.Canceled", err)
	}
}
