package store

import (
	"encoding/json"
	"fmt"
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

type memoryEditorCollaborationDocument struct {
	Ref                   EditorDocumentRef
	Revision              int64
	SnapshotRevision      int64
	SnapshotState         EditorCollaborationState
	AccumulatedDeltaBytes int
	Deleted               bool
	UpdatedTimestamp      time.Time
}

type memoryEditorCollaborationOperation struct {
	Input       EditorCollaborationOperationInput
	DeltaBytes  []byte
	EventID     string
	Revision    int64
	CommittedAt time.Time
}

func editorDocumentMemoryKey(ref EditorDocumentRef) string {
	return ref.CompanyID + ":" + ref.ResourceType + ":" + ref.ResourceID + ":" + ref.DocumentID
}

func (r *MemoryRepo) GetEditorCollaborationSnapshot(ref EditorDocumentRef) (EditorCollaborationSnapshot, error) {
	ref, err := NormalizeEditorDocumentRef(ref)
	if err != nil {
		return EditorCollaborationSnapshot{}, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if !r.editorResourceExistsLocked(ref) {
		return EditorCollaborationSnapshot{}, ErrNotFound
	}
	return r.editorCollaborationSnapshotLocked(ref)
}

func (r *MemoryRepo) editorCollaborationSnapshotLocked(ref EditorDocumentRef) (EditorCollaborationSnapshot, error) {
	document, exists := r.editorCollaborationDocuments[editorDocumentMemoryKey(ref)]
	if !exists {
		now := time.Now().UTC()
		state := NewEditorCollaborationState(r.initialEditorDocumentHTMLLocked(ref))
		html, err := MaterializeEditorCollaborationState(state)
		if err != nil {
			return EditorCollaborationSnapshot{}, err
		}
		return EditorCollaborationSnapshot{
			Document: ref, State: state, HTML: html, ETag: EditorCollaborationSnapshotETag(0, state), UpdatedTimestamp: now,
		}, nil
	}
	state := CloneEditorCollaborationState(document.SnapshotState)
	replayCount := 0
	for _, operation := range r.editorCollaborationOperations[editorDocumentMemoryKey(ref)] {
		if operation.Revision <= document.SnapshotRevision {
			continue
		}
		var err error
		state, err = ApplyEditorCollaborationDelta(state, operation.Input.Delta)
		if err != nil {
			return EditorCollaborationSnapshot{}, err
		}
		replayCount++
	}
	html, err := MaterializeEditorCollaborationState(state)
	if err != nil {
		return EditorCollaborationSnapshot{}, err
	}
	return EditorCollaborationSnapshot{
		Document: ref, Revision: document.Revision, SnapshotRevision: document.SnapshotRevision,
		State: state, HTML: html, ETag: EditorCollaborationSnapshotETag(document.Revision, state),
		Deleted: document.Deleted, ReplayCount: replayCount, UpdatedTimestamp: document.UpdatedTimestamp,
	}, nil
}

func (r *MemoryRepo) CommitEditorCollaborationOperation(input EditorCollaborationOperationInput) (EditorCollaborationCommit, error) {
	input, deltaBytes, err := NormalizeEditorCollaborationOperation(input)
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.editorResourceExistsLocked(input.Document) {
		return EditorCollaborationCommit{}, ErrNotFound
	}
	key := editorDocumentMemoryKey(input.Document)
	for _, operation := range r.editorCollaborationOperations[key] {
		if operation.Input.OperationID != input.OperationID {
			continue
		}
		snapshot, snapshotErr := r.editorCollaborationSnapshotLocked(input.Document)
		return EditorCollaborationCommit{
			OperationID: input.OperationID, EventID: operation.EventID, Revision: operation.Revision,
			CommittedAt: operation.CommittedAt, Deduplicated: true, Snapshot: snapshot,
		}, snapshotErr
	}

	document, exists := r.editorCollaborationDocuments[key]
	if !exists {
		document = memoryEditorCollaborationDocument{
			Ref: input.Document, SnapshotState: NewEditorCollaborationState(r.initialEditorDocumentHTMLLocked(input.Document)),
			UpdatedTimestamp: time.Now().UTC(),
		}
	}
	if document.Deleted {
		return EditorCollaborationCommit{}, ErrNotFound
	}
	state := CloneEditorCollaborationState(document.SnapshotState)
	for _, operation := range r.editorCollaborationOperations[key] {
		if operation.Revision <= document.SnapshotRevision {
			continue
		}
		state, err = ApplyEditorCollaborationDelta(state, operation.Input.Delta)
		if err != nil {
			return EditorCollaborationCommit{}, err
		}
	}
	state, err = ApplyEditorCollaborationDelta(state, input.Delta)
	if err != nil {
		return EditorCollaborationCommit{}, err
	}
	html, err := MaterializeEditorCollaborationState(state)
	if err != nil {
		return EditorCollaborationCommit{}, err
	}

	now := time.Now().UTC()
	revision := document.Revision + 1
	eventID := newUUIDv7String()
	scope := EditorRealtimeScope(input.Document)
	payload, err := json.Marshal(map[string]any{
		"type": EditorCollaborationEventType, "event_id": eventID, "company_id": input.Document.CompanyID,
		"scope": scope, "resource_type": input.Document.ResourceType, "resource_id": input.Document.ResourceID,
		"document_id": input.Document.DocumentID, "resource_revision": revision, "committed_at": now,
		"operation_id": input.OperationID, "client_id": input.ClientID, "delta": input.Delta,
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
		Input: input, DeltaBytes: append([]byte(nil), deltaBytes...), EventID: eventID, Revision: revision, CommittedAt: now,
	})
	document.Revision = revision
	document.UpdatedTimestamp = now
	document.AccumulatedDeltaBytes += len(deltaBytes)
	shouldCompact := revision-document.SnapshotRevision >= EditorCollaborationCompactOperationCount ||
		document.AccumulatedDeltaBytes >= EditorCollaborationCompactDeltaBytes
	if shouldCompact {
		document.SnapshotState = CloneEditorCollaborationState(state)
		document.SnapshotRevision = revision
		document.AccumulatedDeltaBytes = 0
	}
	r.editorCollaborationDocuments[key] = document
	if !exists || shouldCompact {
		r.materializeEditorProjectionLocked(input.Document, html, revision, now)
	}
	snapshot, err := r.editorCollaborationSnapshotLocked(input.Document)
	return EditorCollaborationCommit{
		OperationID: input.OperationID, EventID: eventID, Revision: revision, CommittedAt: now, Snapshot: snapshot,
	}, err
}

func (r *MemoryRepo) replaceEditorCollaborationSnapshotLocked(ref EditorDocumentRef, html, operationID, clientID, actorUserID string, now time.Time) error {
	ref, err := NormalizeEditorDocumentRef(ref)
	if err != nil {
		return err
	}
	key := editorDocumentMemoryKey(ref)
	document, exists := r.editorCollaborationDocuments[key]
	current := NewEditorCollaborationState(r.initialEditorDocumentHTMLLocked(ref))
	if exists {
		snapshot, err := r.editorCollaborationSnapshotLocked(ref)
		if err != nil {
			return err
		}
		current = snapshot.State
	} else {
		document = memoryEditorCollaborationDocument{Ref: ref, SnapshotState: CloneEditorCollaborationState(current)}
	}
	eventID := newUUIDv7String()
	replacementState := EditorCollaborationState{}
	for _, atom := range current.Atoms {
		if !atom.Deleted {
			atom.Deleted = true
			replacementState.Atoms = append(replacementState.Atoms, atom)
		}
	}
	afterID := ""
	for index, value := range []rune(html) {
		id := fmt.Sprintf("restore:%s:%08x", eventID, index)
		replacementState.Atoms = append(replacementState.Atoms, EditorCollaborationAtom{ID: id, AfterID: afterID, Value: string(value)})
		afterID = id
	}
	if materialized, err := MaterializeEditorCollaborationState(replacementState); err != nil || materialized != html {
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
	emptyDelta := EditorCollaborationDelta{}
	r.editorCollaborationOperations[key] = append(r.editorCollaborationOperations[key], memoryEditorCollaborationOperation{
		Input: EditorCollaborationOperationInput{
			Document: ref, OperationID: operationID, ClientID: clientID, ActorUserID: actorUserID,
			BaseRevision: document.Revision, Delta: emptyDelta,
		},
		DeltaBytes: []byte(`{}`), EventID: eventID, Revision: revision, CommittedAt: now,
	})
	document.Ref, document.Revision, document.SnapshotRevision = ref, revision, revision
	document.SnapshotState, document.AccumulatedDeltaBytes = CloneEditorCollaborationState(replacementState), 0
	document.Deleted, document.UpdatedTimestamp = false, now
	r.editorCollaborationDocuments[key] = document
	r.materializeEditorProjectionLocked(ref, html, revision, now)
	return nil
}

func (r *MemoryRepo) tombstoneEditorCollaborationDocumentLocked(ref EditorDocumentRef, operationID, clientID, actorUserID string, now time.Time) error {
	key := editorDocumentMemoryKey(ref)
	document, exists := r.editorCollaborationDocuments[key]
	if !exists {
		document = memoryEditorCollaborationDocument{Ref: ref, SnapshotState: NewEditorCollaborationState(r.initialEditorDocumentHTMLLocked(ref))}
	}
	if document.Deleted {
		return nil
	}
	document.Revision++
	document.Deleted, document.UpdatedTimestamp = true, now
	r.editorCollaborationDocuments[key] = document
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
	input.OperationID, input.ClientID = strings.TrimSpace(input.OperationID), strings.TrimSpace(input.ClientID)
	if input.OperationID == "" || input.ClientID == "" {
		return EditorCollaborationCommit{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.editorResourceExistsLocked(ref) {
		return EditorCollaborationCommit{}, ErrNotFound
	}
	key := editorDocumentMemoryKey(ref)
	document, exists := r.editorCollaborationDocuments[key]
	if !exists {
		document = memoryEditorCollaborationDocument{Ref: ref, SnapshotState: NewEditorCollaborationState(r.initialEditorDocumentHTMLLocked(ref))}
	}
	now := time.Now().UTC()
	document.Revision++
	document.Deleted = true
	document.UpdatedTimestamp = now
	r.editorCollaborationDocuments[key] = document
	eventID, scope := newUUIDv7String(), EditorRealtimeScope(ref)
	payload, _ := json.Marshal(map[string]any{
		"type": EditorCollaborationTombstoneEventType, "event_id": eventID, "company_id": ref.CompanyID,
		"scope": scope, "resource_type": ref.ResourceType, "resource_id": ref.ResourceID,
		"document_id": ref.DocumentID, "resource_revision": document.Revision, "committed_at": now,
		"operation_id": input.OperationID, "client_id": input.ClientID,
	})
	if _, err := r.enqueueRealtimeOutboxLocked(RealtimeOutboxInput{
		EventID: eventID, CompanyID: ref.CompanyID, Scope: scope, EventType: EditorCollaborationTombstoneEventType,
		ResourceType: ref.ResourceType, ResourceID: ref.ResourceID, Permission: EntityPermissionEdit,
		ResourceRevision: document.Revision, Payload: payload,
	}); err != nil {
		return EditorCollaborationCommit{}, err
	}
	r.deleteEditorProjectionLocked(ref)
	snapshot, err := r.editorCollaborationSnapshotLocked(ref)
	return EditorCollaborationCommit{
		OperationID: input.OperationID, EventID: eventID, Revision: document.Revision, CommittedAt: now, Snapshot: snapshot,
	}, err
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
