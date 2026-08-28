package store

import (
	"encoding/json"
	"sort"
	"time"
)

func (r *MemoryRepo) GetHuddleNodeWorkspace(companyID, huddleNodeID string) (HuddleNodeWorkspace, error) {
	companyID = cleanUUIDText(companyID)
	huddleNodeID = cleanUUIDText(huddleNodeID)
	if companyID == "" || huddleNodeID == "" {
		return HuddleNodeWorkspace{}, ErrInvalid
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if _, ok := r.huddleNodes[key(companyID, huddleNodeID)]; !ok {
		return HuddleNodeWorkspace{}, ErrNotFound
	}
	workspace := HuddleNodeWorkspace{Textboxes: []HuddleNodeTextbox{}, Chats: []HuddleNodeTextboxChat{}}
	for _, item := range r.huddleNodeTextboxes[key(companyID, huddleNodeID)] {
		workspace.Textboxes = append(workspace.Textboxes, item)
	}
	for _, item := range r.huddleNodeTextboxChats[key(companyID, huddleNodeID)] {
		item.EntityLinks = append(json.RawMessage(nil), item.EntityLinks...)
		item.MentionedUserIDs = append([]string(nil), item.MentionedUserIDs...)
		item.MentionedGroupIDs = append([]string(nil), item.MentionedGroupIDs...)
		workspace.Chats = append(workspace.Chats, item)
	}
	sort.Slice(workspace.Textboxes, func(i, j int) bool {
		if workspace.Textboxes[i].DisplayOrder != workspace.Textboxes[j].DisplayOrder {
			return workspace.Textboxes[i].DisplayOrder < workspace.Textboxes[j].DisplayOrder
		}
		return workspace.Textboxes[i].TextboxID < workspace.Textboxes[j].TextboxID
	})
	sort.Slice(workspace.Chats, func(i, j int) bool {
		if !workspace.Chats[i].CreatedTimestamp.Equal(workspace.Chats[j].CreatedTimestamp) {
			return workspace.Chats[i].CreatedTimestamp.Before(workspace.Chats[j].CreatedTimestamp)
		}
		return workspace.Chats[i].ChatID < workspace.Chats[j].ChatID
	})
	return workspace, nil
}

func (r *MemoryRepo) CreateHuddleNodeTextbox(input HuddleNodeTextboxCreateInput) (HuddleNodeTextbox, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.HuddleNodeID = cleanUUIDText(input.HuddleNodeID)
	input.TextboxID = cleanUUIDText(input.TextboxID)
	if input.TextboxID == "" {
		input.TextboxID = newUUIDv7String()
	}
	title, err := normalizeHuddleNodeTextboxTitle(input.Title)
	if err != nil || input.CompanyID == "" || input.HuddleNodeID == "" {
		return HuddleNodeTextbox{}, ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.huddleNodes[key(input.CompanyID, input.HuddleNodeID)]; !ok {
		return HuddleNodeTextbox{}, ErrNotFound
	}
	bucketKey := key(input.CompanyID, input.HuddleNodeID)
	if r.huddleNodeTextboxes[bucketKey] == nil {
		r.huddleNodeTextboxes[bucketKey] = map[string]HuddleNodeTextbox{}
	}
	if _, exists := r.huddleNodeTextboxes[bucketKey][input.TextboxID]; exists {
		return HuddleNodeTextbox{}, ErrConflict
	}
	var displayOrder int64
	for _, current := range r.huddleNodeTextboxes[bucketKey] {
		if current.DisplayOrder >= displayOrder {
			displayOrder = current.DisplayOrder + 1
		}
	}
	now := time.Now().UTC()
	item := HuddleNodeTextbox{
		CompanyID: input.CompanyID, HuddleNodeID: input.HuddleNodeID, TextboxID: input.TextboxID,
		Title: title, DisplayOrder: displayOrder, CreatedTimestamp: now, UpdatedTimestamp: now,
	}
	r.huddleNodeTextboxes[bucketKey][item.TextboxID] = item
	return item, nil
}

func (r *MemoryRepo) UpsertHuddleNodeTextboxChat(input HuddleNodeTextboxChatInput) (HuddleNodeTextboxChat, error) {
	input, err := normalizeHuddleNodeTextboxChatInput(input)
	if err != nil {
		return HuddleNodeTextboxChat{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	bucketKey := key(input.CompanyID, input.HuddleNodeID)
	if _, ok := r.huddleNodes[bucketKey]; !ok {
		return HuddleNodeTextboxChat{}, ErrNotFound
	}
	if _, ok := r.huddleNodeTextboxes[bucketKey][input.TextboxID]; !ok {
		return HuddleNodeTextboxChat{}, ErrNotFound
	}
	if r.huddleNodeTextboxChats[bucketKey] == nil {
		r.huddleNodeTextboxChats[bucketKey] = map[string]HuddleNodeTextboxChat{}
	}
	current, exists := r.huddleNodeTextboxChats[bucketKey][input.ChatID]
	if input.ExpectedRevision == nil {
		if exists {
			return HuddleNodeTextboxChat{}, ErrConflict
		}
	} else {
		if !exists {
			return HuddleNodeTextboxChat{}, ErrNotFound
		}
		if current.TextboxID != input.TextboxID {
			return HuddleNodeTextboxChat{}, ErrInvalid
		}
		if current.AuthorUserID != input.ActorUserID {
			return HuddleNodeTextboxChat{}, ErrNotFound
		}
		if *input.ExpectedRevision != current.Revision {
			return HuddleNodeTextboxChat{}, ErrVersionConflict
		}
	}
	if input.ParentChatID != "" {
		parent, ok := r.huddleNodeTextboxChats[bucketKey][input.ParentChatID]
		if !ok || parent.TextboxID != input.TextboxID {
			return HuddleNodeTextboxChat{}, ErrInvalid
		}
	}
	now := time.Now().UTC()
	wantRevision := int64(0)
	created := current.CreatedTimestamp
	if created.IsZero() {
		created = now
	} else {
		wantRevision = current.Revision
		input.AuthorUserID = current.AuthorUserID
		input.AuthorDisplayName = current.AuthorDisplayName
	}
	item := HuddleNodeTextboxChat{
		CompanyID: input.CompanyID, HuddleNodeID: input.HuddleNodeID, TextboxID: input.TextboxID,
		ChatID: input.ChatID, ParentChatID: input.ParentChatID, SelectionQuote: input.SelectionQuote,
		SelectionStart: input.SelectionStart, SelectionEnd: input.SelectionEnd,
		AuthorUserID: input.AuthorUserID, AuthorDisplayName: input.AuthorDisplayName,
		Message: input.Message, EntityLinks: append(json.RawMessage(nil), input.EntityLinks...),
		MentionedUserIDs:  append([]string(nil), input.MentionedUserIDs...),
		MentionedGroupIDs: append([]string(nil), input.MentionedGroupIDs...),
		Revision:          wantRevision + 1, CreatedTimestamp: created, UpdatedTimestamp: now,
	}
	if exists {
		item.EditedTimestamp = &now
	}
	r.huddleNodeTextboxChats[bucketKey][item.ChatID] = item
	return item, nil
}

func (r *MemoryRepo) DeleteHuddleNodeTextboxChat(input HuddleNodeTextboxChatDeleteInput) error {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.HuddleNodeID = cleanUUIDText(input.HuddleNodeID)
	input.ChatID = cleanUUIDText(input.ChatID)
	input.ActorUserID = cleanUUIDText(input.ActorUserID)
	if input.CompanyID == "" || input.HuddleNodeID == "" || input.ChatID == "" || input.ActorUserID == "" || input.ExpectedRevision == nil || *input.ExpectedRevision < 0 {
		return ErrInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	bucketKey := key(input.CompanyID, input.HuddleNodeID)
	item, ok := r.huddleNodeTextboxChats[bucketKey][input.ChatID]
	if !ok {
		return ErrNotFound
	}
	if item.AuthorUserID != input.ActorUserID {
		return ErrNotFound
	}
	if *input.ExpectedRevision != item.Revision {
		return ErrVersionConflict
	}
	remove := map[string]bool{input.ChatID: true}
	changed := true
	for changed {
		changed = false
		for chatID, chat := range r.huddleNodeTextboxChats[bucketKey] {
			if !remove[chatID] && remove[chat.ParentChatID] {
				remove[chatID] = true
				changed = true
			}
		}
	}
	for chatID := range remove {
		delete(r.huddleNodeTextboxChats[bucketKey], chatID)
	}
	return nil
}
