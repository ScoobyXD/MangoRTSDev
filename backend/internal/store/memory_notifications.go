package store

import (
	"miraeopus/backend/internal/domain"
	"slices"
	"strings"
	"time"
)

func notificationStringPtr(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

type NotificationAccessTarget struct {
	EntityType string
	EntityID   string
}

func NotificationAccessTargets(entityType, entityID, logicGateID, nodeID string) []NotificationAccessTarget {
	targets := make([]NotificationAccessTarget, 0, 3)
	seen := map[string]bool{}
	add := func(targetType, targetID string) {
		targetType, ok := NormalizeEntityType(targetType)
		targetID = strings.TrimSpace(targetID)
		if !ok || targetID == "" {
			return
		}
		key := targetType + "\x00" + targetID
		if seen[key] {
			return
		}
		seen[key] = true
		targets = append(targets, NotificationAccessTarget{EntityType: targetType, EntityID: targetID})
	}
	add(EntityTypeLogicGate, logicGateID)
	add(EntityTypeNode, nodeID)
	add(entityType, entityID)
	return targets
}

func NotificationPrimaryAccessTarget(entityType, entityID, logicGateID, nodeID string) (NotificationAccessTarget, bool) {
	for _, target := range NotificationAccessTargets(entityType, entityID, logicGateID, nodeID) {
		return target, true
	}
	return NotificationAccessTarget{}, false
}

func cloneNotification(item domain.Notification) domain.Notification {
	if item.ActorUserID != nil {
		actor := *item.ActorUserID
		item.ActorUserID = &actor
	}
	if item.ReadTimestamp != nil {
		read := *item.ReadTimestamp
		item.ReadTimestamp = &read
	}
	return item
}

func (r *MemoryRepo) notificationVisibleToUserLocked(item domain.Notification, userID string) bool {
	companyID := strings.TrimSpace(item.CompanyID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return true
	}
	if logicGateID := strings.TrimSpace(item.LogicGateID); logicGateID != "" && notificationLogicGateGVICRole(item.Role) {
		return r.entityExistsLocked(companyID, EntityTypeLogicGate, logicGateID)
	}
	target, ok := NotificationPrimaryAccessTarget(item.EntityType, item.EntityID, item.LogicGateID, item.NodeID)
	if !ok {
		return true
	}
	if !r.entityExistsLocked(companyID, target.EntityType, target.EntityID) {
		return false
	}
	if !r.userHasEffectiveAccessLocked(companyID, userID, target.EntityType, target.EntityID, EntityPermissionEdit) {
		return false
	}
	return true
}

func notificationLogicGateGVICRole(role string) bool {
	switch strings.TrimSpace(role) {
	case domain.GVICRoleGenerated, domain.GVICRoleVerified, domain.GVICRoleConsulted, domain.GVICRoleInformed:
		return true
	default:
		return false
	}
}

func notificationRoleSummaryTargetKey(item domain.Notification) string {
	if strings.TrimSpace(item.NodeID) != "" {
		return strings.Join([]string{"node", strings.TrimSpace(item.LogicGateID), strings.TrimSpace(item.NodeID)}, "\x00")
	}
	if strings.TrimSpace(item.LogicGateID) != "" {
		return "logic_gate\x00" + strings.TrimSpace(item.LogicGateID)
	}
	if strings.TrimSpace(item.EntityType) != "" || strings.TrimSpace(item.EntityID) != "" {
		return strings.TrimSpace(item.EntityType) + "\x00" + strings.TrimSpace(item.EntityID)
	}
	return strings.TrimSpace(item.NotificationID)
}

func (r *MemoryRepo) CreateNotifications(input CreateNotificationsInput) ([]domain.Notification, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	notificationsBefore := cloneMemoryMap(r.notifications)
	outboxBefore := cloneMemoryMap(r.realtimeOutbox)
	outboxSequenceBefore := r.realtimeOutboxSequence
	committed := false
	defer func() {
		if committed {
			return
		}
		r.notifications = notificationsBefore
		r.realtimeOutbox = outboxBefore
		r.realtimeOutboxSequence = outboxSequenceBefore
	}()

	created := make([]domain.Notification, 0, len(input.Notifications))
	for _, candidate := range input.Notifications {
		candidate.CompanyID = strings.TrimSpace(candidate.CompanyID)
		candidate.RecipientUserID = strings.TrimSpace(candidate.RecipientUserID)
		candidate.ActorUserID = strings.TrimSpace(candidate.ActorUserID)
		candidate.Type = strings.TrimSpace(candidate.Type)
		candidate.SourceEventID = strings.TrimSpace(candidate.SourceEventID)
		candidate.EntityType = strings.TrimSpace(candidate.EntityType)
		candidate.EntityID = strings.TrimSpace(candidate.EntityID)
		candidate.Title = strings.TrimSpace(candidate.Title)
		candidate.BodyPreview = strings.TrimSpace(candidate.BodyPreview)
		candidate.Surface = strings.TrimSpace(candidate.Surface)
		candidate.Role = strings.TrimSpace(candidate.Role)
		candidate.LogicGateID = strings.TrimSpace(candidate.LogicGateID)
		candidate.NodeID = strings.TrimSpace(candidate.NodeID)
		candidate.InformationID = strings.TrimSpace(candidate.InformationID)
		if candidate.CompanyID == "" || candidate.RecipientUserID == "" || candidate.Type == "" || candidate.SourceEventID == "" || candidate.EntityType == "" || candidate.EntityID == "" || candidate.Title == "" {
			return nil, ErrInvalid
		}
		duplicate := false
		for _, existing := range r.notifications {
			if existing.RecipientUserID == candidate.RecipientUserID && existing.SourceEventID == candidate.SourceEventID && existing.Type == candidate.Type && existing.EntityType == candidate.EntityType && existing.EntityID == candidate.EntityID {
				duplicate = true
				break
			}
		}
		if duplicate {
			continue
		}
		now := time.Now().UTC()
		item := domain.Notification{
			NotificationID:   newUUIDv7String(),
			CompanyID:        candidate.CompanyID,
			RecipientUserID:  candidate.RecipientUserID,
			ActorUserID:      notificationStringPtr(candidate.ActorUserID),
			Type:             candidate.Type,
			SourceEventID:    candidate.SourceEventID,
			EntityType:       candidate.EntityType,
			EntityID:         candidate.EntityID,
			Title:            candidate.Title,
			BodyPreview:      candidate.BodyPreview,
			Surface:          candidate.Surface,
			Role:             candidate.Role,
			LogicGateID:      candidate.LogicGateID,
			NodeID:           candidate.NodeID,
			InformationID:    candidate.InformationID,
			CreatedTimestamp: now,
		}
		r.notifications[item.NotificationID] = item
		outboxInput, err := notificationCreatedOutboxInput(item)
		if err != nil {
			return nil, err
		}
		if _, err := r.enqueueRealtimeOutboxLocked(outboxInput); err != nil {
			return nil, err
		}
		created = append(created, cloneNotification(item))
	}
	committed = true
	return created, nil
}

func (r *MemoryRepo) ListNotifications(input NotificationListInput) ([]domain.Notification, error) {
	input.UserID = strings.TrimSpace(input.UserID)
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.NotificationType = strings.TrimSpace(input.NotificationType)
	if input.UserID == "" {
		return nil, ErrInvalid
	}
	limit := NormalizeNotificationListLimit(input.Limit)

	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.Notification, 0)
	for _, item := range r.notifications {
		if item.RecipientUserID != input.UserID {
			continue
		}
		if input.CompanyID != "" && item.CompanyID != input.CompanyID {
			continue
		}
		if input.NotificationType != "" && item.Type != input.NotificationType {
			continue
		}
		if input.UnreadOnly && item.ReadTimestamp != nil {
			continue
		}
		if !r.notificationVisibleToUserLocked(item, input.UserID) {
			continue
		}
		items = append(items, cloneNotification(item))
	}
	slices.SortFunc(items, func(a, b domain.Notification) int {
		if a.CreatedTimestamp.After(b.CreatedTimestamp) {
			return -1
		}
		if a.CreatedTimestamp.Before(b.CreatedTimestamp) {
			return 1
		}
		return strings.Compare(a.NotificationID, b.NotificationID)
	})
	if len(items) > limit {
		items = items[:limit]
	}
	return items, nil
}

func (r *MemoryRepo) GetNotificationSummary(input NotificationSummaryInput) (domain.NotificationSummary, error) {
	input.UserID = strings.TrimSpace(input.UserID)
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	if input.UserID == "" {
		return domain.NotificationSummary{}, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	summary := domain.NotificationSummary{
		CompanyID:        input.CompanyID,
		RoleCounts:       []domain.NotificationRoleCount{},
		TypeCounts:       []domain.NotificationTypeCount{},
		LogicGateCounts:  []domain.NotificationLogicGateCount{},
		UpdatedTimestamp: time.Now().UTC(),
	}
	roleCounts := map[string]domain.NotificationRoleCount{}
	roleTargets := map[string]map[string]bool{}
	typeCounts := map[string]domain.NotificationTypeCount{}
	logicGateCounts := map[string]domain.NotificationLogicGateCount{}
	for _, item := range r.notifications {
		if item.RecipientUserID != input.UserID || item.ReadTimestamp != nil {
			continue
		}
		if input.CompanyID != "" && item.CompanyID != input.CompanyID {
			continue
		}
		if !r.notificationVisibleToUserLocked(item, input.UserID) {
			continue
		}
		summary.TotalUnread++
		if item.Type != "" {
			count := typeCounts[item.Type]
			if count.Count == 0 {
				count.Type = item.Type
			}
			count.Count++
			typeCounts[item.Type] = count
		}
		if item.Surface != "" || item.Role != "" {
			key := item.Surface + "\x00" + item.Role
			count := roleCounts[key]
			if count.Count == 0 {
				count.Surface = item.Surface
				count.Role = item.Role
			}
			if roleTargets[key] == nil {
				roleTargets[key] = map[string]bool{}
			}
			roleTargets[key][notificationRoleSummaryTargetKey(item)] = true
			count.Count = len(roleTargets[key])
			roleCounts[key] = count
		}
		if item.LogicGateID != "" && item.Role != "" {
			key := item.LogicGateID + "\x00" + item.NodeID + "\x00" + item.Role
			count := logicGateCounts[key]
			if count.Count == 0 {
				count.LogicGateID = item.LogicGateID
				count.NodeID = item.NodeID
				count.Role = item.Role
			}
			count.Count++
			logicGateCounts[key] = count
		}
	}
	for _, count := range roleCounts {
		summary.RoleCounts = append(summary.RoleCounts, count)
	}
	for _, count := range typeCounts {
		summary.TypeCounts = append(summary.TypeCounts, count)
	}
	for _, count := range logicGateCounts {
		summary.LogicGateCounts = append(summary.LogicGateCounts, count)
	}
	slices.SortFunc(summary.RoleCounts, func(a, b domain.NotificationRoleCount) int {
		if cmp := strings.Compare(a.Surface, b.Surface); cmp != 0 {
			return cmp
		}
		return strings.Compare(a.Role, b.Role)
	})
	slices.SortFunc(summary.TypeCounts, func(a, b domain.NotificationTypeCount) int {
		return strings.Compare(a.Type, b.Type)
	})
	slices.SortFunc(summary.LogicGateCounts, func(a, b domain.NotificationLogicGateCount) int {
		if cmp := strings.Compare(a.LogicGateID, b.LogicGateID); cmp != 0 {
			return cmp
		}
		if cmp := strings.Compare(a.NodeID, b.NodeID); cmp != 0 {
			return cmp
		}
		return strings.Compare(a.Role, b.Role)
	})
	return summary, nil
}
func (r *MemoryRepo) CountUnreadNotifications(userID, companyID string) (int, error) {
	userID = strings.TrimSpace(userID)
	companyID = strings.TrimSpace(companyID)
	if userID == "" {
		return 0, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	count := 0
	for _, item := range r.notifications {
		if item.RecipientUserID != userID || item.ReadTimestamp != nil {
			continue
		}
		if companyID != "" && item.CompanyID != companyID {
			continue
		}
		if !r.notificationVisibleToUserLocked(item, userID) {
			continue
		}
		count++
	}
	return count, nil
}

func (r *MemoryRepo) MarkNotificationRead(userID, notificationID string, read bool) (domain.Notification, error) {
	userID = strings.TrimSpace(userID)
	notificationID = strings.TrimSpace(notificationID)
	if userID == "" || notificationID == "" {
		return domain.Notification{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	item, ok := r.notifications[notificationID]
	if !ok || item.RecipientUserID != userID {
		return domain.Notification{}, ErrNotFound
	}
	if !r.notificationVisibleToUserLocked(item, userID) {
		return domain.Notification{}, ErrNotFound
	}
	if read {
		now := time.Now().UTC()
		item.ReadTimestamp = &now
	} else {
		item.ReadTimestamp = nil
	}
	r.notifications[notificationID] = item
	return cloneNotification(item), nil
}

func notificationMatchesMarkReadInput(item domain.Notification, input NotificationMarkReadInput) bool {
	if input.CompanyID != "" && item.CompanyID != input.CompanyID {
		return false
	}
	if input.NotificationType != "" && item.Type != input.NotificationType {
		return false
	}
	if input.Surface != "" && item.Surface != input.Surface {
		return false
	}
	if input.Role != "" && item.Role != input.Role {
		return false
	}
	if input.LogicGateID != "" && item.LogicGateID != input.LogicGateID {
		return false
	}
	if input.NodeID != "" && item.NodeID != input.NodeID {
		return false
	}
	return true
}

func (r *MemoryRepo) MarkNotificationsRead(input NotificationMarkReadInput) (int, error) {
	input.UserID = strings.TrimSpace(input.UserID)
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.NotificationType = strings.TrimSpace(input.NotificationType)
	input.Surface = strings.TrimSpace(input.Surface)
	input.Role = strings.TrimSpace(input.Role)
	input.LogicGateID = strings.TrimSpace(input.LogicGateID)
	input.NodeID = strings.TrimSpace(input.NodeID)
	if input.UserID == "" {
		return 0, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	count := 0
	for id, item := range r.notifications {
		if item.RecipientUserID != input.UserID || item.ReadTimestamp != nil {
			continue
		}
		if !notificationMatchesMarkReadInput(item, input) {
			continue
		}
		if !r.notificationVisibleToUserLocked(item, input.UserID) {
			continue
		}
		item.ReadTimestamp = &now
		r.notifications[id] = item
		count++
	}
	return count, nil
}

func (r *MemoryRepo) MarkAllNotificationsRead(userID, companyID string) (int, error) {
	return r.MarkNotificationsRead(NotificationMarkReadInput{UserID: userID, CompanyID: companyID})
}

func (r *MemoryRepo) DeleteNotifications(input NotificationDeleteInput) ([]domain.Notification, error) {
	input.UserID = strings.TrimSpace(input.UserID)
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.NotificationID = strings.TrimSpace(input.NotificationID)
	input.NotificationType = strings.TrimSpace(input.NotificationType)
	input.Surface = strings.TrimSpace(input.Surface)
	input.Role = strings.TrimSpace(input.Role)
	input.LogicGateID = strings.TrimSpace(input.LogicGateID)
	input.NodeID = strings.TrimSpace(input.NodeID)
	input.RealtimeMode = strings.TrimSpace(input.RealtimeMode)
	if input.UserID == "" || (input.RealtimeMode != "" && input.RealtimeMode != NotificationRealtimeDeleteEach && input.RealtimeMode != NotificationRealtimeClear) {
		return nil, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	notificationsBefore := cloneMemoryMap(r.notifications)
	outboxBefore := cloneMemoryMap(r.realtimeOutbox)
	outboxSequenceBefore := r.realtimeOutboxSequence
	committed := false
	defer func() {
		if committed {
			return
		}
		r.notifications = notificationsBefore
		r.realtimeOutbox = outboxBefore
		r.realtimeOutboxSequence = outboxSequenceBefore
	}()

	deleted := make([]domain.Notification, 0)
	for id, item := range r.notifications {
		if item.RecipientUserID != input.UserID {
			continue
		}
		if input.CompanyID != "" && item.CompanyID != input.CompanyID {
			continue
		}
		if input.NotificationID != "" && item.NotificationID != input.NotificationID {
			continue
		}
		if input.NotificationType != "" && item.Type != input.NotificationType {
			continue
		}
		if input.Surface != "" && item.Surface != input.Surface {
			continue
		}
		if input.Role != "" && item.Role != input.Role {
			continue
		}
		if input.LogicGateID != "" && item.LogicGateID != input.LogicGateID {
			continue
		}
		if input.NodeID != "" && item.NodeID != input.NodeID {
			continue
		}
		delete(r.notifications, id)
		deleted = append(deleted, cloneNotification(item))
	}
	if input.NotificationID != "" && len(deleted) == 0 {
		return nil, ErrNotFound
	}
	slices.SortFunc(deleted, func(a, b domain.Notification) int {
		if a.CreatedTimestamp.After(b.CreatedTimestamp) {
			return -1
		}
		if a.CreatedTimestamp.Before(b.CreatedTimestamp) {
			return 1
		}
		return strings.Compare(a.NotificationID, b.NotificationID)
	})
	outboxInputs, err := notificationDeletionOutboxInputs(deleted, input.RealtimeMode)
	if err != nil {
		return nil, err
	}
	for _, outboxInput := range outboxInputs {
		if _, err := r.enqueueRealtimeOutboxLocked(outboxInput); err != nil {
			return nil, err
		}
	}
	committed = true
	return deleted, nil
}
func (r *MemoryRepo) DeleteExpiredNotifications(olderThan time.Time, limit int) ([]domain.Notification, error) {
	if olderThan.IsZero() {
		return nil, ErrInvalid
	}
	limit = NormalizeNotificationCleanupLimit(limit)

	r.mu.Lock()
	defer r.mu.Unlock()
	notificationsBefore := cloneMemoryMap(r.notifications)
	outboxBefore := cloneMemoryMap(r.realtimeOutbox)
	outboxSequenceBefore := r.realtimeOutboxSequence
	committed := false
	defer func() {
		if committed {
			return
		}
		r.notifications = notificationsBefore
		r.realtimeOutbox = outboxBefore
		r.realtimeOutboxSequence = outboxSequenceBefore
	}()

	candidates := make([]domain.Notification, 0)
	for _, item := range r.notifications {
		if item.ReadTimestamp == nil && item.CreatedTimestamp.Before(olderThan) {
			candidates = append(candidates, item)
		}
	}
	slices.SortFunc(candidates, func(a, b domain.Notification) int {
		if a.CreatedTimestamp.Before(b.CreatedTimestamp) {
			return -1
		}
		if a.CreatedTimestamp.After(b.CreatedTimestamp) {
			return 1
		}
		return strings.Compare(a.NotificationID, b.NotificationID)
	})
	if len(candidates) > limit {
		candidates = candidates[:limit]
	}
	deleted := make([]domain.Notification, 0, len(candidates))
	for _, item := range candidates {
		delete(r.notifications, item.NotificationID)
		deleted = append(deleted, cloneNotification(item))
	}
	outboxInputs, err := notificationDeletionOutboxInputs(deleted, NotificationRealtimeDeleteEach)
	if err != nil {
		return nil, err
	}
	for _, outboxInput := range outboxInputs {
		if _, err := r.enqueueRealtimeOutboxLocked(outboxInput); err != nil {
			return nil, err
		}
	}
	committed = true
	return deleted, nil
}
