package store

import (
	"encoding/json"
	"strings"
	"time"
)

type HuddleNodeTextbox struct {
	CompanyID        string    `json:"company_id"`
	HuddleNodeID     string    `json:"huddle_node_id"`
	TextboxID        string    `json:"textbox_id"`
	Title            string    `json:"title"`
	DisplayOrder     int64     `json:"display_order"`
	Revision         int64     `json:"revision"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type HuddleNodeTextboxChat struct {
	CompanyID         string          `json:"company_id"`
	HuddleNodeID      string          `json:"huddle_node_id"`
	TextboxID         string          `json:"textbox_id"`
	ChatID            string          `json:"chat_id"`
	ParentChatID      string          `json:"parent_chat_id,omitempty"`
	SelectionQuote    string          `json:"selection_quote,omitempty"`
	SelectionStart    *int            `json:"selection_start,omitempty"`
	SelectionEnd      *int            `json:"selection_end,omitempty"`
	AuthorUserID      string          `json:"author_id,omitempty"`
	AuthorDisplayName string          `json:"author_display_name"`
	Message           string          `json:"message"`
	EntityLinks       json.RawMessage `json:"entity_links"`
	MentionedUserIDs  []string        `json:"mentioned_user_ids"`
	MentionedGroupIDs []string        `json:"mentioned_group_ids"`
	Revision          int64           `json:"revision"`
	CreatedTimestamp  time.Time       `json:"created_timestamp"`
	UpdatedTimestamp  time.Time       `json:"updated_timestamp"`
	EditedTimestamp   *time.Time      `json:"edited_timestamp,omitempty"`
}

type HuddleNodeWorkspace struct {
	Textboxes []HuddleNodeTextbox     `json:"textboxes"`
	Chats     []HuddleNodeTextboxChat `json:"chats"`
}

type HuddleNodeTextboxCreateInput struct {
	CompanyID    string
	HuddleNodeID string
	TextboxID    string
	Title        string
}

type HuddleNodeTextboxChatInput struct {
	CompanyID         string
	HuddleNodeID      string
	TextboxID         string
	ChatID            string
	ParentChatID      string
	SelectionQuote    string
	SelectionStart    *int
	SelectionEnd      *int
	AuthorUserID      string
	AuthorDisplayName string
	ActorUserID       string
	Message           string
	EntityLinks       json.RawMessage
	MentionedUserIDs  []string
	MentionedGroupIDs []string
	ExpectedRevision  *int64
}

type HuddleNodeTextboxChatDeleteInput struct {
	CompanyID        string
	HuddleNodeID     string
	ChatID           string
	ActorUserID      string
	ExpectedRevision *int64
}

func normalizeHuddleNodeTextboxTitle(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		value = "New text box"
	}
	if len(value) > 500 {
		return "", ErrInvalid
	}
	return value, nil
}

func normalizeHuddleNodeTextboxChatInput(input HuddleNodeTextboxChatInput) (HuddleNodeTextboxChatInput, error) {
	input.CompanyID = cleanUUIDText(input.CompanyID)
	input.HuddleNodeID = cleanUUIDText(input.HuddleNodeID)
	input.TextboxID = cleanUUIDText(input.TextboxID)
	input.ChatID = cleanUUIDText(input.ChatID)
	input.ParentChatID = cleanUUIDText(input.ParentChatID)
	input.AuthorUserID = cleanUUIDText(input.AuthorUserID)
	input.ActorUserID = cleanUUIDText(input.ActorUserID)
	input.AuthorDisplayName = strings.TrimSpace(input.AuthorDisplayName)
	input.Message = strings.TrimSpace(input.Message)
	input.SelectionQuote = strings.TrimSpace(input.SelectionQuote)
	if input.CompanyID == "" || input.HuddleNodeID == "" || input.TextboxID == "" || input.ChatID == "" || input.ActorUserID == "" || input.Message == "" {
		return HuddleNodeTextboxChatInput{}, ErrInvalid
	}
	if input.ExpectedRevision != nil && *input.ExpectedRevision < 0 {
		return HuddleNodeTextboxChatInput{}, ErrInvalid
	}
	if input.ExpectedRevision == nil {
		if input.AuthorUserID == "" {
			input.AuthorUserID = input.ActorUserID
		}
		if input.AuthorUserID != input.ActorUserID {
			return HuddleNodeTextboxChatInput{}, ErrInvalid
		}
	}
	if (input.SelectionStart == nil) != (input.SelectionEnd == nil) ||
		(input.SelectionStart != nil && (*input.SelectionStart < 0 || *input.SelectionEnd < *input.SelectionStart)) {
		return HuddleNodeTextboxChatInput{}, ErrInvalid
	}
	entityLinks, _, err := normalizeJSONArray(input.EntityLinks)
	if err != nil {
		return HuddleNodeTextboxChatInput{}, err
	}
	input.EntityLinks = json.RawMessage(entityLinks)
	input.MentionedUserIDs = normalizeUniqueUUIDs(input.MentionedUserIDs)
	input.MentionedGroupIDs = normalizeUniqueUUIDs(input.MentionedGroupIDs)
	return input, nil
}

func normalizeUniqueUUIDs(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]bool, len(values))
	for _, value := range values {
		value = cleanUUIDText(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}
