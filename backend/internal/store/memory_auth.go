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

func (r *MemoryRepo) AcceptInvitation(token, cognitoSubject, email, displayName string) (domain.Invitation, error) {
	tokenHash := invitationTokenHash(token)
	cognitoSubject = strings.TrimSpace(cognitoSubject)
	email = normalizeEmail(email)
	displayName = strings.TrimSpace(displayName)
	if strings.TrimSpace(token) == "" || cognitoSubject == "" || email == "" || displayName == "" {
		return domain.Invitation{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	invitation, ok := r.invitations[tokenHash]
	if !ok || invitation.Status != domain.InvitationStatusPending || time.Now().UTC().After(invitation.ExpiresTimestamp) {
		return domain.Invitation{}, ErrNotFound
	}
	if invitation.Email != email {
		return domain.Invitation{}, ErrInvalid
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

func (r *MemoryRepo) CreatePasswordResetCode(input CreatePasswordResetCodeInput) (domain.PasswordResetCode, error) {
	email := normalizeEmail(input.Email)
	if email == "" {
		return domain.PasswordResetCode{}, ErrInvalid
	}
	ttl := input.ExpiresIn
	if ttl <= 0 {
		ttl = DefaultPasswordResetTTL
	}
	code, salt, hash, err := newPasswordResetCode()
	if err != nil {
		return domain.PasswordResetCode{}, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	for key, reset := range r.passwordResets {
		if reset.item.Email == email && reset.item.Status == domain.PasswordResetStatusPending {
			reset.item.Status = domain.PasswordResetStatusRevoked
			reset.item.Code = ""
			reset.item.UpdatedTimestamp = now
			r.passwordResets[key] = reset
		}
	}
	item := domain.PasswordResetCode{
		ResetID:          newUUIDv7String(),
		Email:            email,
		Status:           domain.PasswordResetStatusPending,
		Code:             code,
		ExpiresTimestamp: now.Add(ttl),
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.passwordResets[item.ResetID] = memoryPasswordResetCode{
		item:     item,
		codeHash: hash,
		codeSalt: salt,
	}
	return item, nil
}

func (r *MemoryRepo) ConsumePasswordResetCode(email, code string) (domain.PasswordResetCode, error) {
	email = normalizeEmail(email)
	code = strings.TrimSpace(code)
	if email == "" || code == "" {
		return domain.PasswordResetCode{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	var selected memoryPasswordResetCode
	var selectedKey string
	for key, reset := range r.passwordResets {
		if reset.item.Email != email || reset.item.Status != domain.PasswordResetStatusPending {
			continue
		}
		if selectedKey == "" || reset.item.CreatedTimestamp.After(selected.item.CreatedTimestamp) {
			selected = reset
			selectedKey = key
		}
	}
	if selectedKey == "" {
		return domain.PasswordResetCode{}, ErrNotFound
	}
	now := time.Now().UTC()
	if now.After(selected.item.ExpiresTimestamp) {
		selected.item.Status = domain.PasswordResetStatusRevoked
		selected.item.Code = ""
		selected.item.UpdatedTimestamp = now
		r.passwordResets[selectedKey] = selected
		return domain.PasswordResetCode{}, ErrExpired
	}
	if passwordResetCodeHash(selected.codeSalt, code) != selected.codeHash {
		return domain.PasswordResetCode{}, ErrInvalid
	}
	selected.item.Status = domain.PasswordResetStatusUsed
	selected.item.Code = ""
	selected.item.UsedTimestamp = &now
	selected.item.UpdatedTimestamp = now
	r.passwordResets[selectedKey] = selected
	return selected.item, nil
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

func (r *MemoryRepo) ListResourceAssignments(query ResourceAssignmentQuery) ([]domain.ResourceAssignment, error) {
	companyID := strings.TrimSpace(query.CompanyID)
	if companyID == "" {
		return nil, ErrInvalid
	}
	resourceType := strings.TrimSpace(query.ResourceType)
	resourceID := strings.TrimSpace(query.ResourceID)
	userID := strings.TrimSpace(query.UserID)

	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.ResourceAssignment, 0)
	for _, assignment := range r.assignments {
		if assignment.CompanyID != companyID {
			continue
		}
		if resourceType != "" && assignment.ResourceType != resourceType {
			continue
		}
		if resourceID != "" && assignment.ResourceID != resourceID {
			continue
		}
		if userID != "" && assignment.UserID != userID {
			continue
		}
		items = append(items, assignment)
	}
	slices.SortFunc(items, func(a, b domain.ResourceAssignment) int {
		if a.ResourceType != b.ResourceType {
			return strings.Compare(a.ResourceType, b.ResourceType)
		}
		if a.ResourceID != b.ResourceID {
			return strings.Compare(a.ResourceID, b.ResourceID)
		}
		return strings.Compare(a.UserID, b.UserID)
	})
	return items, nil
}

func (r *MemoryRepo) AssignResource(input ResourceAssignmentInput) (domain.ResourceAssignment, error) {
	companyID := strings.TrimSpace(input.CompanyID)
	resourceType, ok := normalizeResourceType(input.ResourceType)
	resourceID := strings.TrimSpace(input.ResourceID)
	userID := strings.TrimSpace(input.UserID)
	assignedByUserID := strings.TrimSpace(input.AssignedByUserID)
	if companyID == "" || !ok || resourceID == "" || userID == "" || assignedByUserID == "" {
		return domain.ResourceAssignment{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.memberships[membershipKey(companyID, userID)]; !ok {
		return domain.ResourceAssignment{}, ErrNotFound
	}
	now := time.Now().UTC()
	assignment := domain.ResourceAssignment{
		CompanyID:        companyID,
		ResourceType:     resourceType,
		ResourceID:       resourceID,
		UserID:           userID,
		AssignedByUserID: assignedByUserID,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	key := resourceAssignmentKey(companyID, resourceType, resourceID, userID)
	if existing, ok := r.assignments[key]; ok {
		assignment.CreatedTimestamp = existing.CreatedTimestamp
	}
	r.assignments[key] = assignment
	return assignment, nil
}

func (r *MemoryRepo) UnassignResource(companyID, resourceType, resourceID, userID string) error {
	companyID = strings.TrimSpace(companyID)
	resourceType, ok := normalizeResourceType(resourceType)
	resourceID = strings.TrimSpace(resourceID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || !ok || resourceID == "" || userID == "" {
		return ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	key := resourceAssignmentKey(companyID, resourceType, resourceID, userID)
	if _, ok := r.assignments[key]; !ok {
		return ErrNotFound
	}
	delete(r.assignments, key)
	return nil
}

func (r *MemoryRepo) UserHasResourceAssignment(companyID, userID, resourceType, resourceID string) (bool, error) {
	companyID = strings.TrimSpace(companyID)
	resourceType, ok := normalizeResourceType(resourceType)
	resourceID = strings.TrimSpace(resourceID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || !ok || resourceID == "" || userID == "" {
		return false, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	_, ok = r.assignments[resourceAssignmentKey(companyID, resourceType, resourceID, userID)]
	return ok, nil
}
