package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

func (r *MemoryRepo) GetUserEmailConnection(userID string) (domain.UserEmailConnection, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return domain.UserEmailConnection{}, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	connection, ok := r.emailConnections[userID]
	if !ok {
		return domain.UserEmailConnection{}, ErrNotFound
	}
	return connection, nil
}

func (r *MemoryRepo) GetUserEmailConnectionByGrantID(grantID string) (domain.UserEmailConnection, error) {
	grantID = strings.TrimSpace(grantID)
	if grantID == "" {
		return domain.UserEmailConnection{}, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	for _, connection := range r.emailConnections {
		if connection.GrantID == grantID {
			return connection, nil
		}
	}
	return domain.UserEmailConnection{}, ErrNotFound
}

func (r *MemoryRepo) UpsertUserEmailConnection(input UserEmailConnectionInput) (domain.UserEmailConnection, error) {
	userID := strings.TrimSpace(input.UserID)
	provider := normalizeEmailProvider(input.Provider)
	accountEmail := normalizeEmail(input.AccountEmail)
	grantID := strings.TrimSpace(input.GrantID)
	status := normalizeEmailConnectionStatus(input.Status)
	if userID == "" || provider == "" || accountEmail == "" || grantID == "" || status == "" {
		return domain.UserEmailConnection{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if !r.userIDExistsLocked(userID) {
		return domain.UserEmailConnection{}, ErrNotFound
	}

	now := time.Now().UTC()
	connection := r.emailConnections[userID]
	if connection.CreatedTimestamp.IsZero() {
		connection.CreatedTimestamp = now
	}
	connection.UserID = userID
	connection.Provider = provider
	connection.AccountEmail = accountEmail
	connection.GrantID = grantID
	connection.Status = status
	connection.UpdatedTimestamp = now
	r.emailConnections[userID] = connection
	return connection, nil
}

func (r *MemoryRepo) UpdateUserEmailConnectionStatus(userID, status string) (domain.UserEmailConnection, error) {
	userID = strings.TrimSpace(userID)
	status = normalizeEmailConnectionStatus(status)
	if userID == "" || status == "" {
		return domain.UserEmailConnection{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	connection, ok := r.emailConnections[userID]
	if !ok {
		return domain.UserEmailConnection{}, ErrNotFound
	}
	connection.Status = status
	connection.UpdatedTimestamp = time.Now().UTC()
	r.emailConnections[userID] = connection
	return connection, nil
}

func (r *MemoryRepo) DeleteUserEmailConnection(userID string) error {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.emailConnections[userID]; !ok {
		return ErrNotFound
	}
	delete(r.emailConnections, userID)
	return nil
}

func communicationsMessageKey(companyID, messageID string) string {
	return strings.TrimSpace(companyID) + ":" + strings.TrimSpace(messageID)
}

func communicationsDraftKey(companyID, messageID, userID string) string {
	return communicationsMessageKey(companyID, messageID) + ":" + strings.TrimSpace(userID)
}

func defaultCommunicationsMessageState(companyID, messageID string) domain.CommunicationsMessageState {
	now := time.Now().UTC()
	return domain.CommunicationsMessageState{
		CompanyID:        strings.TrimSpace(companyID),
		MessageID:        strings.TrimSpace(messageID),
		SharedInbox:      false,
		Status:           "open",
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
}

func (r *MemoryRepo) GetCommunicationsMessageState(companyID, messageID string) (domain.CommunicationsMessageState, error) {
	companyID = strings.TrimSpace(companyID)
	messageID = strings.TrimSpace(messageID)
	if companyID == "" || messageID == "" {
		return domain.CommunicationsMessageState{}, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	item, ok := r.communicationsMessageStates[communicationsMessageKey(companyID, messageID)]
	if !ok {
		return defaultCommunicationsMessageState(companyID, messageID), nil
	}
	return item, nil
}

func (r *MemoryRepo) UpsertCommunicationsMessageState(input CommunicationsMessageStateInput) (domain.CommunicationsMessageState, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	messageID := strings.TrimSpace(input.MessageID)
	if companyID == "" || messageID == "" {
		return domain.CommunicationsMessageState{}, ErrInvalid
	}
	status := ""
	if input.StatusSet {
		status = normalizeCommunicationsMessageStatus(input.Status)
		if status == "" {
			return domain.CommunicationsMessageState{}, ErrInvalid
		}
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	k := communicationsMessageKey(companyID, messageID)
	item, ok := r.communicationsMessageStates[k]
	if !ok {
		item = defaultCommunicationsMessageState(companyID, messageID)
		item.CreatedTimestamp = now
	}
	if input.SharedInboxSet {
		item.SharedInbox = input.SharedInbox
	}
	if input.StatusSet {
		item.Status = status
	}
	if input.AssignedUserIDSet {
		item.AssignedUserID = cleanOptionalID(input.AssignedUserID)
	}
	if input.LinkedNodeIDSet {
		item.LinkedNodeID = cleanOptionalID(input.LinkedNodeID)
	}
	item.UpdatedTimestamp = now
	r.communicationsMessageStates[k] = item
	return item, nil
}

func (r *MemoryRepo) ListCommunicationsMessageComments(companyID, messageID string) ([]domain.CommunicationsMessageComment, error) {
	companyID = strings.TrimSpace(companyID)
	messageID = strings.TrimSpace(messageID)
	if companyID == "" || messageID == "" {
		return nil, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	items := append([]domain.CommunicationsMessageComment{}, r.communicationsComments[communicationsMessageKey(companyID, messageID)]...)
	return items, nil
}

func (r *MemoryRepo) CreateCommunicationsMessageComment(input CommunicationsMessageCommentInput) (domain.CommunicationsMessageComment, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	messageID := strings.TrimSpace(input.MessageID)
	userID := strings.TrimSpace(input.UserID)
	body := strings.TrimSpace(input.Body)
	if companyID == "" || messageID == "" || userID == "" || body == "" {
		return domain.CommunicationsMessageComment{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	k := communicationsMessageKey(companyID, messageID)
	if _, ok := r.communicationsMessageStates[k]; !ok {
		r.communicationsMessageStates[k] = defaultCommunicationsMessageState(companyID, messageID)
	}
	item := domain.CommunicationsMessageComment{
		CompanyID:        companyID,
		MessageID:        messageID,
		CommentID:        newUUIDv7String(),
		UserID:           userID,
		Body:             body,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.communicationsComments[k] = append(r.communicationsComments[k], item)
	return item, nil
}

func (r *MemoryRepo) ListCommunicationsSharedDrafts(companyID, messageID string) ([]domain.CommunicationsSharedDraft, error) {
	companyID = strings.TrimSpace(companyID)
	messageID = strings.TrimSpace(messageID)
	if companyID == "" || messageID == "" {
		return nil, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	prefix := communicationsMessageKey(companyID, messageID) + ":"
	items := make([]domain.CommunicationsSharedDraft, 0)
	for key, item := range r.communicationsDrafts {
		if strings.HasPrefix(key, prefix) {
			items = append(items, item)
		}
	}
	return items, nil
}

func (r *MemoryRepo) UpsertCommunicationsSharedDraft(input CommunicationsSharedDraftInput) (domain.CommunicationsSharedDraft, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	messageID := strings.TrimSpace(input.MessageID)
	userID := strings.TrimSpace(input.UserID)
	subject := strings.TrimSpace(input.Subject)
	body := strings.TrimSpace(input.Body)
	if companyID == "" || messageID == "" || userID == "" || (subject == "" && body == "") {
		return domain.CommunicationsSharedDraft{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	stateKey := communicationsMessageKey(companyID, messageID)
	if _, ok := r.communicationsMessageStates[stateKey]; !ok {
		r.communicationsMessageStates[stateKey] = defaultCommunicationsMessageState(companyID, messageID)
	}
	k := communicationsDraftKey(companyID, messageID, userID)
	item, ok := r.communicationsDrafts[k]
	if !ok {
		item = domain.CommunicationsSharedDraft{
			CompanyID:        companyID,
			MessageID:        messageID,
			DraftID:          newUUIDv7String(),
			UserID:           userID,
			CreatedTimestamp: now,
		}
	}
	item.Subject = subject
	item.Body = body
	item.UpdatedTimestamp = now
	r.communicationsDrafts[k] = item
	return item, nil
}

func (r *MemoryRepo) ListCommunicationsReadReceipts(companyID, messageID string) ([]domain.CommunicationsReadReceipt, error) {
	companyID = strings.TrimSpace(companyID)
	messageID = strings.TrimSpace(messageID)
	if companyID == "" || messageID == "" {
		return nil, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	prefix := communicationsMessageKey(companyID, messageID) + ":"
	items := make([]domain.CommunicationsReadReceipt, 0)
	for key, item := range r.communicationsReadReceipts {
		if strings.HasPrefix(key, prefix) {
			items = append(items, item)
		}
	}
	return items, nil
}

func (r *MemoryRepo) UpsertCommunicationsReadReceipt(companyID, messageID, userID string) (domain.CommunicationsReadReceipt, error) {
	companyID = strings.TrimSpace(companyID)
	messageID = strings.TrimSpace(messageID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || messageID == "" || userID == "" {
		return domain.CommunicationsReadReceipt{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	stateKey := communicationsMessageKey(companyID, messageID)
	if _, ok := r.communicationsMessageStates[stateKey]; !ok {
		r.communicationsMessageStates[stateKey] = defaultCommunicationsMessageState(companyID, messageID)
	}
	item := domain.CommunicationsReadReceipt{
		CompanyID:     companyID,
		MessageID:     messageID,
		UserID:        userID,
		ReadTimestamp: time.Now().UTC(),
	}
	r.communicationsReadReceipts[communicationsDraftKey(companyID, messageID, userID)] = item
	return item, nil
}

func (r *MemoryRepo) userIDExistsLocked(userID string) bool {
	for _, user := range r.users {
		if user.UserID == userID {
			return true
		}
	}
	return false
}

func cleanOptionalID(value *string) *string {
	if value == nil {
		return nil
	}
	cleaned := strings.TrimSpace(*value)
	if cleaned == "" {
		return nil
	}
	return &cleaned
}

func normalizeCommunicationsMessageStatus(status string) string {
	switch strings.TrimSpace(strings.ToLower(status)) {
	case "", "open":
		return "open"
	case "pending":
		return "pending"
	case "resolved":
		return "resolved"
	default:
		return ""
	}
}

func normalizeEmailProvider(provider string) string {
	switch strings.TrimSpace(strings.ToLower(provider)) {
	case "google", "gmail":
		return "google"
	case "microsoft", "outlook", "office365":
		return "microsoft"
	default:
		return ""
	}
}

func normalizeEmailConnectionStatus(status string) string {
	switch strings.TrimSpace(strings.ToLower(status)) {
	case "", "connected":
		return "connected"
	case "disconnected":
		return "disconnected"
	case "reauth_required":
		return "reauth_required"
	default:
		return ""
	}
}
