package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"math/rand"
	"miraeopus/backend/internal/realtime"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	defaultRealtimeSpineSafetyInterval = 10 * time.Minute
	realtimeSpineBatchLimit            = 100
	realtimeSpineClaimLease            = 15 * time.Second
	realtimeSpinePublishTimeout        = 3 * time.Second
	defaultRealtimeSpineStorageTimeout = 2 * time.Second
	realtimeSpineMaxBatches            = 4
	realtimeSpineMaxPendingGaps        = 1000
)

type realtimeBackplaneEvent struct {
	Sequence           int64           `json:"sequence"`
	EventID            string          `json:"event_id"`
	CompanyID          string          `json:"company_id"`
	Scope              string          `json:"scope"`
	EventType          string          `json:"event_type"`
	ResourceType       string          `json:"resource_type,omitempty"`
	ResourceID         string          `json:"resource_id,omitempty"`
	Permission         string          `json:"permission,omitempty"`
	ResourceRevision   int64           `json:"resource_revision"`
	Payload            json.RawMessage `json:"payload"`
	AllowedUserIDs     []string        `json:"allowed_user_ids,omitempty"`
	AudienceRestricted bool            `json:"audience_restricted,omitempty"`
	CreatedTimestamp   time.Time       `json:"created_timestamp"`
}

func newRealtimeBackplaneEvent(event store.RealtimeOutboxEvent) realtimeBackplaneEvent {
	return realtimeBackplaneEvent{
		Sequence: event.Sequence, EventID: event.EventID, CompanyID: event.CompanyID,
		Scope: event.Scope, EventType: event.EventType, ResourceType: event.ResourceType,
		ResourceID: event.ResourceID, Permission: event.Permission, ResourceRevision: event.ResourceRevision,
		Payload: append(json.RawMessage(nil), event.Payload...), AllowedUserIDs: append([]string(nil), event.AllowedUserIDs...),
		AudienceRestricted: event.AudienceRestricted, CreatedTimestamp: event.CreatedTimestamp.UTC(),
	}
}

func (event realtimeBackplaneEvent) outboxEvent() (store.RealtimeOutboxEvent, error) {
	event.EventID = strings.TrimSpace(event.EventID)
	event.CompanyID = strings.TrimSpace(event.CompanyID)
	event.Scope = strings.TrimSpace(event.Scope)
	event.EventType = strings.TrimSpace(event.EventType)
	if event.Sequence <= 0 || event.EventID == "" || event.CompanyID == "" || event.Scope == "" || event.EventType == "" || event.ResourceRevision < 0 || len(event.Payload) == 0 || !json.Valid(event.Payload) {
		return store.RealtimeOutboxEvent{}, store.ErrInvalid
	}
	return store.RealtimeOutboxEvent{
		Sequence: event.Sequence, EventID: event.EventID, CompanyID: event.CompanyID,
		Scope: event.Scope, EventType: event.EventType, ResourceType: strings.TrimSpace(event.ResourceType),
		ResourceID: strings.TrimSpace(event.ResourceID), Permission: strings.TrimSpace(event.Permission),
		ResourceRevision: event.ResourceRevision, Payload: append(json.RawMessage(nil), event.Payload...),
		AllowedUserIDs: append([]string(nil), event.AllowedUserIDs...), AudienceRestricted: event.AudienceRestricted,
		CreatedTimestamp: event.CreatedTimestamp.UTC(),
	}, nil
}

func (s *Server) startRealtimeSpine() {
	if s == nil || s.repo == nil || s.realtimeSpineDisabled || s.realtimeSpineContext == nil {
		return
	}
	if s.realtimeBackplane == nil {
		return
	}
	ctx := s.realtimeSpineContext
	if err := s.initializeRealtimeSpineCursor(ctx); err == nil {
		s.runInitializedRealtimeSpine(ctx)
		return
	} else if ctx.Err() != nil || errors.Is(err, context.Canceled) {
		return
	} else {
		go s.retryRealtimeSpineBootstrap(ctx, 1, err)
	}
}

func (s *Server) initializeRealtimeSpineCursor(ctx context.Context) error {
	queryCtx, cancel := s.realtimeSpineStorageContext(ctx)
	cursor, err := s.repo.CurrentPublishedRealtimeOutboxSequence(queryCtx)
	cancel()
	if err != nil {
		return err
	}
	s.realtimeSpineMu.Lock()
	s.realtimeSpineCursor = cursor
	s.realtimeSpineMu.Unlock()
	return nil
}

func (s *Server) retryRealtimeSpineBootstrap(ctx context.Context, attempt int, failure error) {
	for ctx.Err() == nil {
		s.recordOperationalMetric("realtime.outbox_initial_cursor_retry_count", "", 1, 0)
		delay := realtimeSpineReconnectDelay(attempt, rand.Int63())
		if attempt == 1 || attempt%5 == 0 {
			log.Printf("realtime_spine_initial_cursor_retry attempt=%d error_category=%s backoff_ms=%d", attempt, realtimeSpineErrorCategory(failure), delay.Milliseconds())
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
		failure = s.initializeRealtimeSpineCursor(ctx)
		if failure == nil {
			s.runInitializedRealtimeSpine(ctx)
			return
		}
		if ctx.Err() != nil || errors.Is(failure, context.Canceled) {
			return
		}
		attempt++
	}
}

func (s *Server) runInitializedRealtimeSpine(ctx context.Context) {
	initialReady := make(chan struct{})
	var initialReadyOnce sync.Once
	go s.runRealtimeSubscriber(ctx, func() {
		initialReadyOnce.Do(func() { close(initialReady) })
		s.realtimeSpineInitialBackplaneReadyOnce.Do(func() { close(s.realtimeSpineInitialBackplaneReady) })
	})
	go s.runRealtimeSpine(ctx)
	// Admission opens after the durable cursor is certified and both lifecycle
	// loops have been launched. It does not wait for broker readiness: the
	// subscriber's on-ready recovery reads forward from this certified cursor.
	s.realtimeSpineReady.Store(true)
	// Local/test subscriptions become ready immediately. A remote Valkey outage
	// never blocks API startup; recovery runs when that subscription reconnects.
	select {
	case <-initialReady:
	case <-time.After(100 * time.Millisecond):
	case <-ctx.Done():
	}
}

func (s *Server) realtimeAdmissionReady() bool {
	return s != nil && s.realtimeSpineReady.Load()
}

func (s *Server) rejectRealtimeAdmissionWhileUnready(w http.ResponseWriter) bool {
	if s.realtimeAdmissionReady() {
		return false
	}
	w.Header().Set("Retry-After", "1")
	writeError(w, http.StatusServiceUnavailable, "realtime_not_ready")
	return true
}

func (s *Server) runRealtimeSubscriber(ctx context.Context, markInitialReady func()) {
	attempt := 0
	for ctx.Err() == nil {
		readyThisAttempt := false
		err := s.realtimeBackplane.Subscribe(ctx, s.queueRealtimeBackplanePayload, func() {
			if !readyThisAttempt {
				readyThisAttempt = true
				attempt = 0
			}
			markInitialReady()
			s.recordOperationalMetric("realtime.backplane_subscriber_ready_count", "", 1, 0)
			s.signalRealtimeRecovery()
			s.wakeRealtimeSpine()
		})
		if ctx.Err() != nil || errors.Is(err, context.Canceled) || errors.Is(err, realtime.ErrBackplaneClosed) {
			return
		}
		attempt++
		s.recordOperationalMetric("realtime.backplane_reconnect_count", "", 1, 0)
		delay := realtimeSpineReconnectDelay(attempt, rand.Int63())
		if attempt == 1 || attempt%5 == 0 {
			log.Printf("realtime_backplane_subscriber_reconnect attempt=%d error_category=%s backoff_ms=%d", attempt, realtimeSpineErrorCategory(err), delay.Milliseconds())
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

func (s *Server) runRealtimeSpine(ctx context.Context) {
	interval := s.realtimeSpineSafetyInterval
	if interval <= 0 {
		interval = defaultRealtimeSpineSafetyInterval
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case payload := <-s.realtimeSpineInbound:
			s.handleRealtimeBackplanePayload(ctx, payload)
		case <-s.realtimeSpineWake:
			s.publishPendingRealtimeOutbox(ctx)
		case <-s.realtimeSpineRecovery:
			s.publishPendingRealtimeOutbox(ctx)
			s.recoverPublishedRealtimeOutbox(ctx)
		case <-ticker.C:
			// This rare bounded safety pass replaces the former 75 ms idle query.
			s.publishPendingRealtimeOutbox(ctx)
			s.recoverPublishedRealtimeOutbox(ctx)
		}
	}
}

func (s *Server) queueRealtimeBackplanePayload(payload []byte) {
	if s == nil {
		return
	}
	copyPayload := append([]byte(nil), payload...)
	select {
	case s.realtimeSpineInbound <- copyPayload:
	default:
		s.recordOperationalMetric("realtime.backplane_inbound_overflow_count", "", 1, 0)
		s.signalRealtimeRecovery()
	}
}

func (s *Server) handleRealtimeBackplanePayload(ctx context.Context, payload []byte) {
	var envelope realtimeBackplaneEvent
	if err := json.Unmarshal(payload, &envelope); err != nil {
		s.recordOperationalMetric("realtime.backplane_invalid_event_count", "", 1, 0)
		return
	}
	event, err := envelope.outboxEvent()
	if err != nil {
		s.recordOperationalMetric("realtime.backplane_invalid_event_count", "", 1, 0)
		return
	}
	// The lifecycle-owned publisher marks durable publication and performs local
	// delivery before this task handles its own broker echo.
	s.realtimeSpinePublishMu.Lock()
	defer s.realtimeSpinePublishMu.Unlock()
	s.acceptRealtimeOutboxEvent(ctx, event)
}

func (s *Server) publishPendingRealtimeOutbox(ctx context.Context) {
	if s == nil || s.repo == nil || s.realtimeBackplane == nil || ctx.Err() != nil {
		return
	}
	s.realtimeSpinePublishMu.Lock()
	defer s.realtimeSpinePublishMu.Unlock()
	if s.realtimePublishRetryBackoffActiveLocked(time.Now()) {
		return
	}
	for batch := 0; batch < realtimeSpineMaxBatches && ctx.Err() == nil; batch++ {
		claimCtx, cancelClaim := s.realtimeSpineStorageContext(ctx)
		claimed, err := s.repo.ClaimRealtimeOutbox(claimCtx, store.RealtimeOutboxClaimQuery{Limit: realtimeSpineBatchLimit, LeaseDuration: s.realtimeSpineClaimLeaseDuration()})
		cancelClaim()
		if err != nil {
			s.recordOperationalMetric("realtime.outbox_claim_failure_count", "", 1, 0)
			s.scheduleRealtimePublishRetryLocked(0)
			return
		}
		if len(claimed) == 0 {
			if s.realtimeSpinePublishRetryAttempts > 0 {
				if s.realtimeSpinePublishLeaseRetryPending {
					s.recordOperationalMetric("realtime.outbox_claim_lease_retry_empty_count", "", 1, 0)
				}
				s.clearRealtimePublishRetryLocked()
			}
			return
		}
		for eventIndex, event := range claimed {
			envelope, err := json.Marshal(newRealtimeBackplaneEvent(event))
			if err != nil {
				markCtx, cancelMark := s.realtimeSpineStorageContext(ctx)
				_ = s.repo.MarkRealtimeOutboxFailed(markCtx, event.EventID, event.ClaimToken, "invalid_event")
				cancelMark()
				continue
			}
			publishCtx, cancel := context.WithTimeout(ctx, realtimeSpinePublishTimeout)
			err = s.realtimeBackplane.Publish(publishCtx, envelope)
			cancel()
			if err != nil {
				released := s.releaseRealtimeOutboxClaims(ctx, claimed[eventIndex:eventIndex+1], realtimeSpineErrorCategory(err))
				released = s.releaseRealtimeOutboxClaims(ctx, claimed[eventIndex+1:], "batch_aborted") && released
				s.recordOperationalMetric("realtime.outbox_publish_failure_count", realtimeScopeType(event.Scope), 1, 0)
				s.realtimeSpinePublishLeaseRetryPending = !released
				minimumDelay := time.Duration(0)
				if !released {
					minimumDelay = s.realtimeSpineClaimLeaseDuration()
				}
				s.scheduleRealtimePublishRetryLocked(minimumDelay)
				// Stop immediately. One lifecycle timer retries this fixed-size batch;
				// later producer wakes cannot bypass its bounded backoff.
				return
			}
			markCtx, cancelMark := s.realtimeSpineStorageContext(ctx)
			err = s.repo.MarkRealtimeOutboxPublished(markCtx, event.EventID, event.ClaimToken)
			cancelMark()
			if err != nil {
				released := s.releaseRealtimeOutboxClaims(ctx, claimed[eventIndex:eventIndex+1], realtimeSpineErrorCategory(err))
				released = s.releaseRealtimeOutboxClaims(ctx, claimed[eventIndex+1:], "batch_aborted") && released
				s.recordOperationalMetric("realtime.outbox_publish_failure_count", realtimeScopeType(event.Scope), 1, 0)
				s.realtimeSpinePublishLeaseRetryPending = !released
				minimumDelay := time.Duration(0)
				if !released {
					minimumDelay = s.realtimeSpineClaimLeaseDuration()
				}
				s.scheduleRealtimePublishRetryLocked(minimumDelay)
				return
			}
			s.clearRealtimePublishRetryLocked()
			s.recordOperationalMetric("realtime.outbox_published_count", realtimeScopeType(event.Scope), 1, time.Since(event.CreatedTimestamp))
			s.acceptRealtimeOutboxEvent(ctx, event)
		}
		if len(claimed) < realtimeSpineBatchLimit {
			return
		}
	}
	if ctx.Err() == nil {
		// A full fourth batch proves more work may remain. Chain one bounded
		// pass through the coalescing wake channel instead of spinning here.
		s.wakeRealtimeSpine()
	}
}

func (s *Server) releaseRealtimeOutboxClaims(ctx context.Context, events []store.RealtimeOutboxEvent, category string) bool {
	if len(events) == 0 {
		return true
	}
	releaseParent := ctx
	if ctx.Err() != nil {
		lifecycle := s.realtimeContext()
		if lifecycle.Err() != nil {
			return false
		}
		releaseParent = lifecycle
	}
	releaseCtx, cancel := s.realtimeSpineStorageContext(releaseParent)
	defer cancel()
	for _, event := range events {
		if releaseCtx.Err() != nil {
			return false
		}
		if err := s.repo.MarkRealtimeOutboxFailed(releaseCtx, event.EventID, event.ClaimToken, category); err != nil {
			return false
		}
	}
	return true
}

func (s *Server) realtimePublishRetryBackoffActiveLocked(now time.Time) bool {
	return !s.realtimeSpinePublishRetryAt.IsZero() && now.Before(s.realtimeSpinePublishRetryAt)
}

func (s *Server) clearRealtimePublishRetryLocked() {
	if s.realtimeSpinePublishRetryTimer != nil {
		s.realtimeSpinePublishRetryTimer.Stop()
		s.realtimeSpinePublishRetryTimer = nil
	}
	s.realtimeSpinePublishRetryGeneration++
	s.realtimeSpinePublishRetryAttempts = 0
	s.realtimeSpinePublishRetryAt = time.Time{}
	s.realtimeSpinePublishLeaseRetryPending = false
}

func (s *Server) scheduleRealtimePublishRetryLocked(minimumDelay time.Duration) {
	s.realtimeSpinePublishRetryAttempts++
	delay := realtimeSpineReconnectDelay(s.realtimeSpinePublishRetryAttempts, rand.Int63())
	if delay < minimumDelay {
		delay = minimumDelay
	}
	s.realtimeSpinePublishRetryAt = time.Now().Add(delay)
	if s.realtimeSpinePublishRetryTimer != nil {
		s.realtimeSpinePublishRetryTimer.Stop()
	}
	s.realtimeSpinePublishRetryGeneration++
	generation := s.realtimeSpinePublishRetryGeneration
	ctx := s.realtimeContext()
	s.realtimeSpinePublishRetryTimer = time.AfterFunc(delay, func() {
		if ctx.Err() != nil {
			return
		}
		s.realtimeSpinePublishMu.Lock()
		ready := generation == s.realtimeSpinePublishRetryGeneration &&
			!time.Now().Before(s.realtimeSpinePublishRetryAt)
		if ready {
			s.realtimeSpinePublishRetryTimer = nil
		}
		s.realtimeSpinePublishMu.Unlock()
		if ready {
			s.wakeRealtimeSpine()
		}
	})
}

func (s *Server) recoverPublishedRealtimeOutbox(ctx context.Context) {
	if s == nil || s.repo == nil || ctx.Err() != nil {
		return
	}
	s.realtimeSpineMu.Lock()
	retryDeferred := s.realtimeSpineRetryBackoffActiveLocked(time.Now())
	recoveryDeferred := s.realtimeRecoveryRetryBackoffActiveLocked(time.Now())
	s.realtimeSpineMu.Unlock()
	if retryDeferred || recoveryDeferred {
		return
	}
	for batch := 0; batch < realtimeSpineMaxBatches && ctx.Err() == nil; batch++ {
		s.realtimeSpineMu.Lock()
		cursor := s.realtimeSpineCursor
		s.realtimeSpineMu.Unlock()
		queryCtx, cancel := s.realtimeSpineStorageContext(ctx)
		events, err := s.repo.ListPublishedRealtimeOutboxAfter(queryCtx, cursor, realtimeSpineBatchLimit)
		cancel()
		if err != nil {
			s.recordOperationalMetric("realtime.backplane_recovery_failure_count", "", 1, 0)
			s.realtimeSpineMu.Lock()
			s.scheduleRealtimeRecoveryRetryLocked()
			s.realtimeSpineMu.Unlock()
			return
		}
		s.realtimeSpineMu.Lock()
		s.clearRealtimeRecoveryRetryLocked()
		s.realtimeSpineMu.Unlock()
		if len(events) == 0 {
			return
		}
		for _, event := range events {
			s.acceptRecoveredRealtimeOutboxEvent(ctx, event)
		}
		if len(events) < realtimeSpineBatchLimit {
			return
		}
	}
	if ctx.Err() == nil {
		s.signalRealtimeRecovery()
	}
}

func (s *Server) acceptRealtimeOutboxEvent(ctx context.Context, event store.RealtimeOutboxEvent) int {
	return s.acceptRealtimeOutboxEventFromSource(ctx, event, false)
}

// A recovery query is allowed to cross unused BIGSERIAL values because the
// repository waits for in-flight outbox writers and returns the next existing
// published rows in indexed sequence order. A broker hint alone cannot prove
// that the apparent gap is not a real unpublished row.
func (s *Server) acceptRecoveredRealtimeOutboxEvent(ctx context.Context, event store.RealtimeOutboxEvent) int {
	return s.acceptRealtimeOutboxEventFromSource(ctx, event, true)
}

func (s *Server) acceptRealtimeOutboxEventFromSource(ctx context.Context, event store.RealtimeOutboxEvent, recoveryCertified bool) int {
	if s == nil || ctx.Err() != nil {
		return 0
	}
	s.realtimeSpineMu.Lock()
	defer s.realtimeSpineMu.Unlock()
	if event.Sequence <= s.realtimeSpineCursor {
		s.recordOperationalMetric("realtime.backplane_duplicate_count", realtimeScopeType(event.Scope), 1, 0)
		return 0
	}
	if s.realtimeSpineRetryBackoffActiveLocked(time.Now()) && event.Sequence >= s.realtimeSpineRetrySequence {
		if len(s.realtimeSpinePending) < realtimeSpineMaxPendingGaps {
			s.realtimeSpinePending[event.Sequence] = event
		}
		return 0
	}
	if event.Sequence > s.realtimeSpineCursor+1 {
		if !recoveryCertified {
			if len(s.realtimeSpinePending) < realtimeSpineMaxPendingGaps {
				s.realtimeSpinePending[event.Sequence] = event
			}
			s.recordOperationalMetric("realtime.backplane_gap_count", realtimeScopeType(event.Scope), 1, 0)
			s.signalRealtimeRecovery()
			return 0
		}
		// The missing values were certified as nonexistent by bounded database
		// recovery, so the next existing published event is contiguous here.
		s.realtimeSpineCursor = event.Sequence - 1
	}
	delete(s.realtimeSpinePending, event.Sequence)
	previousCursor := s.realtimeSpineCursor
	delivered := s.deliverContiguousRealtimeEventLocked(ctx, event)
	if s.realtimeSpineCursor == previousCursor {
		return delivered
	}
	for {
		next, ok := s.realtimeSpinePending[s.realtimeSpineCursor+1]
		if !ok {
			break
		}
		delete(s.realtimeSpinePending, next.Sequence)
		delivered += s.deliverContiguousRealtimeEventLocked(ctx, next)
		if s.realtimeSpineCursor < next.Sequence {
			break
		}
	}
	return delivered
}

func (s *Server) deliverContiguousRealtimeEventLocked(ctx context.Context, event store.RealtimeOutboxEvent) int {
	key := realtimeEventDedupeKey{EventID: event.EventID, ResourceRevision: event.ResourceRevision}
	if s.realtimeSpineDedupe.Seen(key) {
		s.realtimeSpineCursor = event.Sequence
		s.recordOperationalMetric("realtime.backplane_duplicate_count", realtimeScopeType(event.Scope), 1, 0)
		return 0
	}
	deliveryCtx, cancel := s.realtimeSpineStorageContext(ctx)
	outcome := s.deliverRealtimeOutboxEvent(deliveryCtx, event)
	cancel()
	if outcome.retryable() {
		s.realtimeSpinePending[event.Sequence] = event
		s.scheduleRealtimeRecoveryLocked(event, outcome)
		return 0
	}
	s.realtimeSpineDedupe.Add(key)
	s.realtimeSpineCursor = event.Sequence
	s.clearRealtimeSpineRetryLocked()
	return outcome.Delivered
}

func (s *Server) realtimeSpineRetryBackoffActiveLocked(now time.Time) bool {
	return s.realtimeSpineRetrySequence > s.realtimeSpineCursor &&
		!s.realtimeSpineRetryAt.IsZero() && now.Before(s.realtimeSpineRetryAt)
}

func (s *Server) clearRealtimeSpineRetryLocked() {
	if s.realtimeSpineRetryTimer != nil {
		s.realtimeSpineRetryTimer.Stop()
		s.realtimeSpineRetryTimer = nil
	}
	s.realtimeSpineRetryGeneration++
	s.realtimeSpineRetrySequence = 0
	s.realtimeSpineRetryAttempts = 0
	s.realtimeSpineRetryAt = time.Time{}
}

func (s *Server) realtimeRecoveryRetryBackoffActiveLocked(now time.Time) bool {
	return !s.realtimeSpineRecoveryRetryAt.IsZero() && now.Before(s.realtimeSpineRecoveryRetryAt)
}

func (s *Server) clearRealtimeRecoveryRetryLocked() {
	if s.realtimeSpineRecoveryRetryTimer != nil {
		s.realtimeSpineRecoveryRetryTimer.Stop()
		s.realtimeSpineRecoveryRetryTimer = nil
	}
	s.realtimeSpineRecoveryRetryGeneration++
	s.realtimeSpineRecoveryRetryAttempts = 0
	s.realtimeSpineRecoveryRetryAt = time.Time{}
}

func (s *Server) scheduleRealtimeRecoveryRetryLocked() {
	if s.realtimeRecoveryRetryBackoffActiveLocked(time.Now()) {
		return
	}
	s.realtimeSpineRecoveryRetryAttempts++
	delay := realtimeSpineReconnectDelay(s.realtimeSpineRecoveryRetryAttempts, rand.Int63())
	s.realtimeSpineRecoveryRetryAt = time.Now().Add(delay)
	if s.realtimeSpineRecoveryRetryTimer != nil {
		s.realtimeSpineRecoveryRetryTimer.Stop()
	}
	s.realtimeSpineRecoveryRetryGeneration++
	generation := s.realtimeSpineRecoveryRetryGeneration
	ctx := s.realtimeContext()
	s.realtimeSpineRecoveryRetryTimer = time.AfterFunc(delay, func() {
		if ctx.Err() != nil {
			return
		}
		s.realtimeSpineMu.Lock()
		ready := generation == s.realtimeSpineRecoveryRetryGeneration &&
			!time.Now().Before(s.realtimeSpineRecoveryRetryAt)
		if ready {
			s.realtimeSpineRecoveryRetryTimer = nil
		}
		s.realtimeSpineMu.Unlock()
		if ready {
			s.signalRealtimeRecovery()
		}
	})
}

func (s *Server) scheduleRealtimeRecoveryLocked(event store.RealtimeOutboxEvent, outcome realtimeDeliveryOutcome) {
	if s.realtimeSpineRetrySequence == event.Sequence {
		s.realtimeSpineRetryAttempts++
	} else {
		s.realtimeSpineRetrySequence = event.Sequence
		s.realtimeSpineRetryAttempts = 1
	}
	delay := realtimeSpineReconnectDelay(s.realtimeSpineRetryAttempts, rand.Int63())
	s.realtimeSpineRetryAt = time.Now().Add(delay)
	s.recordOperationalMetric("realtime.backplane_delivery_retry_count", realtimeScopeType(event.Scope), 1, 0)
	if s.realtimeSpineRetryAttempts == 1 || s.realtimeSpineRetryAttempts%5 == 0 {
		log.Printf("realtime_backplane_delivery_retry sequence=%d event_id=%s scope_type=%s attempt=%d category=%s backoff_ms=%d", event.Sequence, event.EventID, realtimeScopeType(event.Scope), s.realtimeSpineRetryAttempts, outcome.Category, delay.Milliseconds())
	}
	ctx := s.realtimeSpineContext
	if ctx == nil {
		return
	}
	if s.realtimeSpineRetryTimer != nil {
		s.realtimeSpineRetryTimer.Stop()
	}
	s.realtimeSpineRetryGeneration++
	generation := s.realtimeSpineRetryGeneration
	sequence := event.Sequence
	s.realtimeSpineRetryTimer = time.AfterFunc(delay, func() {
		if ctx.Err() != nil {
			return
		}
		s.realtimeSpineMu.Lock()
		ready := generation == s.realtimeSpineRetryGeneration &&
			sequence == s.realtimeSpineRetrySequence &&
			!time.Now().Before(s.realtimeSpineRetryAt)
		if ready {
			s.realtimeSpineRetryTimer = nil
		}
		s.realtimeSpineMu.Unlock()
		if ready {
			s.signalRealtimeRecovery()
		}
	})
}

func (s *Server) signalRealtimeRecovery() {
	if s == nil || s.realtimeSpineDisabled || s.realtimeSpineRecovery == nil {
		return
	}
	select {
	case s.realtimeSpineRecovery <- struct{}{}:
	default:
	}
}

func (s *Server) wakeRealtimeSpine() {
	if s == nil || s.realtimeSpineDisabled || s.realtimeSpineWake == nil {
		return
	}
	select {
	case s.realtimeSpineWake <- struct{}{}:
	default:
	}
}

// enqueueRealtimeOutboxAndWake is the request-path boundary: the durable row is
// committed before return, while broker publication and local fanout remain
// lifecycle-owned background work. Valkey health therefore cannot delay an API
// acknowledgement.
func (s *Server) enqueueRealtimeOutboxAndWake(ctx context.Context, input store.RealtimeOutboxInput) (store.RealtimeOutboxEvent, error) {
	if s == nil || s.repo == nil {
		return store.RealtimeOutboxEvent{}, store.ErrInvalid
	}
	event, err := s.repo.EnqueueRealtimeOutbox(ctx, input)
	if err != nil {
		log.Printf("realtime_outbox_enqueue_failed company_id=%s scope_type=%s error_category=%s", strings.TrimSpace(input.CompanyID), realtimeScopeType(input.Scope), realtimeSpineErrorCategory(err))
		s.recordOperationalMetric("realtime.outbox_enqueue_failure_count", realtimeScopeType(input.Scope), 1, 0)
		return store.RealtimeOutboxEvent{}, err
	}
	s.recordOperationalMetric("realtime.outbox_enqueued_count", realtimeScopeType(input.Scope), 1, 0)
	s.wakeRealtimeSpine()
	return event, nil
}

func (s *Server) realtimeContext() context.Context {
	if s != nil && s.realtimeSpineContext != nil {
		return s.realtimeSpineContext
	}
	return context.TODO()
}

func (s *Server) realtimeSpineStorageContext(parent context.Context) (context.Context, context.CancelFunc) {
	timeout := s.realtimeSpineStorageTimeout
	if timeout <= 0 {
		timeout = defaultRealtimeSpineStorageTimeout
	}
	return context.WithTimeout(parent, timeout)
}

func (s *Server) realtimeSpineClaimLeaseDuration() time.Duration {
	if s.realtimeSpineClaimLease > 0 {
		return s.realtimeSpineClaimLease
	}
	return realtimeSpineClaimLease
}

func (s *Server) deliverRealtimeOutboxEvent(ctx context.Context, event store.RealtimeOutboxEvent) realtimeDeliveryOutcome {
	companyID, scope := strings.TrimSpace(event.CompanyID), strings.TrimSpace(event.Scope)
	if s == nil || s.realtimeRegistry == nil || companyID == "" || scope == "" {
		return realtimeDeliveryOutcome{Disposition: realtimeDeliveryTerminal, Category: "invalid_or_inactive"}
	}
	unlock := s.realtimeRegistry.lockPublishScope(companyID, scope)
	defer unlock()
	if !s.realtimeRegistry.hasSubscribers(companyID, scope) {
		s.recordOperationalMetric("realtime.publish_skipped_no_subscribers_count", realtimeScopeType(scope), 1, 0)
		return realtimeDeliveryOutcome{Disposition: realtimeDeliveryTerminal, Category: "no_subscribers"}
	}
	var audience map[string]struct{}
	if event.AudienceRestricted {
		audience = realtimeAllowedUserIDs(event.AllowedUserIDs)
	} else if strings.TrimSpace(event.ResourceType) != "" && strings.TrimSpace(event.ResourceID) != "" {
		resolved, err := s.resolveRealtimeEntityAudienceWithContextUnlocked(ctx, companyID, scope, event.ResourceType, event.ResourceID, event.Permission)
		if err != nil {
			s.recordOperationalMetric("realtime.backplane_authorization_failure_count", realtimeScopeType(scope), 1, 0)
			return realtimeDeliveryOutcome{Disposition: realtimeDeliveryRetryable, Category: realtimeSpineErrorCategory(err)}
		}
		audience = resolved
	}
	delivered := s.publishRealtimePayloadWithAudienceUnlocked(companyID, scope, audience, event.Payload)
	s.recordOperationalMetric("realtime.commit_to_fanout_latency", realtimeScopeType(scope), 1, time.Since(event.CreatedTimestamp))
	return realtimeDeliveryOutcome{Delivered: delivered, Disposition: realtimeDeliveryTerminal, Category: "delivered_or_no_authorized_recipient"}
}

func realtimeSpineReconnectDelay(attempt int, random int64) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	base := 250 * time.Millisecond
	for i := 1; i < attempt && base < 30*time.Second; i++ {
		base *= 2
		if base > 30*time.Second {
			base = 30 * time.Second
		}
	}
	if random < 0 {
		random = -random
	}
	// Equal jitter keeps retries spread out while guaranteeing a real pause;
	// full jitter could select zero repeatedly and create a tight retry loop.
	half := base / 2
	return half + time.Duration(random%int64(half+1))
}

func realtimeSpineErrorCategory(err error) string {
	switch {
	case err == nil:
		return "none"
	case errors.Is(err, store.ErrVersionConflict):
		return "claim_conflict"
	case errors.Is(err, context.DeadlineExceeded):
		return "deadline"
	case errors.Is(err, context.Canceled):
		return "canceled"
	default:
		return "storage_or_backplane"
	}
}

type realtimeEventDedupeKey struct {
	EventID          string
	ResourceRevision int64
}

type realtimeEventDeduper struct {
	limit int
	seen  map[realtimeEventDedupeKey]struct{}
	order []realtimeEventDedupeKey
}

func newRealtimeEventDeduper(limit int) *realtimeEventDeduper {
	if limit <= 0 {
		limit = 4096
	}
	return &realtimeEventDeduper{limit: limit, seen: map[realtimeEventDedupeKey]struct{}{}, order: make([]realtimeEventDedupeKey, 0, limit)}
}

func (d *realtimeEventDeduper) Seen(key realtimeEventDedupeKey) bool {
	if d == nil {
		return false
	}
	_, ok := d.seen[key]
	return ok
}

func (d *realtimeEventDeduper) Add(key realtimeEventDedupeKey) {
	if d == nil || d.Seen(key) {
		return
	}
	d.seen[key] = struct{}{}
	d.order = append(d.order, key)
	if len(d.order) <= d.limit {
		return
	}
	delete(d.seen, d.order[0])
	d.order = d.order[1:]
}

type realtimeDeliveryDisposition uint8

const (
	realtimeDeliveryTerminal realtimeDeliveryDisposition = iota
	realtimeDeliveryRetryable
)

type realtimeDeliveryOutcome struct {
	Delivered   int
	Disposition realtimeDeliveryDisposition
	Category    string
}

func (outcome realtimeDeliveryOutcome) retryable() bool {
	return outcome.Disposition == realtimeDeliveryRetryable
}
