package store

import (
	"encoding/json"
	"time"
)

type textboxChatPayload struct {
	BlockID                string          `json:"block_id"`
	EnsureEmailTextboxLink bool            `json:"ensure_email_textbox_link_on_send"`
	EmailTextboxColor      string          `json:"email_textbox_color_on_send"`
	ParentID               string          `json:"parent_id"`
	SelectionSource        string          `json:"selection_source"`
	SelectionBlockID       string          `json:"selection_block_id"`
	SelectionMessageID     string          `json:"selection_message_id"`
	SelectionQuote         string          `json:"selection_quote"`
	SelectionStart         *int            `json:"selection_start"`
	SelectionEnd           *int            `json:"selection_end"`
	AuthorID               string          `json:"author_id"`
	AuthorName             string          `json:"author_name"`
	Message                string          `json:"message"`
	CreatedTimestamp       string          `json:"created_timestamp"`
	EditedTimestamp        string          `json:"edited_timestamp"`
	Attachments            json.RawMessage `json:"attachments"`
	EntityLinks            json.RawMessage `json:"entity_links"`
	MentionedUserIDs       json.RawMessage `json:"mentioned_user_ids"`
	MentionedGroupIDs      json.RawMessage `json:"mentioned_group_ids"`
}

type normalizedTextboxChat struct {
	TextboxID               string
	ParentChatID            string
	SelectionSource         string
	SelectionTextboxID      string
	SelectionEmailMessageID string
	SelectionQuote          string
	SelectionStart          *int
	SelectionEnd            *int
	AuthorUserID            string
	AuthorDisplayName       string
	Message                 string
	CreatedTimestamp        time.Time
	EditedTimestamp         *time.Time
	AttachmentIDsJSON       string
	EntityLinksJSON         string
	MentionedUserIDsJSON    string
	MentionedGroupIDsJSON   string
}
