package httpapi

import (
	"context"
	"errors"
	"log"
	"miraeopus/backend/internal/store"
	"strings"
	"time"
)

const (
	defaultRealtimeSpinePollInterval = 75 * time.Millisecond
	realtimeSpineBatchLimit          = 100
	realtimeSpineClaimLease          = 15 * time.Second
)

func (s *Server) startRealtimeSpine() {
	if s == nil || s.repo == nil || s.realtimeSpineDisabled || s.realtimeSpineCancel != nil {
		return
	}
	cursor, err := s.repo.CurrentPublishedRealtimeOutboxSequence()
	if err != nil {
		log.Printf("realtime_spine_initial_cursor_failed error_category=%s", realtimeSpineErrorCategory(err))
		cursor = 0
	}
	s.realtimeSpineMu.Lock()
	s.realtimeSpineCursor = cursor
	s.realtimeSpineMu.Unlock()
	ctx, cancel := context.WithCancel(context.Background())
	s.realtimeSpineCancel = cancel
	go s.runRealtimeSpine(ctx)
}

func (s *Server) runRealtimeSpine(ctx context.Context) {
	interval := s.realtimeSpinePollInterval
	if interval <= 0 {
		interval = defaultRealtimeSpinePollInterval
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		s.flushRealtimeSpine(nil)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-s.realtimeSpineWake:
		}
	}
}

// flushRealtimeSpine is shared by the background consumer and the low-latency
// mutation acknowledgement path. The per-instance lock makes its cursor exact,
// so a synchronous local flush never creates a later duplicate delivery.
func (s *Server) flushRealtimeSpine(preauthorized map[string]map[string]struct{}) map[string]int {
	if s == nil || s.repo == nil {
		return map[string]int{}
	}
	s.realtimeSpineMu.Lock()
	defer s.realtimeSpineMu.Unlock()
	return s.flushRealtimeSpineLocked(preauthorized)
}

func (s *Server) flushRealtimeSpineLocked(preauthorized map[string]map[string]struct{}) map[string]int {
	deliveredByEventID := map[string]int{}
	claimed, err := s.repo.ClaimRealtimeOutbox(store.RealtimeOutboxClaimQuery{
		Limit: realtimeSpineBatchLimit, LeaseDuration: realtimeSpineClaimLease,
	})
	if err != nil {
		s.recordOperationalMetric("realtime.outbox_claim_failure_count", "", 1, 0)
		return deliveredByEventID
	}
	for _, event := range claimed {
		if err := s.repo.MarkRealtimeOutboxPublished(event.EventID, event.ClaimToken); err != nil {
			_ = s.repo.MarkRealtimeOutboxFailed(event.EventID, event.ClaimToken, realtimeSpineErrorCategory(err))
			s.recordOperationalMetric("realtime.outbox_publish_failure_count", realtimeScopeType(event.Scope), 1, 0)
			continue
		}
		s.recordOperationalMetric("realtime.outbox_published_count", realtimeScopeType(event.Scope), 1, time.Since(event.CreatedTimestamp))
	}

	for batch := 0; batch < 4; batch++ {
		events, err := s.repo.ListPublishedRealtimeOutboxAfter(s.realtimeSpineCursor, realtimeSpineBatchLimit)
		if err != nil {
			s.recordOperationalMetric("realtime.backplane_consume_failure_count", "", 1, 0)
			return deliveredByEventID
		}
		if len(events) == 0 {
			return deliveredByEventID
		}
		for _, event := range events {
			if s.realtimeSpineRetrySequence == event.Sequence && time.Now().Before(s.realtimeSpineRetryAt) {
				return deliveredByEventID
			}
			outcome := s.deliverRealtimeOutboxEvent(event, preauthorized[event.EventID])
			if outcome.retryable() {
				if s.realtimeSpineRetrySequence == event.Sequence {
					s.realtimeSpineRetryAttempts++
				} else {
					s.realtimeSpineRetrySequence = event.Sequence
					s.realtimeSpineRetryAttempts = 1
				}
				backoff := 50 * time.Millisecond
				for attempt := 1; attempt < s.realtimeSpineRetryAttempts && backoff < 5*time.Second; attempt++ {
					backoff *= 2
				}
				if backoff > 5*time.Second {
					backoff = 5 * time.Second
				}
				s.realtimeSpineRetryAt = time.Now().Add(backoff)
				s.recordOperationalMetric("realtime.backplane_delivery_retry_count", realtimeScopeType(event.Scope), 1, 0)
				if s.realtimeSpineRetryAttempts == 1 || s.realtimeSpineRetryAttempts%5 == 0 {
					log.Printf("realtime_backplane_delivery_retry sequence=%d event_id=%s scope_type=%s attempt=%d category=%s backoff_ms=%d",
						event.Sequence, event.EventID, realtimeScopeType(event.Scope), s.realtimeSpineRetryAttempts, outcome.Category, backoff.Milliseconds())
				}
				return deliveredByEventID
			}
			deliveredByEventID[event.EventID] = outcome.Delivered
			s.realtimeSpineCursor = event.Sequence
			s.realtimeSpineRetrySequence = 0
			s.realtimeSpineRetryAttempts = 0
			s.realtimeSpineRetryAt = time.Time{}
		}
		if len(events) < realtimeSpineBatchLimit {
			return deliveredByEventID
		}
	}
	return deliveredByEventID
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

func (s *Server) enqueueRealtimeOutboxAndFlush(input store.RealtimeOutboxInput, preauthorized map[string]struct{}) (store.RealtimeOutboxEvent, int, error) {
	if s == nil || s.repo == nil {
		return store.RealtimeOutboxEvent{}, 0, store.ErrInvalid
	}
	s.realtimeSpineMu.Lock()
	defer s.realtimeSpineMu.Unlock()
	event, err := s.enqueueRealtimeOutbox(input)
	if err != nil {
		return store.RealtimeOutboxEvent{}, 0, err
	}
	audiences := map[string]map[string]struct{}(nil)
	if preauthorized != nil {
		audiences = map[string]map[string]struct{}{event.EventID: preauthorized}
	}
	return event, s.flushRealtimeSpineLocked(audiences)[event.EventID], nil
}
func (s *Server) enqueueRealtimeOutbox(input store.RealtimeOutboxInput) (store.RealtimeOutboxEvent, error) {
	if s == nil || s.repo == nil {
		return store.RealtimeOutboxEvent{}, store.ErrInvalid
	}
	event, err := s.repo.EnqueueRealtimeOutbox(input)
	if err != nil {
		log.Printf("realtime_outbox_enqueue_failed company_id=%s scope_type=%s error_category=%s", strings.TrimSpace(input.CompanyID), realtimeScopeType(input.Scope), realtimeSpineErrorCategory(err))
		s.recordOperationalMetric("realtime.outbox_enqueue_failure_count", realtimeScopeType(input.Scope), 1, 0)
		return store.RealtimeOutboxEvent{}, err
	}
	s.recordOperationalMetric("realtime.outbox_enqueued_count", realtimeScopeType(input.Scope), 1, 0)
	return event, nil
}

func (s *Server) deliverRealtimeOutboxEvent(event store.RealtimeOutboxEvent, preauthorized map[string]struct{}) realtimeDeliveryOutcome {
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
	if preauthorized != nil {
		audience = preauthorized
	} else if event.AudienceRestricted {
		audience = realtimeAllowedUserIDs(event.AllowedUserIDs)
	} else if strings.TrimSpace(event.ResourceType) != "" && strings.TrimSpace(event.ResourceID) != "" {
		resolved, err := s.resolveRealtimeEntityAudienceUnlocked(companyID, scope, event.ResourceType, event.ResourceID, event.Permission)
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
		return "storage"
	}
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
