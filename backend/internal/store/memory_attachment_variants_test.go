package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"testing"
	"time"
)

func TestMemoryAttachmentVariantUpsertIsIdempotentAndContentReadFallsBack(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111111"
	repo.EnsureCompany(companyID, "Variant Company")
	node, err := repo.CreateNode(companyID, "Variant Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	originalSHA := sha256.Sum256([]byte("original"))
	attachment, _, err := repo.CreateAttachmentWithResourceLink(AttachmentCreateInput{
		CompanyID: companyID, OriginalFilename: "image.png", MimeType: "image/png", ByteSize: 8,
		SHA256: hex.EncodeToString(originalSHA[:]), StorageBucket: "bucket", StorageKey: "original-key",
		SourceKind: AttachmentSourceUserUpload,
		ResourceLink: ResourceAttachmentInput{CompanyID: companyID, ResourceType: "node", ResourceID: node.NodeID,
			RelationshipKind: AttachmentRelationshipInlineImage},
	})
	if err != nil {
		t.Fatalf("CreateAttachmentWithResourceLink: %v", err)
	}

	fallback, err := repo.ReadAttachmentContent(context.Background(), companyID, attachment.AttachmentID, AttachmentVariantDisplay)
	if err != nil {
		t.Fatalf("ReadAttachmentContent fallback: %v", err)
	}
	if fallback.ServedVariant != AttachmentVariantOriginal || fallback.StorageKey != "original-key" || len(fallback.ResourceLinks) != 1 {
		t.Fatalf("fallback content = %+v", fallback)
	}

	variantSHA := sha256.Sum256([]byte("display"))
	variantHash := hex.EncodeToString(variantSHA[:])
	generation := 1
	width, height := 800, 600
	created := time.Date(2026, 7, 12, 1, 2, 3, 0, time.UTC)
	input := AttachmentVariantInput{AttachmentID: attachment.AttachmentID, VariantType: AttachmentVariantDisplay,
		MimeType: "image/jpeg", ByteSize: 7, SHA256: &variantHash, GenerationVersion: &generation,
		Width: &width, Height: &height, StorageBucket: "bucket", StorageKey: "display-v1-key", CreatedTimestamp: created}
	first, err := repo.UpsertAttachmentVariants(context.Background(), companyID, []AttachmentVariantInput{input})
	if err != nil {
		t.Fatalf("first UpsertAttachmentVariants: %v", err)
	}
	input.CreatedTimestamp = created.Add(time.Hour)
	second, err := repo.UpsertAttachmentVariants(context.Background(), companyID, []AttachmentVariantInput{input})
	if err != nil {
		t.Fatalf("second UpsertAttachmentVariants: %v", err)
	}
	if !first[0].CreatedTimestamp.Equal(created) || !second[0].CreatedTimestamp.Equal(created) ||
		!second[0].UpdatedTimestamp.Equal(first[0].UpdatedTimestamp) {
		t.Fatalf("idempotent timestamps changed: first=%+v second=%+v", first[0], second[0])
	}

	display, err := repo.ReadAttachmentContent(context.Background(), companyID, attachment.AttachmentID, AttachmentVariantDisplay)
	if err != nil {
		t.Fatalf("ReadAttachmentContent display: %v", err)
	}
	if display.ServedVariant != AttachmentVariantDisplay || display.StorageKey != "display-v1-key" || display.SHA256 != variantHash || display.GenerationVersion != 1 {
		t.Fatalf("display content = %+v", display)
	}
}
