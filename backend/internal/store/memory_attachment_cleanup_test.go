package store

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"miraeopus/backend/internal/attachmentcleanup"
	"miraeopus/backend/internal/domain"
)

func TestMemoryAttachmentCleanupUnrelatedRecycleDoesNotProtectAttachment(t *testing.T) {
	repo, companyID, nodeID, attachmentID := newMemoryAttachmentLinkFixture(t)
	huddle, err := repo.CreateHuddleLogicGate(HuddleCreateInput{CompanyID: companyID, Name: "Unrelated Huddle"})
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.DeleteHuddleLogicGate(companyID, huddle.HuddleLogicGateID, ""); err != nil {
		t.Fatal(err)
	}
	if err := repo.SoftDeleteResourceAttachment(ResourceAttachmentDeleteInput{CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: nodeID, AttachmentID: attachmentID}); err != nil {
		t.Fatal(err)
	}
	work, err := repo.ListWork(context.Background(), companyID, "", 100)
	if err != nil || len(work) != 1 || work[0].AttachmentID != attachmentID {
		t.Fatalf("unrelated full recycle snapshot protected orphan: %v err=%v", work, err)
	}
}

func TestMemoryAttachmentCleanupHuddleNodeDeltaProtectsOriginalAndSharedKey(t *testing.T) {
	repo, companyID, _, attachmentID := newMemoryAttachmentLinkFixture(t)
	attachment := repo.attachments[attachmentKey(companyID, attachmentID)]
	deleted := time.Now().UTC()
	attachment.DeletedTimestamp = &deleted
	repo.attachments[attachmentKey(companyID, attachmentID)] = attachment
	for id, link := range repo.resourceAttachments {
		link.DeletedTimestamp = &deleted
		repo.resourceAttachments[id] = link
	}
	recycleID := NewUUIDv7String()
	repo.recycleBin[key(companyID, recycleID)] = memoryRecycleBinItem{
		Item:     domain.RecycleBinItem{CompanyID: companyID, RecycleBinItemID: recycleID, ObjectKind: EntityTypeHuddleNode},
		UseDelta: true, Delta: memoryRecycleBinSnapshot{attachments: map[string]domain.Attachment{attachmentKey(companyID, attachmentID): attachment}},
	}
	item := attachmentcleanup.WorkItem{Kind: attachmentcleanup.WorkOrphanAttachment, CompanyID: companyID, AttachmentID: attachmentID}
	if eligible, err := repo.Eligible(context.Background(), item); err != nil || eligible {
		t.Fatalf("Huddle Node delta must protect original: eligible=%v err=%v", eligible, err)
	}
	if err := repo.Finalize(context.Background(), item); !errors.Is(err, attachmentcleanup.ErrStillOwned) {
		t.Fatalf("recycled finalization err=%v", err)
	}
	if shared, err := repo.SharedWithRetained(context.Background(), item, attachmentcleanup.ObjectRef{Bucket: attachment.StorageBucket, Key: attachment.StorageKey}); err != nil || !shared {
		t.Fatalf("recycled original must protect a shared key: shared=%v err=%v", shared, err)
	}
}

func TestMemoryAttachmentCleanupTextboxRemovalRetiresChatAndPreservesUploadOrigin(t *testing.T) {
	repo, companyID, nodeID, originAttachmentID := newMemoryAttachmentLinkFixture(t)
	textboxID, chatID, chatAttachmentID := NewUUIDv7String(), NewUUIDv7String(), NewUUIDv7String()
	chatBody, _ := json.Marshal(textboxChatPayload{BlockID: textboxID})
	repo.nodeText[key(companyID, nodeID)] = map[string]domain.NodeProjection{}
	repo.nodeText[key(companyID, nodeID)][textboxID] = domain.NodeProjection{CompanyID: companyID, NodeID: nodeID, InformationID: textboxID, Type: "Text box"}
	repo.nodeText[key(companyID, nodeID)][chatID] = domain.NodeProjection{CompanyID: companyID, NodeID: nodeID, InformationID: chatID, Type: "Text block chat", Information: string(chatBody)}
	for id, link := range repo.resourceAttachments {
		link.InformationID = textboxID // Upload origin does not change the Node owner.
		repo.resourceAttachments[id] = link
	}
	chatAttachment := repo.attachments[attachmentKey(companyID, originAttachmentID)]
	chatAttachment.AttachmentID = chatAttachmentID
	repo.attachments[attachmentKey(companyID, chatAttachmentID)] = chatAttachment
	repo.resourceAttachments[NewUUIDv7String()] = domain.ResourceAttachment{CompanyID: companyID, ResourceType: "node_chat_message", ResourceID: chatID, AttachmentID: chatAttachmentID}
	repo.mu.Lock()
	repo.deleteEditorProjectionLocked(EditorDocumentRef{CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: nodeID, DocumentID: textboxID})
	repo.mu.Unlock()
	if _, err := repo.GetAttachment(companyID, originAttachmentID); err != nil {
		t.Fatalf("textbox upload-origin removal retired Node-owned attachment: %v", err)
	}
	if _, err := repo.GetAttachment(companyID, chatAttachmentID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted chat's final-owner attachment err=%v", err)
	}
}
