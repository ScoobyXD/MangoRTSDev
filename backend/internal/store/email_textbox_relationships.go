package store

type emailTextboxRelationshipPayload struct {
	BlockID           string `json:"block_id"`
	EmailMessageID    string `json:"email_message_id"`
	TextboxColor      string `json:"textbox_color"`
	AttachedTimestamp string `json:"attached_timestamp"`
	LinkScope         string `json:"link_scope"`
}

func validEmailTextboxColor(value string) bool {
	switch value {
	case "#0EA5E9", "#14B8A6", "#8B5CF6", "#F59E0B", "#22C55E", "#6366F1",
		"#06B6D4", "#84CC16", "#A855F7", "#10B981", "#EAB308", "#3B82F6":
		return true
	default:
		return false
	}
}
