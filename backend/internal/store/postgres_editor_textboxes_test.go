package store

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func editorMergeTestDocument(t *testing.T, blocks ...string) json.RawMessage {
	t.Helper()
	raw := `{"format":"mango-tiptap-json","schema_version":1,"document":{"type":"doc","content":[` + strings.Join(blocks, ",") + `]}}`
	canonical, err := ValidateMangoTiptapJSON([]byte(raw))
	if err != nil {
		t.Fatalf("ValidateMangoTiptapJSON: %v", err)
	}
	return canonical
}

func TestEditorTextboxBodyStoresAnnotationsInsideJSON(t *testing.T) {
	document := editorMergeTestDocument(t,
		`{"type":"paragraph","attrs":{"blockId":"a"},"content":[{"type":"text","text":"hello"}]}`,
	)
	annotations := []EditorJSONAnnotation{{ID: "comment-1", Kind: "comment", From: 1, To: 4}}
	body, err := encodeEditorTextboxBody(document, annotations)
	if err != nil {
		t.Fatalf("encodeEditorTextboxBody: %v", err)
	}
	var stored map[string]json.RawMessage
	if err := json.Unmarshal(body, &stored); err != nil {
		t.Fatalf("unmarshal body: %v", err)
	}
	if _, ok := stored["annotations"]; !ok {
		t.Fatal("body_json did not contain annotations")
	}
	decodedDocument, decodedAnnotations, err := decodeEditorTextboxBody(body)
	if err != nil {
		t.Fatalf("decodeEditorTextboxBody: %v", err)
	}
	if !bytes.Equal(document, decodedDocument) {
		t.Fatalf("document changed during body round trip\nwant %s\n got %s", document, decodedDocument)
	}
	if !editorJSONAnnotationsEqual(annotations, decodedAnnotations) {
		t.Fatalf("annotations changed during body round trip: %#v", decodedAnnotations)
	}
}

func TestEditorTextboxBodyCompactsTiptapDefaultsWithoutLosingContent(t *testing.T) {
	document := editorMergeTestDocument(t,
		`{"type":"paragraph","attrs":{"blockId":"970fa252-c954-4fc8-a5fa-7d5ba02807f3","textAlign":null,"indentLevel":0},"content":[{"text":"this is a test test testS","type":"text"}]}`,
		`{"type":"paragraph","attrs":{"blockId":"7c83bff9-24de-448c-a569-cdd951a7277c","textAlign":null,"indentLevel":0}}`,
		`{"type":"paragraph","attrs":{"blockId":"65aac248-d542-45c6-9f1a-b13be7fb8b82","textAlign":null,"indentLevel":0},"content":[{"text":"s","type":"text"},{"type":"hardBreak"},{"type":"hardBreak"}]}`,
		`{"type":"mangoAttachmentImage","attrs":{"alt":"image.png","title":"image.png","width":640,"height":360,"layout":"content","linkRel":"","filename":"image.png","linkHref":"","mimeType":"image/png","position":"break","alignment":"left","linkTitle":"","linkTarget":"","attachmentId":"019fc309-c4a2-7001-b819-35365e91c300","displayWidth":640,"displayHeight":360}}`,
		`{"type":"paragraph","attrs":{"blockId":"3807418e-4311-4f94-9075-d9ce53afee0a","textAlign":null,"indentLevel":0}}`,
	)
	body, err := encodeEditorTextboxBody(document, []EditorJSONAnnotation{})
	if err != nil {
		t.Fatalf("encodeEditorTextboxBody: %v", err)
	}
	for _, redundant := range []string{
		`"textAlign"`, `"indentLevel"`, `"alignment"`, `"position"`,
		`"layout"`, `"linkHref"`, `"linkTarget"`, `"linkRel"`, `"linkTitle"`,
	} {
		if bytes.Contains(body, []byte(redundant)) {
			t.Fatalf("stored body retained default attribute %s: %s", redundant, body)
		}
	}
	for _, required := range []string{
		`"this is a test test testS"`, `"hardBreak"`,
		`"attachmentId":"019fc309-c4a2-7001-b819-35365e91c300"`,
		`"filename":"image.png"`, `"width":640`, `"displayWidth":640`,
		`"alt":"image.png"`, `"title":"image.png"`, `"annotations":[]`,
	} {
		if !bytes.Contains(body, []byte(required)) {
			t.Fatalf("stored body lost required content %s: %s", required, body)
		}
	}
	if saved := len(document) - len(body); saved < 200 {
		t.Fatalf("default compaction saved %d bytes, want at least 200\noriginal=%s\ncompact=%s", saved, document, body)
	}
	decoded, annotations, err := decodeEditorTextboxBody(body)
	if err != nil {
		t.Fatalf("decodeEditorTextboxBody: %v", err)
	}
	expected, err := compactMangoTiptapJSON(document)
	if err != nil {
		t.Fatalf("compactMangoTiptapJSON: %v", err)
	}
	if !bytes.Equal(decoded, expected) {
		t.Fatalf("decoded compact document changed\nwant %s\n got %s", expected, decoded)
	}
	if len(annotations) != 0 {
		t.Fatalf("decoded annotations=%#v, want empty", annotations)
	}
}

func TestMergeMangoTiptapDocumentsTreatsOmittedDefaultsAsEquivalent(t *testing.T) {
	expandedParagraph := `{"type":"paragraph","attrs":{"blockId":"a","textAlign":null,"indentLevel":0},"content":[{"type":"text","text":"same","marks":[{"type":"link","attrs":{"href":"https://example.test","target":"_blank","rel":"noopener noreferrer nofollow","class":null,"title":null}}]}]}`
	compactParagraph := `{"type":"paragraph","attrs":{"blockId":"a"},"content":[{"type":"text","text":"same","marks":[{"type":"link","attrs":{"href":"https://example.test"}}]}]}`
	expandedImage := `{"type":"mangoAttachmentImage","attrs":{"attachmentId":"image-1","filename":"image.png","mimeType":"image/png","alignment":"left","position":"break","layout":"content","linkHref":"","linkTarget":"","linkRel":"","linkTitle":""}}`
	compactImage := `{"type":"mangoAttachmentImage","attrs":{"attachmentId":"image-1","filename":"image.png","mimeType":"image/png"}}`

	merged, err := mergeMangoTiptapDocuments(
		editorMergeTestDocument(t, expandedParagraph, expandedImage),
		editorMergeTestDocument(t, compactParagraph, compactImage),
	)
	if err != nil {
		t.Fatalf("mergeMangoTiptapDocuments: %v", err)
	}
	var envelope mangoTiptapMergeEnvelope
	if err := json.Unmarshal(merged, &envelope); err != nil {
		t.Fatalf("unmarshal merged document: %v", err)
	}
	if got, want := len(envelope.Document.Content), 2; got != want {
		t.Fatalf("compact/expanded compatibility duplicated content: got %d blocks, want %d: %s", got, want, merged)
	}
	for _, redundant := range []string{`"textAlign"`, `"indentLevel"`, `"alignment"`, `"position"`, `"layout"`} {
		if bytes.Contains(merged, []byte(redundant)) {
			t.Fatalf("merged document retained default attribute %s: %s", redundant, merged)
		}
	}
}

func TestMergeMangoTiptapDocumentsKeepsBothConflictingBlocksAndRejectsDeletion(t *testing.T) {
	serverA := `{"type":"paragraph","attrs":{"blockId":"a"},"content":[{"type":"text","text":"server edit"}]}`
	serverB := `{"type":"paragraph","attrs":{"blockId":"b"},"content":[{"type":"text","text":"server-only block"}]}`
	localA := `{"type":"paragraph","attrs":{"blockId":"a"},"content":[{"type":"text","text":"local edit"}]}`
	localC := `{"type":"paragraph","attrs":{"blockId":"c"},"content":[{"type":"text","text":"local-only block"}]}`

	merged, err := mergeMangoTiptapDocuments(
		editorMergeTestDocument(t, serverA, serverB),
		editorMergeTestDocument(t, localA, localC),
	)
	if err != nil {
		t.Fatalf("mergeMangoTiptapDocuments: %v", err)
	}
	var envelope mangoTiptapMergeEnvelope
	if err := json.Unmarshal(merged, &envelope); err != nil {
		t.Fatalf("unmarshal merged document: %v", err)
	}
	if got, want := len(envelope.Document.Content), 4; got != want {
		t.Fatalf("merged block count=%d, want %d: %s", got, want, merged)
	}
	if mangoTiptapBlockID(envelope.Document.Content[0]) != "a" ||
		!bytes.Contains(envelope.Document.Content[0], []byte("server edit")) {
		t.Fatalf("server conflict winner changed: %s", envelope.Document.Content[0])
	}
	if mangoTiptapBlockID(envelope.Document.Content[1]) != "b" ||
		!bytes.Contains(envelope.Document.Content[1], []byte("server-only block")) {
		t.Fatalf("missing local block deleted the server block: %s", merged)
	}
	if mangoTiptapBlockID(envelope.Document.Content[2]) == "a" || mangoTiptapBlockID(envelope.Document.Content[2]) == "" {
		t.Fatalf("conflicting local copy did not receive a fresh block ID: %s", envelope.Document.Content[2])
	}
	if mangoTiptapBlockID(envelope.Document.Content[3]) != "c" {
		t.Fatalf("local-only block was not appended: %s", envelope.Document.Content[3])
	}

	retried, err := mergeMangoTiptapDocuments(merged, editorMergeTestDocument(t, localA, localC))
	if err != nil {
		t.Fatalf("retry merge: %v", err)
	}
	var retriedEnvelope mangoTiptapMergeEnvelope
	if err := json.Unmarshal(retried, &retriedEnvelope); err != nil {
		t.Fatalf("unmarshal retried merge: %v", err)
	}
	if got, want := len(retriedEnvelope.Document.Content), 4; got != want {
		t.Fatalf("retry duplicated a conflict block: got %d blocks, want %d: %s", got, want, retried)
	}
}

func TestEditorTextboxCutoverUsesSixPermanentTables(t *testing.T) {
	migrationPath := filepath.Join("..", "..", "db", "migrations", "20260801_editor_textbox_storage_foundation.sql")
	migration, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	sql := string(migration)
	for _, table := range []string{
		"node_textboxes", "logic_gate_textboxes", "project_textboxes",
		"node_textboxes_history", "logic_gate_textboxes_history", "project_textboxes_history",
	} {
		if !strings.Contains(sql, table) {
			t.Fatalf("migration is missing %s", table)
		}
	}
	logicStart := strings.Index(sql, "create table if not exists logic_gate_textboxes (")
	logicEnd := strings.Index(sql[logicStart:], ");")
	if logicStart < 0 || logicEnd < 0 {
		t.Fatal("logic_gate_textboxes definition not found")
	}
	if strings.Contains(sql[logicStart:logicStart+logicEnd], "display_order") {
		t.Fatal("logic_gate_textboxes must not have display_order")
	}
	for _, obsoleteWrite := range []string{
		"insert into editor_json_operations", "insert into editor_json_versions",
		"insert into project_editor_document_operations", "insert into project_editor_document_versions",
		"insert into logic_gate_editor_document_operations", "insert into logic_gate_editor_document_versions",
	} {
		activePath, err := os.ReadFile(filepath.Join("postgres_editor_" + "textboxes.go"))
		if err != nil {
			t.Fatalf("read active store: %v", err)
		}
		if strings.Contains(string(activePath), obsoleteWrite) {
			t.Fatalf("active editor path still contains obsolete write %q", obsoleteWrite)
		}
	}
}

func TestEditorTextboxRetirementRemovesNineLegacyTables(t *testing.T) {
	schema, err := os.ReadFile(filepath.Join("..", "..", "db", "schema.sql"))
	if err != nil {
		t.Fatalf("read canonical schema: %v", err)
	}
	migration, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260801_z_retire_legacy_editor_storage.sql"))
	if err != nil {
		t.Fatalf("read retirement migration: %v", err)
	}
	schemaText := strings.ToLower(string(schema))
	migrationText := strings.ToLower(string(migration))
	obsolete := []string{
		"editor_json_documents",
		"editor_json_operations",
		"editor_json_versions",
		"project_editor_documents",
		"project_editor_document_operations",
		"project_editor_document_versions",
		"logic_gate_editor_documents",
		"logic_gate_editor_document_operations",
		"logic_gate_editor_document_versions",
	}
	for _, table := range obsolete {
		if strings.Contains(schemaText, table) {
			t.Errorf("canonical schema still references obsolete table %s", table)
		}
		if !strings.Contains(migrationText, "drop table if exists "+table) {
			t.Errorf("retirement migration does not drop %s", table)
		}
	}
	for _, required := range []string{
		"legacy_editor_storage_not_empty",
		"from node_textboxes",
		"from project_textboxes",
		"from logic_gate_textboxes",
	} {
		if !strings.Contains(migrationText, required) {
			t.Errorf("retirement migration missing %q", required)
		}
	}
}
func TestEditorTextboxCutoverAcceptsUUIDv7Identities(t *testing.T) {
	migrationPath := filepath.Join("..", "..", "db", "migrations", "20260801_editor_textbox_storage_foundation.sql")
	migration, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	sql := string(migration)
	for _, check := range []string{
		"not pg_input_is_valid(resource_id, 'uuid')",
		"not pg_input_is_valid(document_id, 'uuid')",
	} {
		if !strings.Contains(sql, check) {
			t.Fatalf("migration must let PostgreSQL validate UUID identities; missing %q", check)
		}
	}
	if strings.Contains(sql, "[1-5][0-9a-f]{3}") {
		t.Fatal("migration must not reject valid UUIDv6, UUIDv7, or UUIDv8 identities")
	}
	if id := newUUIDv7String(); len(id) != 36 || id[14] != '7' {
		t.Fatalf("test requires the application's UUIDv7 identity format, got %q", id)
	}
}

func TestEditorTextboxV3OperationalScriptsRejectPartialCutovers(t *testing.T) {
	checks := map[string][]string{
		filepath.Join("..", "..", "..", "scripts", "verify_editor_textbox_cutover.sql"): {
			"node_textboxes",
			"node_textbox_chats",
			"node_textbox_seen_snapshots",
			"orphan email relationships",
			"legacy attached_email attachment identities",
		},
		filepath.Join("..", "..", "..", "scripts", "apply_editor_textbox_cleanup.sql"): {
			"Retired by the V3 database-table cutover",
			"20260802_zz_v3_database_table_cutover.sql",
			"always aborts without changing data",
		},
	}
	for path, required := range checks {
		contents, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		for _, text := range required {
			if !strings.Contains(string(contents), text) {
				t.Fatalf("%s must enforce the V3 cutover contract; missing %q", path, text)
			}
		}
	}
}
func TestEditorTextboxRecyclePayloadUsesSixPermanentTables(t *testing.T) {
	contents, err := os.ReadFile("postgres_recycle_bin.go")
	if err != nil {
		t.Fatalf("read postgres_recycle_bin.go: %v", err)
	}
	source := string(contents)
	for _, table := range []string{
		"node_textboxes", "project_textboxes", "logic_gate_textboxes",
		"node_textboxes_history", "project_textboxes_history", "logic_gate_textboxes_history",
	} {
		if !strings.Contains(source, `"`+table+`":`) || strings.Count(source, `"`+table+`"`) < 3 {
			t.Fatalf("recycle snapshot and restore paths must include %s", table)
		}
	}
}
func TestEditorTextboxWritesUseDatabaseTimestamps(t *testing.T) {
	contents, err := os.ReadFile("postgres_editor_textboxes.go")
	if err != nil {
		t.Fatalf("read postgres_editor_textboxes.go: %v", err)
	}
	source := string(contents)
	if strings.Contains(source, "clock_timestamp(),clock_timestamp()") {
		t.Fatal("textbox inserts must not use two independently evaluated clock timestamps")
	}
	if strings.Count(source, "statement_timestamp(),statement_timestamp()") != 3 {
		t.Fatal("all three textbox insert paths must use one stable statement timestamp")
	}
	if strings.Count(source, "greatest(clock_timestamp(),created_timestamp)") != 2 {
		t.Fatal("commit and delete must use a database timestamp that cannot precede row creation")
	}
}
