package store

import (
	"encoding/base64"
	"miraeopus/backend/internal/domain"
	"strings"
	"testing"
	"time"
)

func TestMemoryAttachmentUploadIntentIdempotencyAndPayloadConflict(t *testing.T) {
	repo := NewMemoryRepo()
	company, err := repo.CreateCompany("Direct uploads")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	input := testAttachmentUploadIntentInput(company.CompanyID, now, domain.AttachmentUploadStrategySingle)
	first, created, err := repo.CreateAttachmentUploadIntent(input)
	if err != nil || !created {
		t.Fatalf("first create = (%+v, %v, %v), want created", first, created, err)
	}
	second, created, err := repo.CreateAttachmentUploadIntent(input)
	if err != nil || created || second.UploadIntentID != first.UploadIntentID || second.AttachmentID != first.AttachmentID {
		t.Fatalf("idempotent create = (%+v, %v, %v), want same intent", second, created, err)
	}
	width := 640
	input.OriginalWidth = &width
	if _, _, err := repo.CreateAttachmentUploadIntent(input); err != ErrUploadPayloadConflict {
		t.Fatalf("changed idempotency payload error = %v, want %v", err, ErrUploadPayloadConflict)
	}
}

func TestMemoryAttachmentUploadMultipartPartsClaimAndFinalize(t *testing.T) {
	repo := NewMemoryRepo()
	company, err := repo.CreateCompany("Multipart uploads")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	input := testAttachmentUploadIntentInput(company.CompanyID, now, domain.AttachmentUploadStrategyMultipart)
	intent, _, err := repo.CreateAttachmentUploadIntent(input)
	if err != nil {
		t.Fatal(err)
	}
	checksum := base64.StdEncoding.EncodeToString(make([]byte, 32))
	requested := make([]domain.AttachmentUploadPart, 0, intent.PartCount)
	for partNumber := 1; partNumber <= intent.PartCount; partNumber++ {
		requested = append(requested, domain.AttachmentUploadPart{PartNumber: partNumber, ChecksumAlgorithm: "SHA256", ExpectedChecksum: checksum})
	}
	parts, err := repo.UpsertAttachmentUploadParts(AttachmentUploadPartsInput{CompanyID: company.CompanyID,
		ActorUserID: intent.ActorUserID, UploadIntentID: intent.UploadIntentID, Parts: requested, Now: now.Add(time.Minute)})
	if err != nil {
		t.Fatal(err)
	}
	if len(parts) != intent.PartCount || parts[0].SigningAttemptCount != 1 || parts[0].LastSignedTimestamp == nil {
		t.Fatalf("signed parts = %+v", parts)
	}
	if parts[len(parts)-1].ExpectedSizeBytes != 1 {
		t.Fatalf("last expected size = %d, want 1", parts[len(parts)-1].ExpectedSizeBytes)
	}
	observed := make([]domain.AttachmentUploadPart, 0, len(parts))
	for _, part := range parts {
		observed = append(observed, domain.AttachmentUploadPart{PartNumber: part.PartNumber,
			ObservedSizeBytes: part.ExpectedSizeBytes, ETag: "etag", S3Checksum: checksum})
	}
	parts, err = repo.ReplaceAttachmentUploadObservedParts(AttachmentUploadObservedPartsInput{CompanyID: company.CompanyID,
		ActorUserID: intent.ActorUserID, UploadIntentID: intent.UploadIntentID, Parts: observed, Now: now.Add(2 * time.Minute)})
	if err != nil || parts[0].ObservedSizeBytes != parts[0].ExpectedSizeBytes {
		t.Fatalf("observed parts = (%+v, %v)", parts, err)
	}
	completing, claimed, err := repo.BeginAttachmentUploadCompletion(AttachmentUploadTransitionInput{CompanyID: company.CompanyID,
		ActorUserID: intent.ActorUserID, UploadIntentID: intent.UploadIntentID, Now: now.Add(3 * time.Minute)})
	if err != nil || !claimed || completing.Status != domain.AttachmentUploadStatusCompleting {
		t.Fatalf("completion claim = (%+v, %v, %v)", completing, claimed, err)
	}
	_, claimed, err = repo.BeginAttachmentUploadCompletion(AttachmentUploadTransitionInput{CompanyID: company.CompanyID,
		ActorUserID: intent.ActorUserID, UploadIntentID: intent.UploadIntentID, Now: now.Add(3*time.Minute + time.Second)})
	if err != nil || claimed {
		t.Fatalf("concurrent completion claim = (%v, %v), want unclaimed", claimed, err)
	}
	attachment, link, err := repo.FinalizeAttachmentUpload(AttachmentUploadFinalizeInput{CompanyID: company.CompanyID,
		ActorUserID: intent.ActorUserID, UploadIntentID: intent.UploadIntentID, SHA256VerificationMethod: "client_reported",
		StorageChecksumAlgorithm: "SHA256", StorageChecksumValue: checksum + "-5", StorageChecksumType: "COMPOSITE", Now: now.Add(4 * time.Minute)})
	if err != nil {
		t.Fatal(err)
	}
	if attachment.AttachmentID != intent.AttachmentID || attachment.SHA256 != intent.SHA256 || attachment.SHA256VerificationMethod != "client_reported" {
		t.Fatalf("attachment = %+v", attachment)
	}
	if link.ResourceType != "node" || link.ResourceID != input.ResourceID {
		t.Fatalf("resource link = %+v", link)
	}
	if _, err := repo.LinkResourceAttachment(ResourceAttachmentInput{CompanyID: company.CompanyID, ResourceType: "node",
		ResourceID: attachmentUploadUUIDForTest(), AttachmentID: attachment.AttachmentID,
		RelationshipKind: AttachmentRelationshipFileAttachment, CreatedByUserID: intent.ActorUserID}); err != nil {
		t.Fatalf("add secondary resource link: %v", err)
	}
	replayedAttachment, replayedLink, err := repo.FinalizeAttachmentUpload(AttachmentUploadFinalizeInput{CompanyID: company.CompanyID,
		ActorUserID: intent.ActorUserID, UploadIntentID: intent.UploadIntentID, Now: now.Add(5 * time.Minute)})
	if err != nil || replayedAttachment.AttachmentID != attachment.AttachmentID || replayedLink.ResourceAttachmentID != link.ResourceAttachmentID {
		t.Fatalf("finalize replay = (%+v, %+v, %v)", replayedAttachment, replayedLink, err)
	}
}

func TestMemoryAttachmentUploadExpiryScanKeepsIntentCleanupEligible(t *testing.T) {
	repo := NewMemoryRepo()
	company, err := repo.CreateCompany("Expiry")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	input := testAttachmentUploadIntentInput(company.CompanyID, now, domain.AttachmentUploadStrategySingle)
	intent, _, err := repo.CreateAttachmentUploadIntent(input)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.BeginAttachmentUploadCompletion(AttachmentUploadTransitionInput{CompanyID: company.CompanyID,
		ActorUserID: intent.ActorUserID, UploadIntentID: intent.UploadIntentID, Now: input.ExpiresTimestamp.Add(time.Second)}); err != ErrUploadIntentExpired {
		t.Fatalf("expired transition error = %v, want %v", err, ErrUploadIntentExpired)
	}
	items, err := repo.ListExpiredAttachmentUploadIntents(input.ExpiresTimestamp.Add(time.Second), 10)
	if err != nil || len(items) != 1 || items[0].UploadIntentID != intent.UploadIntentID {
		t.Fatalf("expired scan = (%+v, %v)", items, err)
	}
	expired, err := repo.ExpireAttachmentUploadIntent(intent.UploadIntentID, input.ExpiresTimestamp.Add(2*time.Second))
	if err != nil || expired.Status != domain.AttachmentUploadStatusExpired {
		t.Fatalf("expire = (%+v, %v)", expired, err)
	}
}

func TestMemoryAttachmentUploadFailedAndAbortTransitions(t *testing.T) {
	repo := NewMemoryRepo()
	company, err := repo.CreateCompany("Failure transitions")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	input := testAttachmentUploadIntentInput(company.CompanyID, now, domain.AttachmentUploadStrategySingle)
	intent, _, err := repo.CreateAttachmentUploadIntent(input)
	if err != nil {
		t.Fatal(err)
	}
	intent, claimed, err := repo.BeginAttachmentUploadCompletion(AttachmentUploadTransitionInput{CompanyID: company.CompanyID,
		ActorUserID: intent.ActorUserID, UploadIntentID: intent.UploadIntentID, Now: now.Add(time.Minute)})
	if err != nil || !claimed {
		t.Fatalf("claim = (%v, %v)", claimed, err)
	}
	intent, err = repo.FailAttachmentUploadIntent(AttachmentUploadTransitionInput{CompanyID: company.CompanyID,
		ActorUserID: intent.ActorUserID, UploadIntentID: intent.UploadIntentID, Now: now.Add(2 * time.Minute)}, "checksum_mismatch")
	if err != nil || intent.Status != domain.AttachmentUploadStatusFailed || intent.FailureCode != "checksum_mismatch" {
		t.Fatalf("fail = (%+v, %v)", intent, err)
	}
	if _, claimed, err := repo.BeginAttachmentUploadCompletion(AttachmentUploadTransitionInput{CompanyID: company.CompanyID,
		ActorUserID: intent.ActorUserID, UploadIntentID: intent.UploadIntentID, Now: now.Add(3 * time.Minute)}); err != ErrUploadStateConflict || claimed {
		t.Fatalf("failed completion = (claimed=%v, err=%v)", claimed, err)
	}
	intent, err = repo.AbortAttachmentUploadIntent(AttachmentUploadTransitionInput{CompanyID: company.CompanyID,
		ActorUserID: intent.ActorUserID, UploadIntentID: intent.UploadIntentID, Now: now.Add(4 * time.Minute)})
	if err != nil || intent.Status != domain.AttachmentUploadStatusAborted {
		t.Fatalf("abort failed intent = (%+v, %v)", intent, err)
	}
}

func testAttachmentUploadIntentInput(companyID string, now time.Time, strategy string) AttachmentUploadIntentCreateInput {
	input := AttachmentUploadIntentCreateInput{
		UploadIntentID: attachmentUploadUUIDForTest(), CompanyID: companyID, ActorUserID: attachmentUploadUUIDForTest(),
		ClientRequestID: "client-request", AttachmentID: attachmentUploadUUIDForTest(), OriginalFilename: "report.pdf",
		MimeType: "application/pdf", SizeBytes: 1024, SHA256: strings.Repeat("a", 64), ResourceType: "node",
		ResourceID: attachmentUploadUUIDForTest(), RelationshipKind: AttachmentRelationshipFileAttachment,
		SourceKind: AttachmentSourceUserUpload, StorageBucket: "private-attachments", StorageKey: "companies/test/attachment/original",
		Strategy: strategy, ExpiresTimestamp: now.Add(time.Hour), CreatedTimestamp: now,
	}
	if strategy == domain.AttachmentUploadStrategyMultipart {
		input.SizeBytes = 64*1024*1024 + 1
		input.PartSizeBytes = 16 * 1024 * 1024
		input.PartCount = 5
		input.MultipartUploadID = "provider-upload-id"
	}
	return input
}

func attachmentUploadUUIDForTest() string { return newUUIDv7String() }
