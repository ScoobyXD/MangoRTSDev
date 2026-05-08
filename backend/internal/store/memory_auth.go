package store

import (
	"miraeopus/backend/internal/domain"
	"slices"
	"strings"
	"time"
)

func (r *MemoryRepo) UpsertAuthUser(cognitoSubject, email, displayName string) (domain.User, error) {
	cognitoSubject = strings.TrimSpace(cognitoSubject)
	email = normalizeEmail(email)
	displayName = strings.TrimSpace(displayName)
	if cognitoSubject == "" {
		return domain.User{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	user, ok := r.users[cognitoSubject]
	if !ok {
		user = domain.User{
			UserID:           newUUIDv7String(),
			CognitoSubject:   cognitoSubject,
			Email:            email,
			DisplayName:      displayName,
			CreatedTimestamp: now,
			UpdatedTimestamp: now,
		}
	} else {
		if email != "" {
			user.Email = email
		}
		if displayName != "" {
			user.DisplayName = displayName
		}
		user.UpdatedTimestamp = now
	}
	r.users[cognitoSubject] = user
	return user, nil
}

func (r *MemoryRepo) GetAuthUser(cognitoSubject string) (domain.User, error) {
	cognitoSubject = strings.TrimSpace(cognitoSubject)
	if cognitoSubject == "" {
		return domain.User{}, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	user, ok := r.users[cognitoSubject]
	if !ok {
		return domain.User{}, ErrNotFound
	}
	return user, nil
}

func (r *MemoryRepo) GetAuthUserByEmail(email string) (domain.User, error) {
	email = normalizeEmail(email)
	if email == "" {
		return domain.User{}, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	for _, user := range r.users {
		if normalizeEmail(user.Email) == email {
			return user, nil
		}
	}
	return domain.User{}, ErrNotFound
}

func (r *MemoryRepo) ListUserMemberships(userID string) ([]domain.CompanyMembership, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.CompanyMembership, 0)
	for _, membership := range r.memberships {
		if membership.UserID == userID {
			if company, ok := r.companies[membership.CompanyID]; ok {
				membership.CompanyName = company.Name
			}
			items = append(items, membership)
		}
	}
	slices.SortFunc(items, func(a, b domain.CompanyMembership) int {
		if a.CompanyID < b.CompanyID {
			return -1
		}
		if a.CompanyID > b.CompanyID {
			return 1
		}
		return strings.Compare(a.Role, b.Role)
	})
	return items, nil
}

func (r *MemoryRepo) UserHasCompanyAccess(cognitoSubject, companyID string) (bool, error) {
	cognitoSubject = strings.TrimSpace(cognitoSubject)
	companyID = strings.TrimSpace(companyID)
	if cognitoSubject == "" || companyID == "" {
		return false, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	user, ok := r.users[cognitoSubject]
	if !ok {
		return false, nil
	}
	for _, membership := range r.memberships {
		if membership.UserID == user.UserID && membership.Role == domain.RoleDevAdmin {
			return true, nil
		}
	}
	_, ok = r.memberships[membershipKey(companyID, user.UserID)]
	return ok, nil
}

func (r *MemoryRepo) CreateCompany(name string) (domain.Company, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return domain.Company{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	company := domain.Company{
		CompanyID:        newUUIDv7String(),
		Name:             name,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.companies[company.CompanyID] = company
	return company, nil
}

func (r *MemoryRepo) EnsureCompany(companyID, name string) domain.Company {
	companyID = strings.TrimSpace(companyID)
	name = strings.TrimSpace(name)
	if name == "" {
		name = "MangoRTS Dev Company"
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	company, ok := r.companies[companyID]
	if !ok {
		company = domain.Company{
			CompanyID:        companyID,
			Name:             name,
			CreatedTimestamp: now,
			UpdatedTimestamp: now,
		}
	} else {
		company.Name = name
		company.UpdatedTimestamp = now
	}
	r.companies[companyID] = company
	return company
}

func (r *MemoryRepo) AddCompanyMembership(cognitoSubject, companyID, role string) (domain.CompanyMembership, error) {
	cognitoSubject = strings.TrimSpace(cognitoSubject)
	companyID = strings.TrimSpace(companyID)
	var ok bool
	role, ok = normalizeRole(role)
	if !ok {
		return domain.CompanyMembership{}, ErrInvalid
	}
	if cognitoSubject == "" || companyID == "" {
		return domain.CompanyMembership{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	user, ok := r.users[cognitoSubject]
	if !ok {
		return domain.CompanyMembership{}, ErrNotFound
	}
	now := time.Now().UTC()
	membership := domain.CompanyMembership{
		CompanyID:        companyID,
		UserID:           user.UserID,
		Role:             role,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.memberships[membershipKey(companyID, user.UserID)] = membership
	return membership, nil
}

func (r *MemoryRepo) ListCompanyUsers(companyID string) ([]domain.CompanyUser, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return nil, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.CompanyUser, 0)
	for _, membership := range r.memberships {
		if membership.CompanyID != companyID {
			continue
		}
		for _, user := range r.users {
			if user.UserID != membership.UserID {
				continue
			}
			items = append(items, domain.CompanyUser{
				CompanyID:        membership.CompanyID,
				UserID:           user.UserID,
				CognitoSubject:   user.CognitoSubject,
				Email:            user.Email,
				DisplayName:      user.DisplayName,
				Role:             membership.Role,
				CreatedTimestamp: membership.CreatedTimestamp,
				UpdatedTimestamp: membership.UpdatedTimestamp,
			})
			break
		}
	}
	slices.SortFunc(items, func(a, b domain.CompanyUser) int {
		aLabel := a.DisplayName
		if aLabel == "" {
			aLabel = a.Email
		}
		bLabel := b.DisplayName
		if bLabel == "" {
			bLabel = b.Email
		}
		return strings.Compare(aLabel, bLabel)
	})
	return items, nil
}

func (r *MemoryRepo) GetCompanyUser(companyID, userID string) (domain.CompanyUser, error) {
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return domain.CompanyUser{}, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	membership, ok := r.memberships[membershipKey(companyID, userID)]
	if !ok {
		return domain.CompanyUser{}, ErrNotFound
	}
	for _, user := range r.users {
		if user.UserID == userID {
			return domain.CompanyUser{
				CompanyID:        membership.CompanyID,
				UserID:           user.UserID,
				CognitoSubject:   user.CognitoSubject,
				Email:            user.Email,
				DisplayName:      user.DisplayName,
				Role:             membership.Role,
				CreatedTimestamp: membership.CreatedTimestamp,
				UpdatedTimestamp: membership.UpdatedTimestamp,
			}, nil
		}
	}
	return domain.CompanyUser{}, ErrNotFound
}

func (r *MemoryRepo) DeleteCompanyUser(companyID, userID string) (domain.CompanyUser, error) {
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return domain.CompanyUser{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	membership, ok := r.memberships[membershipKey(companyID, userID)]
	if !ok {
		return domain.CompanyUser{}, ErrNotFound
	}
	var user domain.User
	for _, candidate := range r.users {
		if candidate.UserID == userID {
			user = candidate
			break
		}
	}
	if user.UserID == "" {
		return domain.CompanyUser{}, ErrNotFound
	}
	deleted := domain.CompanyUser{
		CompanyID:        membership.CompanyID,
		UserID:           user.UserID,
		CognitoSubject:   user.CognitoSubject,
		Email:            user.Email,
		DisplayName:      user.DisplayName,
		Role:             membership.Role,
		CreatedTimestamp: membership.CreatedTimestamp,
		UpdatedTimestamp: membership.UpdatedTimestamp,
	}

	email := normalizeEmail(user.Email)
	for key, invitation := range r.invitations {
		if normalizeEmail(invitation.Email) == email || invitation.InvitedByUserID == userID || (invitation.AcceptedByUserID != nil && *invitation.AcceptedByUserID == userID) {
			delete(r.invitations, key)
		}
	}
	for key, membership := range r.memberships {
		if membership.UserID == userID {
			delete(r.memberships, key)
		}
	}
	delete(r.emailConnections, userID)
	for key, node := range r.nodes {
		if node.AssigneeUserID != nil && *node.AssigneeUserID == userID {
			node.AssigneeUserID = nil
			r.nodes[key] = node
		}
	}
	delete(r.users, user.CognitoSubject)
	return deleted, nil
}

func (r *MemoryRepo) CreateInvitation(input CreateInvitationInput) (domain.Invitation, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	email := normalizeEmail(input.Email)
	role, ok := normalizeInvitableRole(input.Role)
	invitedByUserID := strings.TrimSpace(input.InvitedByUserID)
	if companyID == "" || email == "" || invitedByUserID == "" || !ok {
		return domain.Invitation{}, ErrInvalid
	}
	ttl := input.ExpiresIn
	if ttl <= 0 {
		ttl = DefaultInvitationTTL
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.companies[companyID]; !ok {
		return domain.Invitation{}, ErrNotFound
	}
	if !r.userCanCreateInvitationLocked(invitedByUserID, companyID) {
		return domain.Invitation{}, ErrInvalid
	}
	for _, user := range r.users {
		if normalizeEmail(user.Email) == email {
			return domain.Invitation{}, ErrAlreadyExists
		}
	}
	token, tokenHash, err := newInvitationToken()
	if err != nil {
		return domain.Invitation{}, err
	}
	now := time.Now().UTC()
	for existingTokenHash, existing := range r.invitations {
		if existing.CompanyID == companyID && existing.Email == email && existing.Status == domain.InvitationStatusPending {
			existing.Status = domain.InvitationStatusRevoked
			existing.Token = ""
			existing.UpdatedTimestamp = now
			r.invitations[existingTokenHash] = existing
		}
	}
	invitation := domain.Invitation{
		InvitationID:     newUUIDv7String(),
		CompanyID:        companyID,
		CompanyName:      r.companies[companyID].Name,
		Email:            email,
		Role:             role,
		Status:           domain.InvitationStatusPending,
		Token:            token,
		InvitedByUserID:  invitedByUserID,
		ExpiresTimestamp: now.Add(ttl),
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.invitations[tokenHash] = invitation
	return invitation, nil
}

func (r *MemoryRepo) ValidateInvitationToken(token string) (domain.Invitation, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return domain.Invitation{}, ErrInvalid
	}
	tokenHash := invitationTokenHash(token)

	r.mu.RLock()
	defer r.mu.RUnlock()

	invitation, ok := r.invitations[tokenHash]
	if !ok {
		return domain.Invitation{}, ErrInvitationBadToken
	}
	if company, ok := r.companies[invitation.CompanyID]; ok {
		invitation.CompanyName = company.Name
	}
	invitation.Token = ""
	if err := invitationAvailabilityError(invitation, time.Now().UTC()); err != nil {
		return domain.Invitation{}, err
	}
	return invitation, nil
}

func (r *MemoryRepo) AcceptInvitation(token, cognitoSubject, email, displayName string) (domain.Invitation, error) {
	token = strings.TrimSpace(token)
	cognitoSubject = strings.TrimSpace(cognitoSubject)
	email = normalizeEmail(email)
	displayName = strings.TrimSpace(displayName)
	if token == "" || cognitoSubject == "" || email == "" || displayName == "" {
		return domain.Invitation{}, ErrInvalid
	}
	tokenHash := invitationTokenHash(token)

	r.mu.Lock()
	defer r.mu.Unlock()

	invitation, ok := r.invitations[tokenHash]
	if !ok {
		return domain.Invitation{}, ErrInvitationBadToken
	}
	if err := invitationAvailabilityError(invitation, time.Now().UTC()); err != nil {
		return domain.Invitation{}, err
	}
	if invitation.Email != email {
		return domain.Invitation{}, ErrInvitationEmailMismatch
	}
	if company, ok := r.companies[invitation.CompanyID]; ok {
		invitation.CompanyName = company.Name
	}
	user, ok := r.users[cognitoSubject]
	if !ok {
		now := time.Now().UTC()
		user = domain.User{
			UserID:           newUUIDv7String(),
			CognitoSubject:   cognitoSubject,
			Email:            email,
			DisplayName:      displayName,
			CreatedTimestamp: now,
			UpdatedTimestamp: now,
		}
		r.users[cognitoSubject] = user
	} else {
		user.Email = email
		user.DisplayName = displayName
		user.UpdatedTimestamp = time.Now().UTC()
		r.users[cognitoSubject] = user
	}
	now := time.Now().UTC()
	r.memberships[membershipKey(invitation.CompanyID, user.UserID)] = domain.CompanyMembership{
		CompanyID:        invitation.CompanyID,
		UserID:           user.UserID,
		Role:             invitation.Role,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	invitation.Status = domain.InvitationStatusAccepted
	invitation.AcceptedByUserID = &user.UserID
	invitation.AcceptedTimestamp = &now
	invitation.UpdatedTimestamp = now
	invitation.Token = ""
	r.invitations[tokenHash] = invitation
	return invitation, nil
}

func (r *MemoryRepo) userCanCreateInvitationLocked(userID, companyID string) bool {
	userID = strings.TrimSpace(userID)
	companyID = strings.TrimSpace(companyID)
	if userID == "" || companyID == "" {
		return false
	}
	for _, membership := range r.memberships {
		if membership.UserID == userID && membership.Role == domain.RoleDevAdmin {
			return true
		}
	}
	membership, ok := r.memberships[membershipKey(companyID, userID)]
	return ok && membership.Role == domain.RoleCompanyAdmin
}
