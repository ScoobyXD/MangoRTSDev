package store

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestMemoryListAttachmentResourceLinksPreservesAttachmentExistenceSemantics(t *testing.T) {
	t.Run("existing attachment with only deleted links returns empty", func(t *testing.T) {
		repo, companyID, nodeID, attachmentID := newMemoryAttachmentLinkFixture(t)
		if err := repo.SoftDeleteResourceAttachment(ResourceAttachmentDeleteInput{
			CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: nodeID, AttachmentID: attachmentID,
		}); err != nil {
			t.Fatalf("SoftDeleteResourceAttachment: %v", err)
		}

		links, err := repo.ListAttachmentResourceLinks(companyID, attachmentID)
		if err != nil {
			t.Fatalf("ListAttachmentResourceLinks: %v", err)
		}
		if len(links) != 0 {
			t.Fatalf("links = %+v, want empty", links)
		}
	})

	t.Run("wrong company and missing attachment are concealed", func(t *testing.T) {
		repo, companyID, _, attachmentID := newMemoryAttachmentLinkFixture(t)
		otherCompanyID := "22222222-2222-4222-8222-222222222222"
		repo.EnsureCompany(otherCompanyID, "Other Company")

		if _, err := repo.ListAttachmentResourceLinks(otherCompanyID, attachmentID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("wrong-company error = %v, want ErrNotFound", err)
		}
		if _, err := repo.ListAttachmentResourceLinks(companyID, NewUUIDv7String()); !errors.Is(err, ErrNotFound) {
			t.Fatalf("missing-attachment error = %v, want ErrNotFound", err)
		}
	})

	t.Run("soft-deleted attachment is concealed", func(t *testing.T) {
		repo, companyID, _, attachmentID := newMemoryAttachmentLinkFixture(t)
		key := attachmentKey(companyID, attachmentID)
		repo.mu.Lock()
		attachment := repo.attachments[key]
		deleted := time.Now().UTC()
		attachment.DeletedTimestamp = &deleted
		repo.attachments[key] = attachment
		repo.mu.Unlock()

		if _, err := repo.ListAttachmentResourceLinks(companyID, attachmentID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("soft-deleted attachment error = %v, want ErrNotFound", err)
		}
	})
}

func newMemoryAttachmentLinkFixture(t *testing.T) (*MemoryRepo, string, string, string) {
	t.Helper()
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111111"
	repo.EnsureCompany(companyID, "Attachment Link Company")
	node, err := repo.CreateNode(companyID, "Attachment Link Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	attachmentID := NewUUIDv7String()
	_, _, err = repo.CreateAttachmentWithResourceLink(AttachmentCreateInput{
		CompanyID: companyID, AttachmentID: attachmentID, OriginalFilename: "link.txt", MimeType: "text/plain",
		ByteSize: 1, SHA256: strings.Repeat("a", 64), StorageBucket: "attachment-link-bucket",
		StorageKey: "companies/" + companyID + "/attachments/" + attachmentID + "/original",
		SourceKind: AttachmentSourceUserUpload,
		ResourceLink: ResourceAttachmentInput{
			CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID,
			RelationshipKind: AttachmentRelationshipFileAttachment,
		},
	})
	if err != nil {
		t.Fatalf("CreateAttachmentWithResourceLink: %v", err)
	}
	return repo, companyID, node.NodeID, attachmentID
}
