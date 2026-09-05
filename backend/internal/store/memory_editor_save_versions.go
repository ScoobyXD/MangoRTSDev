package store

import (
	"maps"
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
	if previous != nil && strings.EqualFold(strings.TrimSpace(previous.Type), "Text block chat") && strings.EqualFold(infoType, "Text block chat") {
		outboxInput, err := nodeChatUpdatedOutboxInput(projection)
		if err != nil {
			return domain.NodeProjection{}, err
		}
		if _, err := r.enqueueRealtimeOutboxLocked(outboxInput); err != nil {
			return domain.NodeProjection{}, err
		}
		r.bumpNodeViewVersionLocked(companyID, nodeID)
	}
	r.nodeText[k][informationID] = projection
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
	saveID := newUUIDv7String()
	saveKind := normalizeEditorSaveKind(input.SaveKind)
	if saveKind == editorSaveKindLegacy {
		saveKind = editorSaveKindManual
	}
	current := []domain.LogicGateInformation{}
	now := time.Now().UTC()
	for _, document := range r.editorJSONDocuments {
		if document.Deleted || document.Ref.CompanyID != companyID || document.Ref.ResourceType != EntityTypeLogicGate || document.Ref.ResourceID != logicGateID {
			continue
		}
		body, err := encodeEditorTextboxBody(document.JSONDocument, document.Annotations)
		if err != nil {
			return domain.EditorSaveVersion{}, err
		}
		current = append(current, domain.LogicGateInformation{Type: "Text box", InformationID: document.Ref.DocumentID, SourceInformationID: document.Ref.DocumentID, Information: string(body)})
	}
	sort.Slice(current, func(i, j int) bool { return current[i].InformationID < current[j].InformationID })
	hasOverview := len(current) > 0
	for _, step := range r.processStepsLocked(companyID, logicGateID) {
		current = append(current, domain.LogicGateInformation{Type: EntityTypeProcessStep, InformationID: step.ProcessStepID, SourceInformationID: step.ProcessStepID, Information: string(step.BodyJSON)})
	}
	if len(current) == 0 {
		return domain.EditorSaveVersion{}, ErrInvalid
	}
	if !hasOverview {
		current = append(current, domain.LogicGateInformation{Type: "Text box", InformationID: "logic-gate-overview", SourceInformationID: "logic-gate-overview", Information: string(emptyEditorTextboxBody())})
	}
	items := make([]domain.EditorSaveVersionItem, 0, len(current))
	for index := range current {
		item := &current[index]
		item.CompanyID, item.LogicGateID, item.SaveBatchID, item.SaveKind = companyID, logicGateID, saveID, saveKind
		item.SavedByUserID, item.SavedByDisplayName = strings.TrimSpace(input.ActorUserID), strings.TrimSpace(input.ActorDisplayName)
		item.CreatedTimestamp, item.UpdatedTimestamp = now, now
		items = append(items, memoryLogicGateHistoryItem(*item))
	}
	r.logicGateInfo[key(companyID, logicGateID)] = append(r.logicGateInfo[key(companyID, logicGateID)], current...)
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
	deleted := false
	defer func() {
		r.mu.Unlock()
		if deleted && input.AfterDeleteCommit != nil {
			input.AfterDeleteCommit()
		}
	}()
	companyID := strings.TrimSpace(input.CompanyID)
	nodeID := strings.TrimSpace(input.ResourceID)
	saveID := strings.TrimSpace(input.SaveID)
	if _, ok := r.nodes[key(companyID, nodeID)]; !ok {
		return domain.EditorSaveVersion{}, ErrNotFound
	}

	version, ok := memoryFindNodeSaveVersion(companyID, nodeID, saveID, r.nodeInfo[key(companyID, nodeID)])
	if !ok {
		return domain.EditorSaveVersion{}, ErrNotFound
	}
	now := time.Now().UTC()
	desired := map[string]domain.EditorSaveVersionItem{}
	for _, item := range version.Items {
		sourceID := strings.TrimSpace(item.SourceInformationID)
		if sourceID == "" {
			sourceID = strings.TrimSpace(item.InformationID)
		}
		if sourceID != "" {
			desired[sourceID] = item
		}
	}
	for sourceID, existing := range r.nodeText[key(companyID, nodeID)] {
		if !isEditorTextBoxType(existing.Type) || existing.IsDeleted {
			continue
		}
		if _, keep := desired[sourceID]; keep {
			continue
		}
		r.deleteEditorProjectionLocked(EditorDocumentRef{CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: nodeID, DocumentID: sourceID})
		deleted = true
	}
	for sourceID, item := range desired {
		projection := r.nodeText[key(companyID, nodeID)][sourceID]
		created := projection.CreatedTimestamp
		if created.IsZero() {
			created = now
		}
		projection.CompanyID, projection.NodeID, projection.InformationID = companyID, nodeID, sourceID
		projection.Type, projection.Information, projection.IsDeleted = "Text box", item.Information, false
		projection.Revision++
		if projection.Revision < 1 {
			projection.Revision = 1
		}
		projection.CreatedTimestamp, projection.UpdatedTimestamp = created, now
		r.nodeText[key(companyID, nodeID)][sourceID] = projection
	}
	return version, nil
}
func (r *MemoryRepo) RestoreLogicGateEditorSaveVersion(input EditorSaveVersionRestoreInput) (version domain.EditorSaveVersion, err error) {
	r.mu.Lock()
	deleted := false
	defer func() {
		r.mu.Unlock()
		if err == nil && deleted && input.AfterDeleteCommit != nil {
			input.AfterDeleteCommit()
		}
	}()
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
	type replacement struct {
		input      EditorJSONCommitInput
		sizeChange int
	}
	replacements := make([]replacement, 0, len(version.Items))
	desiredOverview := map[string]bool{}
	for _, item := range version.Items {
		ref := EditorJSONDocumentRef{CompanyID: companyID, ResourceType: EntityTypeLogicGate, ResourceID: logicGateID, DocumentID: item.SourceInformationID}
		if item.ProcessStepID != nil {
			step, exists := r.processSteps[key(companyID, *item.ProcessStepID)]
			if !exists || step.LogicGateID != logicGateID {
				continue
			}
			ref.ResourceType, ref.ResourceID, ref.DocumentID = EntityTypeProcessStep, step.ProcessStepID, step.ProcessStepID
		} else {
			desiredOverview[ref.DocumentID] = true
		}
		document, annotations, err := decodeEditorTextboxBody([]byte(item.Information))
		if err != nil {
			return domain.EditorSaveVersion{}, err
		}
		current, _, err := r.editorJSONDocumentLocked(ref)
		if err != nil {
			return domain.EditorSaveVersion{}, err
		}
		commit, err := NormalizeEditorJSONCommit(EditorJSONCommitInput{Document: ref, OperationID: newUUIDv7String(), ClientID: "manual-history-restore", ActorUserID: input.ActorUserID, BaseRevision: current.Revision, SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: document, Annotations: annotations})
		if err != nil {
			return domain.EditorSaveVersion{}, err
		}
		replacements = append(replacements, replacement{input: commit, sizeChange: len(document) - len(current.JSONDocument)})
	}
	deletions := []EditorJSONDeleteInput{}
	for _, document := range r.editorJSONDocuments {
		if document.Deleted || document.Ref.CompanyID != companyID || document.Ref.ResourceType != EntityTypeLogicGate || document.Ref.ResourceID != logicGateID || desiredOverview[document.Ref.DocumentID] {
			continue
		}
		deletions = append(deletions, EditorJSONDeleteInput{Document: document.Ref, OperationID: newUUIDv7String(), ClientID: "manual-history-restore", ActorUserID: input.ActorUserID, BaseRevision: document.Revision})
	}
	beforeDocuments, beforeSteps := maps.Clone(r.editorJSONDocuments), maps.Clone(r.processSteps)
	beforeOperations, beforeVersions := maps.Clone(r.editorJSONOperations), maps.Clone(r.editorJSONVersions)
	beforeOutbox, beforeSequence := maps.Clone(r.realtimeOutbox), r.realtimeOutboxSequence
	beforeProjections := maps.Clone(r.logicGateText[key(companyID, logicGateID)])
	defer func() {
		if err != nil {
			r.editorJSONDocuments, r.processSteps = beforeDocuments, beforeSteps
			r.editorJSONOperations, r.editorJSONVersions = beforeOperations, beforeVersions
			r.realtimeOutbox, r.realtimeOutboxSequence = beforeOutbox, beforeSequence
			r.logicGateText[key(companyID, logicGateID)] = beforeProjections
		}
	}()
	sort.SliceStable(replacements, func(i, j int) bool { return replacements[i].sizeChange < replacements[j].sizeChange })
	for _, deletion := range deletions {
		if _, err := r.deleteEditorJSONDocumentLocked(deletion); err != nil {
			return domain.EditorSaveVersion{}, err
		}
	}
	for _, replacement := range replacements {
		if replacement.input.Document.ResourceType == EntityTypeLogicGate {
			documentKey := editorJSONMemoryKey(replacement.input.Document)
			if current, exists := r.editorJSONDocuments[documentKey]; exists && current.Deleted {
				current.Deleted = false
				r.editorJSONDocuments[documentKey] = current
			}
		}
		if _, err := r.commitEditorJSONDocumentLocked(replacement.input); err != nil {
			return domain.EditorSaveVersion{}, err
		}
	}
	deleted = len(deletions) > 0
	return version, nil
}

func memoryLogicGateHistoryItem(item domain.LogicGateInformation) domain.EditorSaveVersionItem {
	result := domain.EditorSaveVersionItem{InformationID: item.InformationID, SourceInformationID: item.SourceInformationID,
		Type: "Text box", Information: item.Information, CreatedTimestamp: item.CreatedTimestamp, UpdatedTimestamp: item.UpdatedTimestamp}
	if item.Type == EntityTypeProcessStep {
		stepID := item.SourceInformationID
		result.ProcessStepID = &stepID
	}
	return result
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
		versionsByID[saveID] = append(versionsByID[saveID], memoryLogicGateHistoryItem(item))
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
