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

	user, ok := r.userByIDLocked(userID)
	if !ok {
		return domain.UserEmailConnection{}, ErrNotFound
	}
	connection, ok := r.emailConnections[emailConnectionKey(userID, user.Email)]
	if ok && emailConnectionIsPersonal(connection) {
		return connection, nil
	}
	connection, _, ok = r.personalEmailConnectionForUserLocked(userID)
	if !ok {
		return domain.UserEmailConnection{}, ErrNotFound
	}
	return connection, nil
}

func (r *MemoryRepo) GetCompanyEmailConnectionByAccountEmail(companyID, accountEmail string) (domain.UserEmailConnection, error) {
	companyID = strings.TrimSpace(companyID)
	accountEmail = normalizeEmail(accountEmail)
	if companyID == "" || accountEmail == "" {
		return domain.UserEmailConnection{}, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	var found domain.UserEmailConnection
	hasFound := false
	for _, connection := range r.emailConnections {
		if connection.Status != "connected" || normalizeEmail(connection.AccountEmail) != accountEmail {
			continue
		}
		if _, ok := r.memberships[membershipKey(companyID, connection.UserID)]; !ok {
			continue
		}
		if !hasFound || connection.UpdatedTimestamp.After(found.UpdatedTimestamp) {
			found = connection
			hasFound = true
		}
	}
	if !hasFound {
		return domain.UserEmailConnection{}, ErrNotFound
	}
	return found, nil
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
	scope := normalizeEmailConnectionScope(input.Scope)
	grantID := strings.TrimSpace(input.GrantID)
	status := normalizeEmailConnectionStatus(input.Status)
	if userID == "" || provider == "" || accountEmail == "" || scope == "" || grantID == "" || status == "" {
		return domain.UserEmailConnection{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if !r.userIDExistsLocked(userID) {
		return domain.UserEmailConnection{}, ErrNotFound
	}

	now := time.Now().UTC()
	connection := r.emailConnections[emailConnectionKey(userID, accountEmail)]
	if connection.CreatedTimestamp.IsZero() {
		connection.CreatedTimestamp = now
	}
	connection.UserID = userID
	connection.Provider = provider
	connection.AccountEmail = accountEmail
	connection.Scope = scope
	connection.GrantID = grantID
	connection.Status = status
	connection.UpdatedTimestamp = now
	r.emailConnections[emailConnectionKey(userID, accountEmail)] = connection
	return connection, nil
}

func (r *MemoryRepo) UpdateUserEmailConnectionStatus(userID, accountEmail, status string) (domain.UserEmailConnection, error) {
	userID = strings.TrimSpace(userID)
	accountEmail = normalizeEmail(accountEmail)
	status = normalizeEmailConnectionStatus(status)
	if userID == "" || accountEmail == "" || status == "" {
		return domain.UserEmailConnection{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	connection, ok := r.emailConnections[emailConnectionKey(userID, accountEmail)]
	if !ok {
		return domain.UserEmailConnection{}, ErrNotFound
	}
	connection.Status = status
	connection.UpdatedTimestamp = time.Now().UTC()
	r.emailConnections[emailConnectionKey(userID, accountEmail)] = connection
	return connection, nil
}

func (r *MemoryRepo) DeleteUserEmailConnection(userID string) error {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	user, ok := r.userByIDLocked(userID)
	if !ok {
		return ErrNotFound
	}
	key := emailConnectionKey(userID, user.Email)
	if connection, ok := r.emailConnections[key]; ok && emailConnectionIsPersonal(connection) {
		delete(r.emailConnections, key)
		return nil
	}
	_, key, ok = r.personalEmailConnectionForUserLocked(userID)
	if !ok {
		return ErrNotFound
	}
	delete(r.emailConnections, key)
	return nil
}

func (r *MemoryRepo) personalEmailConnectionForUserLocked(userID string) (domain.UserEmailConnection, string, bool) {
	var found domain.UserEmailConnection
	foundKey := ""
	hasFound := false
	for key, connection := range r.emailConnections {
		if connection.UserID != userID {
			continue
		}
		if !emailConnectionIsPersonal(connection) {
			continue
		}
		if r.emailConnectionAccountAssignedToSharedInboxLocked(userID, connection.AccountEmail) {
			continue
		}
		if !hasFound || connection.UpdatedTimestamp.After(found.UpdatedTimestamp) {
			found = connection
			foundKey = key
			hasFound = true
		}
	}
	return found, foundKey, hasFound
}

func (r *MemoryRepo) emailConnectionAccountAssignedToSharedInboxLocked(userID, accountEmail string) bool {
	accountEmail = normalizeEmail(accountEmail)
	if accountEmail == "" {
		return false
	}
	for _, folder := range r.folders {
		if folder.FolderKind != "communications" || folder.AccountEmail == nil || normalizeEmail(*folder.AccountEmail) != accountEmail {
			continue
		}
		if _, ok := r.memberships[membershipKey(folder.CompanyID, userID)]; ok {
			return true
		}
	}
	return false
}

func (r *MemoryRepo) UpsertCommunicationsMessageReadStatus(input CommunicationsMessageReadStatusInput) (domain.CommunicationsMessageReadStatus, error) {
	userID := strings.TrimSpace(input.UserID)
	messageID := strings.TrimSpace(input.MessageID)
	threadID := strings.TrimSpace(input.ThreadID)
	status := normalizeCommunicationsMessageReadStatus(input.Status)
	if userID == "" || messageID == "" || status == "" {
		return domain.CommunicationsMessageReadStatus{}, ErrInvalid
	}

	signalAt := input.SignalTimestamp.UTC()
	if signalAt.IsZero() {
		signalAt = time.Now().UTC()
	}
	signalCount := input.SignalCount
	if signalCount < 0 {
		signalCount = 0
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if !r.userIDExistsLocked(userID) {
		return domain.CommunicationsMessageReadStatus{}, ErrNotFound
	}

	now := time.Now().UTC()
	key := communicationsMessageReadStatusKey(userID, messageID)
	next := r.messageReadStatuses[key]
	if next.CreatedTimestamp.IsZero() {
		next.CreatedTimestamp = now
		next.FirstSignalTimestamp = signalAt
		next.SignalCount = 1
	}
	if next.FirstSignalTimestamp.IsZero() || signalAt.Before(next.FirstSignalTimestamp) {
		next.FirstSignalTimestamp = signalAt
	}
	if next.LastSignalTimestamp.IsZero() || signalAt.After(next.LastSignalTimestamp) {
		next.LastSignalTimestamp = signalAt
	}
	if signalCount > 0 {
		if signalCount > next.SignalCount {
			next.SignalCount = signalCount
		}
	} else {
		next.SignalCount++
	}
	if next.SignalCount <= 0 {
		next.SignalCount = 1
	}
	if threadID != "" {
		next.ThreadID = threadID
	}
	next.UserID = userID
	next.MessageID = messageID
	next.Status = strongestCommunicationsMessageReadStatus(next.Status, status)
	next.UpdatedTimestamp = now
	r.messageReadStatuses[key] = next
	return next, nil
}

func (r *MemoryRepo) ListCommunicationsMessageReadStatuses(userID string, messageIDs []string) ([]domain.CommunicationsMessageReadStatus, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, ErrInvalid
	}
	ids := normalizeUniqueStrings(messageIDs, 0)
	if len(ids) == 0 {
		return []domain.CommunicationsMessageReadStatus{}, nil
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	statuses := make([]domain.CommunicationsMessageReadStatus, 0, len(ids))
	for _, messageID := range ids {
		if status, ok := r.messageReadStatuses[communicationsMessageReadStatusKey(userID, messageID)]; ok {
			statuses = append(statuses, status)
		}
	}
	return statuses, nil
}

func (r *MemoryRepo) userIDExistsLocked(userID string) bool {
	_, ok := r.userByIDLocked(userID)
	return ok
}

func (r *MemoryRepo) userByIDLocked(userID string) (domain.User, bool) {
	for _, user := range r.users {
		if user.UserID == userID {
			return user, true
		}
	}
	return domain.User{}, false
}

func emailConnectionKey(userID, accountEmail string) string {
	return strings.TrimSpace(userID) + "\x1f" + normalizeEmail(accountEmail)
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

func communicationsMessageReadStatusKey(userID, messageID string) string {
	return strings.TrimSpace(userID) + ":" + strings.TrimSpace(messageID)
}

func normalizeCommunicationsMessageReadStatus(status string) string {
	switch strings.TrimSpace(strings.ToLower(status)) {
	case "", "likely_read", "opened", "open":
		return "likely_read"
	case "read":
		return "read"
	default:
		return ""
	}
}

func strongestCommunicationsMessageReadStatus(current, next string) string {
	if normalizeCommunicationsMessageReadStatus(current) == "read" || normalizeCommunicationsMessageReadStatus(next) == "read" {
		return "read"
	}
	return "likely_read"
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

func normalizeEmailConnectionScope(scope string) string {
	switch strings.TrimSpace(strings.ToLower(scope)) {
	case "", "personal":
		return "personal"
	case "shared", "shared_inbox":
		return "shared"
	default:
		return ""
	}
}

func emailConnectionIsPersonal(connection domain.UserEmailConnection) bool {
	return normalizeEmailConnectionScope(connection.Scope) == "personal"
}
