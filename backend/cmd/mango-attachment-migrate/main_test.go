package main

import (
	"context"
	"strings"
	"testing"

	"miraeopus/backend/internal/attachments/migration"
)

func TestBuildReportInventoriesInlineAttachmentBytes(t *testing.T) {
	row := candidateRow{
		Location: migration.PayloadLocation{
			Table:         "node_textboxes",
			Column:        "body_json",
			SourcePK:      "11111111-1111-1111-1111-111111111111|22222222-2222-2222-2222-222222222222|33333333-3333-4333-8333-333333333333",
			CompanyID:     "11111111-1111-1111-1111-111111111111",
			ResourceType:  "node",
			ResourceID:    "22222222-2222-2222-2222-222222222222",
			InformationID: "33333333-3333-4333-8333-333333333333",
		},
		Payload: `<img src="data:image/png;base64,aGVsbG8=">`,
	}

	rep := buildReport(commandConfig{LargePayloadBytes: 1024}, []candidateRow{row})
	if !rep.DryRun || rep.Apply {
		t.Fatalf("dry-run flags = dry_run:%v apply:%v", rep.DryRun, rep.Apply)
	}
	if rep.ScannedRows != 1 || rep.AffectedRows != 1 || rep.EmbeddedFileCount != 1 || rep.EstimatedBytes != int64(len("hello")) {
		t.Fatalf("report counts = scanned:%d affected:%d files:%d bytes:%d", rep.ScannedRows, rep.AffectedRows, rep.EmbeddedFileCount, rep.EstimatedBytes)
	}
	if len(rep.Results) != 1 || len(rep.Results[0].EmbeddedFiles) != 1 {
		t.Fatalf("results = %+v, want one embedded file", rep.Results)
	}
	file := rep.Results[0].EmbeddedFiles[0]
	if file.AttachmentID == "" || file.StorageKey != migration.AttachmentObjectKey(row.Location.CompanyID, file.AttachmentID) {
		t.Fatalf("file mapping = %+v, want deterministic attachment object key", file)
	}
	if strings.Contains(rep.Results[0].RewrittenPayload, "data:image/") || !strings.Contains(rep.Results[0].RewrittenPayload, "mango-attachment:"+file.AttachmentID) {
		t.Fatalf("rewritten payload = %q", rep.Results[0].RewrittenPayload)
	}
}

func TestRunApplyRequiresExplicitConfirmationBeforeDBConfig(t *testing.T) {
	var output strings.Builder
	err := run(context.Background(), []string{"-apply", "-company-id=11111111-1111-1111-1111-111111111111"}, func(string) string { return "" }, &output)
	if err == nil || !strings.Contains(err.Error(), "-confirm-apply="+applyConfirmation) {
		t.Fatalf("error = %v, want apply confirmation error before DB config", err)
	}
}

func TestCandidateSourcesConsumeStandardQueryArguments(t *testing.T) {
	for _, source := range candidateSources() {
		for _, placeholder := range []string{"$1", "$2", "$3"} {
			if !strings.Contains(source.Query, placeholder) {
				t.Fatalf("%s.%s query does not consume %s:\n%s", source.Table, source.Column, placeholder, source.Query)
			}
		}
	}
}

func TestCandidateSourcesUseV3NodeAndEmailTables(t *testing.T) {
	joined := ""
	for _, source := range candidateSources() {
		joined += source.Table + "." + source.Column + "\n" + source.Query + "\n"
	}
	for _, required := range []string{
		"node_textboxes.body_json",
		"node_textbox_seen_snapshots.body_json",
		"email_messages.attachment_metadata",
		"email_messages.rich_html_body",
		"email_drafts.body_editor_html",
	} {
		if !strings.Contains(joined, required) {
			t.Fatalf("V3 attachment sources missing %q", required)
		}
	}
	for _, retired := range []string{
		"node_information",
		"node_projection_table",
		"node_projection_seen_snapshots",
		"communications_email_nodes",
		"communications_email_node_attachments",
		"attached_email",
	} {
		if strings.Contains(joined, retired) {
			t.Fatalf("attachment sources still reference retired storage %q", retired)
		}
	}
}
