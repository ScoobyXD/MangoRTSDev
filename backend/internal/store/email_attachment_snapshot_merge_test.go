package store

import (
	"miraeopus/backend/internal/domain"
	"testing"
)

func TestMergeEmailMessageSnapshotMergesMixedAttachmentsByProviderID(t *testing.T) {
	tests := []struct {
		name     string
		existing domain.EmailMessageSnapshot
		incoming domain.EmailMessageSnapshot
		want     map[string]string
	}{
		{
			name: "worker completion preserves promoted local attachment and fills blank",
			existing: domain.EmailMessageSnapshot{ID: "sent-message", Attachments: []domain.EmailAttachmentSnapshot{
				{ID: "provider-one", AttachmentID: "local-one", Filename: "same.txt"},
				{ID: "provider-two", Filename: "same.txt"},
				{ID: "existing-only", AttachmentID: "existing-only-id", Filename: "existing.txt"},
			}},
			incoming: domain.EmailMessageSnapshot{ID: "sent-message", DownloadComplete: true, Attachments: []domain.EmailAttachmentSnapshot{
				{ID: "provider-one", AttachmentID: "downloaded-one", Filename: "same.txt"},
				{ID: "provider-two", AttachmentID: "downloaded-two", Filename: "same.txt"},
				{ID: "incoming-only", AttachmentID: "downloaded-three", Filename: "incoming.txt"},
			}},
			want: map[string]string{
				"provider-one": "local-one", "provider-two": "downloaded-two",
				"existing-only": "existing-only-id", "incoming-only": "downloaded-three",
			},
		},
		{
			name: "local promotion replaces matching import and retains provider-only attachment",
			existing: domain.EmailMessageSnapshot{ID: "sent-message", DownloadComplete: true, Attachments: []domain.EmailAttachmentSnapshot{
				{ID: "provider-one", AttachmentID: "downloaded-one", Filename: "same.txt"},
				{ID: "provider-two", AttachmentID: "downloaded-two", Filename: "same.txt"},
				{ID: "existing-only", AttachmentID: "existing-only-id", Filename: "existing.txt"},
			}},
			incoming: domain.EmailMessageSnapshot{ID: "sent-message", Attachments: []domain.EmailAttachmentSnapshot{
				{ID: "provider-one", AttachmentID: "local-one", Filename: "same.txt"},
				{ID: "provider-two", Filename: "same.txt"},
				{ID: "incoming-only", AttachmentID: "local-three", Filename: "incoming.txt"},
			}},
			want: map[string]string{
				"provider-one": "local-one", "provider-two": "downloaded-two",
				"existing-only": "existing-only-id", "incoming-only": "local-three",
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := mergeEmailMessageSnapshot(test.existing, test.incoming)
			if !got.DownloadComplete {
				t.Fatal("download_complete did not remain sticky")
			}
			if len(got.Attachments) != len(test.want) {
				t.Fatalf("attachments=%+v want %d", got.Attachments, len(test.want))
			}
			seen := make(map[string]bool, len(got.Attachments))
			for _, attachment := range got.Attachments {
				if seen[attachment.ID] {
					t.Fatalf("provider attachment %q was duplicated: %+v", attachment.ID, got.Attachments)
				}
				seen[attachment.ID] = true
				if wantID, ok := test.want[attachment.ID]; !ok || attachment.AttachmentID != wantID {
					t.Fatalf("attachment %q Mango ID=%q want=%q all=%+v", attachment.ID, attachment.AttachmentID, wantID, got.Attachments)
				}
			}
		})
	}
}
