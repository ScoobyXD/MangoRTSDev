package httpapi

import (
	"encoding/json"
	"log"
	"miraeopus/backend/internal/store"
	"sort"
	"strings"
	"sync"
	"time"
)

type projectionDeltaEnvelope struct {
	CompanyID          string                  `json:"company_id"`
	Projection         string                  `json:"projection"`
	ProjectionScope    string                  `json:"projection_scope,omitempty"`
	ProjectionSequence int64                   `json:"projection_sequence"`
	Deltas             []store.ProjectionDelta `json:"deltas"`
	ProjectedTimestamp time.Time               `json:"projected_timestamp"`
}

type projectionDeltaHub struct {
	mu          sync.RWMutex
	subscribers map[string]map[chan []byte]struct{}
}

func newProjectionDeltaHub() *projectionDeltaHub {
	return &projectionDeltaHub{subscribers: map[string]map[chan []byte]struct{}{}}
}

func projectionSubscriptionKey(companyID, projection, scope string) string {
	return strings.TrimSpace(companyID) + "|" + strings.TrimSpace(projection) + "|" + strings.TrimSpace(scope)
}

func projectionUserScope(userID string) string {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return ""
	}
	return "user:" + userID
}

func projectionKanbanBoardScopePrefix(boardID string) string {
	boardID = strings.TrimSpace(boardID)
	if boardID == "" {
		return ""
	}
	return "board:" + boardID
}

func projectionKanbanBoardUserScope(boardID, userID string) string {
	prefix := projectionKanbanBoardScopePrefix(boardID)
	userID = strings.TrimSpace(userID)
	if prefix == "" || userID == "" {
		return ""
	}
	return prefix + "|user:" + userID
}

func projectionScopeUserID(scope string) string {
	return strings.TrimPrefix(strings.TrimSpace(scope), "user:")
}

func (h *projectionDeltaHub) subscribe(companyID, projection, scope string) chan []byte {
	ch := make(chan []byte, 24)
	key := projectionSubscriptionKey(companyID, projection, scope)
	h.mu.Lock()
	bucket := h.subscribers[key]
	if bucket == nil {
		bucket = map[chan []byte]struct{}{}
		h.subscribers[key] = bucket
	}
	bucket[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *projectionDeltaHub) unsubscribe(companyID, projection, scope string, ch chan []byte) {
	key := projectionSubscriptionKey(companyID, projection, scope)
	h.mu.Lock()
	if bucket := h.subscribers[key]; bucket != nil {
		delete(bucket, ch)
		if len(bucket) == 0 {
			delete(h.subscribers, key)
		}
	}
	h.mu.Unlock()
	close(ch)
}

func (h *projectionDeltaHub) hasSubscribers(companyID, projection, scope string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.subscribers[projectionSubscriptionKey(companyID, projection, scope)]) > 0
}

func (h *projectionDeltaHub) activeUserIDs(companyID, projection string) []string {
	prefix := strings.TrimSpace(companyID) + "|" + strings.TrimSpace(projection) + "|user:"
	seen := map[string]bool{}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for key, bucket := range h.subscribers {
		if len(bucket) == 0 || !strings.HasPrefix(key, prefix) {
			continue
		}
		userID := strings.TrimSpace(strings.TrimPrefix(key, prefix))
		if userID != "" {
			seen[userID] = true
		}
	}
	userIDs := make([]string, 0, len(seen))
	for userID := range seen {
		userIDs = append(userIDs, userID)
	}
	sort.Strings(userIDs)
	return userIDs
}

func (h *projectionDeltaHub) activeUserIDsForScopePrefix(companyID, projection, scopePrefix string) []string {
	scopePrefix = strings.TrimSpace(scopePrefix)
	if scopePrefix == "" {
		return nil
	}
	prefix := strings.TrimSpace(companyID) + "|" + strings.TrimSpace(projection) + "|" + scopePrefix + "|user:"
	seen := map[string]bool{}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for key, bucket := range h.subscribers {
		if len(bucket) == 0 || !strings.HasPrefix(key, prefix) {
			continue
		}
		userID := strings.TrimSpace(strings.TrimPrefix(key, prefix))
		if userID != "" {
			seen[userID] = true
		}
	}
	userIDs := make([]string, 0, len(seen))
	for userID := range seen {
		userIDs = append(userIDs, userID)
	}
	sort.Strings(userIDs)
	return userIDs
}

func (h *projectionDeltaHub) publish(companyID, projection, scope string, payload []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for ch := range h.subscribers[projectionSubscriptionKey(companyID, projection, scope)] {
		select {
		case ch <- payload:
		default:
		}
	}
}

func (s *Server) publishProjectionDeltas(deltas []store.ProjectionDelta) {
	s.publishProjectionDeltasWithTiming(deltas, nil)
}

func (s *Server) publishProjectionDeltasWithTiming(deltas []store.ProjectionDelta, timings *requestTimingRecorder) {
	stop := timings.observeAccounted("projection.publish.enqueue")
	deltas = cloneProjectionDeltasForAsync(deltas)
	deltas = requestPathProjectionDeltas(deltas)
	stop()
	if len(deltas) == 0 {
		return
	}
	go s.publishProjectionDeltasAsync(deltas)
}

func requestPathProjectionDeltas(deltas []store.ProjectionDelta) []store.ProjectionDelta {
	if len(deltas) == 0 {
		return nil
	}
	out := deltas[:0]
	for _, delta := range deltas {
		switch strings.TrimSpace(delta.Projection) {
		case store.ProjectionNameKanbanBoard, store.ProjectionNameRacioMatrix:
			continue
		}
		out = append(out, delta)
	}
	return out
}

func (s *Server) publishProjectionDeltasAsync(deltas []store.ProjectionDelta) {
	start := time.Now()
	defer func() {
		if recovered := recover(); recovered != nil {
			log.Printf("async projection delta publish failed count=%d panic=%v", len(deltas), recovered)
		}
	}()

	type groupKey struct {
		companyID     string
		projection    string
		scope         string
		sequenceScope string
		connectionID  string
		realtime      bool
	}
	grouped := map[groupKey][]store.ProjectionDelta{}
	for _, delta := range deltas {
		delta.CompanyID = strings.TrimSpace(delta.CompanyID)
		delta.Projection = strings.TrimSpace(delta.Projection)
		if delta.CompanyID == "" {
			continue
		}
		switch delta.Projection {
		case store.ProjectionNameRacioMatrix:
			userID := projectionDeltaUserID(delta)
			projectionScope := projectionUserScope(userID)
			realtimeScope := realtimeRacioScope(userID)
			if projectionScope == "" || realtimeScope == "" {
				continue
			}
			hasRealtimeSubscribers := s.realtimeRegistry.hasSubscribers(delta.CompanyID, realtimeScope)
			hasProjectionSubscribers := s.projectionHub.hasSubscribers(delta.CompanyID, delta.Projection, projectionScope)
			if !hasRealtimeSubscribers && !hasProjectionSubscribers {
				continue
			}
			filtered, ok := s.authorizedProjectionDeltaForUser(delta, userID)
			if !ok {
				continue
			}
			if hasRealtimeSubscribers {
				key := groupKey{companyID: filtered.CompanyID, projection: filtered.Projection, scope: realtimeScope, sequenceScope: projectionScope, realtime: true}
				grouped[key] = append(grouped[key], filtered)
			}
			if hasProjectionSubscribers {
				key := groupKey{companyID: filtered.CompanyID, projection: filtered.Projection, scope: projectionScope, sequenceScope: projectionScope}
				grouped[key] = append(grouped[key], filtered)
			}
		case store.ProjectionNameKanbanBoard:
			boardID := projectionDeltaBoardID(delta)
			scopePrefix := projectionKanbanBoardScopePrefix(boardID)
			if scopePrefix == "" {
				continue
			}
			realtimeScope := realtimeBoardScope(boardID)
			for _, conn := range s.realtimeRegistry.connectionsForScope(delta.CompanyID, realtimeScope) {
				if conn == nil {
					continue
				}
				filtered, ok := s.authorizedProjectionDeltaForUser(delta, conn.userID)
				if !ok {
					continue
				}
				key := groupKey{companyID: filtered.CompanyID, projection: filtered.Projection, scope: realtimeScope, sequenceScope: scopePrefix, connectionID: conn.id, realtime: true}
				grouped[key] = append(grouped[key], filtered)
			}
			for _, userID := range s.projectionHub.activeUserIDsForScopePrefix(delta.CompanyID, delta.Projection, scopePrefix) {
				scope := projectionKanbanBoardUserScope(boardID, userID)
				if scope == "" || !s.projectionHub.hasSubscribers(delta.CompanyID, delta.Projection, scope) {
					continue
				}
				filtered, ok := s.authorizedProjectionDeltaForUser(delta, userID)
				if !ok {
					continue
				}
				key := groupKey{companyID: filtered.CompanyID, projection: filtered.Projection, scope: scope, sequenceScope: scopePrefix}
				grouped[key] = append(grouped[key], filtered)
			}
		}
	}
	if len(grouped) == 0 {
		return
	}

	sequences := map[string]int64{}
	published := 0
	for key, group := range grouped {
		sequenceKey := key.companyID + "|" + key.projection + "|" + key.sequenceScope
		sequence := sequences[sequenceKey]
		if sequence == 0 {
			next, err := s.repo.NextProjectionSequence(key.companyID, key.projection, key.sequenceScope)
			if err != nil {
				log.Printf("failed to allocate projection sequence company_id=%s projection=%s scope=%s: %v", key.companyID, key.projection, key.sequenceScope, err)
				continue
			}
			sequence = next
			sequences[sequenceKey] = sequence
		}
		for index := range group {
			group[index].ProjectionSequence = sequence
		}
		envelope := projectionDeltaEnvelope{
			CompanyID:          key.companyID,
			Projection:         key.projection,
			ProjectionScope:    key.sequenceScope,
			ProjectionSequence: sequence,
			Deltas:             group,
			ProjectedTimestamp: time.Now().UTC(),
		}
		payload, err := json.Marshal(envelope)
		if err != nil {
			log.Printf("failed to marshal projection delta company_id=%s projection=%s sequence=%d: %v", key.companyID, key.projection, sequence, err)
			continue
		}
		if !key.realtime {
			s.projectionHub.publish(key.companyID, key.projection, key.scope, payload)
		} else {
			realtimePayload, err := json.Marshal(realtimeProjectionDeltaMessage{
				Type:               realtimeMessageProjectionDelta,
				CompanyID:          key.companyID,
				Scope:              key.scope,
				Sequence:           sequence,
				Projection:         key.projection,
				ProjectionScope:    key.sequenceScope,
				ProjectionSequence: sequence,
				Deltas:             group,
				ProjectedTimestamp: envelope.ProjectedTimestamp,
			})
			if err != nil {
				log.Printf("failed to marshal realtime projection delta company_id=%s projection=%s sequence=%d: %v", key.companyID, key.projection, sequence, err)
			} else if key.connectionID == "" {
				s.realtimeRegistry.publish(key.companyID, key.scope, realtimePayload)
			} else {
				s.realtimeRegistry.publishToConnection(key.connectionID, key.companyID, key.scope, realtimePayload)
			}
		}
		published += len(group)
	}
	duration := time.Since(start)
	log.Printf("async_projection_deltas_publish input=%d published=%d duration=%s", len(deltas), published, formatTimingDuration(duration))
}

func (s *Server) currentKanbanBoardProjectionSequence(companyID, boardID string) (int64, error) {
	return s.repo.CurrentProjectionSequence(companyID, store.ProjectionNameKanbanBoard, projectionKanbanBoardScopePrefix(boardID))
}

func (s *Server) authorizedProjectionDeltaForUser(delta store.ProjectionDelta, userID string) (store.ProjectionDelta, bool) {
	switch strings.TrimSpace(delta.Projection) {
	case store.ProjectionNameRacioMatrix:
		return s.authorizedRacioProjectionDeltaForUser(delta, userID)
	case store.ProjectionNameKanbanBoard:
		return s.authorizedKanbanProjectionDeltaForUser(delta, userID)
	default:
		return store.ProjectionDelta{}, false
	}
}

func (s *Server) authorizedRacioProjectionDeltaForUser(delta store.ProjectionDelta, userID string) (store.ProjectionDelta, bool) {
	userID = strings.TrimSpace(userID)
	delta = cloneProjectionDelta(delta)
	delta.RowKey.UserID = userID
	resourceType := strings.TrimSpace(delta.RowKey.ResourceType)
	resourceID := strings.TrimSpace(delta.RowKey.ResourceID)
	if resourceType == "" || resourceID == "" {
		return store.ProjectionDelta{}, false
	}
	switch delta.Operation {
	case store.ProjectionDeltaOperationDelete:
		delta.Row = nil
		delta.Patch = nil
		return delta, true
	case store.ProjectionDeltaOperationUpsert, store.ProjectionDeltaOperationPatch:
	default:
		return store.ProjectionDelta{}, false
	}
	allowed, err := s.repo.UserHasEffectiveAccess(delta.CompanyID, userID, resourceType, resourceID, store.EntityPermissionEdit)
	if err != nil {
		log.Printf("failed to check projection delta access company_id=%s user_id=%s resource_type=%s resource_id=%s: %v", delta.CompanyID, userID, resourceType, resourceID, err)
		return store.ProjectionDelta{}, false
	}
	if !allowed {
		return store.ProjectionDelta{
			CompanyID:          delta.CompanyID,
			Projection:         delta.Projection,
			Operation:          store.ProjectionDeltaOperationDelete,
			RowKey:             delta.RowKey,
			ProjectedTimestamp: time.Now().UTC(),
		}, true
	}
	if delta.Row != nil {
		delta.Row.UserID = userID
	}
	return delta, true
}

func (s *Server) authorizedKanbanProjectionDeltaForUser(delta store.ProjectionDelta, userID string) (store.ProjectionDelta, bool) {
	userID = strings.TrimSpace(userID)
	delta = cloneProjectionDelta(delta)
	logicGateID := projectionDeltaLogicGateID(delta)
	nodeID := projectionDeltaNodeID(delta)
	if logicGateID == "" || nodeID == "" {
		return store.ProjectionDelta{}, false
	}
	switch delta.Operation {
	case store.ProjectionDeltaOperationDelete:
		delta.Row = nil
		delta.Patch = nil
		return delta, true
	case store.ProjectionDeltaOperationUpsert, store.ProjectionDeltaOperationPatch:
	default:
		return store.ProjectionDelta{}, false
	}
	logicGateAllowed, err := s.repo.UserHasEffectiveAccess(delta.CompanyID, userID, store.EntityTypeLogicGate, logicGateID, store.EntityPermissionEdit)
	if err != nil {
		log.Printf("failed to check kanban projection logic gate access company_id=%s user_id=%s logic_gate_id=%s: %v", delta.CompanyID, userID, logicGateID, err)
		return store.ProjectionDelta{}, false
	}
	nodeAllowed, err := s.repo.UserHasEffectiveAccess(delta.CompanyID, userID, store.EntityTypeNode, nodeID, store.EntityPermissionEdit)
	if err != nil {
		log.Printf("failed to check kanban projection node access company_id=%s user_id=%s node_id=%s: %v", delta.CompanyID, userID, nodeID, err)
		return store.ProjectionDelta{}, false
	}
	if !logicGateAllowed || !nodeAllowed {
		return store.ProjectionDelta{
			CompanyID:          delta.CompanyID,
			Projection:         store.ProjectionNameKanbanBoard,
			Operation:          store.ProjectionDeltaOperationDelete,
			RowKey:             delta.RowKey,
			ProjectedTimestamp: time.Now().UTC(),
		}, true
	}
	return delta, true
}

func (s *Server) publishRacioPermissionProjectionDeltas(companyID, entityType, entityID string) {
	companyID = strings.TrimSpace(companyID)
	entityType = strings.TrimSpace(entityType)
	entityID = strings.TrimSpace(entityID)
	if companyID == "" || entityID == "" {
		return
	}
	go s.publishRacioPermissionProjectionDeltasAsync(companyID, entityType, entityID)
}

func (s *Server) publishRacioPermissionProjectionDeltasAsync(companyID, entityType, entityID string) {
	var rows []store.RacioMatrixProjectionRow
	var err error
	switch entityType {
	case store.EntityTypeNode:
		rows, err = s.repo.ListRacioMatrixProjectionRowsForResources(companyID, []string{entityID}, nil)
	case store.EntityTypeLogicGate:
		rows, err = s.repo.ListRacioMatrixProjectionRowsForLogicGate(companyID, entityID)
	default:
		return
	}
	if err != nil {
		log.Printf("failed to read RACI projection rows for permission delta company_id=%s entity_type=%s entity_id=%s: %v", companyID, entityType, entityID, err)
		return
	}
	now := time.Now().UTC()
	deltas := make([]store.ProjectionDelta, 0, len(rows))
	for _, row := range rows {
		copied := row
		deltas = append(deltas, store.ProjectionDelta{
			CompanyID:  companyID,
			Projection: store.ProjectionNameRacioMatrix,
			Operation:  store.ProjectionDeltaOperationUpsert,
			RowKey: store.ProjectionRowKey{
				UserID:       copied.UserID,
				ResourceType: copied.ResourceType,
				ResourceID:   copied.ResourceID,
			},
			Row:                &copied,
			ProjectedTimestamp: now,
		})
	}
	s.publishProjectionDeltasAsync(deltas)
}

func (s *Server) publishKanbanPermissionProjectionDeltas(companyID, entityType, entityID string) {
	companyID = strings.TrimSpace(companyID)
	entityType = strings.TrimSpace(entityType)
	entityID = strings.TrimSpace(entityID)
	if companyID == "" || entityID == "" {
		return
	}
	go s.publishKanbanPermissionProjectionDeltasAsync(companyID, entityType, entityID)
}

func (s *Server) publishKanbanPermissionProjectionDeltasAsync(companyID, entityType, entityID string) {
	var rows []store.KanbanBoardProjectionRow
	var err error
	switch entityType {
	case store.EntityTypeNode:
		rows, err = s.repo.ListKanbanBoardProjectionRowsForNode(companyID, entityID)
	case store.EntityTypeLogicGate:
		boardID := store.LogicGateKanbanBoardID(entityID)
		scopePrefix := projectionKanbanBoardScopePrefix(boardID)
		if len(s.projectionHub.activeUserIDsForScopePrefix(companyID, store.ProjectionNameKanbanBoard, scopePrefix)) == 0 &&
			!s.realtimeRegistry.hasSubscribers(companyID, realtimeBoardScope(boardID)) {
			return
		}
		rows, err = s.repo.ListKanbanBoardProjectionRowsForLogicGate(companyID, entityID)
	default:
		return
	}
	if err != nil {
		log.Printf("failed to read Kanban projection rows for permission delta company_id=%s entity_type=%s entity_id=%s: %v", companyID, entityType, entityID, err)
		return
	}
	s.publishProjectionDeltasAsync(store.KanbanProjectionUpsertDeltas(rows))
}

func (s *Server) publishKanbanProjectionUpsertsForNode(companyID, nodeID string) {
	companyID = strings.TrimSpace(companyID)
	nodeID = strings.TrimSpace(nodeID)
	if companyID == "" || nodeID == "" {
		return
	}
	go s.publishKanbanProjectionUpsertsForNodeAsync(companyID, nodeID)
}

func (s *Server) publishKanbanProjectionUpsertsForNodeAsync(companyID, nodeID string) {
	rows, err := s.repo.ListKanbanBoardProjectionRowsForNode(companyID, nodeID)
	if err != nil {
		log.Printf("failed to read Kanban projection rows for node delta company_id=%s node_id=%s: %v", companyID, nodeID, err)
		return
	}
	s.publishProjectionDeltas(store.KanbanProjectionUpsertDeltas(rows))
}

func projectionDeltaUserID(delta store.ProjectionDelta) string {
	if userID := strings.TrimSpace(delta.RowKey.UserID); userID != "" {
		return userID
	}
	if delta.Row != nil {
		return strings.TrimSpace(delta.Row.UserID)
	}
	return ""
}

func projectionDeltaBoardID(delta store.ProjectionDelta) string {
	if boardID := strings.TrimSpace(delta.RowKey.BoardID); boardID != "" {
		return boardID
	}
	if delta.Row != nil {
		return strings.TrimSpace(delta.Row.BoardID)
	}
	return ""
}

func projectionDeltaLogicGateID(delta store.ProjectionDelta) string {
	if logicGateID := strings.TrimSpace(delta.RowKey.LogicGateID); logicGateID != "" {
		return logicGateID
	}
	if delta.Row != nil && delta.Row.LogicGateID != nil {
		return strings.TrimSpace(*delta.Row.LogicGateID)
	}
	return ""
}

func projectionDeltaNodeID(delta store.ProjectionDelta) string {
	if nodeID := strings.TrimSpace(delta.RowKey.NodeID); nodeID != "" {
		return nodeID
	}
	if resourceType := strings.TrimSpace(delta.RowKey.ResourceType); resourceType == store.EntityTypeNode {
		if resourceID := strings.TrimSpace(delta.RowKey.ResourceID); resourceID != "" {
			return resourceID
		}
	}
	if delta.Row != nil {
		if nodeID := strings.TrimSpace(delta.Row.NodeID); nodeID != "" {
			return nodeID
		}
		if delta.Row.ResourceType == store.EntityTypeNode {
			return strings.TrimSpace(delta.Row.ResourceID)
		}
	}
	return ""
}

func cloneProjectionDeltasForAsync(deltas []store.ProjectionDelta) []store.ProjectionDelta {
	if len(deltas) == 0 {
		return nil
	}
	out := make([]store.ProjectionDelta, len(deltas))
	for index, delta := range deltas {
		out[index] = cloneProjectionDelta(delta)
	}
	return out
}

func cloneProjectionDelta(delta store.ProjectionDelta) store.ProjectionDelta {
	out := delta
	if delta.Row != nil {
		row := *delta.Row
		row.LogicGateID = cloneProjectionStringPointer(row.LogicGateID)
		row.Status = cloneProjectionStringPointer(row.Status)
		row.StatusColor = cloneProjectionStringPointer(row.StatusColor)
		row.DueDate = cloneProjectionStringPointer(row.DueDate)
		row.Priority = cloneProjectionIntPointer(row.Priority)
		row.AssigneeUserID = cloneProjectionStringPointer(row.AssigneeUserID)
		row.AssigneeDisplayName = cloneProjectionStringPointer(row.AssigneeDisplayName)
		row.AssigneeEmail = cloneProjectionStringPointer(row.AssigneeEmail)
		out.Row = &row
	}
	if delta.Patch != nil {
		patch := make(map[string]any, len(delta.Patch))
		for key, value := range delta.Patch {
			patch[key] = value
		}
		out.Patch = patch
	}
	return out
}

func cloneProjectionStringPointer(value *string) *string {
	if value == nil {
		return nil
	}
	copied := *value
	return &copied
}

func cloneProjectionIntPointer(value *int) *int {
	if value == nil {
		return nil
	}
	copied := *value
	return &copied
}
