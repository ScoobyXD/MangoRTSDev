package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

func (r *MemoryRepo) UpsertNodeProjectionWithActor(input NodeInformationInput) (domain.NodeProjection, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	companyID := strings.TrimSpace(input.CompanyID)
	nodeID := strings.TrimSpace(input.NodeID)
	informationID := strings.TrimSpace(input.InformationID)
	infoType := strings.TrimSpace(input.Type)
	if companyID == "" || nodeID == "" || informationID == "" || infoType == "" || strings.TrimSpace(input.Information) == "" {
		return domain.NodeProjection{}, ErrInvalid
	}
	if _, ok := r.nodes[key(companyID, nodeID)]; !ok {
		return domain.NodeProjection{}, ErrNotFound
	}
	if _, protected := r.emailCollaborationForNodeLocked(companyID, nodeID); protected {
		return domain.NodeProjection{}, ErrProtectedEmailCollaborationResource
	}
	k := key(companyID, nodeID)
	if r.nodeText[k] == nil {
		r.nodeText[k] = map[string]domain.NodeProjection{}
	}
	now := time.Now().UTC()
	created := now
	previous := (*domain.NodeProjection)(nil)
	revision := int64(1)
	if existing, ok := r.nodeText[k][informationID]; ok {
		created = existing.CreatedTimestamp
		existingCopy := existing
		if existingCopy.Revision < 1 {
			existingCopy.Revision = 1
		}
		previous = &existingCopy
		revision = existingCopy.Revision + 1
	}
	if isEditorTextBoxType(infoType) {
		if input.ExpectedRevision == nil {
			return domain.NodeProjection{}, ErrProjectionRevisionRequired
		}
		if *input.ExpectedRevision < 0 {
			return domain.NodeProjection{}, ErrInvalid
		}
		if previous == nil && *input.ExpectedRevision != 0 {
			return domain.NodeProjection{}, &ProjectionRevisionConflictError{}
		}
		if previous != nil && !(previous.IsDeleted && *input.ExpectedRevision == 0) && *input.ExpectedRevision != previous.Revision {
			current := *previous
			return domain.NodeProjection{}, &ProjectionRevisionConflictError{NodeCurrent: &current}
		}
	}
	projection := domain.NodeProjection{
		CompanyID:        companyID,
		NodeID:           nodeID,
		Type:             infoType,
		Information:      input.Information,
		InformationID:    informationID,
		Revision:         revision,
		CreatedTimestamp: created,
		UpdatedTimestamp: now,
	}
	r.nodeText[k][informationID] = projection
	if strings.TrimSpace(input.ActorUserID) != "" || strings.TrimSpace(input.ActorDisplayName) != "" {
		r.recordNodeContentChangesLocked(buildNodeContentChanges(
			companyID,
			nodeID,
			informationID,
			infoType,
			previous,
			input.Information,
			normalizeNodeContentChangeActor(input.ActorUserID, input.ActorDisplayName),
			now,
		))
	}
	return projection, nil
}

func (r *MemoryRepo) UpsertLogicGateProjection(input LogicGateProjectionInput) (domain.LogicGateProjection, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	companyID := strings.TrimSpace(input.CompanyID)
	logicGateID := strings.TrimSpace(input.LogicGateID)
	informationID := strings.TrimSpace(input.InformationID)
	infoType := strings.TrimSpace(input.Type)
	if companyID == "" || logicGateID == "" || informationID == "" || infoType == "" || strings.TrimSpace(input.Information) == "" {
		return domain.LogicGateProjection{}, ErrInvalid
	}
	if _, ok := r.logicGates[key(companyID, logicGateID)]; !ok {
		return domain.LogicGateProjection{}, ErrNotFound
	}
	k := key(companyID, logicGateID)
	if r.logicGateText[k] == nil {
		r.logicGateText[k] = map[string]domain.LogicGateProjection{}
	}
	projectionID := informationID
	previous := (*domain.LogicGateProjection)(nil)
	if isEditorTextBoxType(infoType) {
		if existingTextKey := newestLogicGateTextProjectionKey(r.logicGateText[k]); existingTextKey != "" {
			projectionID = existingTextKey
			existing := r.logicGateText[k][projectionID]
			if existing.Revision < 1 {
				existing.Revision = 1
			}
			existingCopy := existing
			previous = &existingCopy
		}
	}
	now := time.Now().UTC()
	created := now
	revision := int64(1)
	if previous != nil {
		created = previous.CreatedTimestamp
		revision = previous.Revision + 1
	}
	if isEditorTextBoxType(infoType) {
		if input.ExpectedRevision == nil {
			return domain.LogicGateProjection{}, ErrProjectionRevisionRequired
		}
		if *input.ExpectedRevision < 0 {
			return domain.LogicGateProjection{}, ErrInvalid
		}
		if previous == nil && *input.ExpectedRevision != 0 {
			return domain.LogicGateProjection{}, &ProjectionRevisionConflictError{}
		}
		if previous != nil && !(previous.IsDeleted && *input.ExpectedRevision == 0) && *input.ExpectedRevision != previous.Revision {
			current := *previous
			return domain.LogicGateProjection{}, &ProjectionRevisionConflictError{LogicGateCurrent: &current}
		}
		if previous != nil && previous.IsDeleted && *input.ExpectedRevision == 0 {
			projectionID = informationID
		}
		for keyValue, projection := range r.logicGateText[k] {
			if keyValue != projectionID && isEditorTextBoxType(projection.Type) {
				delete(r.logicGateText[k], keyValue)
			}
		}
	}
	projection := domain.LogicGateProjection{
		CompanyID:        companyID,
		LogicGateID:      logicGateID,
		Type:             infoType,
		Information:      input.Information,
		InformationID:    projectionID,
		Revision:         revision,
		CreatedTimestamp: created,
		UpdatedTimestamp: now,
	}
	r.logicGateText[k][projectionID] = projection
	return projection, nil
}

func (r *MemoryRepo) CreateNodeEditorSaveVersion(input EditorSaveVersionInput) (domain.EditorSaveVersion, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	companyID := strings.TrimSpace(input.CompanyID)
	nodeID := strings.TrimSpace(input.ResourceID)
	if _, ok := r.nodes[key(companyID, nodeID)]; !ok {
		return domain.EditorSaveVersion{}, ErrNotFound
	}
	if _, protected := r.emailCollaborationForNodeLocked(companyID, nodeID); protected {
		return domain.EditorSaveVersion{}, ErrProtectedEmailCollaborationResource
	}
	projections := memoryEditorTextNodeProjections(r.nodeText[key(companyID, nodeID)])
	if len(projections) == 0 {
		return domain.EditorSaveVersion{}, ErrInvalid
	}
	saveID := newUUIDv7String()
	saveKind := normalizeEditorSaveKind(input.SaveKind)
	if saveKind == editorSaveKindLegacy {
		saveKind = editorSaveKindManual
	}
	items := make([]domain.EditorSaveVersionItem, 0, len(projections))
	now := time.Now().UTC()
	for _, projection := range projections {
		item := domain.NodeInformation{
			CompanyID:           companyID,
			InformationID:       newUUIDv7String(),
			NodeID:              nodeID,
			Type:                projection.Type,
			Information:         projection.Information,
			SaveBatchID:         saveID,
			SaveKind:            saveKind,
			SavedByUserID:       strings.TrimSpace(input.ActorUserID),
			SavedByDisplayName:  strings.TrimSpace(input.ActorDisplayName),
			SourceInformationID: projection.InformationID,
			CreatedTimestamp:    now,
			UpdatedTimestamp:    now,
		}
		r.nodeInfo[key(companyID, nodeID)] = append(r.nodeInfo[key(companyID, nodeID)], item)
		items = append(items, domain.EditorSaveVersionItem{
			InformationID:       item.InformationID,
			SourceInformationID: item.SourceInformationID,
			Type:                item.Type,
			Information:         item.Information,
			CreatedTimestamp:    item.CreatedTimestamp,
			UpdatedTimestamp:    item.UpdatedTimestamp,
		})
	}
	return editorSaveVersionFromItems(companyID, EntityTypeNode, nodeID, saveID, saveKind, strings.TrimSpace(input.ActorUserID), strings.TrimSpace(input.ActorDisplayName), items), nil
}

func (r *MemoryRepo) CreateLogicGateEditorSaveVersion(input EditorSaveVersionInput) (domain.EditorSaveVersion, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	companyID := strings.TrimSpace(input.CompanyID)
	logicGateID := strings.TrimSpace(input.ResourceID)
	if _, ok := r.logicGates[key(companyID, logicGateID)]; !ok {
		return domain.EditorSaveVersion{}, ErrNotFound
	}
	projections := memoryEditorTextLogicGateProjections(r.logicGateText[key(companyID, logicGateID)])
	if len(projections) == 0 {
		return domain.EditorSaveVersion{}, ErrInvalid
	}
	saveID := newUUIDv7String()
	saveKind := normalizeEditorSaveKind(input.SaveKind)
	if saveKind == editorSaveKindLegacy {
		saveKind = editorSaveKindManual
	}
	items := make([]domain.EditorSaveVersionItem, 0, len(projections))
	now := time.Now().UTC()
	for _, projection := range projections {
		item := domain.LogicGateInformation{
			CompanyID:           companyID,
			InformationID:       newUUIDv7String(),
			LogicGateID:         logicGateID,
			Type:                projection.Type,
			Information:         projection.Information,
			SaveBatchID:         saveID,
			SaveKind:            saveKind,
			SavedByUserID:       strings.TrimSpace(input.ActorUserID),
			SavedByDisplayName:  strings.TrimSpace(input.ActorDisplayName),
			SourceInformationID: projection.InformationID,
			CreatedTimestamp:    now,
			UpdatedTimestamp:    now,
		}
		r.logicGateInfo[key(companyID, logicGateID)] = append(r.logicGateInfo[key(companyID, logicGateID)], item)
		items = append(items, domain.EditorSaveVersionItem{
			InformationID:       item.InformationID,
			SourceInformationID: item.SourceInformationID,
			Type:                item.Type,
			Information:         item.Information,
			CreatedTimestamp:    item.CreatedTimestamp,
			UpdatedTimestamp:    item.UpdatedTimestamp,
		})
	}
	return editorSaveVersionFromItems(companyID, EntityTypeLogicGate, logicGateID, saveID, saveKind, strings.TrimSpace(input.ActorUserID), strings.TrimSpace(input.ActorDisplayName), items), nil
}

func (r *MemoryRepo) ListNodeEditorSaveVersions(companyID, nodeID string) ([]domain.EditorSaveVersion, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, ok := r.nodes[key(companyID, nodeID)]; !ok {
		return nil, ErrNotFound
	}
	return memoryNodeSaveVersions(companyID, nodeID, r.nodeInfo[key(companyID, nodeID)]), nil
}

func (r *MemoryRepo) ListLogicGateEditorSaveVersions(companyID, logicGateID string) ([]domain.EditorSaveVersion, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, ok := r.logicGates[key(companyID, logicGateID)]; !ok {
		return nil, ErrNotFound
	}
	return memoryLogicGateSaveVersions(companyID, logicGateID, r.logicGateInfo[key(companyID, logicGateID)]), nil
}

func (r *MemoryRepo) RestoreNodeEditorSaveVersion(input EditorSaveVersionRestoreInput) (domain.EditorSaveVersion, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	companyID := strings.TrimSpace(input.CompanyID)
	nodeID := strings.TrimSpace(input.ResourceID)
	saveID := strings.TrimSpace(input.SaveID)
	if _, ok := r.nodes[key(companyID, nodeID)]; !ok {
		return domain.EditorSaveVersion{}, ErrNotFound
	}
	if _, protected := r.emailCollaborationForNodeLocked(companyID, nodeID); protected {
		return domain.EditorSaveVersion{}, ErrProtectedEmailCollaborationResource
	}
	version, ok := memoryFindNodeSaveVersion(companyID, nodeID, saveID, r.nodeInfo[key(companyID, nodeID)])
	if !ok {
		return domain.EditorSaveVersion{}, ErrNotFound
	}
	k := key(companyID, nodeID)
	beforeText := cloneMemoryNodeProjectionMap(r.nodeText[k])
	r.nodeText[k] = map[string]domain.NodeProjection{}
	now := time.Now().UTC()
	for _, existing := range beforeText {
		if isEditorTextBoxType(existing.Type) {
			existing.IsDeleted = true
			existing.Revision++
			existing.UpdatedTimestamp = now
			r.nodeText[k][existing.InformationID] = existing
			continue
		}
		r.nodeText[k][existing.InformationID] = existing
	}
	for _, item := range version.Items {
		sourceID := strings.TrimSpace(item.SourceInformationID)
		if sourceID == "" {
			sourceID = strings.TrimSpace(item.InformationID)
		}
		revision := int64(1)
		if existing, exists := beforeText[sourceID]; exists {
			if existing.Revision < 1 {
				existing.Revision = 1
			}
			revision = existing.Revision + 1
		}
		projection := domain.NodeProjection{
			CompanyID:        companyID,
			NodeID:           nodeID,
			Type:             item.Type,
			Information:      item.Information,
			InformationID:    sourceID,
			Revision:         revision,
			CreatedTimestamp: now,
			UpdatedTimestamp: now,
		}
		r.nodeText[k][sourceID] = projection
	}
	return version, nil
}

func (r *MemoryRepo) RestoreLogicGateEditorSaveVersion(input EditorSaveVersionRestoreInput) (domain.EditorSaveVersion, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	companyID := strings.TrimSpace(input.CompanyID)
	logicGateID := strings.TrimSpace(input.ResourceID)
	saveID := strings.TrimSpace(input.SaveID)
	if _, ok := r.logicGates[key(companyID, logicGateID)]; !ok {
		return domain.EditorSaveVersion{}, ErrNotFound
	}
	version, ok := memoryFindLogicGateSaveVersion(companyID, logicGateID, saveID, r.logicGateInfo[key(companyID, logicGateID)])
	if !ok {
		return domain.EditorSaveVersion{}, ErrNotFound
	}
	k := key(companyID, logicGateID)
	beforeText := cloneMemoryLogicGateProjectionMap(r.logicGateText[k])
	r.logicGateText[k] = map[string]domain.LogicGateProjection{}
	now := time.Now().UTC()
	for _, existing := range beforeText {
		if isEditorTextBoxType(existing.Type) {
			existing.IsDeleted = true
			existing.Revision++
			existing.UpdatedTimestamp = now
			r.logicGateText[k][existing.InformationID] = existing
			continue
		}
		r.logicGateText[k][existing.InformationID] = existing
	}
	for _, item := range version.Items {
		sourceID := strings.TrimSpace(item.SourceInformationID)
		if sourceID == "" {
			sourceID = strings.TrimSpace(item.InformationID)
		}
		revision := int64(1)
		if existing, exists := beforeText[sourceID]; exists {
			if existing.Revision < 1 {
				existing.Revision = 1
			}
			revision = existing.Revision + 1
		}
		projection := domain.LogicGateProjection{
			CompanyID:        companyID,
			LogicGateID:      logicGateID,
			Type:             item.Type,
			Information:      item.Information,
			InformationID:    sourceID,
			Revision:         revision,
			CreatedTimestamp: now,
			UpdatedTimestamp: now,
		}
		r.logicGateText[k][sourceID] = projection
	}
	return version, nil
}

func memoryEditorTextNodeProjections(items map[string]domain.NodeProjection) []domain.NodeProjection {
	out := make([]domain.NodeProjection, 0)
	for _, item := range items {
		if isEditorTextBoxType(item.Type) && !item.IsDeleted {
			out = append(out, item)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if !out[i].CreatedTimestamp.Equal(out[j].CreatedTimestamp) {
			return out[i].CreatedTimestamp.Before(out[j].CreatedTimestamp)
		}
		return out[i].InformationID < out[j].InformationID
	})
	return out
}

func memoryEditorTextLogicGateProjections(items map[string]domain.LogicGateProjection) []domain.LogicGateProjection {
	out := make([]domain.LogicGateProjection, 0)
	latestTextKey := newestLogicGateTextProjectionKey(items)
	for keyValue, item := range items {
		if isEditorTextBoxType(item.Type) && !item.IsDeleted && keyValue == latestTextKey {
			out = append(out, item)
		}
	}
	return out
}

func memoryNodeSaveVersions(companyID, nodeID string, items []domain.NodeInformation) []domain.EditorSaveVersion {
	versionsByID := map[string][]domain.EditorSaveVersionItem{}
	metaByID := map[string]domain.NodeInformation{}
	for _, item := range items {
		if strings.TrimSpace(item.SaveBatchID) == "" {
			continue
		}
		saveID := strings.TrimSpace(item.SaveBatchID)
		metaByID[saveID] = item
		versionsByID[saveID] = append(versionsByID[saveID], domain.EditorSaveVersionItem{
			InformationID:       item.InformationID,
			SourceInformationID: item.SourceInformationID,
			Type:                item.Type,
			Information:         item.Information,
			CreatedTimestamp:    item.CreatedTimestamp,
			UpdatedTimestamp:    item.UpdatedTimestamp,
		})
	}
	out := make([]domain.EditorSaveVersion, 0, len(versionsByID))
	for saveID, versionItems := range versionsByID {
		meta := metaByID[saveID]
		out = append(out, editorSaveVersionFromItems(companyID, EntityTypeNode, nodeID, saveID, meta.SaveKind, meta.SavedByUserID, meta.SavedByDisplayName, versionItems))
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].CreatedTimestamp.After(out[j].CreatedTimestamp)
	})
	return out
}

func memoryLogicGateSaveVersions(companyID, logicGateID string, items []domain.LogicGateInformation) []domain.EditorSaveVersion {
	versionsByID := map[string][]domain.EditorSaveVersionItem{}
	metaByID := map[string]domain.LogicGateInformation{}
	for _, item := range items {
		if strings.TrimSpace(item.SaveBatchID) == "" {
			continue
		}
		saveID := strings.TrimSpace(item.SaveBatchID)
		metaByID[saveID] = item
		versionsByID[saveID] = append(versionsByID[saveID], domain.EditorSaveVersionItem{
			InformationID:       item.InformationID,
			SourceInformationID: item.SourceInformationID,
			Type:                item.Type,
			Information:         item.Information,
			CreatedTimestamp:    item.CreatedTimestamp,
			UpdatedTimestamp:    item.UpdatedTimestamp,
		})
	}
	out := make([]domain.EditorSaveVersion, 0, len(versionsByID))
	for saveID, versionItems := range versionsByID {
		meta := metaByID[saveID]
		out = append(out, editorSaveVersionFromItems(companyID, EntityTypeLogicGate, logicGateID, saveID, meta.SaveKind, meta.SavedByUserID, meta.SavedByDisplayName, versionItems))
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].CreatedTimestamp.After(out[j].CreatedTimestamp)
	})
	return out
}

func memoryFindNodeSaveVersion(companyID, nodeID, saveID string, items []domain.NodeInformation) (domain.EditorSaveVersion, bool) {
	for _, version := range memoryNodeSaveVersions(companyID, nodeID, items) {
		if version.SaveID == saveID {
			return version, true
		}
	}
	return domain.EditorSaveVersion{}, false
}

func memoryFindLogicGateSaveVersion(companyID, logicGateID, saveID string, items []domain.LogicGateInformation) (domain.EditorSaveVersion, bool) {
	for _, version := range memoryLogicGateSaveVersions(companyID, logicGateID, items) {
		if version.SaveID == saveID {
			return version, true
		}
	}
	return domain.EditorSaveVersion{}, false
}
