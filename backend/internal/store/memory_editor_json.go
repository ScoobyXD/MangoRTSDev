package store

import (
	"bytes"
	"encoding/json"
	"sort"
	"strings"
	"time"
)

type memoryEditorJSONDocument struct {
	Ref                EditorJSONDocumentRef
	CollaborationEpoch string
	Revision           int64
	SchemaVersion      int
	JSONDocument       json.RawMessage
	Annotations        []EditorJSONAnnotation
	Deleted            bool
	UpdatedTimestamp   time.Time
}

type memoryEditorJSONOperation struct {
	OperationID  string
	ClientID     string
	BaseRevision int64
	JSONDocument json.RawMessage
	Annotations  []EditorJSONAnnotation
	EventID      string
	Revision     int64
	CommittedAt  time.Time
	Deleted      bool
}

func editorJSONMemoryKey(ref EditorJSONDocumentRef) string {
	return ref.CompanyID + ":" + ref.ResourceType + ":" + ref.ResourceID + ":" + ref.DocumentID
}

func (r *MemoryRepo) editorJSONOwnerTextLimitExceededLocked(ref EditorJSONDocumentRef, nextDocumentBytes int64) bool {
	var otherCurrentBytes int64
	targetKey := editorJSONMemoryKey(ref)
	for key, document := range r.editorJSONDocuments {
		if key == targetKey || document.Deleted || document.Ref.CompanyID != ref.CompanyID ||
			document.Ref.ResourceType != ref.ResourceType || document.Ref.ResourceID != ref.ResourceID {
			continue
		}
		otherCurrentBytes += int64(len(document.JSONDocument))
	}
	return EditorOwnerTextLimitExceeded(otherCurrentBytes, nextDocumentBytes)
}

func (r *MemoryRepo) GetEditorDataFormat(companyID string) (EditorDataFormatGate, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return EditorDataFormatGate{}, ErrInvalid
	}
	return DefaultEditorDataFormatGate(companyID), nil
}

// SetEditorDataFormatForTests validates the permanent TipTap-only gate.
func (r *MemoryRepo) SetEditorDataFormatForTests(gate EditorDataFormatGate) error {
	return ValidateEditorDataFormatGate(gate)
}

func (r *MemoryRepo) editorJSONFormatReadyLocked(companyID string) bool {
	return strings.TrimSpace(companyID) != ""
}

func (r *MemoryRepo) editorJSONResourceExistsLocked(ref EditorJSONDocumentRef) bool {
	switch ref.ResourceType {
	case EntityTypeNode, EntityTypeProject, EntityTypeLogicGate:
		return r.editorResourceExistsLocked(EditorDocumentRef{
			CompanyID: ref.CompanyID, ResourceType: ref.ResourceType,
			ResourceID: ref.ResourceID, DocumentID: ref.DocumentID,
		})
	case EntityTypeHuddleLogicGate:
		_, ok := r.huddleLogicGates[key(ref.CompanyID, ref.ResourceID)]
		return ok && ref.DocumentID == ref.ResourceID
	case EntityTypeHuddleNode:
		_, ok := r.huddleNodes[key(ref.CompanyID, ref.ResourceID)]
		return ok
	case EntityTypeKPI:
		_, ok := r.kpis[key(ref.CompanyID, ref.ResourceID)]
		return ok && ref.DocumentID == ref.ResourceID
	default:
		return false
	}
}

func memoryEditorJSONSnapshot(ref EditorJSONDocumentRef, document memoryEditorJSONDocument) EditorJSONSnapshot {
	jsonDocument := document.JSONDocument
	if len(jsonDocument) == 0 {
		jsonDocument = append(json.RawMessage(nil), emptyMangoTiptapDocument...)
	}
	collaborationEpoch := document.CollaborationEpoch
	if collaborationEpoch == "" {
		collaborationEpoch = ref.ResourceID
	}
	return EditorJSONSnapshot{
		Document: ref, Revision: document.Revision, SchemaVersion: MangoTiptapSchemaVersion,
		CollaborationEpoch: collaborationEpoch,
		JSONDocument:       append(json.RawMessage(nil), jsonDocument...), Deleted: document.Deleted,
		Annotations:      append([]EditorJSONAnnotation(nil), document.Annotations...),
		UpdatedTimestamp: document.UpdatedTimestamp,
	}
}

func (r *MemoryRepo) GetEditorJSONSnapshot(ref EditorJSONDocumentRef) (EditorJSONSnapshot, error) {
	ref, err := NormalizeEditorJSONDocumentRef(ref)
	if err != nil {
		return EditorJSONSnapshot{}, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if !r.editorJSONFormatReadyLocked(ref.CompanyID) {
		return EditorJSONSnapshot{}, ErrVersionConflict
	}
	if !r.editorJSONResourceExistsLocked(ref) {
		return EditorJSONSnapshot{}, ErrNotFound
	}
	document, exists := r.editorJSONDocuments[editorJSONMemoryKey(ref)]
	if !exists {
		document = memoryEditorJSONDocument{
			Ref: ref, SchemaVersion: MangoTiptapSchemaVersion,
			JSONDocument:     append(json.RawMessage(nil), emptyMangoTiptapDocument...),
			UpdatedTimestamp: time.Now().UTC(),
		}
	}
	return memoryEditorJSONSnapshot(ref, document), nil
}

func (r *MemoryRepo) EnsureEditorJSONCollaborationDocument(ref EditorJSONDocumentRef) (EditorJSONSnapshot, error) {
	ref, err := NormalizeEditorJSONDocumentRef(ref)
	if err != nil {
		return EditorJSONSnapshot{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.editorJSONFormatReadyLocked(ref.CompanyID) {
		return EditorJSONSnapshot{}, ErrVersionConflict
	}
	if !r.editorJSONResourceExistsLocked(ref) {
		return EditorJSONSnapshot{}, ErrNotFound
	}
	key := editorJSONMemoryKey(ref)
	document, exists := r.editorJSONDocuments[key]
	if !exists {
		document = memoryEditorJSONDocument{
			Ref: ref, CollaborationEpoch: newUUIDv7String(), SchemaVersion: MangoTiptapSchemaVersion,
			JSONDocument: append(json.RawMessage(nil), emptyMangoTiptapDocument...), UpdatedTimestamp: time.Now().UTC(),
		}
		r.editorJSONDocuments[key] = document
	}
	return memoryEditorJSONSnapshot(ref, document), nil
}

func (r *MemoryRepo) CommitEditorJSONDocument(input EditorJSONCommitInput) (EditorJSONCommit, error) {
	input, err := NormalizeEditorJSONCommit(input)
	if err != nil {
		return EditorJSONCommit{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.editorJSONFormatReadyLocked(input.Document.CompanyID) {
		return EditorJSONCommit{}, ErrVersionConflict
	}
	if !r.editorJSONResourceExistsLocked(input.Document) {
		return EditorJSONCommit{}, ErrNotFound
	}
	key := editorJSONMemoryKey(input.Document)
	for _, operation := range r.editorJSONOperations[key] {
		if operation.OperationID != input.OperationID {
			continue
		}
		if operation.Deleted || operation.ClientID != input.ClientID || operation.BaseRevision != input.BaseRevision || !bytes.Equal(operation.JSONDocument, input.JSONDocument) || !editorJSONAnnotationsEqual(operation.Annotations, input.Annotations) {
			return EditorJSONCommit{}, ErrInvalid
		}
		return EditorJSONCommit{
			OperationID: operation.OperationID, EventID: operation.EventID,
			Revision: operation.Revision, SchemaVersion: MangoTiptapSchemaVersion,
			JSONDocument: append(json.RawMessage(nil), operation.JSONDocument...),
			Annotations:  append([]EditorJSONAnnotation(nil), operation.Annotations...),
			CommittedAt:  operation.CommittedAt, Deduplicated: true,
		}, nil
	}
	document, exists := r.editorJSONDocuments[key]
	if !exists {
		document = memoryEditorJSONDocument{
			Ref: input.Document, CollaborationEpoch: newUUIDv7String(), SchemaVersion: MangoTiptapSchemaVersion,
			JSONDocument: append(json.RawMessage(nil), emptyMangoTiptapDocument...),
		}
	}
	if document.CollaborationEpoch == "" {
		document.CollaborationEpoch = newUUIDv7String()
	}
	if document.Deleted {
		return EditorJSONCommit{}, ErrNotFound
	}
	if input.BaseRevision != document.Revision {
		return EditorJSONCommit{}, ErrVersionConflict
	}
	if r.editorJSONOwnerTextLimitExceededLocked(input.Document, int64(len(input.JSONDocument))) {
		return EditorJSONCommit{}, ErrEditorOwnerTextLimit
	}
	now := time.Now().UTC()
	revision := document.Revision + 1
	eventID := newUUIDv7String()
	scope := EditorJSONRealtimeScope(input.Document)
	payload, err := json.Marshal(map[string]any{
		"type": EditorJSONSnapshotEventType, "event_id": eventID, "company_id": input.Document.CompanyID,
		"scope": scope, "resource_type": input.Document.ResourceType, "resource_id": input.Document.ResourceID,
		"document_id": input.Document.DocumentID, "resource_revision": revision, "committed_at": now,
		"operation_id": input.OperationID, "client_id": input.ClientID, "reason": "tiptap_json_committed",
	})
	if err != nil {
		return EditorJSONCommit{}, err
	}
	if _, err := r.enqueueRealtimeOutboxLocked(RealtimeOutboxInput{
		EventID: eventID, CompanyID: input.Document.CompanyID, Scope: scope,
		EventType: EditorJSONSnapshotEventType, ResourceType: input.Document.ResourceType,
		ResourceID: input.Document.ResourceID, Permission: EntityPermissionEdit,
		ResourceRevision: revision, Payload: payload,
	}); err != nil {
		return EditorJSONCommit{}, err
	}
	document.Revision = revision
	document.SchemaVersion = MangoTiptapSchemaVersion
	document.JSONDocument = append(json.RawMessage(nil), input.JSONDocument...)
	document.Annotations = append([]EditorJSONAnnotation(nil), input.Annotations...)
	document.UpdatedTimestamp = now
	r.editorJSONDocuments[key] = document
	if input.Document.ResourceType == EntityTypeHuddleNode || input.Document.ResourceType == EntityTypeHuddleLogicGate {
		if r.syncHuddleActionItemRelationshipsLocked(input.Document.CompanyID, input.Document.ResourceType, input.Document.ResourceID) {
			boardIDs := r.memoryHuddleActionItemBoardIDsForResourceLocked(input.Document.CompanyID, input.Document.ResourceType, input.Document.ResourceID)
			nodeIDs := r.memoryHuddleNodeIDsForBoardSetLocked(input.Document.CompanyID, stringSet(boardIDs))
			if err := r.enqueueHuddleActionItemsRealtimeLocked(input.Document.CompanyID, boardIDs, nodeIDs); err != nil {
				return EditorJSONCommit{}, err
			}
		}
	}
	r.editorJSONOperations[key] = append(r.editorJSONOperations[key], memoryEditorJSONOperation{
		OperationID: input.OperationID, ClientID: input.ClientID, BaseRevision: input.BaseRevision,
		JSONDocument: append(json.RawMessage(nil), input.JSONDocument...),
		Annotations:  append([]EditorJSONAnnotation(nil), input.Annotations...),
		EventID:      eventID, Revision: revision, CommittedAt: now,
	})
	r.editorJSONVersions[key] = append(r.editorJSONVersions[key], EditorJSONVersion{
		Revision: revision, SchemaVersion: MangoTiptapSchemaVersion,
		JSONDocument: append(json.RawMessage(nil), input.JSONDocument...),
		Annotations:  append([]EditorJSONAnnotation(nil), input.Annotations...),
		OperationID:  input.OperationID, ActorUserID: input.ActorUserID, CreatedAt: now,
	})
	return EditorJSONCommit{
		OperationID: input.OperationID, EventID: eventID, Revision: revision,
		SchemaVersion: MangoTiptapSchemaVersion,
		JSONDocument:  append(json.RawMessage(nil), input.JSONDocument...),
		Annotations:   append([]EditorJSONAnnotation(nil), input.Annotations...), CommittedAt: now,
	}, nil
}

func editorJSONAnnotationsEqual(left, right []EditorJSONAnnotation) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func (r *MemoryRepo) DeleteEditorJSONDocument(input EditorJSONDeleteInput) (EditorJSONCommit, error) {
	ref, err := NormalizeEditorJSONDocumentRef(input.Document)
	if err != nil {
		return EditorJSONCommit{}, err
	}
	input.OperationID, input.ClientID, input.ActorUserID = strings.TrimSpace(input.OperationID), strings.TrimSpace(input.ClientID), strings.TrimSpace(input.ActorUserID)
	if input.OperationID == "" || input.ClientID == "" || input.BaseRevision < 0 {
		return EditorJSONCommit{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.editorJSONFormatReadyLocked(ref.CompanyID) {
		return EditorJSONCommit{}, ErrVersionConflict
	}
	if !r.editorJSONResourceExistsLocked(ref) {
		return EditorJSONCommit{}, ErrNotFound
	}
	key := editorJSONMemoryKey(ref)
	for _, operation := range r.editorJSONOperations[key] {
		if operation.OperationID != input.OperationID {
			continue
		}
		if !operation.Deleted || operation.ClientID != input.ClientID || operation.BaseRevision != input.BaseRevision {
			return EditorJSONCommit{}, ErrInvalid
		}
		return EditorJSONCommit{
			OperationID: operation.OperationID, EventID: operation.EventID, Revision: operation.Revision,
			SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: append(json.RawMessage(nil), operation.JSONDocument...),
			Annotations: append([]EditorJSONAnnotation(nil), operation.Annotations...),
			CommittedAt: operation.CommittedAt, Deduplicated: true,
		}, nil
	}
	document, exists := r.editorJSONDocuments[key]
	if !exists {
		document = memoryEditorJSONDocument{
			Ref: ref, SchemaVersion: MangoTiptapSchemaVersion,
			JSONDocument: append(json.RawMessage(nil), emptyMangoTiptapDocument...),
		}
	}
	if document.Deleted {
		return EditorJSONCommit{}, ErrNotFound
	}
	if document.Revision != input.BaseRevision {
		return EditorJSONCommit{}, ErrVersionConflict
	}
	now, revision, eventID := time.Now().UTC(), document.Revision+1, newUUIDv7String()
	payload, _ := json.Marshal(map[string]any{
		"type": EditorJSONDeletedEventType, "event_id": eventID, "company_id": ref.CompanyID,
		"scope": EditorJSONRealtimeScope(ref), "resource_type": ref.ResourceType,
		"resource_id": ref.ResourceID, "document_id": ref.DocumentID,
		"resource_revision": revision, "committed_at": now, "operation_id": input.OperationID, "client_id": input.ClientID,
	})
	if _, err := r.enqueueRealtimeOutboxLocked(RealtimeOutboxInput{
		EventID: eventID, CompanyID: ref.CompanyID, Scope: EditorJSONRealtimeScope(ref),
		EventType: EditorJSONDeletedEventType, ResourceType: ref.ResourceType, ResourceID: ref.ResourceID,
		Permission: EntityPermissionEdit, ResourceRevision: revision, Payload: payload,
	}); err != nil {
		return EditorJSONCommit{}, err
	}
	document.Revision, document.Deleted, document.UpdatedTimestamp = revision, true, now
	document.CollaborationEpoch = newUUIDv7String()
	r.editorJSONDocuments[key] = document
	if ref.ResourceType == EntityTypeHuddleNode || ref.ResourceType == EntityTypeHuddleLogicGate {
		if r.syncHuddleActionItemRelationshipsLocked(ref.CompanyID, ref.ResourceType, ref.ResourceID) {
			boardIDs := r.memoryHuddleActionItemBoardIDsForResourceLocked(ref.CompanyID, ref.ResourceType, ref.ResourceID)
			nodeIDs := r.memoryHuddleNodeIDsForBoardSetLocked(ref.CompanyID, stringSet(boardIDs))
			if err := r.enqueueHuddleActionItemsRealtimeLocked(ref.CompanyID, boardIDs, nodeIDs); err != nil {
				return EditorJSONCommit{}, err
			}
		}
	}
	r.editorJSONOperations[key] = append(r.editorJSONOperations[key], memoryEditorJSONOperation{
		OperationID: input.OperationID, ClientID: input.ClientID, BaseRevision: input.BaseRevision,
		JSONDocument: append(json.RawMessage(nil), document.JSONDocument...),
		Annotations:  append([]EditorJSONAnnotation(nil), document.Annotations...), Deleted: true,
		EventID: eventID, Revision: revision, CommittedAt: now,
	})
	r.deleteEditorProjectionLocked(EditorDocumentRef{
		CompanyID: ref.CompanyID, ResourceType: ref.ResourceType,
		ResourceID: ref.ResourceID, DocumentID: ref.DocumentID,
	})
	if ref.ResourceType == EntityTypeNode {
		r.bumpNodeViewVersionLocked(ref.CompanyID, ref.ResourceID)
	}
	r.editorJSONVersions[key] = append(r.editorJSONVersions[key], EditorJSONVersion{
		Revision: revision, SchemaVersion: MangoTiptapSchemaVersion,
		JSONDocument: append(json.RawMessage(nil), document.JSONDocument...),
		Annotations:  append([]EditorJSONAnnotation(nil), document.Annotations...),
		OperationID:  input.OperationID, ActorUserID: input.ActorUserID, CreatedAt: now, Deleted: true,
	})
	return EditorJSONCommit{
		OperationID: input.OperationID, EventID: eventID, Revision: revision,
		SchemaVersion: MangoTiptapSchemaVersion, JSONDocument: append(json.RawMessage(nil), document.JSONDocument...),
		Annotations: append([]EditorJSONAnnotation(nil), document.Annotations...),
		CommittedAt: now,
	}, nil
}

func (r *MemoryRepo) ListEditorJSONVersions(ref EditorJSONDocumentRef, limit int) ([]EditorJSONVersion, error) {
	ref, err := NormalizeEditorJSONDocumentRef(ref)
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if !r.editorJSONFormatReadyLocked(ref.CompanyID) {
		return nil, ErrVersionConflict
	}
	source := append([]EditorJSONVersion(nil), r.editorJSONVersions[editorJSONMemoryKey(ref)]...)
	sort.Slice(source, func(i, j int) bool { return source[i].Revision > source[j].Revision })
	if len(source) > limit {
		source = source[:limit]
	}
	return source, nil
}
