package store

import (
	"miraeopus/backend/internal/domain"
	"time"
)

func (r *MemoryRepo) UpdateEditorJSONMetadata(input EditorJSONMetadataInput) (EditorJSONMetadataCommit, error) {
	input, err := NormalizeEditorJSONMetadata(input)
	if err != nil {
		return EditorJSONMetadataCommit{}, err
	}
	if input.Document.ResourceType == EntityTypeNode {
		return EditorJSONMetadataCommit{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.editorJSONFormatReadyLocked(input.Document.CompanyID) {
		return EditorJSONMetadataCommit{}, ErrVersionConflict
	}
	if !r.editorResourceExistsLocked(input.Document) {
		return EditorJSONMetadataCommit{}, ErrNotFound
	}
	information, err := editorProjectionInformationWithJSONMetadata(input, "")
	if err != nil {
		return EditorJSONMetadataCommit{}, err
	}
	return r.updateEditorProjectionMetadataLocked(input, information)
}

func (r *MemoryRepo) updateEditorProjectionMetadataLocked(input EditorJSONMetadataInput, information string) (EditorJSONMetadataCommit, error) {
	now := time.Now().UTC()
	bucketKey := key(input.Document.CompanyID, input.Document.ResourceID)
	var revision int64
	switch input.Document.ResourceType {
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
		return EditorJSONMetadataCommit{}, ErrInvalid
	}
	return EditorJSONMetadataCommit{ProjectionRevision: revision, UpdatedTimestamp: now}, nil
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
