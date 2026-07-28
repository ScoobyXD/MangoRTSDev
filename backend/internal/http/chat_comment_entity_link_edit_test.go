package httpapi

import (
	"encoding/json"
	"testing"
)

func TestEditChatCommentInformationPreservesEntityLinksWhenOmitted(t *testing.T) {
	authorID := "author-1"
	original := `{"block_id":"block-1","author_id":"author-1","message":"See #Project One","attachments":[],"entity_links":[{"start":4,"end":16,"entity_type":"project","entity_id":"project-1","label":"Project One"}]}`
	message := "See #Project One soon"
	updated, _, err := editChatCommentInformation(
		"Text block chat", original, authorID, &message, nil, nil, nil,
	)
	if err != nil {
		t.Fatalf("editChatCommentInformation: %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(updated), &payload); err != nil {
		t.Fatal(err)
	}
	links, ok := payload["entity_links"].([]any)
	if !ok || len(links) != 1 {
		t.Fatalf("entity_links=%+v", payload["entity_links"])
	}
}
