package migration

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

func TestScanPayloadRewritesInlineImageDataURLIdempotently(t *testing.T) {
	payload := `<p>before</p><img src="data:image/png;base64,` + base64.StdEncoding.EncodeToString([]byte("png-bytes")) + `"><p>after</p>`
	location := PayloadLocation{
		Table:         "node_projection_table",
		Column:        "information",
		SourcePK:      "company-1|node-1|info-1",
		CompanyID:     "company-1",
		ResourceType:  "node",
		ResourceID:    "node-1",
		InformationID: "info-1",
	}

	result := ScanPayload(location, payload, ScanOptions{})
	if len(result.EmbeddedFiles) != 1 {
		t.Fatalf("embedded files = %d, want 1", len(result.EmbeddedFiles))
	}
	file := result.EmbeddedFiles[0]
	if file.MimeType != "image/png" || file.DecodedBytes != int64(len("png-bytes")) || file.SHA256 == "" {
		t.Fatalf("file = %+v, want decoded png metadata", file)
	}
	if file.AttachmentID == "" || file.StorageKey != AttachmentObjectKey("company-1", file.AttachmentID) {
		t.Fatalf("attachment mapping = id %q key %q", file.AttachmentID, file.StorageKey)
	}
	if strings.Contains(result.RewrittenPayload, "data:image/") || !strings.Contains(result.RewrittenPayload, "mango-attachment:"+file.AttachmentID) {
		t.Fatalf("rewritten payload = %q", result.RewrittenPayload)
	}

	second := ScanPayload(location, result.RewrittenPayload, ScanOptions{})
	if len(second.EmbeddedFiles) != 0 || second.RewrittenPayload != result.RewrittenPayload {
		t.Fatalf("second scan files=%d rewritten=%q", len(second.EmbeddedFiles), second.RewrittenPayload)
	}
}

func TestScanPayloadRewritesDurableDataURLFieldToAttachmentReference(t *testing.T) {
	dataURL := "data:application/pdf;base64," + base64.StdEncoding.EncodeToString([]byte("%PDF"))
	payload := `{"attachments":[{"id":"legacy-row","name":"contract.pdf","dataURL":"` + dataURL + `"}]}`

	result := ScanPayload(PayloadLocation{Table: "project_information", Column: "information", SourcePK: "pk", CompanyID: "company-1"}, payload, ScanOptions{})
	if len(result.EmbeddedFiles) != 1 {
		t.Fatalf("embedded files = %d, want 1", len(result.EmbeddedFiles))
	}
	if !result.HasSignal("durable_data_url_field") {
		t.Fatalf("signals = %#v, want durable_data_url_field", result.Signals)
	}
	var rewritten map[string][]map[string]any
	if err := json.Unmarshal([]byte(result.RewrittenPayload), &rewritten); err != nil {
		t.Fatalf("rewritten json: %v\n%s", err, result.RewrittenPayload)
	}
	attachment := rewritten["attachments"][0]
	if _, exists := attachment["dataURL"]; exists {
		t.Fatalf("rewritten attachment still has dataURL: %#v", attachment)
	}
	if attachment["attachment_id"] != result.EmbeddedFiles[0].AttachmentID {
		t.Fatalf("attachment_id = %#v, want %q", attachment["attachment_id"], result.EmbeddedFiles[0].AttachmentID)
	}
	if attachment["mime_type"] != "application/pdf" || attachment["byte_size"].(float64) != 4 {
		t.Fatalf("attachment metadata = %#v", attachment)
	}
}

func TestScanPayloadRewritesEmailAttachmentContent(t *testing.T) {
	payload := `{"attachments":[{"filename":"large.txt","content_type":"text/plain","content":"` + base64.StdEncoding.EncodeToString([]byte("hello")) + `"}]}`

	result := ScanPayload(PayloadLocation{Table: "communications_email_nodes", Column: "message", SourcePK: "pk", CompanyID: "company-1"}, payload, ScanOptions{})
	if len(result.EmbeddedFiles) != 1 {
		t.Fatalf("embedded files = %d, want 1", len(result.EmbeddedFiles))
	}
	if result.EmbeddedFiles[0].Kind != "email_attachment_content" {
		t.Fatalf("kind = %q", result.EmbeddedFiles[0].Kind)
	}
	if strings.Contains(result.RewrittenPayload, `"content"`) {
		t.Fatalf("rewritten payload still has content: %s", result.RewrittenPayload)
	}
	if !strings.Contains(result.RewrittenPayload, `"attachment_id"`) {
		t.Fatalf("rewritten payload missing attachment reference: %s", result.RewrittenPayload)
	}
}

func TestScanPayloadReportsLargeBase64MarkerWithoutDecodedFile(t *testing.T) {
	payload := strings.Repeat("x", 64) + " base64," + strings.Repeat("y", 64)
	result := ScanPayload(PayloadLocation{Table: "node_projection_table", Column: "information", SourcePK: "pk"}, payload, ScanOptions{LargePayloadBytes: 32})
	if !result.LargePayload || !result.HasSignal("large_payload_with_base64_marker") {
		t.Fatalf("large=%v signals=%#v", result.LargePayload, result.Signals)
	}
	if len(result.EmbeddedFiles) != 0 {
		t.Fatalf("embedded files = %d, want 0", len(result.EmbeddedFiles))
	}
}

func TestDeterministicAttachmentIDIsStableAndUUIDShaped(t *testing.T) {
	location := PayloadLocation{Table: "node_projection_table", Column: "information", SourcePK: "pk", CompanyID: "company-1"}
	first := DeterministicAttachmentID(location, "abc123", 1)
	second := DeterministicAttachmentID(location, "abc123", 1)
	if first != second {
		t.Fatalf("ids differ: %q %q", first, second)
	}
	if len(first) != 36 || first[14] != '5' {
		t.Fatalf("id = %q, want uuid v5-shaped", first)
	}
	if first == DeterministicAttachmentID(location, "abc123", 2) {
		t.Fatalf("different occurrence produced same id %q", first)
	}
}
