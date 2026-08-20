package store

import (
	"encoding/json"
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

// memoryProjectEmailRelationship is the fixed-Project in-memory equivalent of one
// email_relationships row. Project projection JSON is never relationship storage.
type memoryProjectEmailRelationship struct {
	CompanyID         string
	ProjectID         string
	RelationshipID    string
	EmailThreadID     string
	EmailMessageID    string
	ResourceTextboxID string
	CreatedTimestamp  time.Time
}

func memoryProjectProjectionAsInformation(item domain.ProjectProjection) domain.ProjectInformation {
	return domain.ProjectInformation{
		CompanyID: item.CompanyID, ProjectID: item.ProjectID, InformationID: item.InformationID,
		Type: item.Type, Information: item.Information,
		CreatedTimestamp: item.CreatedTimestamp, UpdatedTimestamp: item.UpdatedTimestamp,
	}
}

func memoryProjectEmailRelationshipKey(companyID, relationshipID string) string {
	return key(strings.TrimSpace(companyID), strings.TrimSpace(relationshipID))
}

func cloneMemoryProjectEmailRelationships(source map[string]memoryProjectEmailRelationship) map[string]memoryProjectEmailRelationship {
	out := make(map[string]memoryProjectEmailRelationship, len(source))
	for relationshipKey, relationship := range source {
		out[relationshipKey] = relationship
	}
	return out
}

func cloneMemoryProjectProjections(source map[string]domain.ProjectProjection) map[string]domain.ProjectProjection {
	out := make(map[string]domain.ProjectProjection, len(source))
	for projectionID, projection := range source {
		out[projectionID] = projection
	}
	return out
}

func (r *MemoryRepo) memoryEmailMessageLocked(companyID, emailMessageID string) (domain.CommunicationsEmailThread, domain.CommunicationsEmailMessage, bool) {
	for _, thread := range r.emailThreads {
		if thread.CompanyID != companyID {
			continue
		}
		for _, message := range thread.Messages {
			if message.EmailMessageID == emailMessageID {
				return thread, message, true
			}
		}
	}
	return domain.CommunicationsEmailThread{}, domain.CommunicationsEmailMessage{}, false
}

func (r *MemoryRepo) memoryProjectEmailRelationshipLocked(companyID, projectID, emailMessageID, textboxID string) (memoryProjectEmailRelationship, bool) {
	for _, relationship := range r.projectEmailRelationships {
		if relationship.CompanyID == companyID && relationship.ProjectID == projectID && relationship.EmailMessageID == emailMessageID &&
			relationship.ResourceTextboxID == textboxID {
			return relationship, true
		}
	}
	return memoryProjectEmailRelationship{}, false
}

func (r *MemoryRepo) memoryProjectEmailRelationshipProjectionLocked(relationship memoryProjectEmailRelationship) (domain.ProjectProjection, bool) {
	thread, message, found := r.memoryEmailMessageLocked(relationship.CompanyID, relationship.EmailMessageID)
	if !found || thread.EmailThreadID != relationship.EmailThreadID {
		return domain.ProjectProjection{}, false
	}
	from := ""
	if len(message.Message.From) > 0 {
		from = strings.TrimSpace(message.Message.From[0].Name)
		if from == "" {
			from = strings.TrimSpace(message.Message.From[0].Email)
		}
	}
	accountEmail := thread.AccountEmail
	if accountEmail == "" {
		accountEmail = thread.PersonalAccountEmail
	}
	payload := map[string]any{
		"block_id": relationship.ResourceTextboxID, "collaboration_id": relationship.RelationshipID,
		"message_id": message.ProviderMessageID, "email_message_id": message.EmailMessageID,
		"thread_id": thread.ProviderThreadID, "email_thread_id": thread.EmailThreadID,
		"shared_inbox_id": thread.SharedInboxID, "account_email": accountEmail,
		"created_from_email": true, "subject": message.Message.Subject,
		"snippet": message.Message.Snippet, "from": from, "date": message.Message.Date,
		"attached_timestamp": relationship.CreatedTimestamp.Format(time.RFC3339Nano),
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return domain.ProjectProjection{}, false
	}
	return domain.ProjectProjection{
		CompanyID: relationship.CompanyID, ProjectID: relationship.ProjectID,
		InformationID: relationship.RelationshipID, Type: "Attached email", Information: string(encoded),
		CreatedTimestamp: relationship.CreatedTimestamp, UpdatedTimestamp: relationship.CreatedTimestamp,
	}, true
}

func parseMemoryProjectTextboxInformation(information string) (string, map[string]any, error) {
	prefix := ""
	information = strings.TrimSpace(information)
	if strings.HasPrefix(information, editorTextBlockProjectionPrefix) {
		prefix = editorTextBlockProjectionPrefix
		information = strings.TrimSpace(strings.TrimPrefix(information, prefix))
	}
	payload := map[string]any{}
	if json.Unmarshal([]byte(information), &payload) != nil {
		return "", nil, ErrInvalid
	}
	return prefix, payload, nil
}

func (r *MemoryRepo) setMemoryProjectTextboxColorLocked(companyID, projectID, textboxID, color string) error {
	projectionKey := key(companyID, projectID)
	textbox, found := r.projectText[projectionKey][textboxID]
	if !found || !isEditorTextBoxType(textbox.Type) {
		return ErrNotFound
	}
	color = strings.ToUpper(strings.TrimSpace(color))
	if color != "" && !validEmailTextboxColor(color) {
		return ErrInvalid
	}
	prefix, payload, err := parseMemoryProjectTextboxInformation(textbox.Information)
	if err != nil {
		return err
	}
	payload["color"] = color
	delete(payload, "email_accent")
	delete(payload, "email_message_id")
	delete(payload, "email_message_ids")
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	textbox.Information = prefix + string(encoded)
	textbox.UpdatedTimestamp = time.Now().UTC()
	r.projectText[projectionKey][textboxID] = textbox
	return nil
}

func (r *MemoryRepo) memoryProjectTextboxColorLocked(companyID, projectID, textboxID string) (string, error) {
	textbox, found := r.projectText[key(companyID, projectID)][textboxID]
	if !found || !isEditorTextBoxType(textbox.Type) {
		return "", ErrNotFound
	}
	_, payload, err := parseMemoryProjectTextboxInformation(textbox.Information)
	if err != nil {
		return "", err
	}
	color, _ := payload["color"].(string)
	color = strings.ToUpper(strings.TrimSpace(color))
	if color != "" && !validEmailTextboxColor(color) {
		return "", ErrInvalid
	}
	return color, nil
}

func (r *MemoryRepo) addMemoryProjectEmailRelationshipLocked(input ProjectInformationInput) (domain.ProjectProjection, error) {
	var payload emailTextboxRelationshipPayload
	if json.Unmarshal([]byte(input.Information), &payload) != nil {
		return domain.ProjectProjection{}, ErrInvalid
	}
	rawBlockID := strings.TrimSpace(payload.BlockID)
	rawMessageID := strings.TrimSpace(payload.EmailMessageID)
	payload.BlockID = cleanUUIDText(payload.BlockID)
	payload.EmailMessageID = cleanUUIDText(payload.EmailMessageID)
	payload.TextboxColor = strings.ToUpper(strings.TrimSpace(payload.TextboxColor))
	payload.LinkScope = strings.ToLower(strings.TrimSpace(payload.LinkScope))
	if payload.LinkScope == "" {
		payload.LinkScope = "message"
	}
	actorUserID := cleanUUIDText(input.ActorUserID)
	if rawMessageID == "" || payload.EmailMessageID == "" {
		return domain.ProjectProjection{}, ErrEmailMessageIdentityInvalid
	}
	if (rawBlockID != "" && payload.BlockID == "") || actorUserID == "" ||
		(payload.LinkScope != "message" && payload.LinkScope != "thread") ||
		(payload.LinkScope == "thread" && payload.BlockID != "") || payload.BlockID == input.ProjectID {
		return domain.ProjectProjection{}, ErrInvalid
	}
	if payload.BlockID != "" && payload.TextboxColor != "" && !validEmailTextboxColor(payload.TextboxColor) {
		return domain.ProjectProjection{}, ErrInvalid
	}
	thread, _, found := r.memoryEmailMessageLocked(input.CompanyID, payload.EmailMessageID)
	if !found {
		if payload.BlockID == "" {
			return domain.ProjectProjection{}, ErrInvalid
		}
		return domain.ProjectProjection{}, ErrEmailMessageNotAttachedToProject
	}
	createdTimestamp := time.Now().UTC()
	if strings.TrimSpace(payload.AttachedTimestamp) != "" {
		parsed, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(payload.AttachedTimestamp))
		if err != nil {
			return domain.ProjectProjection{}, ErrInvalid
		}
		createdTimestamp = parsed.UTC()
	}
	if existing, exists := r.projectEmailRelationships[memoryProjectEmailRelationshipKey(input.CompanyID, input.InformationID)]; exists {
		if existing.ProjectID != input.ProjectID ||
			existing.EmailMessageID != payload.EmailMessageID || existing.ResourceTextboxID != payload.BlockID {
			return domain.ProjectProjection{}, ErrInvalid
		}
		projection, ok := r.memoryProjectEmailRelationshipProjectionLocked(existing)
		if !ok {
			return domain.ProjectProjection{}, ErrNotFound
		}
		return projection, nil
	}
	if payload.BlockID != "" {
		if textbox, found := r.projectText[key(input.CompanyID, input.ProjectID)][payload.BlockID]; !found || !isEditorTextBoxType(textbox.Type) {
			return domain.ProjectProjection{}, ErrInvalid
		}
		hasWideThreadRelationship := false
		for _, relationship := range r.projectEmailRelationships {
			if relationship.CompanyID == input.CompanyID && relationship.ProjectID == input.ProjectID &&
				relationship.EmailThreadID == thread.EmailThreadID && relationship.ResourceTextboxID == "" {
				hasWideThreadRelationship = true
				break
			}
		}
		if !hasWideThreadRelationship {
			return domain.ProjectProjection{}, ErrEmailMessageNotAttachedToProject
		}
		for _, relationship := range r.projectEmailRelationships {
			if relationship.CompanyID != input.CompanyID || relationship.ProjectID != input.ProjectID ||
				relationship.EmailMessageID != payload.EmailMessageID ||
				relationship.ResourceTextboxID == "" {
				continue
			}
			if relationship.ResourceTextboxID != payload.BlockID {
				return domain.ProjectProjection{}, ErrEmailMessageTextboxConflict
			}
			projection, ok := r.memoryProjectEmailRelationshipProjectionLocked(relationship)
			if !ok {
				return domain.ProjectProjection{}, ErrNotFound
			}
			return projection, nil
		}
		color, err := r.memoryProjectTextboxColorLocked(input.CompanyID, input.ProjectID, payload.BlockID)
		if err != nil {
			return domain.ProjectProjection{}, err
		}
		if color == "" {
			if payload.TextboxColor == "" {
				return domain.ProjectProjection{}, ErrInvalid
			}
			if err := r.setMemoryProjectTextboxColorLocked(input.CompanyID, input.ProjectID, payload.BlockID, payload.TextboxColor); err != nil {
				return domain.ProjectProjection{}, err
			}
		}
	}

	selectedRelationshipID := input.InformationID
	for _, message := range thread.Messages {
		if payload.LinkScope == "message" && message.EmailMessageID != payload.EmailMessageID {
			continue
		}
		if existing, exists := r.memoryProjectEmailRelationshipLocked(input.CompanyID, input.ProjectID, message.EmailMessageID, payload.BlockID); exists {
			if message.EmailMessageID == payload.EmailMessageID {
				selectedRelationshipID = existing.RelationshipID
			}
			continue
		}
		relationshipID := newUUIDv7String()
		if message.EmailMessageID == payload.EmailMessageID {
			relationshipID = input.InformationID
			selectedRelationshipID = relationshipID
		}
		r.projectEmailRelationships[memoryProjectEmailRelationshipKey(input.CompanyID, relationshipID)] = memoryProjectEmailRelationship{
			CompanyID: input.CompanyID, RelationshipID: relationshipID,
			EmailThreadID: thread.EmailThreadID, EmailMessageID: message.EmailMessageID,
			ProjectID:         input.ProjectID,
			ResourceTextboxID: payload.BlockID, CreatedTimestamp: createdTimestamp,
		}
	}
	selected, exists := r.projectEmailRelationships[memoryProjectEmailRelationshipKey(input.CompanyID, selectedRelationshipID)]
	if !exists {
		return domain.ProjectProjection{}, ErrNotFound
	}
	projection, ok := r.memoryProjectEmailRelationshipProjectionLocked(selected)
	if !ok {
		return domain.ProjectProjection{}, ErrNotFound
	}
	return projection, nil
}

func (r *MemoryRepo) ensureMemoryProjectEmailSelectionTextboxLinkLocked(input ProjectInformationInput, payload textboxChatPayload) error {
	textboxID := cleanUUIDText(payload.BlockID)
	selectionTextboxID := cleanUUIDText(payload.SelectionBlockID)
	emailMessageID := cleanUUIDText(payload.SelectionMessageID)
	textboxColor := strings.ToUpper(strings.TrimSpace(payload.EmailTextboxColor))
	if strings.TrimSpace(payload.SelectionMessageID) == "" || emailMessageID == "" {
		return ErrEmailMessageIdentityInvalid
	}
	if textboxID == "" || textboxID == input.ProjectID || selectionTextboxID != textboxID ||
		strings.TrimSpace(payload.ParentID) != "" || strings.ToLower(strings.TrimSpace(payload.SelectionSource)) != "email" ||
		strings.TrimSpace(payload.SelectionQuote) == "" || !validEmailTextboxColor(textboxColor) {
		return ErrInvalid
	}
	projectionKey := key(input.CompanyID, input.ProjectID)
	if r.projectText[projectionKey] == nil {
		r.projectText[projectionKey] = map[string]domain.ProjectProjection{}
	}
	if target, exists := r.projectText[projectionKey][textboxID]; exists {
		if !isEditorTextBoxType(target.Type) {
			return ErrInvalid
		}
	} else {
		now := time.Now().UTC()
		r.projectText[projectionKey][textboxID] = domain.ProjectProjection{
			CompanyID: input.CompanyID, ProjectID: input.ProjectID, InformationID: textboxID,
			Type: "Text box", Information: editorTextBlockProjectionPrefix + `{"title":"","color":"","document":"","attachments":[]}`,
			CreatedTimestamp: now, UpdatedTimestamp: now,
		}
	}
	attachedPayload, err := json.Marshal(emailTextboxRelationshipPayload{
		BlockID: textboxID, EmailMessageID: emailMessageID, TextboxColor: textboxColor,
		AttachedTimestamp: time.Now().UTC().Format(time.RFC3339Nano), LinkScope: "message",
	})
	if err != nil {
		return err
	}
	_, err = r.addMemoryProjectEmailRelationshipLocked(ProjectInformationInput{
		CompanyID: input.CompanyID, ProjectID: input.ProjectID, InformationID: newUUIDv7String(),
		Type: "Attached email", Information: string(attachedPayload), ActorUserID: input.ActorUserID,
	})
	return err
}

func (r *MemoryRepo) addMemoryProjectTextboxChatLocked(input ProjectInformationInput) (domain.ProjectProjection, error) {
	var payload textboxChatPayload
	if json.Unmarshal([]byte(input.Information), &payload) != nil {
		return domain.ProjectProjection{}, ErrInvalid
	}
	rawParentID, rawSelectionBlockID := strings.TrimSpace(payload.ParentID), strings.TrimSpace(payload.SelectionBlockID)
	payload.BlockID = cleanUUIDText(payload.BlockID)
	payload.ParentID = cleanUUIDText(payload.ParentID)
	payload.SelectionBlockID = cleanUUIDText(payload.SelectionBlockID)
	payload.AuthorID = cleanUUIDText(payload.AuthorID)
	actorUserID := cleanUUIDText(input.ActorUserID)
	if payload.AuthorID == "" {
		payload.AuthorID = actorUserID
	}
	if payload.BlockID == "" || payload.BlockID == input.ProjectID || actorUserID == "" || payload.AuthorID != actorUserID ||
		(rawParentID != "" && payload.ParentID == "") || (rawSelectionBlockID != "" && payload.SelectionBlockID == "") {
		return domain.ProjectProjection{}, ErrInvalid
	}
	selectionSource := strings.ToLower(strings.TrimSpace(payload.SelectionSource))
	if selectionSource == "" {
		selectionSource = "text"
	}
	if selectionSource != "text" && selectionSource != "email" {
		return domain.ProjectProjection{}, ErrInvalid
	}
	payload.SelectionSource = selectionSource
	payload.Message = strings.TrimSpace(payload.Message)
	_, hasAttachments, err := normalizeChatAttachmentIDs(payload.Attachments)
	if err != nil {
		return domain.ProjectProjection{}, err
	}
	if payload.Message == "" && !hasAttachments {
		return domain.ProjectProjection{}, ErrInvalid
	}
	if _, _, err := normalizeJSONArray(payload.EntityLinks); err != nil {
		return domain.ProjectProjection{}, err
	}
	if _, err := normalizeChatUUIDArray(payload.MentionedUserIDs); err != nil {
		return domain.ProjectProjection{}, err
	}
	if _, err := normalizeChatUUIDArray(payload.MentionedGroupIDs); err != nil {
		return domain.ProjectProjection{}, err
	}
	createdTimestamp, _, err := parseChatTimestamp(payload.CreatedTimestamp, true)
	if err != nil {
		return domain.ProjectProjection{}, err
	}
	_, editedTimestamp, err := parseChatTimestamp(payload.EditedTimestamp, false)
	if err != nil || (editedTimestamp != nil && editedTimestamp.Before(createdTimestamp)) ||
		(payload.SelectionStart == nil) != (payload.SelectionEnd == nil) ||
		(payload.SelectionStart != nil && (*payload.SelectionStart < 0 || *payload.SelectionEnd < *payload.SelectionStart)) {
		return domain.ProjectProjection{}, ErrInvalid
	}

	projectionKey := key(input.CompanyID, input.ProjectID)
	beforeProjections := cloneMemoryProjectProjections(r.projectText[projectionKey])
	beforeRelationships := cloneMemoryProjectEmailRelationships(r.projectEmailRelationships)
	rollback := func() {
		r.projectText[projectionKey] = beforeProjections
		r.projectEmailRelationships = beforeRelationships
	}
	if existing, exists := r.projectText[projectionKey][input.InformationID]; exists {
		if !isTextboxChatType(existing.Type) {
			return domain.ProjectProjection{}, ErrInvalid
		}
		var stored textboxChatPayload
		if json.Unmarshal([]byte(existing.Information), &stored) != nil || cleanUUIDText(stored.AuthorID) != actorUserID ||
			cleanUUIDText(stored.BlockID) != payload.BlockID || cleanUUIDText(stored.ParentID) != payload.ParentID ||
			strings.ToLower(strings.TrimSpace(stored.SelectionSource)) != selectionSource ||
			cleanUUIDText(stored.SelectionMessageID) != cleanUUIDText(payload.SelectionMessageID) {
			return domain.ProjectProjection{}, ErrInvalid
		}
		payload.CreatedTimestamp = stored.CreatedTimestamp
		createdTimestamp = existing.CreatedTimestamp
	} else {
		if _, exists := r.projectText[projectionKey][payload.BlockID]; !exists {
			if !payload.EnsureEmailTextboxLink || selectionSource != "email" {
				return domain.ProjectProjection{}, ErrNotFound
			}
		}
		if payload.ParentID != "" {
			parent, exists := r.projectText[projectionKey][payload.ParentID]
			if !exists || !isTextboxChatType(parent.Type) {
				return domain.ProjectProjection{}, ErrInvalid
			}
			var parentPayload textboxChatPayload
			if json.Unmarshal([]byte(parent.Information), &parentPayload) != nil || cleanUUIDText(parentPayload.BlockID) != payload.BlockID {
				return domain.ProjectProjection{}, ErrInvalid
			}
		}
	}
	if selectionSource == "text" {
		if strings.TrimSpace(payload.SelectionMessageID) != "" || payload.EnsureEmailTextboxLink {
			return domain.ProjectProjection{}, ErrInvalid
		}
	} else {
		messageID := cleanUUIDText(payload.SelectionMessageID)
		if messageID == "" {
			return domain.ProjectProjection{}, ErrEmailMessageIdentityInvalid
		}
		payload.SelectionMessageID = messageID
		if payload.EnsureEmailTextboxLink {
			if err := r.ensureMemoryProjectEmailSelectionTextboxLinkLocked(input, payload); err != nil {
				rollback()
				return domain.ProjectProjection{}, err
			}
		} else if _, exists := r.memoryProjectEmailRelationshipLocked(input.CompanyID, input.ProjectID, messageID, payload.BlockID); !exists {
			for _, relationship := range r.projectEmailRelationships {
				if relationship.CompanyID == input.CompanyID && relationship.ProjectID == input.ProjectID &&
					relationship.EmailMessageID == messageID && relationship.ResourceTextboxID != "" {
					return domain.ProjectProjection{}, ErrEmailMessageTextboxConflict
				}
			}
			return domain.ProjectProjection{}, ErrEmailMessageNotAttachedToProject
		}
	}
	payload.EnsureEmailTextboxLink = false
	payload.EmailTextboxColor = ""
	payload.CreatedTimestamp = createdTimestamp.Format(time.RFC3339Nano)
	if editedTimestamp != nil {
		payload.EditedTimestamp = editedTimestamp.Format(time.RFC3339Nano)
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		rollback()
		return domain.ProjectProjection{}, err
	}
	now := time.Now().UTC()
	projection := domain.ProjectProjection{
		CompanyID: input.CompanyID, ProjectID: input.ProjectID, InformationID: input.InformationID,
		Type: CommunicationsEmailCollaborationChatInformationType, Information: string(encoded),
		CreatedTimestamp: createdTimestamp, UpdatedTimestamp: now,
	}
	if existing, exists := r.projectText[projectionKey][input.InformationID]; exists {
		projection.CreatedTimestamp = existing.CreatedTimestamp
	}
	r.projectText[projectionKey][input.InformationID] = projection
	return projection, nil
}

func (r *MemoryRepo) deleteMemoryProjectEmailRelationshipLocked(input ProjectProjectionDeleteInput, relationship memoryProjectEmailRelationship) error {
	if relationship.ResourceTextboxID == "" {
		for _, candidate := range r.projectEmailRelationships {
			if candidate.CompanyID == input.CompanyID && candidate.ProjectID == input.ProjectID &&
				candidate.EmailThreadID == relationship.EmailThreadID &&
				candidate.ResourceTextboxID != "" {
				return ErrEmailRelationshipHasProjectWork
			}
		}
		for _, projection := range r.projectText[key(input.CompanyID, input.ProjectID)] {
			if !isTextboxChatType(projection.Type) {
				continue
			}
			var chat textboxChatPayload
			if json.Unmarshal([]byte(projection.Information), &chat) != nil || strings.ToLower(strings.TrimSpace(chat.SelectionSource)) != "email" {
				continue
			}
			thread, _, found := r.memoryEmailMessageLocked(input.CompanyID, cleanUUIDText(chat.SelectionMessageID))
			if found && thread.EmailThreadID == relationship.EmailThreadID {
				return ErrEmailRelationshipHasProjectWork
			}
		}
		r.retireMemoryExactResourceSharedEmailDraftLocked(input.CompanyID, EntityTypeProject, input.ProjectID, relationship.EmailMessageID)
		delete(r.projectEmailRelationships, memoryProjectEmailRelationshipKey(input.CompanyID, relationship.RelationshipID))
		return nil
	}
	for _, projection := range r.projectText[key(input.CompanyID, input.ProjectID)] {
		if !isTextboxChatType(projection.Type) {
			continue
		}
		var chat textboxChatPayload
		if json.Unmarshal([]byte(projection.Information), &chat) == nil &&
			strings.ToLower(strings.TrimSpace(chat.SelectionSource)) == "email" &&
			cleanUUIDText(chat.BlockID) == relationship.ResourceTextboxID &&
			cleanUUIDText(chat.SelectionMessageID) == relationship.EmailMessageID {
			return ErrEmailRelationshipRequiredByChat
		}
	}
	delete(r.projectEmailRelationships, memoryProjectEmailRelationshipKey(input.CompanyID, relationship.RelationshipID))
	for _, candidate := range r.projectEmailRelationships {
		if candidate.CompanyID == input.CompanyID && candidate.ProjectID == input.ProjectID &&
			candidate.ResourceTextboxID == relationship.ResourceTextboxID {
			return nil
		}
	}
	return r.setMemoryProjectTextboxColorLocked(input.CompanyID, input.ProjectID, relationship.ResourceTextboxID, "")
}

func (r *MemoryRepo) listMemoryProjectProjectionsLocked(companyID, projectID string) []domain.ProjectProjection {
	stored := r.projectText[key(companyID, projectID)]
	type linkedMessage struct {
		messageID string
		date      int64
	}
	linkedByTextbox := map[string][]linkedMessage{}
	items := make([]domain.ProjectProjection, 0, len(stored)+len(r.projectEmailRelationships))
	for _, relationship := range r.projectEmailRelationships {
		if relationship.CompanyID != companyID || relationship.ProjectID != projectID {
			continue
		}
		if projection, ok := r.memoryProjectEmailRelationshipProjectionLocked(relationship); ok {
			items = append(items, projection)
		}
		if relationship.ResourceTextboxID != "" {
			_, message, found := r.memoryEmailMessageLocked(companyID, relationship.EmailMessageID)
			if found {
				linkedByTextbox[relationship.ResourceTextboxID] = append(linkedByTextbox[relationship.ResourceTextboxID], linkedMessage{messageID: relationship.EmailMessageID, date: message.Message.Date})
			}
		}
	}
	for textboxID := range linkedByTextbox {
		sort.Slice(linkedByTextbox[textboxID], func(i, j int) bool {
			left, right := linkedByTextbox[textboxID][i], linkedByTextbox[textboxID][j]
			if left.date != right.date {
				return left.date < right.date
			}
			return left.messageID < right.messageID
		})
	}
	for _, projection := range stored {
		if isEditorTextBoxType(projection.Type) {
			prefix, payload, err := parseMemoryProjectTextboxInformation(projection.Information)
			if err == nil {
				delete(payload, "email_accent")
				delete(payload, "email_message_id")
				delete(payload, "email_message_ids")
				seen := map[string]bool{}
				messageIDs := make([]string, 0, len(linkedByTextbox[projection.InformationID]))
				for _, linked := range linkedByTextbox[projection.InformationID] {
					if !seen[linked.messageID] {
						seen[linked.messageID] = true
						messageIDs = append(messageIDs, linked.messageID)
					}
				}
				if len(messageIDs) > 0 {
					payload["email_message_ids"] = messageIDs
				}
				if encoded, marshalErr := json.Marshal(payload); marshalErr == nil {
					projection.Information = prefix + string(encoded)
				}
			}
		}
		items = append(items, projection)
	}
	sort.Slice(items, func(i, j int) bool {
		if !items[i].CreatedTimestamp.Equal(items[j].CreatedTimestamp) {
			return items[i].CreatedTimestamp.Before(items[j].CreatedTimestamp)
		}
		return items[i].InformationID < items[j].InformationID
	})
	return items
}
