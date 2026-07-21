package store

import (
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

type memoryEditorCollaborationDocument struct {
	Ref              EditorDocumentRef
	Revision         int64
	CanonicalHTML    string
	Deleted          bool
	UpdatedTimestamp time.Time
}

type memoryEditorCollaborationOperation struct {
	Input            EditorCollaborationOperationInput
	PatchBytes       []byte
	EventID          string
	Revision         int64
	CommittedAt      time.Time
	RequiresSnapshot bool
	Tombstone        bool
}

func editorDocumentMemoryKey(ref EditorDocumentRef) string {
	return ref.CompanyID + ":" + ref.ResourceType + ":" + ref.ResourceID + ":" + ref.DocumentID
}

func memoryConcurrentEditorOperations(operations []memoryEditorCollaborationOperation, baseRevision, beforeRevision int64) []EditorCollaborationRevisionOperation {
	result := make([]EditorCollaborationRevisionOperation, 0)
	for _, operation := range operations {
		if operation.Revision <= baseRevision || operation.Revision >= beforeRevision || operation.RequiresSnapshot || operation.Tombstone {
			continue
		}
		result = append(result, EditorCollaborationRevisionOperation{
			Revision: operation.Revision, OperationID: operation.Input.OperationID,
			ClientID: operation.Input.ClientID, Patch: operation.Input.Patch,
		})
	}
	return result
}

func (r *MemoryRepo) GetEditorCollaborationSnapshot(ref EditorDocumentRef) (EditorCollaborationSnapshot, error) {
	ref, err := NormalizeEditorDocumentRef(ref)
	if err != nil {
		return EditorCollaborationSnapshot{}, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.editorJSONFormatReadyLocked(ref.CompanyID) {
		return EditorCollaborationSnapshot{}, ErrVersionConflict
	}
	if !r.editorResourceExistsLocked(ref) {
		return EditorCollaborationSnapshot{}, ErrNotFound
	}
	return r.editorCollaborationSnapshotLocked(ref)
}

func (r *MemoryRepo) editorCollaborationSnapshotLocked(ref EditorDocumentRef) (EditorCollaborationSnapshot, error) {
	document, exists := r.editorCollaborationDocuments[editorDocumentMemoryKey(ref)]
	if !exists {
		now := time.Now().UTC()
		html := r.initialEditorDocumentHTMLLocked(ref)
		return EditorCollaborationSnapshot{
			Document: ref, HTML: html, ETag: EditorCollaborationSnapshotETag(0, html), UpdatedTimestamp: now,
		}, nil
	}
	return EditorCollaborationSnapshot{
		Document: ref, Revision: document.Revision, HTML: document.CanonicalHTML,
		ETag:    EditorCollaborationSnapshotETag(document.Revision, document.CanonicalHTML),
		Deleted: document.Deleted, UpdatedTimestamp: document.UpdatedTimestamp,
	}, nil
}

func (r *MemoryRepo) CommitEditorCollaborationOperation(input EditorCollaborationOperationInput) (EditorCollaborationCommit, error) {
	input, patchBytes, err := NormalizeEditorCollaborationOperation(input)
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.editorJSONFormatReadyLocked(input.Document.CompanyID) {
		return EditorCollaborationCommit{}, ErrVersionConflict
	}
	if !r.editorResourceExistsLocked(input.Document) {
		return EditorCollaborationCommit{}, ErrNotFound
	}
	key := editorDocumentMemoryKey(input.Document)
	for _, operation := range r.editorCollaborationOperations[key] {
		if operation.Input.OperationID != input.OperationID {
			continue
		}
		concurrent := memoryConcurrentEditorOperations(r.editorCollaborationOperations[key], operation.Input.BaseRevision, operation.Revision)
		return EditorCollaborationCommit{
			OperationID: input.OperationID, EventID: operation.EventID, Revision: operation.Revision,
			CommittedAt: operation.CommittedAt, Deduplicated: true, Patch: operation.Input.Patch,
			ConcurrentOperations: concurrent,
		}, nil
	}

	document, exists := r.editorCollaborationDocuments[key]
	if !exists {
		document = memoryEditorCollaborationDocument{
			Ref: input.Document, CanonicalHTML: r.initialEditorDocumentHTMLLocked(input.Document),
			UpdatedTimestamp: time.Now().UTC(),
		}
	}
	if document.Deleted {
		return EditorCollaborationCommit{}, ErrNotFound
	}
	if input.BaseRevision > document.Revision {
		return EditorCollaborationCommit{}, ErrVersionConflict
	}
	transformed := input.Patch
	concurrent := make([]EditorCollaborationRevisionOperation, 0)
	for _, operation := range r.editorCollaborationOperations[key] {
		if operation.Revision > input.BaseRevision {
			if operation.RequiresSnapshot || operation.Tombstone {
				return EditorCollaborationCommit{}, ErrVersionConflict
			}
			concurrent = append(concurrent, EditorCollaborationRevisionOperation{
				Revision: operation.Revision, OperationID: operation.Input.OperationID,
				ClientID: operation.Input.ClientID, Patch: operation.Input.Patch,
			})
			transformed = TransformEditorHTMLPatch(operation.Input.Patch, transformed, true)
		}
	}
	previousHTML := document.CanonicalHTML
	input.Patch = transformed
	patchBytes, err = json.Marshal(input.Patch)
	if err != nil || len(patchBytes) > EditorCollaborationOperationMaxBytes {
		return EditorCollaborationCommit{}, ErrInvalid
	}
	html, err := ApplyEditorHTMLPatch(document.CanonicalHTML, transformed)
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	if len([]byte(html)) > EditorCollaborationDocumentMaxBytes {
		return EditorCollaborationCommit{}, ErrEditorDocumentTooLarge
	}

	now := time.Now().UTC()
	revision := document.Revision + 1
	eventID := newUUIDv7String()
	scope := EditorRealtimeScope(input.Document)
	payload, err := json.Marshal(map[string]any{
		"type": EditorCollaborationEventType, "event_id": eventID, "company_id": input.Document.CompanyID,
		"scope": scope, "resource_type": input.Document.ResourceType, "resource_id": input.Document.ResourceID,
		"document_id": input.Document.DocumentID, "resource_revision": revision, "committed_at": now,
		"operation_id": input.OperationID, "client_id": input.ClientID, "patch": input.Patch,
	})
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	if _, err := r.enqueueRealtimeOutboxLocked(RealtimeOutboxInput{
		EventID: eventID, CompanyID: input.Document.CompanyID, Scope: scope, EventType: EditorCollaborationEventType,
		ResourceType: input.Document.ResourceType, ResourceID: input.Document.ResourceID, Permission: EntityPermissionEdit,
		ResourceRevision: revision, Payload: payload,
	}); err != nil {
		return EditorCollaborationCommit{}, err
	}

	r.editorCollaborationOperations[key] = append(r.editorCollaborationOperations[key], memoryEditorCollaborationOperation{
		Input: input, PatchBytes: append([]byte(nil), patchBytes...), EventID: eventID, Revision: revision, CommittedAt: now,
	})
	document.Revision, document.CanonicalHTML, document.UpdatedTimestamp = revision, html, now
	r.editorCollaborationDocuments[key] = document
	r.materializeEditorProjectionLocked(input.Document, html, revision, now)
	return EditorCollaborationCommit{
		OperationID: input.OperationID, EventID: eventID, Revision: revision, CommittedAt: now, Patch: input.Patch, PreviousHTML: previousHTML, CommittedHTML: html,
		ConcurrentOperations: concurrent,
	}, nil
}

func (r *MemoryRepo) replaceEditorCollaborationSnapshotLocked(ref EditorDocumentRef, html, operationID, clientID, actorUserID string, now time.Time) error {
	ref, err := NormalizeEditorDocumentRef(ref)
	if err != nil {
		return err
	}
	key := editorDocumentMemoryKey(ref)
	document, exists := r.editorCollaborationDocuments[key]
	if !exists {
		document = memoryEditorCollaborationDocument{Ref: ref, CanonicalHTML: r.initialEditorDocumentHTMLLocked(ref)}
	}
	eventID := newUUIDv7String()
	if len([]byte(html)) > EditorCollaborationDocumentMaxBytes {
		return ErrEditorDocumentTooLarge
	}
	if editorBytesContainSensitiveContent([]byte(html)) {
		return ErrInvalid
	}
	revision := document.Revision + 1
	scope := EditorRealtimeScope(ref)
	payload, err := json.Marshal(map[string]any{
		"type": EditorCollaborationSnapshotRequiredEventType, "event_id": eventID, "company_id": ref.CompanyID,
		"scope": scope, "resource_type": ref.ResourceType, "resource_id": ref.ResourceID,
		"document_id": ref.DocumentID, "resource_revision": revision, "committed_at": now,
		"operation_id": operationID, "client_id": clientID, "reason": "canonical_snapshot_replaced",
	})
	if err != nil {
		return err
	}
	if _, err := r.enqueueRealtimeOutboxLocked(RealtimeOutboxInput{
		EventID: eventID, CompanyID: ref.CompanyID, Scope: scope, EventType: EditorCollaborationSnapshotRequiredEventType,
		ResourceType: ref.ResourceType, ResourceID: ref.ResourceID, Permission: EntityPermissionEdit,
		ResourceRevision: revision, Payload: payload,
	}); err != nil {
		return err
	}
	emptyPatch := EditorHTMLPatch{}
	r.editorCollaborationOperations[key] = append(r.editorCollaborationOperations[key], memoryEditorCollaborationOperation{
		Input: EditorCollaborationOperationInput{
			Document: ref, OperationID: operationID, ClientID: clientID, ActorUserID: actorUserID,
			BaseRevision: document.Revision, Patch: emptyPatch,
		},
		PatchBytes: []byte(`{"start_utf8":0,"delete_utf8":0,"insert":""}`), EventID: eventID,
		Revision: revision, CommittedAt: now, RequiresSnapshot: true,
	})
	document.Ref, document.Revision, document.CanonicalHTML = ref, revision, html
	document.Deleted, document.UpdatedTimestamp = false, now
	r.editorCollaborationDocuments[key] = document
	r.materializeEditorProjectionLocked(ref, html, revision, now)
	return nil
}

func (r *MemoryRepo) tombstoneEditorCollaborationDocumentLocked(ref EditorDocumentRef, operationID, clientID, actorUserID string, now time.Time) error {
	key := editorDocumentMemoryKey(ref)
	document, exists := r.editorCollaborationDocuments[key]
	if !exists {
		document = memoryEditorCollaborationDocument{Ref: ref, CanonicalHTML: r.initialEditorDocumentHTMLLocked(ref)}
	}
	if document.Deleted {
		return nil
	}
	document.Revision++
	eventID, scope := newUUIDv7String(), EditorRealtimeScope(ref)
	payload, _ := json.Marshal(map[string]any{
		"type": EditorCollaborationTombstoneEventType, "event_id": eventID, "company_id": ref.CompanyID,
		"scope": scope, "resource_type": ref.ResourceType, "resource_id": ref.ResourceID,
		"document_id": ref.DocumentID, "resource_revision": document.Revision, "committed_at": now,
		"operation_id": operationID, "client_id": clientID,
	})
	if _, err := r.enqueueRealtimeOutboxLocked(RealtimeOutboxInput{
		EventID: eventID, CompanyID: ref.CompanyID, Scope: scope, EventType: EditorCollaborationTombstoneEventType,
		ResourceType: ref.ResourceType, ResourceID: ref.ResourceID, Permission: EntityPermissionEdit,
		ResourceRevision: document.Revision, Payload: payload,
	}); err != nil {
		return err
	}
	r.editorCollaborationOperations[key] = append(r.editorCollaborationOperations[key], memoryEditorCollaborationOperation{
		Input: EditorCollaborationOperationInput{
			Document: ref, OperationID: operationID, ClientID: clientID, ActorUserID: actorUserID,
			BaseRevision: document.Revision - 1, Patch: EditorHTMLPatch{},
		},
		PatchBytes: []byte(`{"start_utf8":0,"delete_utf8":0,"insert":""}`), EventID: eventID,
		Revision: document.Revision, CommittedAt: now, RequiresSnapshot: true, Tombstone: true,
	})
	document.Deleted, document.UpdatedTimestamp = true, now
	r.editorCollaborationDocuments[key] = document
	r.deleteEditorProjectionLocked(ref)
	return nil
}
func (r *MemoryRepo) UpdateEditorCollaborationMetadata(input EditorCollaborationMetadataInput) (EditorCollaborationMetadataCommit, error) {
	input, err := NormalizeEditorCollaborationMetadata(input)
	if err != nil {
		return EditorCollaborationMetadataCommit{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.editorJSONFormatReadyLocked(input.Document.CompanyID) {
		return EditorCollaborationMetadataCommit{}, ErrVersionConflict
	}
	if !r.editorResourceExistsLocked(input.Document) {
		return EditorCollaborationMetadataCommit{}, ErrNotFound
	}
	snapshot, err := r.editorCollaborationSnapshotLocked(input.Document)
	if err != nil || snapshot.Deleted {
		if snapshot.Deleted {
			err = ErrNotFound
		}
		return EditorCollaborationMetadataCommit{}, err
	}
	information, err := editorProjectionInformationWithMetadata(input, snapshot.HTML)
	if err != nil {
		return EditorCollaborationMetadataCommit{}, err
	}
	return r.updateEditorProjectionMetadataLocked(input, information)
}

func (r *MemoryRepo) UpdateEditorJSONMetadata(input EditorCollaborationMetadataInput) (EditorCollaborationMetadataCommit, error) {
	input, err := NormalizeEditorCollaborationMetadata(input)
	if err != nil {
		return EditorCollaborationMetadataCommit{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.editorJSONFormatReadyLocked(input.Document.CompanyID) {
		return EditorCollaborationMetadataCommit{}, ErrVersionConflict
	}
	if !r.editorResourceExistsLocked(input.Document) {
		return EditorCollaborationMetadataCommit{}, ErrNotFound
	}
	information, err := editorProjectionInformationWithMetadata(input, "")
	if err != nil {
		return EditorCollaborationMetadataCommit{}, err
	}
	return r.updateEditorProjectionMetadataLocked(input, information)
}

func (r *MemoryRepo) updateEditorProjectionMetadataLocked(input EditorCollaborationMetadataInput, information string) (EditorCollaborationMetadataCommit, error) {
	now := time.Now().UTC()
	bucketKey := key(input.Document.CompanyID, input.Document.ResourceID)
	var revision int64
	switch input.Document.ResourceType {
	case EntityTypeNode:
		if r.nodeText[bucketKey] == nil {
			r.nodeText[bucketKey] = map[string]domain.NodeProjection{}
		}
		item := r.nodeText[bucketKey][input.Document.DocumentID]
		created := item.CreatedTimestamp
		if created.IsZero() {
			created = now
		}
		revision = item.Revision + 1
		if revision < 1 {
			revision = 1
		}
		item.CompanyID, item.NodeID, item.InformationID = input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID
		item.Type, item.Information, item.IsDeleted, item.Revision = "Text box", information, false, revision
		item.CreatedTimestamp, item.UpdatedTimestamp = created, now
		r.nodeText[bucketKey][input.Document.DocumentID] = item
	case EntityTypeLogicGate:
		if r.logicGateText[bucketKey] == nil {
			r.logicGateText[bucketKey] = map[string]domain.LogicGateProjection{}
		}
		item := r.logicGateText[bucketKey][input.Document.DocumentID]
		created := item.CreatedTimestamp
		if created.IsZero() {
			created = now
		}
		revision = item.Revision + 1
		if revision < 1 {
			revision = 1
		}
		item.CompanyID, item.LogicGateID, item.InformationID = input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID
		item.Type, item.Information, item.IsDeleted, item.Revision = "Text box", information, false, revision
		item.CreatedTimestamp, item.UpdatedTimestamp = created, now
		r.logicGateText[bucketKey][input.Document.DocumentID] = item
	case EntityTypeProject:
		if r.projectText[bucketKey] == nil {
			r.projectText[bucketKey] = map[string]domain.ProjectProjection{}
		}
		item := r.projectText[bucketKey][input.Document.DocumentID]
		created := item.CreatedTimestamp
		if created.IsZero() {
			created = now
		}
		item.CompanyID, item.ProjectID, item.InformationID, item.Type = input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID, "Text box"
		item.Information, item.CreatedTimestamp, item.UpdatedTimestamp = information, created, now
		r.projectText[bucketKey][input.Document.DocumentID] = item
		revision = 1
	default:
		return EditorCollaborationMetadataCommit{}, ErrInvalid
	}
	return EditorCollaborationMetadataCommit{ProjectionRevision: revision, UpdatedTimestamp: now}, nil
}
func (r *MemoryRepo) DeleteEditorCollaborationDocument(input EditorCollaborationDeleteInput) (EditorCollaborationCommit, error) {
	ref, err := NormalizeEditorDocumentRef(input.Document)
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	input.OperationID, input.ClientID, input.ActorUserID = strings.TrimSpace(input.OperationID), strings.TrimSpace(input.ClientID), strings.TrimSpace(input.ActorUserID)
	if input.OperationID == "" || input.ClientID == "" || len(input.OperationID) > 160 || len(input.ClientID) > 160 {
		return EditorCollaborationCommit{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.editorJSONFormatReadyLocked(ref.CompanyID) {
		return EditorCollaborationCommit{}, ErrVersionConflict
	}
	if !r.editorResourceExistsLocked(ref) {
		return EditorCollaborationCommit{}, ErrNotFound
	}
	key := editorDocumentMemoryKey(ref)
	for _, operation := range r.editorCollaborationOperations[key] {
		if operation.Input.OperationID == input.OperationID {
			return EditorCollaborationCommit{
				OperationID: input.OperationID, EventID: operation.EventID, Revision: operation.Revision,
				CommittedAt: operation.CommittedAt, Deduplicated: true,
			}, nil
		}
	}
	if document, exists := r.editorCollaborationDocuments[key]; exists && document.Deleted {
		return EditorCollaborationCommit{}, ErrNotFound
	}
	now := time.Now().UTC()
	if err := r.tombstoneEditorCollaborationDocumentLocked(ref, input.OperationID, input.ClientID, input.ActorUserID, now); err != nil {
		return EditorCollaborationCommit{}, err
	}
	operation := r.editorCollaborationOperations[key][len(r.editorCollaborationOperations[key])-1]
	return EditorCollaborationCommit{
		OperationID: input.OperationID, EventID: operation.EventID, Revision: operation.Revision, CommittedAt: now,
	}, nil
}

func (r *MemoryRepo) editorResourceExistsLocked(ref EditorDocumentRef) bool {
	switch ref.ResourceType {
	case EntityTypeNode:
		_, ok := r.nodes[key(ref.CompanyID, ref.ResourceID)]
		return ok
	case EntityTypeLogicGate:
		_, ok := r.logicGates[key(ref.CompanyID, ref.ResourceID)]
		return ok
	case EntityTypeProject:
		_, ok := r.projects[key(ref.CompanyID, ref.ResourceID)]
		return ok
	}
	return false
}

func (r *MemoryRepo) initialEditorDocumentHTMLLocked(ref EditorDocumentRef) string {
	bucketKey := key(ref.CompanyID, ref.ResourceID)
	switch ref.ResourceType {
	case EntityTypeNode:
		if projection, ok := r.nodeText[bucketKey][ref.DocumentID]; ok && !projection.IsDeleted {
			return editorDocumentHTMLFromProjectionInformation(projection.Information)
		}
	case EntityTypeLogicGate:
		if projection, ok := r.logicGateText[bucketKey][ref.DocumentID]; ok && !projection.IsDeleted {
			return editorDocumentHTMLFromProjectionInformation(projection.Information)
		}
	case EntityTypeProject:
		if projection, ok := r.projectText[bucketKey][ref.DocumentID]; ok {
			return editorDocumentHTMLFromProjectionInformation(projection.Information)
		}
	}
	return ""
}

func (r *MemoryRepo) materializeEditorProjectionLocked(ref EditorDocumentRef, html string, revision int64, now time.Time) {
	bucketKey := key(ref.CompanyID, ref.ResourceID)
	switch ref.ResourceType {
	case EntityTypeNode:
		if r.nodeText[bucketKey] == nil {
			r.nodeText[bucketKey] = map[string]domain.NodeProjection{}
		}
		item := r.nodeText[bucketKey][ref.DocumentID]
		created := item.CreatedTimestamp
		if created.IsZero() {
			created = now
		}
		item.CompanyID, item.NodeID, item.InformationID = ref.CompanyID, ref.ResourceID, ref.DocumentID
		item.Type, item.IsDeleted, item.Revision = "Text box", false, revision
		item.Information = editorProjectionInformationWithDocument(item.Information, html)
		item.CreatedTimestamp, item.UpdatedTimestamp = created, now
		r.nodeText[bucketKey][ref.DocumentID] = item
	case EntityTypeLogicGate:
		if r.logicGateText[bucketKey] == nil {
			r.logicGateText[bucketKey] = map[string]domain.LogicGateProjection{}
		}
		item := r.logicGateText[bucketKey][ref.DocumentID]
		created := item.CreatedTimestamp
		if created.IsZero() {
			created = now
		}
		item.CompanyID, item.LogicGateID, item.InformationID = ref.CompanyID, ref.ResourceID, ref.DocumentID
		item.Type, item.IsDeleted, item.Revision = "Text box", false, revision
		item.Information = editorProjectionInformationWithDocument(item.Information, html)
		item.CreatedTimestamp, item.UpdatedTimestamp = created, now
		r.logicGateText[bucketKey][ref.DocumentID] = item
	case EntityTypeProject:
		if r.projectText[bucketKey] == nil {
			r.projectText[bucketKey] = map[string]domain.ProjectProjection{}
		}
		item := r.projectText[bucketKey][ref.DocumentID]
		created := item.CreatedTimestamp
		if created.IsZero() {
			created = now
		}
		item.CompanyID, item.ProjectID, item.InformationID, item.Type = ref.CompanyID, ref.ResourceID, ref.DocumentID, "Text box"
		item.Information = editorProjectionInformationWithDocument(item.Information, html)
		item.CreatedTimestamp, item.UpdatedTimestamp = created, now
		r.projectText[bucketKey][ref.DocumentID] = item
	}
}

func (r *MemoryRepo) deleteEditorProjectionLocked(ref EditorDocumentRef) {
	bucketKey := key(ref.CompanyID, ref.ResourceID)
	switch ref.ResourceType {
	case EntityTypeNode:
		if item, ok := r.nodeText[bucketKey][ref.DocumentID]; ok {
			item.IsDeleted, item.Revision, item.UpdatedTimestamp = true, item.Revision+1, time.Now().UTC()
			r.nodeText[bucketKey][ref.DocumentID] = item
		}
	case EntityTypeLogicGate:
		if item, ok := r.logicGateText[bucketKey][ref.DocumentID]; ok {
			item.IsDeleted, item.Revision, item.UpdatedTimestamp = true, item.Revision+1, time.Now().UTC()
			r.logicGateText[bucketKey][ref.DocumentID] = item
		}
	case EntityTypeProject:
		delete(r.projectText[bucketKey], ref.DocumentID)
	}
}
