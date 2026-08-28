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

func TestEditChatCommentInformationPreservesEntityReferenceMetadata(t *testing.T) {
	authorID := "author-1"
	message := "Track #Thailand delivery tomorrow"
	updated, _, err := editChatCommentInformation(
		"Text block chat",
		`{"block_id":"block-1","author_id":"author-1","message":"Original","attachments":[]}`,
		authorID,
		&message,
		&[]chatCommentEntityLink{{
			Start:      6,
			End:        24,
			EntityType: "entity",
			EntityID:   "11111111-1111-4111-8111-111111111111",
			Label:      "Thailand delivery",
		}},
		nil,
		nil,
	)
	if err != nil {
		t.Fatalf("editChatCommentInformation: %v", err)
	}
	var payload struct {
		EntityLinks []chatCommentEntityLink `json:"entity_links"`
	}
	if err := json.Unmarshal([]byte(updated), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.EntityLinks) != 1 {
		t.Fatalf("entity_links=%+v", payload.EntityLinks)
	}
	want := chatCommentEntityLink{
		Start:      6,
		End:        24,
		EntityType: "entity",
		EntityID:   "11111111-1111-4111-8111-111111111111",
		Label:      "Thailand delivery",
	}
	if payload.EntityLinks[0] != want {
		t.Fatalf("entity link=%+v, want %+v", payload.EntityLinks[0], want)
	}
}
