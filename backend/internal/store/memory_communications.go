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
	return domain.UserEmailConnection{}, ErrNotFound
}

func (r *MemoryRepo) ListUserEmailConnections(userID string) ([]domain.UserEmailConnection, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	if !r.userIDExistsLocked(userID) {
		return nil, ErrNotFound
	}
	connections := make([]domain.UserEmailConnection, 0)
	for _, connection := range r.emailConnections {
		if connection.UserID == userID {
			connections = append(connections, connection)
		}
	}
	return connections, nil
}

func (r *MemoryRepo) GetCompanyEmailConnectionByAccountEmail(companyID, accountEmail string) (domain.CompanyEmailConnection, error) {
	companyID = strings.TrimSpace(companyID)
	accountEmail = normalizeEmail(accountEmail)
	if companyID == "" || accountEmail == "" {
		return domain.CompanyEmailConnection{}, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	for _, connection := range r.companyEmailConnections {
		if connection.CompanyID == companyID && normalizeEmail(connection.AccountEmail) == accountEmail {
			return connection, nil
		}
	}
	return domain.CompanyEmailConnection{}, ErrNotFound
}

func (r *MemoryRepo) GetCompanyEmailConnectionByID(companyID, connectionID string) (domain.CompanyEmailConnection, error) {
	companyID = strings.TrimSpace(companyID)
	connectionID = strings.TrimSpace(connectionID)
	if companyID == "" || connectionID == "" {
		return domain.CompanyEmailConnection{}, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	connection, ok := r.companyEmailConnections[companyEmailConnectionKey(companyID, connectionID)]
	if !ok {
		return domain.CompanyEmailConnection{}, ErrNotFound
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
	connectionKey := emailConnectionKey(userID, accountEmail)
	for existingKey, existing := range r.emailConnections {
		if existing.GrantID == grantID && existingKey != connectionKey {
			delete(r.emailConnections, existingKey)
		}
	}
	connection := r.emailConnections[connectionKey]
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
	r.emailConnections[connectionKey] = connection
	if scope == "shared" {
		for _, membership := range r.memberships {
			if membership.UserID != userID {
				continue
			}
			existingConnectionID := ""
			for _, existing := range r.companyEmailConnections {
				if existing.CompanyID == membership.CompanyID && normalizeEmail(existing.AccountEmail) == accountEmail {
					existingConnectionID = existing.CompanyEmailConnectionID
					break
				}
			}
			if existingConnectionID == "" {
				existingConnectionID = newUUIDv7String()
			}
			companyKey := companyEmailConnectionKey(membership.CompanyID, existingConnectionID)
			companyConnection := r.companyEmailConnections[companyKey]
			if companyConnection.CreatedTimestamp.IsZero() {
				companyConnection.CreatedTimestamp = now
			}
			companyConnection.CompanyEmailConnectionID = existingConnectionID
			companyConnection.CompanyID = membership.CompanyID
			companyConnection.Provider = provider
			companyConnection.AccountEmail = accountEmail
			companyConnection.GrantID = grantID
			companyConnection.Status = status
			companyConnection.ConnectedByUserID = userID
			companyConnection.UpdatedTimestamp = now
			r.companyEmailConnections[companyKey] = companyConnection
		}
	}
	return connection, nil
}

func (r *MemoryRepo) UpsertCompanyEmailConnection(input CompanyEmailConnectionInput) (domain.CompanyEmailConnection, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	connectionID := strings.TrimSpace(input.CompanyEmailConnectionID)
	provider := normalizeEmailProvider(input.Provider)
	accountEmail := normalizeEmail(input.AccountEmail)
	grantID := strings.TrimSpace(input.GrantID)
	status := normalizeEmailConnectionStatus(input.Status)
	connectedByUserID := strings.TrimSpace(input.ConnectedByUserID)
	if companyID == "" || provider == "" || accountEmail == "" || grantID == "" || status == "" {
		return domain.CompanyEmailConnection{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.companies[companyID]; !ok {
		return domain.CompanyEmailConnection{}, ErrNotFound
	}
	if connectedByUserID != "" && !r.userIDExistsLocked(connectedByUserID) {
		return domain.CompanyEmailConnection{}, ErrNotFound
	}

	for _, existing := range r.companyEmailConnections {
		if existing.CompanyID == companyID && normalizeEmail(existing.AccountEmail) == accountEmail {
			connectionID = existing.CompanyEmailConnectionID
			break
		}
	}
	if connectionID == "" {
		connectionID = newUUIDv7String()
	}
	connectionKey := companyEmailConnectionKey(companyID, connectionID)
	for existingKey, existing := range r.companyEmailConnections {
		if existing.CompanyID == companyID && existing.GrantID == grantID && existingKey != connectionKey {
			delete(r.companyEmailConnections, existingKey)
		}
	}

	now := time.Now().UTC()
	connection := r.companyEmailConnections[connectionKey]
	if connection.CreatedTimestamp.IsZero() {
		connection.CreatedTimestamp = now
	}
	connection.CompanyEmailConnectionID = connectionID
	connection.CompanyID = companyID
	connection.Provider = provider
	connection.AccountEmail = accountEmail
	connection.GrantID = grantID
	connection.Status = status
	connection.ConnectedByUserID = connectedByUserID
	connection.UpdatedTimestamp = now
	r.companyEmailConnections[connectionKey] = connection
	return connection, nil
}

func (r *MemoryRepo) UpdateCompanyEmailConnectionStatus(companyID, connectionID, status string) (domain.CompanyEmailConnection, error) {
	companyID = strings.TrimSpace(companyID)
	connectionID = strings.TrimSpace(connectionID)
	status = normalizeEmailConnectionStatus(status)
	if companyID == "" || connectionID == "" || status == "" {
		return domain.CompanyEmailConnection{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	connectionKey := companyEmailConnectionKey(companyID, connectionID)
	connection, ok := r.companyEmailConnections[connectionKey]
	if !ok {
		return domain.CompanyEmailConnection{}, ErrNotFound
	}
	connection.Status = status
	connection.UpdatedTimestamp = time.Now().UTC()
	r.companyEmailConnections[connectionKey] = connection
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
	return ErrNotFound
}

func (r *MemoryRepo) personalEmailConnectionForUserLocked(userID string) (domain.UserEmailConnection, string, bool) {
	user, ok := r.userByIDLocked(userID)
	if !ok {
		return domain.UserEmailConnection{}, "", false
	}
	key := emailConnectionKey(userID, user.Email)
	connection, ok := r.emailConnections[key]
	if !ok || !emailConnectionIsPersonal(connection) {
		return domain.UserEmailConnection{}, "", false
	}
	return connection, key, true
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

func companyEmailConnectionKey(companyID, connectionID string) string {
	return strings.TrimSpace(companyID) + "\x1f" + strings.TrimSpace(connectionID)
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
