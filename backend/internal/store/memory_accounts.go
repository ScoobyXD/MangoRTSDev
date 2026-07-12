package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

func accountKey(companyID, accountID string) string {
	return strings.TrimSpace(companyID) + ":" + strings.TrimSpace(accountID)
}

func accountFolderKey(companyID, folderID string) string {
	return strings.TrimSpace(companyID) + ":" + strings.TrimSpace(folderID)
}

func nodeAccountAssignmentKey(companyID, nodeID, accountID string) string {
	return strings.TrimSpace(companyID) + ":" + strings.TrimSpace(nodeID) + ":" + strings.TrimSpace(accountID)
}

func (r *MemoryRepo) ListAccounts(companyID string) ([]domain.Account, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := []domain.Account{}
	for _, account := range r.accounts {
		if account.CompanyID == companyID {
			account.FolderID = cloneStringPointer(account.FolderID)
			items = append(items, account)
		}
	}
	sortAccounts(items)
	return items, nil
}

func (r *MemoryRepo) CreateAccount(input AccountInput) (AccountMutationResult, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.AccountID = strings.TrimSpace(input.AccountID)
	input.Name = strings.TrimSpace(input.Name)
	if input.CompanyID == "" || input.Name == "" {
		return AccountMutationResult{}, ErrInvalid
	}
	if input.AccountID == "" {
		input.AccountID = newUUIDv7String()
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.accounts[accountKey(input.CompanyID, input.AccountID)]; exists {
		return AccountMutationResult{}, ErrAlreadyExists
	}
	folderID := ""
	if input.FolderID != nil {
		folderID = strings.TrimSpace(*input.FolderID)
		if folderID != "" {
			if _, ok := r.accountFolders[accountFolderKey(input.CompanyID, folderID)]; !ok {
				return AccountMutationResult{}, ErrNotFound
			}
		}
	}
	now := time.Now().UTC()
	item := domain.Account{
		CompanyID:        input.CompanyID,
		AccountID:        input.AccountID,
		Name:             input.Name,
		Position:         input.Position,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	if folderID != "" {
		item.FolderID = &folderID
	}
	r.accounts[accountKey(item.CompanyID, item.AccountID)] = item
	return AccountMutationResult{Account: &item}, nil
}

func (r *MemoryRepo) UpdateAccount(input AccountInput) (AccountMutationResult, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.AccountID = strings.TrimSpace(input.AccountID)
	input.Name = strings.TrimSpace(input.Name)
	if input.CompanyID == "" || input.AccountID == "" {
		return AccountMutationResult{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	existing, ok := r.accounts[accountKey(input.CompanyID, input.AccountID)]
	if !ok {
		return AccountMutationResult{}, ErrNotFound
	}
	nodeIDs := r.nodeIDsForAccountLocked(input.CompanyID, input.AccountID)
	if input.Name != "" {
		existing.Name = input.Name
	}
	if input.FolderIDSet {
		folderID := ""
		if input.FolderID != nil {
			folderID = strings.TrimSpace(*input.FolderID)
		}
		if folderID != "" {
			if _, ok := r.accountFolders[accountFolderKey(input.CompanyID, folderID)]; !ok {
				return AccountMutationResult{}, ErrNotFound
			}
			existing.FolderID = &folderID
		} else {
			existing.FolderID = nil
		}
	}
	if input.PositionSet {
		existing.Position = input.Position
	}
	existing.UpdatedTimestamp = time.Now().UTC()
	r.accounts[accountKey(input.CompanyID, input.AccountID)] = existing
	r.syncProjectionsForAccountNodeIDsLocked(input.CompanyID, nodeIDs)
	for _, nodeID := range nodeIDs {
		r.bumpNodeViewVersionLocked(input.CompanyID, nodeID)
	}
	return AccountMutationResult{Account: &existing}, nil
}

func (r *MemoryRepo) DeleteAccount(companyID, accountID, actorUserID string) (AccountMutationResult, error) {
	companyID = strings.TrimSpace(companyID)
	accountID = strings.TrimSpace(accountID)
	if companyID == "" || accountID == "" {
		return AccountMutationResult{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.accounts[accountKey(companyID, accountID)]; !ok {
		return AccountMutationResult{}, ErrNotFound
	}
	nodeIDs := r.nodeIDsForAccountLocked(companyID, accountID)
	delete(r.accounts, accountKey(companyID, accountID))
	for keyValue, assignment := range r.nodeAccountAssignments {
		if assignment.CompanyID == companyID && assignment.AccountID == accountID {
			delete(r.nodeAccountAssignments, keyValue)
		}
	}
	r.syncProjectionsForAccountNodeIDsLocked(companyID, nodeIDs)
	for _, nodeID := range nodeIDs {
		r.bumpNodeViewVersionLocked(companyID, nodeID)
	}
	_ = actorUserID
	return AccountMutationResult{DeletedAccountID: accountID}, nil
}

func (r *MemoryRepo) ListAccountFolders(companyID string) ([]domain.AccountFolder, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := []domain.AccountFolder{}
	for _, folder := range r.accountFolders {
		if folder.CompanyID == companyID {
			folder.ParentFolderID = cloneStringPointer(folder.ParentFolderID)
			items = append(items, folder)
		}
	}
	sortAccountFolders(items)
	return items, nil
}

func (r *MemoryRepo) CreateAccountFolder(input AccountFolderInput) (domain.AccountFolder, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.FolderID = strings.TrimSpace(input.FolderID)
	input.Name = strings.TrimSpace(input.Name)
	if input.CompanyID == "" || input.Name == "" {
		return domain.AccountFolder{}, ErrInvalid
	}
	if input.FolderID == "" {
		input.FolderID = newUUIDv7String()
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	parentID := ""
	if input.ParentFolderID != nil {
		parentID = strings.TrimSpace(*input.ParentFolderID)
		if parentID != "" {
			if _, ok := r.accountFolders[accountFolderKey(input.CompanyID, parentID)]; !ok {
				return domain.AccountFolder{}, ErrNotFound
			}
		}
	}
	now := time.Now().UTC()
	item := domain.AccountFolder{
		CompanyID:        input.CompanyID,
		FolderID:         input.FolderID,
		Name:             input.Name,
		Position:         input.Position,
		CreatedTimestamp: now,
		UpdatedTimestamp: now,
	}
	if parentID != "" {
		item.ParentFolderID = &parentID
	}
	r.accountFolders[accountFolderKey(item.CompanyID, item.FolderID)] = item
	return item, nil
}

func (r *MemoryRepo) UpdateAccountFolder(input AccountFolderInput) (domain.AccountFolder, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.FolderID = strings.TrimSpace(input.FolderID)
	input.Name = strings.TrimSpace(input.Name)
	if input.CompanyID == "" || input.FolderID == "" {
		return domain.AccountFolder{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	item, ok := r.accountFolders[accountFolderKey(input.CompanyID, input.FolderID)]
	if !ok {
		return domain.AccountFolder{}, ErrNotFound
	}
	if input.ParentFolderIDSet {
		parentID := ""
		if input.ParentFolderID != nil {
			parentID = strings.TrimSpace(*input.ParentFolderID)
		}
		if parentID != "" {
			if parentID == input.FolderID || r.accountFolderDescendantLocked(input.CompanyID, input.FolderID, parentID) {
				return domain.AccountFolder{}, ErrInvalid
			}
			if _, ok := r.accountFolders[accountFolderKey(input.CompanyID, parentID)]; !ok {
				return domain.AccountFolder{}, ErrNotFound
			}
			item.ParentFolderID = &parentID
		} else {
			item.ParentFolderID = nil
		}
	}
	if input.Name != "" {
		item.Name = input.Name
	}
	if input.PositionSet {
		item.Position = input.Position
	}
	item.UpdatedTimestamp = time.Now().UTC()
	r.accountFolders[accountFolderKey(item.CompanyID, item.FolderID)] = item
	return item, nil
}

func (r *MemoryRepo) DeleteAccountFolder(companyID, folderID string) error {
	companyID = strings.TrimSpace(companyID)
	folderID = strings.TrimSpace(folderID)
	if companyID == "" || folderID == "" {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.accountFolders[accountFolderKey(companyID, folderID)]; !ok {
		return ErrNotFound
	}
	delete(r.accountFolders, accountFolderKey(companyID, folderID))
	for keyValue, folder := range r.accountFolders {
		if folder.CompanyID == companyID && accountFolderIDValue(folder.ParentFolderID) == folderID {
			folder.ParentFolderID = nil
			folder.UpdatedTimestamp = time.Now().UTC()
			r.accountFolders[keyValue] = folder
		}
	}
	for keyValue, account := range r.accounts {
		if account.CompanyID == companyID && accountFolderIDValue(account.FolderID) == folderID {
			account.FolderID = nil
			account.UpdatedTimestamp = time.Now().UTC()
			r.accounts[keyValue] = account
		}
	}
	return nil
}

func (r *MemoryRepo) ListNodeAccountAssignments(companyID, nodeID string) ([]domain.NodeAccountAssignment, error) {
	companyID = strings.TrimSpace(companyID)
	nodeID = strings.TrimSpace(nodeID)
	if companyID == "" || nodeID == "" {
		return nil, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.nodeAccountAssignmentsForNodeLocked(companyID, nodeID), nil
}

func (r *MemoryRepo) SetNodeAccountAssignments(input NodeAccountAssignmentUpdateInput) (NodeAccountAssignmentUpdateResult, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.NodeID = strings.TrimSpace(input.NodeID)
	input.AccountIDs = cleanAccountIDs(input.AccountIDs)
	if input.CompanyID == "" || input.NodeID == "" {
		return NodeAccountAssignmentUpdateResult{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.nodes[key(input.CompanyID, input.NodeID)]; !ok {
		return NodeAccountAssignmentUpdateResult{}, ErrNotFound
	}
	for _, accountID := range input.AccountIDs {
		if _, ok := r.accounts[accountKey(input.CompanyID, accountID)]; !ok {
			return NodeAccountAssignmentUpdateResult{}, ErrNotFound
		}
	}
	for keyValue, assignment := range r.nodeAccountAssignments {
		if assignment.CompanyID == input.CompanyID && assignment.NodeID == input.NodeID {
			delete(r.nodeAccountAssignments, keyValue)
		}
	}
	now := time.Now().UTC()
	for _, accountID := range input.AccountIDs {
		account := r.accounts[accountKey(input.CompanyID, accountID)]
		r.nodeAccountAssignments[nodeAccountAssignmentKey(input.CompanyID, input.NodeID, accountID)] = domain.NodeAccountAssignment{
			CompanyID:        input.CompanyID,
			NodeID:           input.NodeID,
			AccountID:        accountID,
			AccountName:      account.Name,
			CreatedTimestamp: now,
		}
	}
	r.syncProjectionsForAccountNodeIDsLocked(input.CompanyID, []string{input.NodeID})
	node := r.withNodeReadModelLocked(r.nodes[key(input.CompanyID, input.NodeID)])
	eventInput := nodeUpdatedWorkspaceEventInput(node)
	eventInput.ActorUserID = strings.TrimSpace(input.ActorUserID)
	eventInput.Payload["node_title"] = strings.TrimSpace(node.Title)
	eventInput.Payload["accounts_changed"] = true
	event, err := r.appendDomainEventLocked(eventInput)
	if err != nil {
		return NodeAccountAssignmentUpdateResult{}, err
	}
	r.bumpNodeViewVersionLocked(input.CompanyID, input.NodeID)
	return NodeAccountAssignmentUpdateResult{
		Node:        node,
		Assignments: r.nodeAccountAssignmentsForNodeLocked(input.CompanyID, input.NodeID),
		Events:      []domain.DomainEvent{event},
	}, nil
}

func (r *MemoryRepo) accountFolderDescendantLocked(companyID, folderID, candidateID string) bool {
	children := map[string][]string{}
	for _, folder := range r.accountFolders {
		if folder.CompanyID != companyID || folder.ParentFolderID == nil {
			continue
		}
		children[*folder.ParentFolderID] = append(children[*folder.ParentFolderID], folder.FolderID)
	}
	stack := append([]string{}, children[folderID]...)
	for len(stack) > 0 {
		current := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if current == candidateID {
			return true
		}
		stack = append(stack, children[current]...)
	}
	return false
}

func (r *MemoryRepo) accountSnapshotsForNodeLocked(companyID, nodeID string) []domain.Account {
	items := []domain.Account{}
	for _, assignment := range r.nodeAccountAssignments {
		if assignment.CompanyID != companyID || assignment.NodeID != nodeID {
			continue
		}
		account, ok := r.accounts[accountKey(companyID, assignment.AccountID)]
		if !ok {
			continue
		}
		account.FolderID = cloneStringPointer(account.FolderID)
		items = append(items, account)
	}
	sortAccounts(items)
	return items
}

func (r *MemoryRepo) nodeAccountAssignmentsForNodeLocked(companyID, nodeID string) []domain.NodeAccountAssignment {
	items := []domain.NodeAccountAssignment{}
	for _, assignment := range r.nodeAccountAssignments {
		if assignment.CompanyID != companyID || assignment.NodeID != nodeID {
			continue
		}
		if account, ok := r.accounts[accountKey(companyID, assignment.AccountID)]; ok {
			assignment.AccountName = account.Name
		}
		items = append(items, assignment)
	}
	sort.Slice(items, func(i, j int) bool {
		left := strings.ToLower(strings.TrimSpace(items[i].AccountName))
		right := strings.ToLower(strings.TrimSpace(items[j].AccountName))
		if left != right {
			return left < right
		}
		return items[i].AccountID < items[j].AccountID
	})
	return items
}

func (r *MemoryRepo) nodeIDsForAccountLocked(companyID, accountID string) []string {
	seen := map[string]bool{}
	for _, assignment := range r.nodeAccountAssignments {
		if assignment.CompanyID == companyID && assignment.AccountID == accountID {
			seen[assignment.NodeID] = true
		}
	}
	nodeIDs := mapKeys(seen)
	return nodeIDs
}

func (r *MemoryRepo) syncProjectionsForAccountNodeIDsLocked(companyID string, nodeIDs []string) {
	for _, nodeID := range cleanAccountIDs(nodeIDs) {
		r.syncGVICMatrixProjectionForNodeLocked(companyID, nodeID)
		r.syncProjectManagementTimelineProjectionForNodeLocked(companyID, nodeID)
	}
}
