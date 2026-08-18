package store

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func editorJSONTestDocument(t *testing.T, companyID string) (*MemoryRepo, EditorJSONDocumentRef) {
	t.Helper()
	repo := NewMemoryRepo()
	node, err := repo.CreateNode(companyID, "Tiptap JSON")
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.SetEditorDataFormatForTests(EditorDataFormatGate{
		CompanyID: companyID, EditorFormat: EditorFormatTiptapJSON,
		MigrationState: EditorMigrationReady, DocumentSchemaVersion: MangoTiptapSchemaVersion,
	}); err != nil {
		t.Fatal(err)
	}
	return repo, EditorJSONDocumentRef{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID,
		DocumentID: "22222222-2222-4222-8222-222222222222",
	}
}

func TestMangoTiptapJSONStrictContractAcceptsFeatureDocument(t *testing.T) {
	raw := json.RawMessage(`{
		"format":"mango-tiptap-json","schema_version":1,
		"document":{"type":"doc","content":[
			{"type":"heading","attrs":{"level":2,"blockId":"heading-1","textAlign":"center","indentLevel":0},"content":[{"type":"text","text":"Plan","marks":[{"type":"bold"}]}]},
			{"type":"paragraph","attrs":{"blockId":"paragraph-1","textAlign":"left","indentLevel":1},"content":[
				{"type":"mention","attrs":{"userId":"user-1","label":"Ada","kind":"normal"}},
				{"type":"mangoEntityLink","attrs":{"entityType":"node","entityId":"node-1","label":"Linked Node"}},
				{"type":"text","text":" link","marks":[{"type":"link","attrs":{"href":"https://example.test","target":"_blank","rel":"noopener"}},{"type":"textStyle","attrs":{"fontSize":"18px","color":"#123456"}},{"type":"highlight","attrs":{"color":"#fff59d"}}]}
			]},
			{"type":"bulletList","attrs":{"blockId":"list-1"},"content":[{"type":"listItem","attrs":{"blockId":"item-1"},"content":[{"type":"paragraph","content":[{"type":"text","text":"Nested"}]}]}]},
			{"type":"orderedList","attrs":{"blockId":"ordered-list-1","start":1,"type":null},"content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Numbered"}]}]}]},
			{"type":"table","attrs":{"blockId":"table-1"},"content":[{"type":"tableRow","content":[
				{"type":"tableHeader","attrs":{"colspan":1,"rowspan":1,"colwidth":[160]},"content":[{"type":"paragraph","content":[{"type":"text","text":"Key"}]}]},
				{"type":"tableCell","attrs":{"colspan":1,"rowspan":1},"content":[{"type":"paragraph","content":[{"type":"text","text":"Value"}]}]}
			]}]},
			{"type":"mangoAttachmentImage","attrs":{"attachmentId":"attachment-1","filename":"diagram.png","mimeType":"image/png","width":640,"height":360,"displayWidth":320,"displayHeight":180,"alignment":"center","position":"break","layout":"content","alt":"Diagram","title":"Diagram","linkHref":"https://example.test/diagram","linkTarget":"_blank","linkRel":"noopener noreferrer","linkTitle":"Open diagram"}}
		]}
	}`)
	canonical, err := ValidateMangoTiptapJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(canonical) == 0 || string(canonical) == string(raw) {
		t.Fatalf("expected a non-empty canonical compact document")
	}
}

func TestMangoTiptapJSONAcceptsEmailMessageReference(t *testing.T) {
	raw := json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"mangoEntityLink","attrs":{"entityType":"email_message","entityId":"11111111-1111-4111-8111-111111111111","label":"Quarterly update","emailMessageId":"11111111-1111-4111-8111-111111111111","emailThreadId":"22222222-2222-4222-8222-222222222222","emailAccountEmail":"owner@example.com"}}]}]}}`)
	if _, err := ValidateMangoTiptapJSON(raw); err != nil {
		t.Fatalf("email message reference rejected: %v", err)
	}
}

func TestMangoTiptapJSONCanonicalEmptyDocumentRequiresParagraph(t *testing.T) {
	invalid := json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[]}}`)
	if _, err := ValidateMangoTiptapJSON(invalid); !errors.Is(err, ErrInvalid) {
		t.Fatalf("empty document root error=%v, want ErrInvalid", err)
	}

	valid := json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph"}]}}`)
	if _, err := ValidateMangoTiptapJSON(valid); err != nil {
		t.Fatalf("canonical empty paragraph rejected: %v", err)
	}
}

func TestMangoTiptapJSONAcceptsDocumentsAndAnnotationPositionsBeyondTwoMiB(t *testing.T) {
	largeText := strings.Repeat("x", 2*1024*1024+4096)
	raw, err := json.Marshal(map[string]any{
		"format":         MangoTiptapFormat,
		"schema_version": MangoTiptapSchemaVersion,
		"document": map[string]any{
			"type": "doc",
			"content": []any{map[string]any{
				"type":    "paragraph",
				"content": []any{map[string]any{"type": "text", "text": largeText}},
			}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) <= 2*1024*1024 {
		t.Fatalf("fixture bytes=%d, want above former two-MiB limit", len(raw))
	}
	if _, err := ValidateMangoTiptapJSON(raw); err != nil {
		t.Fatalf("large document rejected: %v", err)
	}
	if _, err := NormalizeEditorJSONAnnotations([]EditorJSONAnnotation{{ID: "large-position", Kind: "chat", From: 2*1024*1024 + 1, To: 2*1024*1024 + 100}}); err != nil {
		t.Fatalf("large annotation position rejected: %v", err)
	}
}

func TestMangoTiptapJSONCommitRejectsDuplicateBlockIDsWithoutBreakingLegacyReads(t *testing.T) {
	raw := json.RawMessage(`{
		"format":"mango-tiptap-json","schema_version":1,
		"document":{"type":"doc","content":[
			{"type":"paragraph","attrs":{"blockId":"duplicate-block"}},
			{"type":"bulletList","attrs":{"blockId":"list-block"},"content":[
				{"type":"listItem","attrs":{"blockId":"duplicate-block"},"content":[{"type":"paragraph"}]}
			]}
		]}
	}`)
	if _, err := ValidateMangoTiptapJSON(raw); err != nil {
		t.Fatalf("legacy snapshot with duplicate block IDs must remain readable: %v", err)
	}
	if _, err := validateMangoTiptapJSONForCommit(raw); !errors.Is(err, ErrInvalid) {
		t.Fatalf("new commit with duplicate block IDs error=%v", err)
	}
}
func TestMangoTiptapJSONKeepsOnlyStructuralAndDurabilityRestrictions(t *testing.T) {
	rejected := []json.RawMessage{
		json.RawMessage(`{"format":"mango-tiptap-json","schema_version":2,"document":{"type":"doc","content":[]}}`),
		json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"legacyHTML","attrs":{"html":"<p>old</p>"}}]}}`),
		json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"mangoAttachmentImage","attrs":{"attachmentId":"a","filename":"x","mimeType":"image/png","alt":"blob:secret"}}]}}`),
		json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[{"type":"link","attrs":{"href":"javascript:alert(1)"}}]}]}]}}`),
		json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","marks":[{"type":"bold"}]}]}}`),
		json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"mangoAttachmentImage","attrs":{"filename":"missing-id.png","mimeType":"image/png"}}]}}`),
		json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"mangoAttachmentImage","attrs":{"attachmentId":"a","linkHref":"javascript:alert(1)"}}]}}`),
		json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"mention","attrs":{"userId":"","label":"Missing"}}]}]}}`),
		json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"mangoEntityLink","attrs":{"entityType":"folder","entityId":"folder-1","label":"Bad"}}]}]}}`),
	}
	for index, raw := range rejected {
		if _, err := ValidateMangoTiptapJSON(raw); !errors.Is(err, ErrInvalid) {
			t.Fatalf("rejected case %d error=%v", index, err)
		}
	}

	acceptedCosmeticFormatting := []json.RawMessage{
		json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"keep formatting","marks":[{"type":"textStyle","attrs":{"fontSize":"11pt","color":"rgb(31, 78, 121)","fontFamily":"Aptos"}},{"type":"highlight","attrs":{"color":"color(display-p3 1 0.8 0.1)"}}]}]}]}}`),
		json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"first"},{"type":"hardBreak","marks":[{"type":"textStyle","attrs":{"fontSize":"10.5pt","color":"rgba(1,2,3,.5)"}}]},{"type":"text","text":"second"}]}]}}`),
		json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"mangoAttachmentImage","attrs":{"attachmentId":"a","mimeType":"image/avif","displayWidth":1000000,"alignment":"unusual-but-cosmetic"}}]}}`),
	}
	for index, raw := range acceptedCosmeticFormatting {
		if _, err := ValidateMangoTiptapJSON(raw); err != nil {
			t.Fatalf("cosmetic case %d rejected: %v", index, err)
		}
	}
}
func TestEditorJSONExactRevisionDedupeConflictVersionsAndDelete(t *testing.T) {
	repo, ref := editorJSONTestDocument(t, "11111111-1111-4111-8111-111111111111")
	firstDocument := json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"first"}]}]}}`)
	annotations := []EditorJSONAnnotation{
		{ID: "comment-1", Kind: "comment", From: 2, To: 7},
		{ID: "change-1", Kind: "change", From: 8, To: 12},
		{ID: "chat-1", Kind: "chat", From: 13, To: 18},
	}
	input := EditorJSONCommitInput{
		Document: ref, OperationID: "operation-1", ClientID: "client-1",
		BaseRevision: 0, SchemaVersion: 1, JSONDocument: firstDocument, Annotations: annotations,
	}
	first, err := repo.CommitEditorJSONDocument(input)
	if err != nil {
		t.Fatal(err)
	}
	duplicate, err := repo.CommitEditorJSONDocument(input)
	if err != nil || !duplicate.Deduplicated || duplicate.Revision != first.Revision || duplicate.EventID != first.EventID || !editorJSONAnnotationsEqual(duplicate.Annotations, annotations) {
		t.Fatalf("duplicate=%+v err=%v", duplicate, err)
	}
	stale := input
	stale.OperationID = "operation-2"
	stale.JSONDocument = json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"stale"}]}]}}`)
	if _, err := repo.CommitEditorJSONDocument(stale); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("stale commit error=%v", err)
	}
	snapshot, err := repo.GetEditorJSONSnapshot(ref)
	if err != nil || snapshot.Revision != 1 || string(snapshot.JSONDocument) != string(first.JSONDocument) || !editorJSONAnnotationsEqual(snapshot.Annotations, annotations) {
		t.Fatalf("snapshot=%+v err=%v", snapshot, err)
	}
	versions, err := repo.ListEditorJSONVersions(ref, 10)
	if err != nil || len(versions) != 1 || versions[0].Revision != 1 || !editorJSONAnnotationsEqual(versions[0].Annotations, annotations) {
		t.Fatalf("versions=%+v err=%v", versions, err)
	}
	deleted, err := repo.DeleteEditorJSONDocument(EditorJSONDeleteInput{
		Document: ref, OperationID: "delete-1", ClientID: "client-1", BaseRevision: 1,
	})
	if err != nil || deleted.Revision != 2 {
		t.Fatalf("delete=%+v err=%v", deleted, err)
	}
	duplicateDelete, err := repo.DeleteEditorJSONDocument(EditorJSONDeleteInput{
		Document: ref, OperationID: "delete-1", ClientID: "client-1", BaseRevision: 1,
	})
	if err != nil || !duplicateDelete.Deduplicated || duplicateDelete.EventID != deleted.EventID {
		t.Fatalf("duplicate delete=%+v err=%v", duplicateDelete, err)
	}
	snapshot, err = repo.GetEditorJSONSnapshot(ref)
	if err != nil || !snapshot.Deleted {
		t.Fatalf("deleted snapshot=%+v err=%v", snapshot, err)
	}
}

func TestEditorJSONRejectsInvalidOrChangedStableOperationAnnotations(t *testing.T) {
	repo, ref := editorJSONTestDocument(t, "55555555-5555-4555-8555-555555555555")
	document := json.RawMessage(`{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"mapped"}]}]}}`)
	input := EditorJSONCommitInput{
		Document: ref, OperationID: "stable-operation", ClientID: "stable-client", BaseRevision: 0,
		SchemaVersion: 1, JSONDocument: document,
		Annotations: []EditorJSONAnnotation{{ID: "comment-1", Kind: "comment", From: 2, To: 5}},
	}
	if _, err := repo.CommitEditorJSONDocument(input); err != nil {
		t.Fatal(err)
	}
	changed := input
	changed.Annotations = []EditorJSONAnnotation{{ID: "comment-1", Kind: "comment", From: 3, To: 6}}
	if _, err := repo.CommitEditorJSONDocument(changed); !errors.Is(err, ErrInvalid) {
		t.Fatalf("changed stable operation annotations error=%v", err)
	}
	invalid := input
	invalid.OperationID = "invalid-annotation"
	invalid.BaseRevision = 1
	invalid.Annotations = []EditorJSONAnnotation{{ID: "comment-1", Kind: "unknown", From: 2, To: 5}}
	if _, err := repo.CommitEditorJSONDocument(invalid); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid annotation error=%v", err)
	}
}

func TestEditorJSONDeleteSupportsNeverEditedEmptyDocument(t *testing.T) {
	repo, ref := editorJSONTestDocument(t, "44444444-4444-4444-8444-444444444444")
	deleted, err := repo.DeleteEditorJSONDocument(EditorJSONDeleteInput{
		Document: ref, OperationID: "delete-empty", ClientID: "client-empty", BaseRevision: 0,
	})
	if err != nil || deleted.Revision != 1 || string(deleted.JSONDocument) != string(emptyMangoTiptapDocument) {
		t.Fatalf("empty delete=%+v err=%v", deleted, err)
	}
	snapshot, err := repo.GetEditorJSONSnapshot(ref)
	if err != nil || !snapshot.Deleted || snapshot.Revision != 1 {
		t.Fatalf("empty deleted snapshot=%+v err=%v", snapshot, err)
	}
}

func TestEditorFormatGateIsPermanentlyReadyAndRejectsPartialCounts(t *testing.T) {
	repo := NewMemoryRepo()
	gate, err := repo.GetEditorDataFormat("33333333-3333-4333-8333-333333333333")
	if err != nil || gate.EditorFormat != EditorFormatTiptapJSON || gate.MigrationState != EditorMigrationReady || gate.ExpectedDocumentCount != gate.ConvertedDocumentCount {
		t.Fatalf("gate=%+v err=%v", gate, err)
	}
	err = repo.SetEditorDataFormatForTests(EditorDataFormatGate{
		CompanyID:    "33333333-3333-4333-8333-333333333333",
		EditorFormat: EditorFormatTiptapJSON, MigrationState: EditorMigrationReady,
		DocumentSchemaVersion: 1, ExpectedDocumentCount: 2, ConvertedDocumentCount: 1,
	})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("partial ready error=%v", err)
	}
}

func TestNodeTextboxMetadataAllowsNoColorAndRejectsUnapprovedStoredColors(t *testing.T) {
	document := EditorDocumentRef{
		CompanyID: "11111111-1111-4111-8111-111111111111", ResourceType: EntityTypeNode,
		ResourceID: "22222222-2222-4222-8222-222222222222", DocumentID: "33333333-3333-4333-8333-333333333333",
	}
	normalized, err := NormalizeEditorJSONMetadata(EditorJSONMetadataInput{Document: document, Title: "Notes", Color: " #14b8a6 "})
	if err != nil || normalized.Color != "#14B8A6" {
		t.Fatalf("approved color metadata=%+v err=%v", normalized, err)
	}
	withoutColor, err := NormalizeEditorJSONMetadata(EditorJSONMetadataInput{Document: document, Title: "Ordinary notes"})
	if err != nil || withoutColor.Color != "" {
		t.Fatalf("ordinary metadata=%+v err=%v", withoutColor, err)
	}
	for _, color := range []string{"#EF4444", "#FF0000", "red", "#123456"} {
		if _, err := NormalizeEditorJSONMetadata(EditorJSONMetadataInput{Document: document, Title: "Notes", Color: color}); !errors.Is(err, ErrInvalid) {
			t.Fatalf("color %q error=%v, want ErrInvalid", color, err)
		}
	}
	if _, err := NormalizeEditorJSONMetadata(EditorJSONMetadataInput{Document: document, Title: "Notes", Color: "#0EA5E9", EmailAccent: "#0EA5E9"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("obsolete Node email accent error=%v, want ErrInvalid", err)
	}
}

func TestProjectTextboxMetadataCannotWriteRelationshipOwnedFields(t *testing.T) {
	document := EditorDocumentRef{
		CompanyID: "11111111-1111-4111-8111-111111111111", ResourceType: EntityTypeProject,
		ResourceID: "22222222-2222-4222-8222-222222222222", DocumentID: "33333333-3333-4333-8333-333333333333",
	}
	normalized, err := NormalizeEditorJSONMetadata(EditorJSONMetadataInput{Document: document, Title: " Project notes "})
	if err != nil || normalized.Title != "Project notes" {
		t.Fatalf("ordinary Project metadata=%+v err=%v", normalized, err)
	}
	for name, input := range map[string]EditorJSONMetadataInput{
		"color":            {Document: document, Color: "#0EA5E9"},
		"email_message_id": {Document: document, EmailMessageID: "44444444-4444-4444-8444-444444444444"},
		"email_accent":     {Document: document, EmailAccent: "#0EA5E9"},
	} {
		if _, err := NormalizeEditorJSONMetadata(input); !errors.Is(err, ErrInvalid) {
			t.Errorf("Project %s metadata error=%v, want ErrInvalid", name, err)
		}
	}
	projection, err := editorProjectionInformationWithJSONMetadata(normalized, `{"type":"doc"}`)
	if err != nil {
		t.Fatal(err)
	}
	for _, obsolete := range []string{`"color"`, `"email_message_id"`, `"email_accent"`} {
		if strings.Contains(projection, obsolete) {
			t.Errorf("Project metadata projection contains relationship-owned field %s: %s", obsolete, projection)
		}
	}
}
