package store

import (
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

type communicationsEmailNodeLink struct {
	CompanyID        string
	UserID           string
	MessageID        string
	NodeID           string
	BoardID          string
	CardID           string
	LogicGateID      string
	Message          domain.EmailMessageSnapshot
	CreatedTimestamp time.Time
	UpdatedTimestamp time.Time
}

func (r *MemoryRepo) ListCommunicationsTriageItems(userID string) ([]domain.CommunicationsTriageItem, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.CommunicationsTriageItem, 0)
	for _, item := range r.triageItems {
		if item.UserID == userID {
			items = append(items, item)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].CreatedTimestamp.After(items[j].CreatedTimestamp)
		}
		return items[i].MessageID < items[j].MessageID
	})
	return items, nil
}

func (r *MemoryRepo) UpsertCommunicationsTriageItem(userID string, message domain.EmailMessageSnapshot) (domain.CommunicationsTriageItem, error) {
	userID = strings.TrimSpace(userID)
	message = normalizeEmailMessageSnapshot(message)
	if userID == "" || message.ID == "" {
		return domain.CommunicationsTriageItem{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if !r.userIDExistsLocked(userID) {
		return domain.CommunicationsTriageItem{}, ErrNotFound
	}
	now := time.Now().UTC()
	k := triageItemKey(userID, message.ID)
	created := now
	if existing, ok := r.triageItems[k]; ok {
		created = existing.CreatedTimestamp
	}
	item := domain.CommunicationsTriageItem{
		UserID:           userID,
		MessageID:        message.ID,
		Message:          message,
		CreatedTimestamp: created,
		UpdatedTimestamp: now,
	}
	r.triageItems[k] = item
	return item, nil
}

func (r *MemoryRepo) DeleteCommunicationsTriageItem(userID, messageID string) error {
	userID = strings.TrimSpace(userID)
	messageID = strings.TrimSpace(messageID)
	if userID == "" || messageID == "" {
		return ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	k := triageItemKey(userID, messageID)
	if _, ok := r.triageItems[k]; !ok {
		return ErrNotFound
	}
	delete(r.triageItems, k)
	return nil
}

func (r *MemoryRepo) ConvertCommunicationsTriageItems(input CommunicationsTriageConversionInput) (CommunicationsTriageConversionResult, error) {
	input.UserID = strings.TrimSpace(input.UserID)
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.LogicGateID = strings.TrimSpace(input.LogicGateID)
	messageIDs := normalizeUniqueStrings(input.MessageIDs, CommunicationsTriageBatchMaxItems)
	if input.UserID == "" || input.CompanyID == "" || input.LogicGateID == "" || len(messageIDs) == 0 {
		return CommunicationsTriageConversionResult{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	logicGate, ok := r.logicGates[key(input.CompanyID, input.LogicGateID)]
	if !ok {
		return CommunicationsTriageConversionResult{}, ErrNotFound
	}
	board := r.ensureLogicGateKanbanBoardLocked(input.CompanyID, input.LogicGateID, logicGate.Header)
	pendingColumnID := r.pendingKanbanColumnIDLocked(input.CompanyID, board.BoardID)
	if pendingColumnID == "" {
		return CommunicationsTriageConversionResult{}, ErrNotFound
	}

	now := time.Now().UTC()
	result := CommunicationsTriageConversionResult{Board: board}
	nextCardPositionValue := nextKanbanCardPosition(r.kanbanCards[boardKey(input.CompanyID, board.BoardID)], pendingColumnID)
	for index, messageID := range messageIDs {
		triageItem, ok := r.triageItems[triageItemKey(input.UserID, messageID)]
		if !ok {
			return CommunicationsTriageConversionResult{}, ErrNotFound
		}
		nodeID := newUUIDv7String()
		node := domain.Node{
			CompanyID:        input.CompanyID,
			NodeID:           nodeID,
			Title:            emailNodeTitle(triageItem.Message),
			CreatedTimestamp: now,
		}
		r.nodes[key(input.CompanyID, nodeID)] = node
		r.nodeMapPositions[key(input.CompanyID, nodeID)] = domain.NodeMapPosition{
			CompanyID:        input.CompanyID,
			NodeID:           nodeID,
			X:                120 + float64(index*28),
			Y:                120 + float64(index*28),
			UpdatedTimestamp: now,
		}
		r.addEmailProjectionLocked(input.CompanyID, nodeID, triageItem.Message, now)

		logicGateID := input.LogicGateID
		card := domain.KanbanCard{
			CompanyID:           input.CompanyID,
			BoardID:             board.BoardID,
			CardID:              newUUIDv7String(),
			ColumnID:            pendingColumnID,
			NodeID:              nodeID,
			LogicGateID:         &logicGateID,
			NodeTitle:           node.Title,
			DescriptionSnapshot: emailDescriptionSnapshot(triageItem.Message),
			IsIssue:             false,
			Position:            nextCardPositionValue + index*1000,
			CreatedTimestamp:    now,
			UpdatedTimestamp:    now,
		}
		r.kanbanCards[boardKey(input.CompanyID, board.BoardID)] = append(r.kanbanCards[boardKey(input.CompanyID, board.BoardID)], card)
		r.syncNodeStatusFromKanbanCardLocked(card)
		r.emailNodeLinks[emailNodeLinkKey(input.CompanyID, board.BoardID, card.CardID)] = communicationsEmailNodeLink{
			CompanyID:        input.CompanyID,
			UserID:           input.UserID,
			MessageID:        messageID,
			NodeID:           nodeID,
			BoardID:          board.BoardID,
			CardID:           card.CardID,
			LogicGateID:      input.LogicGateID,
			Message:          triageItem.Message,
			CreatedTimestamp: now,
			UpdatedTimestamp: now,
		}
		delete(r.triageItems, triageItemKey(input.UserID, messageID))

		result.Nodes = append(result.Nodes, node)
		result.Cards = append(result.Cards, card)
		result.DeletedMessageIDs = append(result.DeletedMessageIDs, messageID)
	}
	return result, nil
}

func (r *MemoryRepo) RevertCommunicationsTriageNode(input CommunicationsTriageRevertInput) (CommunicationsTriageRevertResult, error) {
	input.UserID = strings.TrimSpace(input.UserID)
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.BoardID = strings.TrimSpace(input.BoardID)
	input.CardID = strings.TrimSpace(input.CardID)
	if input.UserID == "" || input.CompanyID == "" || input.BoardID == "" || input.CardID == "" {
		return CommunicationsTriageRevertResult{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	linkKey := emailNodeLinkKey(input.CompanyID, input.BoardID, input.CardID)
	link, ok := r.emailNodeLinks[linkKey]
	if !ok || link.UserID != input.UserID {
		return CommunicationsTriageRevertResult{}, ErrNotFound
	}
	now := time.Now().UTC()
	triageItem := domain.CommunicationsTriageItem{
		UserID:           input.UserID,
		MessageID:        link.MessageID,
		Message:          link.Message,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.triageItems[triageItemKey(input.UserID, link.MessageID)] = triageItem

	boardCards := r.kanbanCards[boardKey(input.CompanyID, input.BoardID)]
	nextCards := boardCards[:0]
	for _, card := range boardCards {
		if card.CardID != input.CardID {
			nextCards = append(nextCards, card)
		}
	}
	r.kanbanCards[boardKey(input.CompanyID, input.BoardID)] = nextCards
	delete(r.emailNodeLinks, linkKey)
	delete(r.nodes, key(input.CompanyID, link.NodeID))
	delete(r.nodeInfo, key(input.CompanyID, link.NodeID))
	delete(r.nodeText, key(input.CompanyID, link.NodeID))
	delete(r.nodeMapPositions, key(input.CompanyID, link.NodeID))
	delete(r.folderItems, folderItemKey(input.CompanyID, "node", link.NodeID))

	return CommunicationsTriageRevertResult{
		TriageItem:    triageItem,
		DeletedNodeID: link.NodeID,
		DeletedCardID: input.CardID,
		BoardID:       input.BoardID,
	}, nil
}

func (r *MemoryRepo) ListUserLogicGateShortcuts(userID, companyID string) ([]domain.UserLogicGateShortcut, error) {
	userID = strings.TrimSpace(userID)
	companyID = strings.TrimSpace(companyID)
	if userID == "" || companyID == "" {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.UserLogicGateShortcut, 0)
	for _, item := range r.logicGateShortcuts {
		if item.UserID == userID && item.CompanyID == companyID {
			items = append(items, item)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Position != items[j].Position {
			return items[i].Position < items[j].Position
		}
		if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
		}
		return items[i].LogicGateID < items[j].LogicGateID
	})
	return items, nil
}

func (r *MemoryRepo) UpsertUserLogicGateShortcuts(userID, companyID string, logicGateIDs []string) ([]domain.UserLogicGateShortcut, error) {
	userID = strings.TrimSpace(userID)
	companyID = strings.TrimSpace(companyID)
	ids := normalizeUniqueStrings(logicGateIDs, UserLogicGateShortcutBatchMaxItems)
	if userID == "" || companyID == "" || len(ids) == 0 {
		return nil, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	position := 1000
	for _, item := range r.logicGateShortcuts {
		if item.UserID == userID && item.CompanyID == companyID && item.Position >= position {
			position = item.Position + 1000
		}
	}
	now := time.Now().UTC()
	items := make([]domain.UserLogicGateShortcut, 0, len(ids))
	for _, logicGateID := range ids {
		if _, ok := r.logicGates[key(companyID, logicGateID)]; !ok {
			return nil, ErrNotFound
		}
		k := logicGateShortcutKey(userID, companyID, logicGateID)
		item, exists := r.logicGateShortcuts[k]
		if !exists {
			item = domain.UserLogicGateShortcut{
				UserID:           userID,
				CompanyID:        companyID,
				LogicGateID:      logicGateID,
				Position:         position,
				CreatedTimestamp: now,
			}
			position += 1000
		}
		item.UpdatedTimestamp = now
		r.logicGateShortcuts[k] = item
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Position < items[j].Position })
	return items, nil
}

func (r *MemoryRepo) DeleteUserLogicGateShortcut(userID, companyID, logicGateID string) error {
	userID = strings.TrimSpace(userID)
	companyID = strings.TrimSpace(companyID)
	logicGateID = strings.TrimSpace(logicGateID)
	if userID == "" || companyID == "" || logicGateID == "" {
		return ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	k := logicGateShortcutKey(userID, companyID, logicGateID)
	if _, ok := r.logicGateShortcuts[k]; !ok {
		return ErrNotFound
	}
	delete(r.logicGateShortcuts, k)
	return nil
}

func (r *MemoryRepo) pendingKanbanColumnIDLocked(companyID, boardID string) string {
	for _, column := range r.kanbanColumns[boardKey(companyID, boardID)] {
		if strings.EqualFold(strings.TrimSpace(column.Title), "Pending") {
			return column.ColumnID
		}
	}
	return ""
}

func (r *MemoryRepo) addEmailProjectionLocked(companyID, nodeID string, message domain.EmailMessageSnapshot, now time.Time) {
	raw, _ := json.Marshal(message)
	informationID := newUUIDv7String()
	info := domain.NodeInformation{
		CompanyID:        companyID,
		InformationID:    informationID,
		NodeID:           nodeID,
		Type:             "Attached email",
		Information:      string(raw),
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	k := key(companyID, nodeID)
	r.nodeInfo[k] = append(r.nodeInfo[k], info)
	if r.nodeText[k] == nil {
		r.nodeText[k] = map[string]domain.NodeProjection{}
	}
	r.nodeText[k][informationID] = domain.NodeProjection{
		CompanyID:        companyID,
		NodeID:           nodeID,
		Type:             info.Type,
		Information:      info.Information,
		InformationID:    informationID,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
}

func normalizeEmailMessageSnapshot(message domain.EmailMessageSnapshot) domain.EmailMessageSnapshot {
	message.ID = strings.TrimSpace(message.ID)
	message.ThreadID = strings.TrimSpace(message.ThreadID)
	message.Subject = strings.TrimSpace(message.Subject)
	message.Snippet = strings.TrimSpace(message.Snippet)
	message.Body = strings.TrimSpace(message.Body)
	message.From = normalizeEmailAddressSnapshots(message.From)
	message.To = normalizeEmailAddressSnapshots(message.To)
	message.Cc = normalizeEmailAddressSnapshots(message.Cc)
	message.Bcc = normalizeEmailAddressSnapshots(message.Bcc)
	message.ReplyTo = normalizeEmailAddressSnapshots(message.ReplyTo)
	message.Folders = normalizeUniqueStrings(message.Folders, 100)
	message.FolderIDs = normalizeUniqueStrings(message.FolderIDs, 100)
	return message
}

func normalizeEmailAddressSnapshots(addresses []domain.EmailAddressSnapshot) []domain.EmailAddressSnapshot {
	out := make([]domain.EmailAddressSnapshot, 0, len(addresses))
	seen := map[string]bool{}
	for _, address := range addresses {
		email := strings.ToLower(strings.TrimSpace(address.Email))
		if email == "" || seen[email] {
			continue
		}
		seen[email] = true
		out = append(out, domain.EmailAddressSnapshot{Name: strings.TrimSpace(address.Name), Email: email})
	}
	return out
}

func normalizeUniqueStrings(values []string, limit int) []string {
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		clean := strings.TrimSpace(value)
		if clean == "" || seen[clean] {
			continue
		}
		seen[clean] = true
		out = append(out, clean)
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out
}

func emailNodeTitle(message domain.EmailMessageSnapshot) string {
	if subject := strings.TrimSpace(message.Subject); subject != "" {
		return subject
	}
	if len(message.From) > 0 {
		if message.From[0].Name != "" {
			return "Email from " + message.From[0].Name
		}
		if message.From[0].Email != "" {
			return "Email from " + message.From[0].Email
		}
	}
	return "Email"
}

func emailDescriptionSnapshot(message domain.EmailMessageSnapshot) string {
	if snippet := strings.TrimSpace(message.Snippet); snippet != "" {
		return snippet
	}
	return strings.TrimSpace(message.Body)
}
