package store

import (
	"context"
	"maps"
	"miraeopus/backend/internal/domain"
	"slices"
	"strings"
	"time"
)

func (r *MemoryRepo) UpsertAuthUser(cognitoSubject, email, displayName string) (domain.User, error) {
	cognitoSubject = strings.TrimSpace(cognitoSubject)
	email = normalizeEmail(email)
	if cognitoSubject == "" {
		return domain.User{}, ErrInvalid
	}
	insertDisplayName := authInsertDisplayName(cognitoSubject, email, displayName)
	updateDisplayName := authoritativeAuthDisplayName(displayName, email)

	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	user, ok := r.users[cognitoSubject]
	if !ok {
		user = domain.User{
			UserID:           newUUIDv7String(),
			CognitoSubject:   cognitoSubject,
			Email:            email,
			DisplayName:      insertDisplayName,
			CreatedTimestamp: now,
			UpdatedTimestamp: now,
		}
		r.users[cognitoSubject] = user
		return user, nil
	}

	updated := user
	if email != "" {
		updated.Email = email
	}
	if updateDisplayName != "" {
		updated.DisplayName = updateDisplayName
	}
	if updated.Email == user.Email && updated.DisplayName == user.DisplayName {
		return user, nil
	}
	updated.UpdatedTimestamp = now
	r.users[cognitoSubject] = updated
	companyIDs := make([]string, 0)
	for _, membership := range r.memberships {
		if membership.UserID == user.UserID {
			companyIDs = append(companyIDs, membership.CompanyID)
		}
	}
	if _, err := r.appendDomainEventsLocked(companyMembershipEventInputs(companyIDs, CompanyUserProfileUpdatedEventType, user.UserID)); err != nil {
		r.users[cognitoSubject] = user
		return domain.User{}, err
	}
	return updated, nil
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
	return r.ListUserMembershipsContext(context.Background(), userID)
}

func (r *MemoryRepo) ListUserMembershipsContext(ctx context.Context, userID string) ([]domain.CompanyMembership, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
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

	snapshot := r.snapshotProcessMapMutationLocked()
	entityTypesSnapshot := maps.Clone(r.entityTypes)
	entityFieldTypesSnapshot := maps.Clone(r.entityFieldTypes)
	now := time.Now().UTC()
	company := domain.Company{
		CompanyID:        newUUIDv7String(),
		Name:             name,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	r.companies[company.CompanyID] = company
	r.ensureCompanyExplorerV2CompanyGraphLocked(company.CompanyID)
	defaultFolders := r.ensureCompanyExplorerDefaultFoldersLocked(company.CompanyID)
	if err := r.syncMemoryDefaultFolderProcessMapPlacementsLocked(company.CompanyID, defaultFolders); err != nil {
		r.restoreProcessMapMutationLocked(snapshot)
		r.entityTypes = entityTypesSnapshot
		r.entityFieldTypes = entityFieldTypesSnapshot
		return domain.Company{}, err
	}
	if err := r.ensureActionItemDefaultsLocked(company.CompanyID); err != nil {
		r.restoreProcessMapMutationLocked(snapshot)
		r.entityTypes = entityTypesSnapshot
		r.entityFieldTypes = entityFieldTypesSnapshot
		return domain.Company{}, err
	}
	return company, nil
}

func (r *MemoryRepo) ListCompanies(query string, limit int) ([]domain.Company, error) {
	query = strings.ToLower(strings.TrimSpace(query))
	limit = NormalizeCompanyListLimit(limit)

	r.mu.RLock()
	defer r.mu.RUnlock()

	items := make([]domain.Company, 0, min(limit, len(r.companies)))
	for _, company := range r.companies {
		if query != "" && !strings.Contains(strings.ToLower(company.Name), query) && !strings.Contains(strings.ToLower(company.CompanyID), query) {
			continue
		}
		items = append(items, company)
	}
	slices.SortFunc(items, func(a, b domain.Company) int {
		aName := strings.ToLower(strings.TrimSpace(a.Name))
		bName := strings.ToLower(strings.TrimSpace(b.Name))
		if aName < bName {
			return -1
		}
		if aName > bName {
			return 1
		}
		return strings.Compare(a.CompanyID, b.CompanyID)
	})
	if len(items) > limit {
		items = items[:limit]
	}
	return items, nil
}

func (r *MemoryRepo) EnsureCompany(companyID, name string) domain.Company {
	companyID = strings.TrimSpace(companyID)
	name = strings.TrimSpace(name)
	if name == "" {
		name = "MangoRTS Dev Company"
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	snapshot := r.snapshotProcessMapMutationLocked()
	entityTypesSnapshot := maps.Clone(r.entityTypes)
	entityFieldTypesSnapshot := maps.Clone(r.entityFieldTypes)
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
	r.ensureCompanyExplorerV2CompanyGraphLocked(companyID)
	defaultFolders := r.ensureCompanyExplorerDefaultFoldersLocked(companyID)
	if err := r.syncMemoryDefaultFolderProcessMapPlacementsLocked(companyID, defaultFolders); err != nil {
		// EnsureCompany predates repository error returns and is used only by
		// deterministic bootstrap/test setup. Return an unmistakable empty value
		// after restoring every mutation if existing malformed map state blocks it.
		r.restoreProcessMapMutationLocked(snapshot)
		r.entityTypes = entityTypesSnapshot
		r.entityFieldTypes = entityFieldTypesSnapshot
		return domain.Company{}
	}
	if cleanUUIDText(companyID) == companyID {
		if err := r.ensureActionItemDefaultsLocked(companyID); err != nil {
			r.restoreProcessMapMutationLocked(snapshot)
			r.entityTypes = entityTypesSnapshot
			r.entityFieldTypes = entityFieldTypesSnapshot
			return domain.Company{}
		}
	}
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
	membershipKeyValue := membershipKey(companyID, user.UserID)
	existingMembership, hadExistingMembership := r.memberships[membershipKeyValue]
	if hadExistingMembership && existingMembership.Role == role {
		return existingMembership, nil
	}
	beforeMemberships := cloneMemoryMap(r.memberships)
	beforeDomainEvents := cloneMemoryMap(r.domainEvents)
	beforeWorkspaceReadVersions := cloneMemoryMap(r.workspaceReadVersions)
	beforeRealtimeOutbox := cloneMemoryMap(r.realtimeOutbox)
	beforeRealtimeOutboxSequence := r.realtimeOutboxSequence
	hadGlobalAccess := memoryUserHasDevAdminMembershipLocked(r.memberships, user.UserID)
	now := time.Now().UTC()
	membership := domain.CompanyMembership{
		CompanyID:        companyID,
		UserID:           user.UserID,
		Role:             role,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	if hadExistingMembership {
		membership.CreatedTimestamp = existingMembership.CreatedTimestamp
	}
	r.memberships[membershipKeyValue] = membership
	hasGlobalAccess := memoryUserHasDevAdminMembershipLocked(r.memberships, user.UserID)
	affectedCompanyIDs := memoryMembershipAffectedCompanyIDsLocked(r.companies, companyID, hadGlobalAccess != hasGlobalAccess)
	r.advancePolicyGroupMembershipVersionsLocked(affectedCompanyIDs)
	if _, err := r.appendDomainEventsLocked(companyMembershipEventInputs(affectedCompanyIDs, CompanyMembershipSavedEventType, user.UserID)); err != nil {
		r.memberships = beforeMemberships
		r.domainEvents = beforeDomainEvents
		r.workspaceReadVersions = beforeWorkspaceReadVersions
		r.realtimeOutbox = beforeRealtimeOutbox
		r.realtimeOutboxSequence = beforeRealtimeOutboxSequence
		return domain.CompanyMembership{}, err
	}
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

func (r *MemoryRepo) ListCompanyUserOnboarding(companyID string) ([]domain.CompanyUserOnboarding, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return nil, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	latestInvitationByEmail := map[string]domain.Invitation{}
	for _, invitation := range r.invitations {
		if invitation.CompanyID != companyID || invitation.Status == domain.InvitationStatusRevoked {
			continue
		}
		email := normalizeEmail(invitation.Email)
		existing, ok := latestInvitationByEmail[email]
		if !ok || invitation.CreatedTimestamp.After(existing.CreatedTimestamp) {
			latestInvitationByEmail[email] = invitation
		}
	}

	items := make([]domain.CompanyUserOnboarding, 0)
	seenEmails := map[string]bool{}
	for _, membership := range r.memberships {
		if membership.CompanyID != companyID {
			continue
		}
		var user domain.User
		found := false
		for _, candidate := range r.users {
			if candidate.UserID == membership.UserID {
				user = candidate
				found = true
				break
			}
		}
		if !found {
			continue
		}
		email := normalizeEmail(user.Email)
		invitation := latestInvitationByEmail[email]
		connection, _, _ := r.personalEmailConnectionForUserLocked(user.UserID)
		item := domain.CompanyUserOnboarding{
			CompanyID:                    companyID,
			Email:                        email,
			Role:                         membership.Role,
			UserID:                       user.UserID,
			DisplayName:                  user.DisplayName,
			InvitationID:                 invitation.InvitationID,
			InvitationStatus:             invitation.Status,
			CognitoStatus:                invitation.CognitoStatus,
			InviteEmailStatus:            invitation.InviteEmailStatus,
			InviteEmailError:             invitation.InviteEmailError,
			InviteEmailSentTimestamp:     invitation.EmailSentTimestamp,
			InviteAccepted:               invitation.Status == domain.InvitationStatusAccepted,
			GoogleConnectionStatus:       googleConnectionStatus(connection),
			GoogleConnectionAccountEmail: googleConnectionAccountEmail(connection),
			CreatedTimestamp:             membership.CreatedTimestamp,
			UpdatedTimestamp:             membership.UpdatedTimestamp,
		}
		if item.InvitationStatus == "" {
			item.InvitationStatus = "none"
		}
		if item.CognitoStatus == "" {
			item.CognitoStatus = "existing_mango_user"
		}
		if item.InviteEmailStatus == "" {
			item.InviteEmailStatus = "not_started"
		}
		items = append(items, item)
		seenEmails[email] = true
	}

	for email, invitation := range latestInvitationByEmail {
		if seenEmails[email] || invitation.Status != domain.InvitationStatusPending {
			continue
		}
		item := domain.CompanyUserOnboarding{
			CompanyID:                companyID,
			Email:                    email,
			Role:                     invitation.Role,
			InvitationID:             invitation.InvitationID,
			InvitationStatus:         invitation.Status,
			CognitoStatus:            invitation.CognitoStatus,
			InviteEmailStatus:        invitation.InviteEmailStatus,
			InviteEmailError:         invitation.InviteEmailError,
			InviteEmailSentTimestamp: invitation.EmailSentTimestamp,
			GoogleConnectionStatus:   "not_connected",
			CreatedTimestamp:         invitation.CreatedTimestamp,
			UpdatedTimestamp:         invitation.UpdatedTimestamp,
		}
		if item.CognitoStatus == "" {
			item.CognitoStatus = "not_started"
		}
		if item.InviteEmailStatus == "" {
			item.InviteEmailStatus = "not_started"
		}
		items = append(items, item)
	}

	slices.SortFunc(items, func(a, b domain.CompanyUserOnboarding) int {
		if cmp := strings.Compare(a.Email, b.Email); cmp != 0 {
			return cmp
		}
		return strings.Compare(a.UserID, b.UserID)
	})
	return items, nil
}

func googleConnectionAccountEmail(connection domain.UserEmailConnection) string {
	if strings.TrimSpace(strings.ToLower(connection.Provider)) != "google" {
		return ""
	}
	return normalizeEmail(connection.AccountEmail)
}

func (r *MemoryRepo) ListMentionableCompanyUsers(companyID string) ([]domain.CompanyUser, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return nil, ErrInvalid
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	byUserID := map[string]domain.CompanyUser{}
	userByID := map[string]domain.User{}
	for _, user := range r.users {
		userByID[user.UserID] = user
	}
	addMembership := func(membership domain.CompanyMembership, role string) {
		user, ok := userByID[membership.UserID]
		if !ok {
			return
		}
		if _, exists := byUserID[user.UserID]; exists {
			return
		}
		byUserID[user.UserID] = domain.CompanyUser{
			CompanyID:        companyID,
			UserID:           user.UserID,
			CognitoSubject:   user.CognitoSubject,
			Email:            user.Email,
			DisplayName:      user.DisplayName,
			Role:             role,
			CreatedTimestamp: membership.CreatedTimestamp,
			UpdatedTimestamp: membership.UpdatedTimestamp,
		}
	}
	for _, membership := range r.memberships {
		if membership.CompanyID == companyID {
			addMembership(membership, membership.Role)
		}
	}
	for _, membership := range r.memberships {
		if membership.Role == domain.RoleDevAdmin {
			addMembership(membership, domain.RoleDevAdmin)
		}
	}

	items := make([]domain.CompanyUser, 0, len(byUserID))
	for _, item := range byUserID {
		items = append(items, item)
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

func (r *MemoryRepo) DeleteCompanyUser(companyID, userID string, deleteIdentity bool) (DeleteCompanyUserResult, error) {
	companyID = strings.TrimSpace(companyID)
	userID = strings.TrimSpace(userID)
	if companyID == "" || userID == "" {
		return DeleteCompanyUserResult{}, ErrInvalid
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	membership, ok := r.memberships[membershipKey(companyID, userID)]
	if !ok {
		return DeleteCompanyUserResult{}, ErrNotFound
	}
	var user domain.User
	for _, candidate := range r.users {
		if candidate.UserID == userID {
			user = candidate
			break
		}
	}
	if user.UserID == "" {
		return DeleteCompanyUserResult{}, ErrNotFound
	}
	originalMembershipCompanyIDs := make([]string, 0)
	for _, existingMembership := range r.memberships {
		if existingMembership.UserID == userID {
			originalMembershipCompanyIDs = append(originalMembershipCompanyIDs, existingMembership.CompanyID)
		}
	}
	hadGlobalAccess := memoryUserHasDevAdminMembershipLocked(r.memberships, userID)
	membershipsSnapshot := cloneMemoryMap(r.memberships)
	userGroupMembersSnapshot := cloneMemoryMap(r.userGroupMembers)
	entityPermissionsSnapshot := cloneMemoryMap(r.entityPermissions)
	entitiesSnapshot := cloneMemoryMap(r.entities)
	entityFieldsSnapshot := cloneMemoryMap(r.entityFields)
	nodesSnapshot := cloneMemoryMap(r.nodes)
	nodeLogicGateAssignmentsSnapshot := cloneMemoryMap(r.nodeLogicGateAssignments)
	logicGateRACISnapshot := cloneMemorySliceMap(r.logicGateRACI)
	sharedInboxRACISnapshot := cloneMemorySliceMap(r.sharedInboxRACI)
	usersSnapshot := cloneMemoryMap(r.users)
	qdRatingsSnapshot := cloneMemoryMap(r.qdRatings)
	recycleBinSnapshot := cloneMemoryMap(r.recycleBin)
	invitationsSnapshot := cloneMemoryMap(r.invitations)
	folderSharesSnapshot := cloneMemoryMap(r.folderShares)
	emailConnectionsSnapshot := cloneMemoryMap(r.emailConnections)
	effectiveAccessSnapshot := cloneMemoryMap(r.effectiveAccess)
	raciMatrixProjectionRowsSnapshot := cloneMemoryMap(r.RACIMatrixProjectionRows)
	domainEventsSnapshot := cloneMemoryMap(r.domainEvents)
	workspaceReadVersionsSnapshot := cloneMemoryMap(r.workspaceReadVersions)
	realtimeOutboxSnapshot := cloneMemoryMap(r.realtimeOutbox)
	realtimeOutboxSequenceSnapshot := r.realtimeOutboxSequence
	restore := func() {
		r.memberships = membershipsSnapshot
		r.userGroupMembers = userGroupMembersSnapshot
		r.entityPermissions = entityPermissionsSnapshot
		r.entities = entitiesSnapshot
		r.entityFields = entityFieldsSnapshot
		r.nodes = nodesSnapshot
		r.nodeLogicGateAssignments = nodeLogicGateAssignmentsSnapshot
		r.logicGateRACI = logicGateRACISnapshot
		r.sharedInboxRACI = sharedInboxRACISnapshot
		r.users = usersSnapshot
		r.qdRatings = qdRatingsSnapshot
		r.recycleBin = recycleBinSnapshot
		r.invitations = invitationsSnapshot
		r.folderShares = folderSharesSnapshot
		r.emailConnections = emailConnectionsSnapshot
		r.effectiveAccess = effectiveAccessSnapshot
		r.RACIMatrixProjectionRows = raciMatrixProjectionRowsSnapshot
		r.domainEvents = domainEventsSnapshot
		r.workspaceReadVersions = workspaceReadVersionsSnapshot
		r.realtimeOutbox = realtimeOutboxSnapshot
		r.realtimeOutboxSequence = realtimeOutboxSequenceSnapshot
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

	r.clearLogicGateAssignmentMemberReferencesLocked(companyID, userID)
	r.clearEntityMemberReferencesLocked(companyID, userID)
	delete(r.memberships, membershipKey(companyID, userID))
	for memberKey, member := range r.userGroupMembers {
		if member.CompanyID == companyID && member.UserID == userID {
			delete(r.userGroupMembers, memberKey)
		}
	}
	for permissionKey, permission := range r.entityPermissions {
		if permission.CompanyID == companyID && permission.SubjectType == EntityPermissionSubjectUser && permission.SubjectID == userID {
			delete(r.entityPermissions, permissionKey)
		}
	}
	for gateKey, assignments := range r.logicGateRACI {
		filtered := assignments[:0]
		for _, assignment := range assignments {
			if assignment.CompanyID == companyID && assignment.UserID == userID {
				continue
			}
			filtered = append(filtered, assignment)
		}
		if len(filtered) == 0 {
			delete(r.logicGateRACI, gateKey)
		} else {
			r.logicGateRACI[gateKey] = filtered
		}
	}
	for RACIKey, assignments := range r.sharedInboxRACI {
		filtered := assignments[:0]
		for _, assignment := range assignments {
			principalType := strings.TrimSpace(assignment.PrincipalType)
			principalID := strings.TrimSpace(assignment.PrincipalID)
			if principalType == "" {
				principalType = EntityPermissionSubjectUser
				principalID = strings.TrimSpace(assignment.UserID)
			}
			if assignment.CompanyID == companyID && principalType == EntityPermissionSubjectUser && principalID == userID {
				continue
			}
			filtered = append(filtered, assignment)
		}
		if len(filtered) == 0 {
			delete(r.sharedInboxRACI, RACIKey)
		} else {
			r.sharedInboxRACI[RACIKey] = filtered
		}
	}

	if r.effectiveAccessErr != nil {
		restore()
		return DeleteCompanyUserResult{}, r.effectiveAccessErr
	}

	for rowKey, row := range r.RACIMatrixProjectionRows {
		if row.CompanyID == companyID && row.UserID == userID {
			delete(r.RACIMatrixProjectionRows, rowKey)
		}
	}
	hasRemainingMembership := false
	for _, membership := range r.memberships {
		if membership.UserID == userID {
			hasRemainingMembership = true
			break
		}
	}
	if hasRemainingMembership && !deleteIdentity {
		affectedCompanyIDs := memoryMembershipAffectedCompanyIDsLocked(
			r.companies,
			companyID,
			hadGlobalAccess != memoryUserHasDevAdminMembershipLocked(r.memberships, userID),
		)
		r.advancePolicyGroupMembershipVersionsLocked(affectedCompanyIDs)
		if _, err := r.appendDomainEventsLocked(companyMembershipEventInputs(affectedCompanyIDs, CompanyMembershipDeletedEventType, userID)); err != nil {
			restore()
			return DeleteCompanyUserResult{}, err
		}
		return DeleteCompanyUserResult{User: deleted, DeleteExternalIdentity: false}, nil
	}

	email := normalizeEmail(user.Email)
	r.clearLogicGateAssignmentMemberReferencesLocked("", userID)
	for membershipKeyValue, membership := range r.memberships {
		if membership.UserID == userID {
			r.clearEntityMemberReferencesLocked(membership.CompanyID, userID)
			delete(r.memberships, membershipKeyValue)
		}
	}
	for key, invitation := range r.invitations {
		if normalizeEmail(invitation.Email) == email || invitation.InvitedByUserID == userID || (invitation.AcceptedByUserID != nil && *invitation.AcceptedByUserID == userID) {
			delete(r.invitations, key)
		}
	}
	for key, share := range r.folderShares {
		if share.Email == email || share.InvitedByUserID == userID || (share.UserID != nil && *share.UserID == userID) {
			delete(r.folderShares, key)
		}
	}
	for memberKey, member := range r.userGroupMembers {
		if member.UserID == userID {
			delete(r.userGroupMembers, memberKey)
		}
	}
	for permissionKey, permission := range r.entityPermissions {
		if permission.SubjectType == EntityPermissionSubjectUser && permission.SubjectID == userID {
			delete(r.entityPermissions, permissionKey)
		}
	}
	for key, connection := range r.emailConnections {
		if connection.UserID == userID {
			delete(r.emailConnections, key)
		}
	}
	for gateKey, assignments := range r.logicGateRACI {
		filtered := assignments[:0]
		for _, assignment := range assignments {
			if assignment.UserID == userID {
				continue
			}
			filtered = append(filtered, assignment)
		}
		if len(filtered) == 0 {
			delete(r.logicGateRACI, gateKey)
		} else {
			r.logicGateRACI[gateKey] = filtered
		}
	}
	for RACIKey, assignments := range r.sharedInboxRACI {
		filtered := assignments[:0]
		for _, assignment := range assignments {
			principalType := strings.TrimSpace(assignment.PrincipalType)
			principalID := strings.TrimSpace(assignment.PrincipalID)
			if principalType == "" {
				principalType = EntityPermissionSubjectUser
				principalID = strings.TrimSpace(assignment.UserID)
			}
			if principalType == EntityPermissionSubjectUser && principalID == userID {
				continue
			}
			filtered = append(filtered, assignment)
		}
		if len(filtered) == 0 {
			delete(r.sharedInboxRACI, RACIKey)
		} else {
			r.sharedInboxRACI[RACIKey] = filtered
		}
	}
	if r.effectiveAccessErr != nil {
		restore()
		return DeleteCompanyUserResult{}, r.effectiveAccessErr
	}
	for accessKey, access := range r.effectiveAccess {
		if access.UserID == userID {
			delete(r.effectiveAccess, accessKey)
		}
	}
	for rowKey, row := range r.RACIMatrixProjectionRows {
		if row.UserID == userID {
			delete(r.RACIMatrixProjectionRows, rowKey)
		}
	}
	r.clearQDRatingUserReferencesLocked(userID)
	delete(r.users, user.CognitoSubject)
	affectedCompanyIDs := originalMembershipCompanyIDs
	if hadGlobalAccess != memoryUserHasDevAdminMembershipLocked(r.memberships, userID) {
		affectedCompanyIDs = memoryMembershipAffectedCompanyIDsLocked(r.companies, companyID, true)
	}
	r.advancePolicyGroupMembershipVersionsLocked(affectedCompanyIDs)
	if _, err := r.appendDomainEventsLocked(companyMembershipEventInputs(affectedCompanyIDs, CompanyMembershipDeletedEventType, userID)); err != nil {
		restore()
		return DeleteCompanyUserResult{}, err
	}
	return DeleteCompanyUserResult{User: deleted, DeleteExternalIdentity: true}, nil
}

func (r *MemoryRepo) CompleteExternalIdentityDeletion(cognitoSubject string) error {
	return nil
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
	if !domain.CanInviteCompanyRole(r.companyInvitationRoleForUserLocked(invitedByUserID, companyID), role) {
		return domain.Invitation{}, ErrInvalid
	}
	for _, user := range r.users {
		if normalizeEmail(user.Email) == email {
			if _, ok := r.memberships[membershipKey(companyID, user.UserID)]; ok {
				return domain.Invitation{}, ErrAlreadyExists
			}
			break
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
		InvitationID:      newUUIDv7String(),
		CompanyID:         companyID,
		CompanyName:       r.companies[companyID].Name,
		Email:             email,
		Role:              role,
		Status:            domain.InvitationStatusPending,
		Token:             token,
		CognitoStatus:     "not_started",
		InviteEmailStatus: "not_started",
		InvitedByUserID:   invitedByUserID,
		ExpiresTimestamp:  now.Add(ttl),
		CreatedTimestamp:  now,
		UpdatedTimestamp:  now,
	}
	r.invitations[tokenHash] = invitation
	return invitation, nil
}

func (r *MemoryRepo) UpdateInvitationDeliveryStatus(input InvitationDeliveryStatusInput) (domain.Invitation, error) {
	invitationID := strings.TrimSpace(input.InvitationID)
	if invitationID == "" {
		return domain.Invitation{}, ErrInvalid
	}
	cognitoStatus := strings.TrimSpace(input.CognitoStatus)
	if cognitoStatus != "" {
		cognitoStatus = normalizeInvitationCognitoStatus(cognitoStatus)
		if cognitoStatus == "" {
			return domain.Invitation{}, ErrInvalid
		}
	}
	emailStatus := strings.TrimSpace(input.InviteEmailStatus)
	if emailStatus != "" {
		emailStatus = normalizeInvitationEmailStatus(emailStatus)
		if emailStatus == "" {
			return domain.Invitation{}, ErrInvalid
		}
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	for tokenHash, invitation := range r.invitations {
		if invitation.InvitationID != invitationID {
			continue
		}
		if cognitoStatus != "" {
			invitation.CognitoStatus = cognitoStatus
			invitation.CognitoError = strings.TrimSpace(input.CognitoError)
		}
		if emailStatus != "" {
			invitation.InviteEmailStatus = emailStatus
			invitation.InviteEmailError = strings.TrimSpace(input.InviteEmailError)
			if emailStatus == "sent" {
				now := time.Now().UTC()
				invitation.EmailSentTimestamp = &now
			}
		}
		invitation.UpdatedTimestamp = time.Now().UTC()
		if company, ok := r.companies[invitation.CompanyID]; ok {
			invitation.CompanyName = company.Name
		}
		r.invitations[tokenHash] = invitation
		return invitation, nil
	}
	return domain.Invitation{}, ErrNotFound
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
	beforeUsers := cloneMemoryMap(r.users)
	beforeMemberships := cloneMemoryMap(r.memberships)
	beforeInvitations := cloneMemoryMap(r.invitations)
	beforeDomainEvents := cloneMemoryMap(r.domainEvents)
	beforeWorkspaceReadVersions := cloneMemoryMap(r.workspaceReadVersions)
	beforeRealtimeOutbox := cloneMemoryMap(r.realtimeOutbox)
	beforeRealtimeOutboxSequence := r.realtimeOutboxSequence
	restore := func() {
		r.users = beforeUsers
		r.memberships = beforeMemberships
		r.invitations = beforeInvitations
		r.domainEvents = beforeDomainEvents
		r.workspaceReadVersions = beforeWorkspaceReadVersions
		r.realtimeOutbox = beforeRealtimeOutbox
		r.realtimeOutboxSequence = beforeRealtimeOutboxSequence
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
	hadGlobalAccess := memoryUserHasDevAdminMembershipLocked(r.memberships, user.UserID)
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
	hasGlobalAccess := memoryUserHasDevAdminMembershipLocked(r.memberships, user.UserID)
	affectedCompanyIDs := memoryMembershipAffectedCompanyIDsLocked(r.companies, invitation.CompanyID, hadGlobalAccess != hasGlobalAccess)
	r.advancePolicyGroupMembershipVersionsLocked(affectedCompanyIDs)
	if _, err := r.appendDomainEventsLocked(companyMembershipEventInputs(affectedCompanyIDs, CompanyMembershipSavedEventType, user.UserID)); err != nil {
		restore()
		return domain.Invitation{}, err
	}
	return invitation, nil
}

func (r *MemoryRepo) companyInvitationRoleForUserLocked(userID, companyID string) string {
	userID = strings.TrimSpace(userID)
	companyID = strings.TrimSpace(companyID)
	if userID == "" || companyID == "" {
		return ""
	}
	for _, membership := range r.memberships {
		if membership.UserID == userID && membership.Role == domain.RoleDevAdmin {
			return domain.RoleDevAdmin
		}
	}
	membership, ok := r.memberships[membershipKey(companyID, userID)]
	if !ok {
		return ""
	}
	return domain.NormalizeRole(membership.Role)
}

func (r *MemoryRepo) userCanCreateInvitationLocked(userID, companyID string) bool {
	return domain.CanManageCompany(r.companyInvitationRoleForUserLocked(userID, companyID))
}
