package httpapi

import (
	"context"
	"encoding/json"
	"log"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"strings"
	"time"
)

const realtimePublicationAuthorizationTimeout = 2 * time.Second

func (s *Server) publishRealtimeMessage(companyID, scope string, message any) int {
	return s.publishRealtimeMessageWithAudience(companyID, scope, nil, message)
}

func realtimeAllowedUserIDs(userIDs []string) map[string]struct{} {
	allowedUserIDs := map[string]struct{}{}
	for _, userID := range userIDs {
		if userID = strings.TrimSpace(userID); userID != "" {
			allowedUserIDs[userID] = struct{}{}
		}
	}
	return allowedUserIDs
}

func realtimeAllowedUserIDList(userIDs map[string]struct{}) []string {
	if userIDs == nil {
		return nil
	}
	allowed := make([]string, 0, len(userIDs))
	for userID := range userIDs {
		if userID = strings.TrimSpace(userID); userID != "" {
			allowed = append(allowed, userID)
		}
	}
	return allowed
}

func (s *Server) publishRealtimeMessageToCurrentEntityAudience(companyID, scope, resourceType, resourceID, permission string, message any) int {
	delivered, _ := s.publishRealtimeMessageToCurrentEntityAudienceResult(companyID, scope, resourceType, resourceID, permission, message)
	return delivered
}

func (s *Server) publishRealtimeMessageToCurrentEntityAudienceResult(companyID, scope, resourceType, resourceID, permission string, message any) (int, error) {
	companyID = strings.TrimSpace(companyID)
	scope = strings.TrimSpace(scope)
	resourceType = strings.TrimSpace(resourceType)
	resourceID = strings.TrimSpace(resourceID)
	permission = strings.TrimSpace(permission)
	if s == nil || companyID == "" || scope == "" || resourceType == "" || resourceID == "" {
		return 0, store.ErrInvalid
	}
	payload, eventType, err := realtimeMessagePayload(message)
	if err != nil {
		return 0, err
	}
	var preauthorized map[string]struct{}
	if s.realtimeRegistry.hasSubscribers(companyID, scope) {
		unlock := s.realtimeRegistry.lockPublishScope(companyID, scope)
		preauthorized, err = s.resolveRealtimeEntityAudienceUnlocked(companyID, scope, resourceType, resourceID, permission)
		unlock()
		if err != nil {
			return 0, err
		}
	}
	_, delivered, err := s.enqueueRealtimeOutboxAndFlush(store.RealtimeOutboxInput{
		CompanyID: companyID, Scope: scope, EventType: eventType, ResourceType: resourceType,
		ResourceID: resourceID, Permission: permission, Payload: payload,
	}, preauthorized)
	return delivered, err
}

func (s *Server) resolveRealtimeEntityAudienceUnlocked(companyID, scope, resourceType, resourceID, permission string) (map[string]struct{}, error) {
	candidateUserIDs := s.realtimeRegistry.scopeUserIDs(companyID, scope)
	ctx, cancel := context.WithTimeout(context.Background(), realtimePublicationAuthorizationTimeout)
	defer cancel()
	exists, userIDs, err := s.repo.ResolveEffectiveUsersForResource(ctx, companyID, resourceType, resourceID, permission, candidateUserIDs)
	if err != nil {
		log.Printf("failed to resolve current realtime audience company_id=%s scope_type=%s scope=%s resource_type=%s resource_id=%s: %v", companyID, realtimeScopeType(scope), scope, resourceType, resourceID, err)
		s.recordOperationalMetric("realtime.publish_authorization_failure_count", realtimeScopeType(scope), 1, 0)
		return nil, err
	}
	if !exists {
		return map[string]struct{}{}, nil
	}
	return realtimeAllowedUserIDs(userIDs), nil
}

func (s *Server) publishRealtimeMessageWithAudience(companyID, scope string, allowedUserIDs map[string]struct{}, message any) int {
	companyID = strings.TrimSpace(companyID)
	scope = strings.TrimSpace(scope)
	if s == nil || companyID == "" || scope == "" {
		return 0
	}
	payload, eventType, err := realtimeMessagePayload(message)
	if err != nil {
		log.Printf("failed to marshal realtime message company_id=%s scope_type=%s: %v", companyID, realtimeScopeType(scope), err)
		return 0
	}
	_, delivered, err := s.enqueueRealtimeOutboxAndFlush(store.RealtimeOutboxInput{
		CompanyID: companyID, Scope: scope, EventType: eventType, Payload: payload,
		AllowedUserIDs: realtimeAllowedUserIDList(allowedUserIDs), AudienceRestricted: allowedUserIDs != nil,
	}, nil)
	if err != nil {
		return 0
	}
	return delivered
}

func realtimeMessagePayload(message any) (json.RawMessage, string, error) {
	payload, err := json.Marshal(message)
	if err != nil {
		return nil, "", err
	}
	var envelope struct {
		Type string `json:"type"`
	}
	_ = json.Unmarshal(payload, &envelope)
	eventType := strings.TrimSpace(envelope.Type)
	if eventType == "" {
		eventType = "realtime.event"
	}
	return payload, eventType, nil
}

// publishRealtimeMessageWithAudienceUnlocked is the final local-registry boundary.
// The caller must hold this exact scope's publication lock. New mutations enqueue
// into the shared outbox; only the shared spine calls this local delivery path.
func (s *Server) publishRealtimeMessageWithAudienceUnlocked(companyID, scope string, allowedUserIDs map[string]struct{}, message any) int {
	payload, _, err := realtimeMessagePayload(message)
	if err != nil {
		return 0
	}
	return s.publishRealtimePayloadWithAudienceUnlocked(companyID, scope, allowedUserIDs, payload)
}

func (s *Server) publishRealtimePayloadWithAudienceUnlocked(companyID, scope string, allowedUserIDs map[string]struct{}, payload []byte) int {
	restrictedAudience := allowedUserIDs != nil
	if restrictedAudience && len(allowedUserIDs) == 0 {
		s.recordOperationalMetric("realtime.publish_skipped_no_authorized_subscribers_count", realtimeScopeType(scope), 1, 0)
		return 0
	}
	if !s.realtimeRegistry.hasSubscribers(companyID, scope) {
		s.recordOperationalMetric("realtime.publish_skipped_no_subscribers_count", realtimeScopeType(scope), 1, 0)
		return 0
	}
	result := realtimePublishResult{}
	if restrictedAudience {
		result = s.realtimeRegistry.publishToUsersUnlocked(companyID, scope, payload, allowedUserIDs)
	} else {
		result = s.realtimeRegistry.publishUnlocked(companyID, scope, payload)
	}
	attempted := result.delivered + result.failed
	if attempted > 0 {
		s.recordOperationalMetric("realtime.delivery_attempt_count", realtimeScopeType(scope), int64(attempted), 0)
	}
	if result.failed > 0 {
		log.Printf("realtime_delivery_failed company_id=%s scope_type=%s scope=%s attempted=%d failed=%d", companyID, realtimeScopeType(scope), scope, attempted, result.failed)
		s.recordOperationalMetric("realtime.delivery_failure_count", realtimeScopeType(scope), int64(result.failed), 0)
		s.recordRealtimeActiveConnections()
		s.recordRealtimeActiveSubscriptions()
	}
	if attempted == 0 {
		metric := "realtime.publish_skipped_no_subscribers_count"
		if restrictedAudience {
			metric = "realtime.publish_skipped_no_authorized_subscribers_count"
		}
		s.recordOperationalMetric(metric, realtimeScopeType(scope), 1, 0)
		return 0
	}
	if result.delivered > 0 {
		s.recordOperationalMetric("realtime.messages_published", realtimeScopeType(scope), int64(result.delivered), 0)
	}
	return result.delivered
}
func nodeChatProjectionDetails(items []domain.NodeProjection, messageID string) (string, bool) {
	messageID = strings.TrimSpace(messageID)
	for _, item := range items {
		if strings.TrimSpace(item.InformationID) != messageID || strings.TrimSpace(item.Type) != "Text block chat" {
			continue
		}
		var payload struct {
			BlockID string `json:"block_id"`
		}
		_ = json.Unmarshal([]byte(item.Information), &payload)
		return strings.TrimSpace(payload.BlockID), true
	}
	return "", false
}
func (s *Server) publishNodeChatCreated(companyID, nodeID, messageID string, item domain.NodeInformation) {
	if s == nil || strings.TrimSpace(item.Type) != "Text block chat" || strings.TrimSpace(companyID) == "" || strings.TrimSpace(nodeID) == "" || strings.TrimSpace(messageID) == "" {
		return
	}
	s.wakeRealtimeSpine()
}

func (s *Server) publishNodeChatDeleted(companyID, nodeID, blockID, messageID string) {
	if s == nil || strings.TrimSpace(companyID) == "" || strings.TrimSpace(nodeID) == "" || strings.TrimSpace(messageID) == "" {
		return
	}
	s.wakeRealtimeSpine()
}

type capturedKanbanDelete struct {
	boardID        string
	allowedUserIDs map[string]struct{} // nil when the surviving board must reauthorize at publication time
}

func (s *Server) captureKanbanBoardsForDeleteTargets(companyID string, targets []store.CompanyExplorerDeleteTargetInput) []capturedKanbanDelete {
	captureAudienceByBoardID := map[string]bool{}
	addBoard := func(boardID string, captureAudience bool) {
		if boardID = strings.TrimSpace(boardID); boardID != "" {
			captureAudienceByBoardID[boardID] = captureAudienceByBoardID[boardID] || captureAudience
		}
	}
	for _, target := range targets {
		switch strings.TrimSpace(target.Kind) {
		case "node":
			rows, err := s.repo.ListKanbanBoardProjectionRowsForNode(companyID, target.ID)
			if err != nil {
				log.Printf("failed to capture board changes before node delete company_id=%s node_id=%s: %v", companyID, target.ID, err)
				continue
			}
			for _, row := range rows {
				addBoard(row.BoardID, false)
			}
		case "logic_gate":
			addBoard(store.LogicGateKanbanBoardID(target.ID), true)
		case "kanban":
			addBoard(target.ID, false)
		}
	}

	captured := make([]capturedKanbanDelete, 0, len(captureAudienceByBoardID))
	for boardID, captureAudience := range captureAudienceByBoardID {
		item := capturedKanbanDelete{boardID: boardID}
		if !captureAudience {
			captured = append(captured, item)
			continue
		}
		scope := realtimeBoardScope(boardID)
		logicGateID := store.LogicGateIDFromKanbanBoardID(boardID)
		if scope == "" || logicGateID == "" || s == nil || s.realtimeRegistry == nil {
			continue
		}
		unlockPublishScope := s.realtimeRegistry.lockPublishScope(companyID, scope)
		if !s.realtimeRegistry.hasSubscribers(companyID, scope) {
			unlockPublishScope()
			continue
		}
		resolved, err := s.resolveRealtimeEntityAudienceUnlocked(companyID, scope, store.EntityTypeLogicGate, logicGateID, store.EntityPermissionEdit)
		if err != nil {
			resolved = map[string]struct{}{}
		}
		item.allowedUserIDs = resolved
		unlockPublishScope()
		captured = append(captured, item)
	}
	return captured
}

func (s *Server) publishCapturedKanbanDeletes(companyID string, captured []capturedKanbanDelete) {
	if s == nil || strings.TrimSpace(companyID) == "" || len(captured) == 0 {
		return
	}
	// The repository transaction already persisted exact-scope delete events,
	// including a pre-delete audience snapshot when the resource ceased to exist.
	s.wakeRealtimeSpine()
}
