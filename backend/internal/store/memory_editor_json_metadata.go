package store

import (
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"strings"
	"time"
)

func (r *MemoryRepo) UpdateEditorJSONMetadata(input EditorJSONMetadataInput) (EditorJSONMetadataCommit, error) {
	input, err := NormalizeEditorJSONMetadata(input)
	if err != nil {
		return EditorJSONMetadataCommit{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.editorJSONFormatReadyLocked(input.Document.CompanyID) {
		return EditorJSONMetadataCommit{}, ErrVersionConflict
	}
	if !r.editorResourceExistsLocked(input.Document) {
		return EditorJSONMetadataCommit{}, ErrNotFound
	}
	if input.Document.ResourceType == EntityTypeNode {
		projections := r.nodeText[key(input.Document.CompanyID, input.Document.ResourceID)]
		linked := false
		for _, projection := range projections {
			if projection.IsDeleted || !strings.EqualFold(strings.TrimSpace(projection.Type), "Attached email") {
				continue
			}
			var relationship emailTextboxRelationshipPayload
			if json.Unmarshal([]byte(projection.Information), &relationship) == nil &&
				cleanUUIDText(relationship.BlockID) == input.Document.DocumentID {
				linked = true
				break
			}
		}
		if linked {
			textboxInformation := strings.TrimSpace(projections[input.Document.DocumentID].Information)
			textboxInformation = strings.TrimSpace(strings.TrimPrefix(textboxInformation, editorTextBlockProjectionPrefix))
			var metadata struct {
				Color string `json:"color"`
			}
			if json.Unmarshal([]byte(textboxInformation), &metadata) != nil {
				return EditorJSONMetadataCommit{}, ErrInvalid
			}
			metadata.Color = strings.ToUpper(strings.TrimSpace(metadata.Color))
			if !validEmailTextboxColor(metadata.Color) {
				return EditorJSONMetadataCommit{}, ErrInvalid
			}
			input.Color = metadata.Color
		} else {
			input.Color = ""
		}
	} else if input.Document.ResourceType == EntityTypeProject {
		input.Color = ""
		for _, relationship := range r.projectEmailRelationships {
			if relationship.CompanyID == input.Document.CompanyID && relationship.ProjectID == input.Document.ResourceID &&
				relationship.ResourceTextboxID == input.Document.DocumentID {
				color, colorErr := r.memoryProjectTextboxColorLocked(input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID)
				if colorErr != nil {
					return EditorJSONMetadataCommit{}, colorErr
				}
				if !validEmailTextboxColor(color) {
					return EditorJSONMetadataCommit{}, ErrInvalid
				}
				input.Color = color
				break
			}
		}
	}
	information, err := editorProjectionInformationWithJSONMetadata(input, "")
	if err != nil {
		return EditorJSONMetadataCommit{}, err
	}
	if input.Document.ResourceType == EntityTypeProject {
		prefix, payload, parseErr := parseMemoryProjectTextboxInformation(information)
		if parseErr != nil {
			return EditorJSONMetadataCommit{}, parseErr
		}
		payload["color"] = input.Color
		encoded, marshalErr := json.Marshal(payload)
		if marshalErr != nil {
			return EditorJSONMetadataCommit{}, marshalErr
		}
		information = prefix + string(encoded)
	}
	return r.updateEditorProjectionMetadataLocked(input, information)
}

func (r *MemoryRepo) updateEditorProjectionMetadataLocked(input EditorJSONMetadataInput, information string) (EditorJSONMetadataCommit, error) {
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
	case EntityTypeHuddleNode:
		if r.huddleNodeTextboxes[bucketKey] == nil {
			r.huddleNodeTextboxes[bucketKey] = map[string]HuddleNodeTextbox{}
		}
		item := r.huddleNodeTextboxes[bucketKey][input.Document.DocumentID]
		created := item.CreatedTimestamp
		if created.IsZero() {
			created = now
		}
		revision = item.Revision + 1
		item.CompanyID, item.HuddleNodeID, item.TextboxID = input.Document.CompanyID, input.Document.ResourceID, input.Document.DocumentID
		item.Title, item.Revision = input.Title, revision
		item.CreatedTimestamp, item.UpdatedTimestamp = created, now
		r.huddleNodeTextboxes[bucketKey][input.Document.DocumentID] = item
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
	case EntityTypeHuddleNode:
		_, ok := r.huddleNodes[key(ref.CompanyID, ref.ResourceID)]
		return ok
	}
	return false
}

func (r *MemoryRepo) deleteEditorProjectionLocked(ref EditorDocumentRef) {
	bucketKey := key(ref.CompanyID, ref.ResourceID)
	switch ref.ResourceType {
	case EntityTypeNode:
		textboxID := cleanUUIDText(ref.DocumentID)
		removedProjectionIDs := map[string]bool{}
		for projectionID, projection := range r.nodeText[bucketKey] {
			if projection.IsDeleted {
				continue
			}
			remove := false
			switch {
			case isTextboxChatType(projection.Type):
				var chat textboxChatPayload
				if textboxID != "" && json.Unmarshal([]byte(projection.Information), &chat) == nil && cleanUUIDText(chat.BlockID) == textboxID {
					remove = true
				}
			case strings.EqualFold(strings.TrimSpace(projection.Type), "Attached email"):
				var relationship emailTextboxRelationshipPayload
				if textboxID != "" && json.Unmarshal([]byte(projection.Information), &relationship) == nil && cleanUUIDText(relationship.BlockID) == textboxID {
					remove = true
				}
			}
			if remove {
				delete(r.nodeText[bucketKey], projectionID)
				removedProjectionIDs[projectionID] = true
			}
		}
		if len(removedProjectionIDs) > 0 {
			information := r.nodeInfo[bucketKey]
			kept := information[:0]
			for _, item := range information {
				if !removedProjectionIDs[item.InformationID] {
					kept = append(kept, item)
				}
			}
			r.nodeInfo[bucketKey] = kept
		}
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
		textboxID := cleanUUIDText(ref.DocumentID)
		for projectionID, projection := range r.projectText[bucketKey] {
			if !isTextboxChatType(projection.Type) {
				continue
			}
			var chat textboxChatPayload
			if json.Unmarshal([]byte(projection.Information), &chat) == nil && cleanUUIDText(chat.BlockID) == textboxID {
				delete(r.projectText[bucketKey], projectionID)
			}
		}
		for relationshipKey, relationship := range r.projectEmailRelationships {
			if relationship.CompanyID == ref.CompanyID && relationship.ProjectID == ref.ResourceID &&
				relationship.ResourceTextboxID == textboxID {
				delete(r.projectEmailRelationships, relationshipKey)
			}
		}
		delete(r.projectText[bucketKey], ref.DocumentID)
	case EntityTypeHuddleNode:
		delete(r.huddleNodeTextboxes[bucketKey], ref.DocumentID)
		for chatID, chat := range r.huddleNodeTextboxChats[bucketKey] {
			if chat.TextboxID == ref.DocumentID {
				delete(r.huddleNodeTextboxChats[bucketKey], chatID)
			}
		}
	}
}
