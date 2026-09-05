package httpapi

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

type attachmentRetirementBoundaryRepo struct {
	store.Repository
	beforeCommit  func()
	fail          bool
	partialCommit bool
}

func (r *attachmentRetirementBoundaryRepo) SoftDeleteCommunicationsEmailDraft(input store.CommunicationsEmailDraftDeleteInput) error {
	r.beforeCommit()
	if r.fail {
		return errors.New("draft commit failed")
	}
	return r.Repository.SoftDeleteCommunicationsEmailDraft(input)
}

func (r *attachmentRetirementBoundaryRepo) PermanentlyDeleteRecycleBinItems(companyID, userID string, itemIDs []string) error {
	r.beforeCommit()
	if r.fail {
		return errors.New("purge commit failed")
	}
	return r.Repository.PermanentlyDeleteRecycleBinItems(companyID, userID, itemIDs)
}

func (r *attachmentRetirementBoundaryRepo) RestoreNodeEditorSaveVersion(input store.EditorSaveVersionRestoreInput) (domain.EditorSaveVersion, error) {
	r.beforeCommit()
	if r.partialCommit {
		input.AfterDeleteCommit()
	}
	return domain.EditorSaveVersion{}, errors.New("history restore failed")
}

func (r *attachmentRetirementBoundaryRepo) DeleteProcessMapPlacement(context.Context, store.ProcessMapPlacementDeleteInput) (store.ProcessMapMutationEnvelope, error) {
	r.beforeCommit()
	return store.ProcessMapMutationEnvelope{Changed: r.partialCommit}, errors.New("map command failed")
}

func assertAttachmentRetirementWake(t *testing.T, server *Server, want bool) {
	t.Helper()
	select {
	case <-server.attachmentDeletionCleanupWake:
		if !want {
			t.Fatal("attachment cleanup woke without a committed retirement")
		}
	default:
		if want {
			t.Fatal("committed retirement did not wake attachment cleanup")
		}
	}
}

func TestAttachmentDraftDiscardWakesOnlyAfterCommit(t *testing.T) {
	fixture := newCommunicationsEmailDraftScopeHTTPFixture(t)
	storage := newFakeAttachmentObjectStorage()
	const draftID = "attachment-wake-draft"
	attachmentID := seedLiveEmailDraftAttachmentForCommunicationsTest(t, fixture.repo, storage,
		fixture.owner.UserID, fixture.companyID, "owner-a@example.com", draftID, "draft.txt", "text/plain", []byte("draft"))
	repo := &attachmentRetirementBoundaryRepo{Repository: fixture.repo, fail: true}
	server := NewServer(repo)
	defer server.Close()
	repo.beforeCommit = func() { assertAttachmentRetirementWake(t, server, false) }
	fixture.handler = server.Routes()
	path := fixture.draftByIDPath(draftID, "owner-a@example.com", "")
	fixture.expectStatus(t, http.MethodDelete, path, nil, fixture.owner, domain.RoleCompanyUser, http.StatusInternalServerError)
	assertAttachmentRetirementWake(t, server, false)
	if _, err := fixture.repo.GetAttachment(fixture.companyID, attachmentID); err != nil {
		t.Fatalf("failed draft deletion changed its live attachment: %v", err)
	}
	repo.fail = false
	fixture.expectStatus(t, http.MethodDelete, path, nil, fixture.owner, domain.RoleCompanyUser, http.StatusOK)
	assertAttachmentRetirementWake(t, server, true)
	if _, err := fixture.repo.GetAttachment(fixture.companyID, attachmentID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("final draft owner was not retired: %v", err)
	}
	if len(storage.objects) != 1 {
		t.Fatal("draft discard removed bytes before the cleanup consumer")
	}
}

func TestAttachmentHuddleDeleteAndPermanentPurgeWakeCleanup(t *testing.T) {
	fixture := newCommunicationsEmailDraftScopeHTTPFixture(t)
	boardID := createHuddleLogicGateForHTTPTest(t, fixture.repo, fixture.companyID)
	node, err := fixture.repo.CreateHuddleNode(store.HuddleCreateInput{
		CompanyID: fixture.companyID, OwnerID: boardID, Name: "Wake cleanup", ActorID: fixture.manager.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	repo := &attachmentRetirementBoundaryRepo{Repository: fixture.repo}
	server := NewServer(repo)
	defer server.Close()
	repo.beforeCommit = func() { assertAttachmentRetirementWake(t, server, false) }
	fixture.handler = server.Routes()
	for _, path := range []string{
		"/v1/huddle-nodes/" + node.HuddleNodeID + "?company_id=" + fixture.companyID,
		"/v1/huddle-logic-gates/" + boardID + "?company_id=" + fixture.companyID,
	} {
		fixture.expectStatus(t, http.MethodDelete, path, nil, fixture.manager, domain.RoleCompanyAdmin, http.StatusOK)
		assertAttachmentRetirementWake(t, server, true)
	}
	items, err := fixture.repo.ListRecycleBinItems(fixture.companyID, "")
	if err != nil || len(items) != 2 {
		t.Fatalf("recycled Huddle resources=%+v err=%v", items, err)
	}
	body := map[string]any{
		"company_id": fixture.companyID, "item_ids": []string{items[0].RecycleBinItemID, items[1].RecycleBinItemID},
		"confirmation_display_name": fixture.manager.DisplayName,
	}
	repo.fail = true
	fixture.expectStatus(t, http.MethodPost, "/v1/recycle-bin/delete", body, fixture.manager, domain.RoleCompanyAdmin, http.StatusInternalServerError)
	assertAttachmentRetirementWake(t, server, false)
	repo.fail = false
	fixture.expectStatus(t, http.MethodPost, "/v1/recycle-bin/delete", body, fixture.manager, domain.RoleCompanyAdmin, http.StatusOK)
	assertAttachmentRetirementWake(t, server, true)
}

func TestAttachmentPartialCommitWakesDespiteLaterCommandFailure(t *testing.T) {
	for _, committed := range []bool{false, true} {
		t.Run(map[bool]string{false: "no commit", true: "partial commit"}[committed], func(t *testing.T) {
			fixture := newCommunicationsEmailDraftScopeHTTPFixture(t)
			node, err := fixture.repo.CreateNode(fixture.companyID, "Restore boundary")
			if err != nil {
				t.Fatal(err)
			}
			repo := &attachmentRetirementBoundaryRepo{Repository: fixture.repo, partialCommit: committed}
			server := NewServer(repo)
			defer server.Close()
			repo.beforeCommit = func() { assertAttachmentRetirementWake(t, server, false) }
			fixture.handler = server.Routes()
			fixture.expectStatus(t, http.MethodPost,
				"/v1/nodes/"+node.NodeID+"/save-versions/"+store.NewUUIDv7String()+"/restore",
				map[string]any{"company_id": fixture.companyID}, fixture.manager, domain.RoleCompanyAdmin, http.StatusInternalServerError)
			assertAttachmentRetirementWake(t, server, committed)
			fixture.expectStatus(t, http.MethodDelete,
				"/v1/process-map/placements/company_explorer_folder/"+store.NewUUIDv7String()+"?company_id="+fixture.companyID,
				nil, fixture.manager, domain.RoleCompanyAdmin, http.StatusInternalServerError)
			assertAttachmentRetirementWake(t, server, committed)
		})
	}
}

type attachmentIngestionRetirementRepo struct {
	store.Repository
	t               *testing.T
	server          *Server
	providerMessage string
	convergenceErr  error
	convergences    int
}

func (r *attachmentIngestionRetirementRepo) ConvergeCommunicationsEmailThreadAttachmentLinksContext(ctx context.Context, companyID, threadID string) (bool, error) {
	thread, err := r.Repository.GetCommunicationsEmailThreadContext(ctx, companyID, threadID)
	message, exists := storedEmailMessageForProvider(thread, r.providerMessage)
	if err != nil || !exists || !message.Message.DownloadComplete {
		r.t.Fatalf("attachment retirement preceded committed message completion: %+v err=%v", message, err)
	}
	assertAttachmentRetirementWake(r.t, r.server, false)
	r.convergences++
	return true, r.convergenceErr
}

func TestAttachmentEmailWorkerRetiresCompletedMessageBeforeLaterFetchFails(t *testing.T) {
	for _, failRetirement := range []bool{false, true} {
		t.Run(map[bool]string{false: "committed retirement", true: "failed retirement"}[failRetirement], func(t *testing.T) {
			base, job, client := newEmailOutboxBoundaryFixture(t)
			trigger := client.messagesByID[job.ProviderMessageID]
			trigger.ThreadID = "attachment-wake-thread"
			client.messagesByID[job.ProviderMessageID] = trigger
			client.threadsByID[trigger.ThreadID] = NylasThread{ID: trigger.ThreadID, MessageIDs: []string{trigger.ID, "later-failed-message"}}
			client.messageErrorsByID["later-failed-message"] = errors.New("later fetch failed")
			repo := &attachmentIngestionRetirementRepo{Repository: base, t: t, providerMessage: trigger.ID}
			if failRetirement {
				repo.convergenceErr = errors.New("attachment retirement commit failed")
			}
			server := NewServerWithOptions(repo, ServerOptions{
				NylasClient: client, NylasConfig: testNylasConfig(), EmailWorkerOnly: true,
				DisableAttachmentUploadCleanup: true, DisableNotificationCleanup: true, DisableRealtimeSpine: true,
			})
			defer server.Close()
			repo.server = server
			server.nylasGate = newNylasRequestGate(0)
			if err := server.processCommunicationsEmailIngestionProviderWork(context.Background(), job); err == nil {
				t.Fatal("expected the later provider or retirement failure")
			}
			if repo.convergences != 1 {
				t.Fatalf("retirement commits=%d, want one before the next message fetch", repo.convergences)
			}
			assertAttachmentRetirementWake(t, server, !failRetirement)
		})
	}
}
