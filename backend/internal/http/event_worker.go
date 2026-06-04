package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"miraeopus/backend/internal/store"
	"strings"
	"time"
)

const (
	defaultEventWorkerInterval   = 500 * time.Millisecond
	defaultEventWorkerBatchLimit = 25
	maxEventWorkerRetryDelay     = 30 * time.Second
)

func (s *Server) startEventWorker() {
	if s == nil || s.eventWorkerDisabled || s.repo == nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.eventWorkerCancel = cancel
	go s.runEventWorker(ctx)
}

func (s *Server) runEventWorker(ctx context.Context) {
	ticker := time.NewTicker(s.eventWorkerInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, err := s.processAvailableEventRows(ctx, s.eventWorkerBatchLimit); err != nil && !strings.Contains(err.Error(), "context canceled") {
				log.Printf("event worker failed: %v", err)
			}
		}
	}
}

func (s *Server) processAvailableEventRows(ctx context.Context, limit int) (int, error) {
	if s == nil || s.repo == nil {
		return 0, nil
	}
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	rows, err := s.repo.ClaimAvailableEventRows(limit, s.eventWorkerLeaseTimeout)
	if err != nil {
		return 0, err
	}
	s.recordEventRowLag(rows)
	for _, row := range rows {
		if err := ctx.Err(); err != nil {
			return len(rows), err
		}
		if err := s.processEventRow(row); err != nil {
			availableAt := time.Now().UTC().Add(eventWorkerRetryDelay(row.AttemptCount))
			s.recordOperationalMetric("event_worker.retry_count", "", 1, 0)
			if markErr := s.repo.MarkEventRowFailed(row.CompanyID, row.EventID, err.Error(), availableAt); markErr != nil {
				return len(rows), markErr
			}
			continue
		}
		if err := s.repo.MarkEventRowProcessed(row.CompanyID, row.EventID); err != nil {
			return len(rows), err
		}
	}
	return len(rows), nil
}

func (s *Server) recordEventRowLag(rows []store.EventRow) {
	if len(rows) == 0 {
		return
	}
	now := time.Now().UTC()
	var maxLag time.Duration
	for _, row := range rows {
		if row.AvailableAt.IsZero() || row.AvailableAt.After(now) {
			continue
		}
		lag := now.Sub(row.AvailableAt)
		if lag > maxLag {
			maxLag = lag
		}
	}
	s.recordOperationalMetric("event_rows.lag_ms", "", int64(maxLag/time.Millisecond), maxLag)
}

func (s *Server) processEventRow(row store.EventRow) error {
	switch strings.TrimSpace(row.EventType) {
	case store.EventTypeKanbanProjectionDelta:
		return s.processKanbanProjectionDeltaEvent(row)
	case store.EventTypeRacioProjectionDelta:
		return s.processRacioProjectionDeltaEvent(row)
	case store.EventTypeEditorProjectionDelta:
		return s.processEditorProjectionDeltaEvent(row)
	case store.EventTypePermissionChanged:
		return s.processPermissionChangedEvent(row)
	default:
		return fmt.Errorf("unsupported_event_type:%s", row.EventType)
	}
}

func (s *Server) processKanbanProjectionDeltaEvent(row store.EventRow) error {
	payload, err := store.DecodeKanbanProjectionDeltaEventPayload(row)
	if err != nil {
		return err
	}
	if payload.Projection != store.ProjectionNameKanbanBoard {
		return fmt.Errorf("unsupported_projection:%s", payload.Projection)
	}
	if len(payload.Deltas) == 0 {
		return nil
	}
	s.publishProjectionDeltasAsync(payload.Deltas)
	return nil
}

func (s *Server) processRacioProjectionDeltaEvent(row store.EventRow) error {
	payload, err := store.DecodeRacioProjectionDeltaEventPayload(row)
	if err != nil {
		return err
	}
	if payload.Projection != store.ProjectionNameRacioMatrix {
		return fmt.Errorf("unsupported_projection:%s", payload.Projection)
	}
	if len(payload.Deltas) == 0 {
		return nil
	}
	s.publishProjectionDeltasAsync(payload.Deltas)
	return nil
}

func (s *Server) processEditorProjectionDeltaEvent(row store.EventRow) error {
	payload, err := store.DecodeEditorProjectionDeltaEventPayload(row)
	if err != nil {
		return err
	}
	scope := payload.Scope
	if scope == "" {
		scope = realtimeEditorScope(payload.ResourceType, payload.ResourceID)
	}
	if scope == "" || scope != realtimeEditorScope(payload.ResourceType, payload.ResourceID) {
		return fmt.Errorf("unsupported_editor_scope:%s", scope)
	}
	if len(payload.Deltas) == 0 {
		return nil
	}
	message, err := json.Marshal(realtimeEditorProjectionDeltaMessage{
		Type:               realtimeMessageProjectionDelta,
		CompanyID:          row.CompanyID,
		Scope:              scope,
		Sequence:           row.Sequence,
		Projection:         "editor",
		ResourceType:       payload.ResourceType,
		ResourceID:         payload.ResourceID,
		Deltas:             payload.Deltas,
		ProjectedTimestamp: time.Now().UTC(),
	})
	if err != nil {
		return err
	}
	s.realtimeRegistry.publish(row.CompanyID, scope, message)
	return nil
}

func (s *Server) processPermissionChangedEvent(row store.EventRow) error {
	payload, err := store.DecodePermissionChangedEventPayload(row)
	if err != nil {
		return err
	}
	entityType := strings.TrimSpace(payload.EntityType)
	entityID := strings.TrimSpace(payload.EntityID)
	if entityType == "" {
		entityType = strings.TrimSpace(row.ResourceType)
	}
	if entityID == "" {
		entityID = strings.TrimSpace(row.ResourceID)
	}
	switch entityType {
	case store.EntityTypeNode:
		s.revalidateEditorSubscriptionsForResource(row.CompanyID, entityType, entityID)
		s.revalidateWorkspaceSubscriptionsForResource(row.CompanyID, entityType, entityID)
		s.publishRacioPermissionProjectionDeltasAsync(row.CompanyID, entityType, entityID)
		s.publishKanbanPermissionProjectionDeltasAsync(row.CompanyID, entityType, entityID)
		return nil
	case store.EntityTypeLogicGate:
		s.revalidateEditorSubscriptionsForResource(row.CompanyID, entityType, entityID)
		s.revalidateKanbanBoardSubscriptionsForLogicGate(row.CompanyID, entityID)
		s.revalidateWorkspaceSubscriptionsForResource(row.CompanyID, entityType, entityID)
		s.publishRacioPermissionProjectionDeltasAsync(row.CompanyID, entityType, entityID)
		s.publishKanbanPermissionProjectionDeltasAsync(row.CompanyID, entityType, entityID)
		return nil
	default:
		return nil
	}
}

func (s *Server) revalidateWorkspaceSubscriptionsForResource(companyID, resourceType, resourceID string) {
	companyID = strings.TrimSpace(companyID)
	resourceType = strings.TrimSpace(resourceType)
	resourceID = strings.TrimSpace(resourceID)
	if companyID == "" || resourceType == "" || resourceID == "" || s == nil || s.realtimeRegistry == nil {
		return
	}
	for _, item := range s.realtimeRegistry.workspaceScopeConnections(companyID) {
		conn := item.Connection
		scope := strings.TrimSpace(item.Scope)
		if conn == nil || scope == "" {
			continue
		}
		userID := realtimeWorkspaceUserIDFromScope(scope)
		if userID == "" {
			continue
		}
		allowed, err := s.repo.UserHasEffectiveAccess(companyID, userID, resourceType, resourceID, store.EntityPermissionView)
		if err != nil {
			log.Printf("failed to revalidate workspace realtime subscription company_id=%s user_id=%s scope=%s resource_type=%s resource_id=%s: %v", companyID, userID, scope, resourceType, resourceID, err)
			_ = conn.sendJSON(realtimeServerMessage{
				Type:         realtimeMessageSnapshotRefetch,
				CompanyID:    companyID,
				Scope:        scope,
				ResourceType: resourceType,
				ResourceID:   resourceID,
				Reason:       "permission_check_failed",
			})
			s.recordOperationalMetric("realtime.snapshot_refetch_count", realtimeScopeType(scope), 1, 0)
			continue
		}
		if allowed {
			_ = conn.sendJSON(realtimeServerMessage{
				Type:         realtimeMessageSnapshotRefetch,
				CompanyID:    companyID,
				Scope:        scope,
				ResourceType: resourceType,
				ResourceID:   resourceID,
				Reason:       "permission_changed",
			})
			s.recordOperationalMetric("realtime.snapshot_refetch_count", realtimeScopeType(scope), 1, 0)
			continue
		}
		_ = conn.sendJSON(realtimeServerMessage{
			Type:         realtimeMessagePermissionRevoked,
			CompanyID:    companyID,
			Scope:        scope,
			ResourceType: resourceType,
			ResourceID:   resourceID,
			Reason:       "permission_revoked",
		})
		s.recordOperationalMetric("realtime.permission_revoked_count", realtimeScopeType(scope), 1, 0)
	}
}

func (s *Server) revalidateEditorSubscriptionsForResource(companyID, resourceType, resourceID string) {
	companyID = strings.TrimSpace(companyID)
	resourceID = strings.TrimSpace(resourceID)
	scope := realtimeEditorScope(resourceType, resourceID)
	if companyID == "" || resourceID == "" || scope == "" {
		return
	}
	for _, conn := range s.realtimeRegistry.connectionsForScope(companyID, scope) {
		if conn == nil {
			continue
		}
		authorized, _, err := s.authorizeRealtimeSubscription(conn.actor, companyID, scope)
		if err != nil {
			log.Printf("failed to revalidate editor realtime subscription company_id=%s user_id=%s scope=%s: %v", companyID, conn.userID, scope, err)
			_ = conn.sendJSON(realtimeServerMessage{
				Type:      realtimeMessageSnapshotRefetch,
				CompanyID: companyID,
				Scope:     scope,
				Reason:    "permission_check_failed",
			})
			s.recordOperationalMetric("realtime.snapshot_refetch_count", realtimeScopeType(scope), 1, 0)
			continue
		}
		if authorized {
			_ = conn.sendJSON(realtimeServerMessage{
				Type:      realtimeMessageSnapshotRefetch,
				CompanyID: companyID,
				Scope:     scope,
				Reason:    "permission_changed",
			})
			s.recordOperationalMetric("realtime.snapshot_refetch_count", realtimeScopeType(scope), 1, 0)
			continue
		}
		_ = conn.sendJSON(realtimeServerMessage{
			Type:         realtimeMessagePermissionRevoked,
			CompanyID:    companyID,
			Scope:        scope,
			ResourceType: resourceType,
			ResourceID:   resourceID,
			Reason:       "permission_revoked",
		})
		s.recordOperationalMetric("realtime.permission_revoked_count", realtimeScopeType(scope), 1, 0)
		s.realtimeRegistry.unsubscribe(conn.id, companyID, scope)
		s.recordRealtimeActiveSubscriptions()
	}
}

func (s *Server) revalidateKanbanBoardSubscriptionsForLogicGate(companyID, logicGateID string) {
	companyID = strings.TrimSpace(companyID)
	logicGateID = strings.TrimSpace(logicGateID)
	if companyID == "" || logicGateID == "" {
		return
	}
	scope := realtimeBoardScope(store.LogicGateKanbanBoardID(logicGateID))
	for _, conn := range s.realtimeRegistry.connectionsForScope(companyID, scope) {
		if conn == nil {
			continue
		}
		authorized, _, err := s.authorizeRealtimeSubscription(conn.actor, companyID, scope)
		if err != nil {
			log.Printf("failed to revalidate realtime subscription company_id=%s user_id=%s scope=%s: %v", companyID, conn.userID, scope, err)
			_ = conn.sendJSON(realtimeServerMessage{
				Type:      realtimeMessageSnapshotRefetch,
				CompanyID: companyID,
				Scope:     scope,
				Reason:    "permission_check_failed",
			})
			s.recordOperationalMetric("realtime.snapshot_refetch_count", realtimeScopeType(scope), 1, 0)
			continue
		}
		if authorized {
			_ = conn.sendJSON(realtimeServerMessage{
				Type:      realtimeMessageSnapshotRefetch,
				CompanyID: companyID,
				Scope:     scope,
				Reason:    "permission_changed",
			})
			s.recordOperationalMetric("realtime.snapshot_refetch_count", realtimeScopeType(scope), 1, 0)
			continue
		}
		_ = conn.sendJSON(realtimeServerMessage{
			Type:         realtimeMessagePermissionRevoked,
			CompanyID:    companyID,
			Scope:        scope,
			ResourceType: store.EntityTypeLogicGate,
			ResourceID:   logicGateID,
			Reason:       "permission_revoked",
		})
		s.recordOperationalMetric("realtime.permission_revoked_count", realtimeScopeType(scope), 1, 0)
		s.realtimeRegistry.unsubscribe(conn.id, companyID, scope)
		s.recordRealtimeActiveSubscriptions()
	}
}

func eventWorkerRetryDelay(attemptCount int) time.Duration {
	if attemptCount <= 0 {
		return time.Second
	}
	delay := time.Duration(attemptCount) * time.Second
	if delay > maxEventWorkerRetryDelay {
		return maxEventWorkerRetryDelay
	}
	return delay
}
