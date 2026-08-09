package httpapi

import (
	"context"
	"encoding/json"
	"log"
	"strings"
	"time"
)

const realtimePublicationAuthorizationTimeout = 2 * time.Second

func realtimeAllowedUserIDs(userIDs []string) map[string]struct{} {
	allowedUserIDs := map[string]struct{}{}
	for _, userID := range userIDs {
		if userID = strings.TrimSpace(userID); userID != "" {
			allowedUserIDs[userID] = struct{}{}
		}
	}
	return allowedUserIDs
}

func (s *Server) resolveRealtimeEntityAudienceWithContextUnlocked(parent context.Context, companyID, scope, resourceType, resourceID, permission string) (map[string]struct{}, error) {
	candidateUserIDs := s.realtimeRegistry.scopeUserIDs(companyID, scope)
	ctx, cancel := context.WithTimeout(parent, realtimePublicationAuthorizationTimeout)
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

// publishRealtimePayloadWithAudienceUnlocked is the sole local WebSocket delivery
// boundary. The caller is the shared spine and must hold this scope's publish lock.
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
