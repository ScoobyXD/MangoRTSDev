package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

func (r *MemoryRepo) ConvertLogicGateToHuddle(companyID, logicGateID, actorID string) (domain.HuddleLogicGate, error) {
	companyID, logicGateID = strings.TrimSpace(companyID), strings.TrimSpace(logicGateID)
	if companyID == "" || logicGateID == "" {
		return domain.HuddleLogicGate{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	gate, ok := r.logicGates[key(companyID, logicGateID)]
	if !ok {
		return domain.HuddleLogicGate{}, ErrNotFound
	}
	blockers := LogicGateConversionBlockers{}
	for _, item := range r.nodeLogicGateAssignments {
		if item.CompanyID == companyID && item.LogicGateID == logicGateID {
			blockers.KanbanWork = true
		}
	}
	for _, item := range r.kpis {
		if item.CompanyID == companyID && item.LogicGateID == logicGateID {
			blockers.KPIs = true
		}
	}
	for _, document := range r.editorJSONDocuments {
		if document.Ref.CompanyID == companyID && document.Ref.ResourceType == EntityTypeLogicGate && document.Ref.ResourceID == logicGateID && !editorJSONValuesEqual(document.JSONDocument, emptyMangoTiptapDocument) {
			blockers.Editor = true
		}
	}
	if blockers.Any() {
		return domain.HuddleLogicGate{}, &LogicGateConversionBlockedError{Blockers: blockers}
	}
	r.ensureV2PolicySettingsLocked(companyID, EntityTypeLogicGate, logicGateID)
	gvicSource := r.resolveV2PolicyLocked(companyID, EntityTypeLogicGate, logicGateID, true)
	permissionSource := r.resolveV2PolicyLocked(companyID, EntityTypeLogicGate, logicGateID, false)
	gvicAssignments := r.directMemoryRACIEdgesLocked(companyID, gvicSource.SourceType, gvicSource.SourceID)
	permissionAssignments := r.directMemoryPermissionEdgesLocked(companyID, permissionSource.SourceType, permissionSource.SourceID)
	permissionDefault := r.permissionV2Settings[resourcePolicyKey(companyID, permissionSource.SourceType, permissionSource.SourceID)].DefaultAccess
	now := time.Now().UTC()
	huddle := domain.HuddleLogicGate{CompanyID: companyID, HuddleLogicGateID: logicGateID, Header: gate.Header, CreatedTimestamp: gate.CreatedTimestamp, UpdatedTimestamp: now}
	r.huddleLogicGates[key(companyID, logicGateID)] = huddle
	r.ensureV2PolicySettingsLocked(companyID, EntityTypeHuddleLogicGate, logicGateID)
	huddlePolicyKey := resourcePolicyKey(companyID, EntityTypeHuddleLogicGate, logicGateID)
	huddlePermission := r.permissionV2Settings[huddlePolicyKey]
	huddlePermission.DefaultAccess = permissionDefault
	r.permissionV2Settings[huddlePolicyKey] = huddlePermission
	r.replaceMemoryRACIEdgesLocked(companyID, EntityTypeHuddleLogicGate, logicGateID, gvicAssignments)
	r.replaceMemoryPermissionEdgesLocked(companyID, EntityTypeHuddleLogicGate, logicGateID, permissionAssignments)
	item := domain.HuddleExplorerItem{CompanyID: companyID, ItemID: newUUIDv7String(), ResourceType: EntityTypeHuddleLogicGate, ResourceID: logicGateID, Name: gate.Header, CreatedTimestamp: now, UpdatedTimestamp: now}
	r.huddleExplorerItems[key(companyID, item.ItemID)] = item
	delete(r.logicGates, key(companyID, logicGateID))
	delete(r.logicGateInfo, key(companyID, logicGateID))
	delete(r.logicGateText, key(companyID, logicGateID))
	delete(r.logicGateRels, key(companyID, logicGateID))
	delete(r.logicGateRACI, key(companyID, logicGateID))
	r.deleteMemoryHuddleRelationshipsForLogicGateLocked(companyID, logicGateID)
	r.deleteMemoryHuddlePoliciesLocked(companyID, EntityTypeLogicGate, logicGateID)
	for k, board := range r.kanbanBoards {
		if board.CompanyID == companyID && board.LogicGateID != nil && *board.LogicGateID == logicGateID {
			delete(r.kanbanBoards, k)
		}
	}
	return huddle, nil
}

func (r *MemoryRepo) ListHuddleLogicGates(companyID string) ([]domain.HuddleLogicGate, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := []domain.HuddleLogicGate{}
	for _, item := range r.huddleLogicGates {
		if item.CompanyID == companyID {
			items = append(items, item)
		}
	}
	sort.Slice(items, func(i, j int) bool { return strings.ToLower(items[i].Header) < strings.ToLower(items[j].Header) })
	return items, nil
}

func (r *MemoryRepo) GetHuddleLogicGate(companyID, id string) (domain.HuddleLogicGate, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	item, ok := r.huddleLogicGates[key(companyID, id)]
	if !ok {
		return domain.HuddleLogicGate{}, ErrNotFound
	}
	return item, nil
}

func (r *MemoryRepo) UpdateHuddleLogicGate(input HuddleUpdateInput) (domain.HuddleLogicGate, error) {
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		return domain.HuddleLogicGate{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	k := key(input.CompanyID, input.ResourceID)
	item, ok := r.huddleLogicGates[k]
	if !ok {
		return domain.HuddleLogicGate{}, ErrNotFound
	}
	item.Header = input.Name
	item.UpdatedTimestamp = time.Now().UTC()
	r.huddleLogicGates[k] = item
	for ik, placement := range r.huddleExplorerItems {
		if placement.CompanyID == input.CompanyID && placement.ResourceType == EntityTypeHuddleLogicGate && placement.ResourceID == input.ResourceID {
			placement.Name = input.Name
			placement.UpdatedTimestamp = item.UpdatedTimestamp
			r.huddleExplorerItems[ik] = placement
		}
	}
	return item, nil
}

func memoryHuddleLogicGateRelationshipKey(companyID, huddleLogicGateID, logicGateID string) string {
	return companyID + ":" + huddleLogicGateID + ":" + logicGateID
}

func memoryHuddleNodeLogicGateRelationshipKey(companyID, huddleNodeID, logicGateID string) string {
	return companyID + ":" + huddleNodeID + ":" + logicGateID
}

func memoryHuddleNodeKPIRelationshipKey(companyID, huddleNodeID, logicGateID, kpiID string) string {
	return companyID + ":" + huddleNodeID + ":" + logicGateID + ":" + kpiID
}

func (r *MemoryRepo) deleteMemoryHuddleRelationshipsForLogicGateLocked(companyID, logicGateID string) {
	for relationshipKey, relationship := range r.huddleLogicGateRelationships {
		if relationship.CompanyID == companyID && relationship.LogicGateID == logicGateID {
			delete(r.huddleLogicGateRelationships, relationshipKey)
		}
	}
	for relationshipKey, relationship := range r.huddleNodeLogicGateRelationships {
		if relationship.CompanyID == companyID && relationship.LogicGateID == logicGateID {
			delete(r.huddleNodeLogicGateRelationships, relationshipKey)
		}
	}
	for relationshipKey, relationship := range r.huddleNodeKPIRelationships {
		if relationship.CompanyID == companyID && relationship.LogicGateID == logicGateID {
			delete(r.huddleNodeKPIRelationships, relationshipKey)
		}
	}
	for kpiKey, kpi := range r.kpis {
		if kpi.CompanyID == companyID && kpi.LogicGateID == logicGateID {
			delete(r.kpis, kpiKey)
		}
	}
}

func (r *MemoryRepo) huddleLogicGateCardsLocked(companyID string, logicGateIDs, kpiIDs map[string]bool) []domain.HuddleLogicGateCard {
	items := []domain.HuddleLogicGateCard{}
	for logicGateID := range logicGateIDs {
		gate, ok := r.logicGates[key(companyID, logicGateID)]
		if !ok {
			continue
		}
		card := domain.HuddleLogicGateCard{CompanyID: companyID, LogicGateID: gate.LogicGateID, Header: gate.Header, KPIs: []domain.KPI{}}
		for _, kpi := range r.kpis {
			if kpi.CompanyID == companyID && kpi.LogicGateID == logicGateID && (kpiIDs == nil || kpiIDs[kpi.KPIID]) {
				card.KPIs = append(card.KPIs, kpi)
			}
		}
		sort.Slice(card.KPIs, func(i, j int) bool {
			if card.KPIs[i].CreatedTimestamp.Equal(card.KPIs[j].CreatedTimestamp) {
				return card.KPIs[i].KPIID < card.KPIs[j].KPIID
			}
			return card.KPIs[i].CreatedTimestamp.Before(card.KPIs[j].CreatedTimestamp)
		})
		items = append(items, card)
	}
	sort.Slice(items, func(i, j int) bool {
		left, right := strings.ToLower(items[i].Header), strings.ToLower(items[j].Header)
		if left == right {
			return items[i].LogicGateID < items[j].LogicGateID
		}
		return left < right
	})
	return items
}

func (r *MemoryRepo) ListHuddleLogicGateCards(companyID, huddleLogicGateID string) ([]domain.HuddleLogicGateCard, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	logicGateIDs := map[string]bool{}
	for _, relationship := range r.huddleLogicGateRelationships {
		if relationship.CompanyID != companyID || relationship.HuddleLogicGateID != huddleLogicGateID {
			continue
		}
		logicGateIDs[relationship.LogicGateID] = true
	}
	return r.huddleLogicGateCardsLocked(companyID, logicGateIDs, nil), nil
}

func (r *MemoryRepo) ListHuddleLogicGatesForLogicGate(companyID, logicGateID string) ([]domain.HuddleLogicGate, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := []domain.HuddleLogicGate{}
	for _, relationship := range r.huddleLogicGateRelationships {
		if relationship.CompanyID != companyID || relationship.LogicGateID != logicGateID {
			continue
		}
		if item, ok := r.huddleLogicGates[key(companyID, relationship.HuddleLogicGateID)]; ok {
			items = append(items, item)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		left, right := strings.ToLower(items[i].Header), strings.ToLower(items[j].Header)
		if left == right {
			return items[i].HuddleLogicGateID < items[j].HuddleLogicGateID
		}
		return left < right
	})
	return items, nil
}

func (r *MemoryRepo) CreateHuddleLogicGateRelationship(input HuddleLogicGateRelationshipInput) error {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.HuddleLogicGateID = cleanUUIDText(input.HuddleLogicGateID)
	input.LogicGateID = cleanUUIDText(input.LogicGateID)
	if input.CompanyID == "" || input.HuddleLogicGateID == "" || input.LogicGateID == "" {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.huddleLogicGates[key(input.CompanyID, input.HuddleLogicGateID)]; !ok {
		return ErrNotFound
	}
	if _, ok := r.logicGates[key(input.CompanyID, input.LogicGateID)]; !ok {
		return ErrNotFound
	}
	relationshipKey := memoryHuddleLogicGateRelationshipKey(input.CompanyID, input.HuddleLogicGateID, input.LogicGateID)
	if _, ok := r.huddleLogicGateRelationships[relationshipKey]; !ok {
		r.huddleLogicGateRelationships[relationshipKey] = domain.HuddleLogicGateRelationship{CompanyID: input.CompanyID, HuddleLogicGateID: input.HuddleLogicGateID, LogicGateID: input.LogicGateID, CreatedTimestamp: time.Now().UTC()}
	}
	return nil
}

func (r *MemoryRepo) DeleteHuddleLogicGateRelationship(input HuddleLogicGateRelationshipInput) error {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.HuddleLogicGateID = cleanUUIDText(input.HuddleLogicGateID)
	input.LogicGateID = cleanUUIDText(input.LogicGateID)
	if input.CompanyID == "" || input.HuddleLogicGateID == "" || input.LogicGateID == "" {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	relationshipKey := memoryHuddleLogicGateRelationshipKey(input.CompanyID, input.HuddleLogicGateID, input.LogicGateID)
	if _, ok := r.huddleLogicGateRelationships[relationshipKey]; !ok {
		return ErrNotFound
	}
	delete(r.huddleLogicGateRelationships, relationshipKey)
	return nil
}

func (r *MemoryRepo) DeleteHuddleLogicGate(companyID, id, userID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	k := key(companyID, id)
	item, ok := r.huddleLogicGates[k]
	if !ok {
		return ErrNotFound
	}
	for _, node := range r.huddleNodes {
		if node.CompanyID == companyID && node.HuddleLogicGateID == id {
			return ErrConflict
		}
	}
	r.addSimpleHuddleRecycleLocked(companyID, userID, "huddle_logic_gate", id, item.Header)
	r.deleteMemoryHuddlePoliciesLocked(companyID, EntityTypeHuddleLogicGate, id)
	delete(r.huddleLogicGates, k)
	for relationshipKey, relationship := range r.huddleLogicGateRelationships {
		if relationship.CompanyID == companyID && relationship.HuddleLogicGateID == id {
			delete(r.huddleLogicGateRelationships, relationshipKey)
		}
	}
	for ik, p := range r.huddleExplorerItems {
		if p.CompanyID == companyID && p.ResourceType == EntityTypeHuddleLogicGate && p.ResourceID == id {
			delete(r.huddleExplorerItems, ik)
		}
	}
	return nil
}

func (r *MemoryRepo) ListHuddleNodes(companyID, ownerID string) ([]domain.HuddleNode, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := []domain.HuddleNode{}
	for _, item := range r.huddleNodes {
		if item.CompanyID == companyID && item.HuddleLogicGateID == ownerID {
			items = append(items, item)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp) })
	return items, nil
}

func (r *MemoryRepo) CreateHuddleNode(input HuddleCreateInput) (domain.HuddleNode, error) {
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		return domain.HuddleNode{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.huddleLogicGates[key(input.CompanyID, input.OwnerID)]; !ok {
		return domain.HuddleNode{}, ErrNotFound
	}
	now := time.Now().UTC()
	item := domain.HuddleNode{CompanyID: input.CompanyID, HuddleNodeID: newUUIDv7String(), HuddleLogicGateID: input.OwnerID, Name: input.Name, CreatedTimestamp: now, UpdatedTimestamp: now}
	r.huddleNodes[key(input.CompanyID, item.HuddleNodeID)] = item
	r.ensureV2PolicySettingsLocked(input.CompanyID, EntityTypeHuddleNode, item.HuddleNodeID)
	for _, relationship := range r.huddleLogicGateRelationships {
		if relationship.CompanyID != input.CompanyID || relationship.HuddleLogicGateID != input.OwnerID {
			continue
		}
		nodeRelationship := domain.HuddleNodeLogicGateRelationship{CompanyID: input.CompanyID, HuddleNodeID: item.HuddleNodeID, LogicGateID: relationship.LogicGateID, CreatedTimestamp: now}
		r.huddleNodeLogicGateRelationships[memoryHuddleNodeLogicGateRelationshipKey(input.CompanyID, item.HuddleNodeID, relationship.LogicGateID)] = nodeRelationship
		for _, kpi := range r.kpis {
			if kpi.CompanyID == input.CompanyID && kpi.LogicGateID == relationship.LogicGateID {
				r.huddleNodeKPIRelationships[memoryHuddleNodeKPIRelationshipKey(input.CompanyID, item.HuddleNodeID, relationship.LogicGateID, kpi.KPIID)] = domain.HuddleNodeKPIRelationship{CompanyID: input.CompanyID, HuddleNodeID: item.HuddleNodeID, LogicGateID: relationship.LogicGateID, KPIID: kpi.KPIID, CreatedTimestamp: now}
			}
		}
	}
	return item, nil
}

func (r *MemoryRepo) GetHuddleNode(companyID, id string) (domain.HuddleNode, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	item, ok := r.huddleNodes[key(companyID, id)]
	if !ok {
		return domain.HuddleNode{}, ErrNotFound
	}
	return item, nil
}

func (r *MemoryRepo) ListHuddleNodeLogicGateCards(companyID, huddleNodeID string) ([]domain.HuddleLogicGateCard, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	logicGateIDs := map[string]bool{}
	kpiIDs := map[string]bool{}
	for _, relationship := range r.huddleNodeLogicGateRelationships {
		if relationship.CompanyID == companyID && relationship.HuddleNodeID == huddleNodeID {
			logicGateIDs[relationship.LogicGateID] = true
		}
	}
	for _, relationship := range r.huddleNodeKPIRelationships {
		if relationship.CompanyID == companyID && relationship.HuddleNodeID == huddleNodeID {
			kpiIDs[relationship.KPIID] = true
		}
	}
	return r.huddleLogicGateCardsLocked(companyID, logicGateIDs, kpiIDs), nil
}
func (r *MemoryRepo) UpdateHuddleNode(input HuddleUpdateInput) (domain.HuddleNode, error) {
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		return domain.HuddleNode{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	k := key(input.CompanyID, input.ResourceID)
	item, ok := r.huddleNodes[k]
	if !ok {
		return domain.HuddleNode{}, ErrNotFound
	}
	item.Name = input.Name
	item.UpdatedTimestamp = time.Now().UTC()
	r.huddleNodes[k] = item
	return item, nil
}
func (r *MemoryRepo) DeleteHuddleNode(companyID, id, userID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	k := key(companyID, id)
	item, ok := r.huddleNodes[k]
	if !ok {
		return ErrNotFound
	}
	r.addSimpleHuddleRecycleLocked(companyID, userID, "huddle_node", id, item.Name)
	r.deleteMemoryHuddlePoliciesLocked(companyID, EntityTypeHuddleNode, id)
	delete(r.huddleNodes, k)
	for relationshipKey, relationship := range r.huddleNodeLogicGateRelationships {
		if relationship.CompanyID == companyID && relationship.HuddleNodeID == id {
			delete(r.huddleNodeLogicGateRelationships, relationshipKey)
		}
	}
	for relationshipKey, relationship := range r.huddleNodeKPIRelationships {
		if relationship.CompanyID == companyID && relationship.HuddleNodeID == id {
			delete(r.huddleNodeKPIRelationships, relationshipKey)
		}
	}
	return nil
}

func (r *MemoryRepo) ListKPIs(companyID, ownerID string) ([]domain.KPI, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := []domain.KPI{}
	for _, item := range r.kpis {
		if item.CompanyID == companyID && item.LogicGateID == ownerID {
			items = append(items, item)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp) })
	return items, nil
}
func (r *MemoryRepo) CreateKPI(input HuddleCreateInput) (domain.KPI, error) {
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		return domain.KPI{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.logicGates[key(input.CompanyID, input.OwnerID)]; !ok {
		return domain.KPI{}, ErrNotFound
	}
	now := time.Now().UTC()
	item := domain.KPI{CompanyID: input.CompanyID, KPIID: newUUIDv7String(), LogicGateID: input.OwnerID, Name: input.Name, CreatedTimestamp: now, UpdatedTimestamp: now}
	r.kpis[key(input.CompanyID, item.KPIID)] = item
	return item, nil
}
func (r *MemoryRepo) GetKPI(companyID, id string) (domain.KPI, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	item, ok := r.kpis[key(companyID, id)]
	if !ok {
		return domain.KPI{}, ErrNotFound
	}
	return item, nil
}
func (r *MemoryRepo) UpdateKPI(input HuddleUpdateInput) (domain.KPI, error) {
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		return domain.KPI{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	k := key(input.CompanyID, input.ResourceID)
	item, ok := r.kpis[k]
	if !ok {
		return domain.KPI{}, ErrNotFound
	}
	item.Name = input.Name
	item.UpdatedTimestamp = time.Now().UTC()
	r.kpis[k] = item
	return item, nil
}
func (r *MemoryRepo) DeleteKPI(companyID, id, userID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	k := key(companyID, id)
	item, ok := r.kpis[k]
	if !ok {
		return ErrNotFound
	}
	r.addSimpleHuddleRecycleLocked(companyID, userID, "kpi", id, item.Name)
	delete(r.kpis, k)
	for relationshipKey, relationship := range r.huddleNodeKPIRelationships {
		if relationship.CompanyID == companyID && relationship.KPIID == id {
			delete(r.huddleNodeKPIRelationships, relationshipKey)
		}
	}
	return nil
}

func (r *MemoryRepo) ListHuddleExplorer(companyID string) (domain.HuddleExplorer, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := domain.HuddleExplorer{Folders: []domain.HuddleExplorerFolder{}, Items: []domain.HuddleExplorerItem{}}
	for _, v := range r.huddleExplorerFolders {
		if v.CompanyID == companyID {
			result.Folders = append(result.Folders, v)
		}
	}
	for _, v := range r.huddleExplorerItems {
		if v.CompanyID == companyID {
			result.Items = append(result.Items, v)
		}
	}
	return result, nil
}
func (r *MemoryRepo) CreateHuddleExplorerFolder(input HuddleCreateInput) (domain.HuddleExplorerFolder, error) {
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		return domain.HuddleExplorerFolder{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now().UTC()
	item := domain.HuddleExplorerFolder{CompanyID: input.CompanyID, FolderID: newUUIDv7String(), Name: input.Name, CreatedTimestamp: now, UpdatedTimestamp: now}
	if input.OwnerID != "" {
		if _, ok := r.huddleExplorerFolders[key(input.CompanyID, input.OwnerID)]; !ok {
			return domain.HuddleExplorerFolder{}, ErrNotFound
		}
		item.ParentFolderID = &input.OwnerID
	}
	r.huddleExplorerFolders[key(input.CompanyID, item.FolderID)] = item
	return item, nil
}
func (r *MemoryRepo) UpdateHuddleExplorerFolder(input HuddleUpdateInput) (domain.HuddleExplorerFolder, error) {
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		return domain.HuddleExplorerFolder{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	k := key(input.CompanyID, input.ResourceID)
	item, ok := r.huddleExplorerFolders[k]
	if !ok {
		return domain.HuddleExplorerFolder{}, ErrNotFound
	}
	item.Name = input.Name
	item.UpdatedTimestamp = time.Now().UTC()
	r.huddleExplorerFolders[k] = item
	return item, nil
}
func (r *MemoryRepo) MoveHuddleExplorerFolder(input HuddleMoveInput) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	k := key(input.CompanyID, input.ResourceID)
	item, ok := r.huddleExplorerFolders[k]
	if !ok {
		return ErrNotFound
	}
	if input.ParentFolderID == input.ResourceID {
		return ErrConflict
	}
	if input.ParentFolderID == "" {
		item.ParentFolderID = nil
	} else {
		if _, ok := r.huddleExplorerFolders[key(input.CompanyID, input.ParentFolderID)]; !ok {
			return ErrNotFound
		}
		parent := input.ParentFolderID
		item.ParentFolderID = &parent
	}
	item.UpdatedTimestamp = time.Now().UTC()
	r.huddleExplorerFolders[k] = item
	return nil
}
func (r *MemoryRepo) DeleteHuddleExplorerFolder(companyID, id, userID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	k := key(companyID, id)
	item, ok := r.huddleExplorerFolders[k]
	if !ok {
		return ErrNotFound
	}
	for _, f := range r.huddleExplorerFolders {
		if f.CompanyID == companyID && f.ParentFolderID != nil && *f.ParentFolderID == id {
			return ErrConflict
		}
	}
	for _, p := range r.huddleExplorerItems {
		if p.CompanyID == companyID && p.ParentFolderID != nil && *p.ParentFolderID == id {
			return ErrConflict
		}
	}
	r.addSimpleHuddleRecycleLocked(companyID, userID, "huddle_explorer_folder", id, item.Name)
	delete(r.huddleExplorerFolders, k)
	return nil
}
func (r *MemoryRepo) MoveHuddleExplorerItem(input HuddleMoveInput) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	k := key(input.CompanyID, input.ResourceID)
	item, ok := r.huddleExplorerItems[k]
	if !ok {
		return ErrNotFound
	}
	if input.ParentFolderID == "" {
		item.ParentFolderID = nil
	} else {
		if _, ok := r.huddleExplorerFolders[key(input.CompanyID, input.ParentFolderID)]; !ok {
			return ErrNotFound
		}
		parent := input.ParentFolderID
		item.ParentFolderID = &parent
	}
	item.UpdatedTimestamp = time.Now().UTC()
	r.huddleExplorerItems[k] = item
	return nil
}
func (r *MemoryRepo) DeleteHuddleExplorerItem(companyID, id, userID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	k := key(companyID, id)
	item, ok := r.huddleExplorerItems[k]
	if !ok {
		return ErrNotFound
	}
	r.addSimpleHuddleRecycleLocked(companyID, userID, "huddle_explorer_item", id, item.Name)
	delete(r.huddleExplorerItems, k)
	return nil
}

func (r *MemoryRepo) addSimpleHuddleRecycleLocked(companyID, userID, kind, id, label string) {
	now := time.Now().UTC()
	recycleID := newUUIDv7String()
	r.recycleBin[key(companyID, recycleID)] = memoryRecycleBinItem{Item: domain.RecycleBinItem{CompanyID: companyID, RecycleBinItemID: recycleID, ObjectKind: kind, ObjectID: id, ObjectLabel: label, DeletedByUserID: userID, DeletedTimestamp: now}, Snapshot: r.snapshotRecycleStateLocked()}
}

func (r *MemoryRepo) deleteMemoryHuddlePoliciesLocked(companyID, resourceType, resourceID string) {
	r.replaceMemoryRACIEdgesLocked(companyID, resourceType, resourceID, nil)
	r.replaceMemoryPermissionEdgesLocked(companyID, resourceType, resourceID, nil)
	policyKey := resourcePolicyKey(companyID, resourceType, resourceID)
	delete(r.gvicV2Settings, policyKey)
	delete(r.permissionV2Settings, policyKey)
}
