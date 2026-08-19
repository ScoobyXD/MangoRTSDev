package store

import (
	"errors"
	"miraeopus/backend/internal/domain"
	"testing"
	"time"
)

func TestMemoryNodeGraphWorkspaceEventsAreDurableAndReplayable(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"

	node, event, err := repo.CreateNodeWithWorkspaceEvent(companyID, "Alpha")
	if err != nil {
		t.Fatalf("CreateNodeWithWorkspaceEvent: %v", err)
	}
	if event.Type != "node_created" || event.Sequence != 1 || event.Payload["node_id"] != node.NodeID {
		t.Fatalf("node create event = %+v, node_id payload=%v", event, event.Payload["node_id"])
	}

	updated, event, err := repo.UpdateNodeAndWorkspaceEvent(UpdateNodeInput{CompanyID: companyID, NodeID: node.NodeID, Title: "Alpha updated", TitleSet: true})
	if err != nil {
		t.Fatalf("UpdateNodeAndWorkspaceEvent: %v", err)
	}
	if updated.Title != "Alpha updated" || event.Type != "node_updated" || event.Sequence != 2 || event.Payload["node_id"] != node.NodeID {
		t.Fatalf("node update result = %+v event = %+v", updated, event)
	}

	other, err := repo.CreateNode(companyID, "Beta")
	if err != nil {
		t.Fatalf("CreateNode setup: %v", err)
	}
	rel, event, err := repo.CreateNodeRelationshipAndWorkspaceEvent(companyID, node.NodeID, other.NodeID, "Peer", "Peer")
	if err != nil {
		t.Fatalf("CreateNodeRelationshipAndWorkspaceEvent: %v", err)
	}
	if event.Type != "relationship_created" || event.Sequence != 3 || event.Payload["node_relationship_id"] != rel.NodeRelationshipID {
		t.Fatalf("relationship create event = %+v", event)
	}

	event, err = repo.DeleteNodeRelationshipAndWorkspaceEvent(companyID, rel.NodeRelationshipID)
	if err != nil {
		t.Fatalf("DeleteNodeRelationshipAndWorkspaceEvent: %v", err)
	}
	if event.Type != "relationship_deleted" || event.Sequence != 4 || event.Payload["node_relationship_id"] != rel.NodeRelationshipID {
		t.Fatalf("relationship delete event = %+v", event)
	}

	event, err = repo.DeleteNodeAndWorkspaceEvent(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("DeleteNodeAndWorkspaceEvent: %v", err)
	}
	if event.Type != "node_deleted" || event.Sequence != 5 || event.Payload["node_id"] != node.NodeID {
		t.Fatalf("node delete event = %+v", event)
	}

	replay, err := repo.ListDomainEventsAfter(DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: 0, Limit: 10})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter: %v", err)
	}
	wantTypes := []string{"node_created", "node_updated", "relationship_created", "relationship_deleted", "node_deleted"}
	if len(replay) != len(wantTypes) {
		t.Fatalf("replay len = %d, want %d: %+v", len(replay), len(wantTypes), replay)
	}
	for index, want := range wantTypes {
		if replay[index].Type != want || replay[index].Sequence != int64(index+1) {
			t.Fatalf("replay[%d] = type %q sequence %d, want %q sequence %d", index, replay[index].Type, replay[index].Sequence, want, index+1)
		}
	}

	cursorReplay, err := repo.ListDomainEventsAfter(DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: 2, Limit: 10})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter cursor: %v", err)
	}
	if len(cursorReplay) != 3 || cursorReplay[0].Type != "relationship_created" || cursorReplay[0].Sequence != 3 {
		t.Fatalf("cursor replay = %+v, want converted events after sequence 2", cursorReplay)
	}
}

func TestMemoryNodeGraphWorkspaceEventAppendFailureRollsBackState(t *testing.T) {
	errAppend := errors.New("append failed")
	companyID := "22222222-2222-2222-2222-222222222222"

	t.Run("node create", func(t *testing.T) {
		repo := NewMemoryRepo()
		repo.domainEventAppendErr = errAppend
		_, _, err := repo.CreateNodeWithWorkspaceEvent(companyID, "No commit")
		if !errors.Is(err, errAppend) {
			t.Fatalf("err = %v, want append failure", err)
		}
		nodes, err := repo.ListNodes(companyID)
		if err != nil || len(nodes) != 0 {
			t.Fatalf("nodes after failed create = %+v err=%v, want none", nodes, err)
		}
		assertNoWorkspaceEvents(t, repo, companyID)
	})

	t.Run("node update", func(t *testing.T) {
		repo := NewMemoryRepo()
		node, err := repo.CreateNode(companyID, "Original")
		if err != nil {
			t.Fatalf("CreateNode setup: %v", err)
		}
		repo.domainEventAppendErr = errAppend
		_, _, err = repo.UpdateNodeAndWorkspaceEvent(UpdateNodeInput{CompanyID: companyID, NodeID: node.NodeID, Title: "Changed", TitleSet: true})
		if !errors.Is(err, errAppend) {
			t.Fatalf("err = %v, want append failure", err)
		}
		got, err := repo.GetNode(companyID, node.NodeID)
		if err != nil || got.Title != "Original" {
			t.Fatalf("node after failed update = %+v err=%v, want original", got, err)
		}
		assertNoWorkspaceEvents(t, repo, companyID)
	})

	t.Run("node delete", func(t *testing.T) {
		repo := NewMemoryRepo()
		node, err := repo.CreateNode(companyID, "Keep")
		if err != nil {
			t.Fatalf("CreateNode setup: %v", err)
		}
		now := time.Now().UTC()
		draftID, attachmentID, relationshipID := "shared-draft", newUUIDv7String(), newUUIDv7String()
		repo.mu.Lock()
		repo.emailDrafts[communicationsEmailDraftKey(companyID, draftID)] = domain.CommunicationsEmailDraft{
			CompanyID: companyID, DraftID: draftID, SharedNodeID: node.NodeID, Revision: 1, Kind: "reply",
		}
		repo.attachments[attachmentKey(companyID, attachmentID)] = domain.Attachment{
			CompanyID: companyID, AttachmentID: attachmentID, OriginalFilename: "keep.txt", CreatedTimestamp: now,
		}
		repo.resourceAttachments[relationshipID] = domain.ResourceAttachment{
			CompanyID: companyID, ResourceAttachmentID: relationshipID, ResourceType: "email_draft",
			ResourceID: draftID, AttachmentID: attachmentID, CreatedTimestamp: now,
		}
		repo.mu.Unlock()
		repo.domainEventAppendErr = errAppend
		_, err = repo.DeleteNodeAndWorkspaceEvent(companyID, node.NodeID)
		if !errors.Is(err, errAppend) {
			t.Fatalf("err = %v, want append failure", err)
		}
		if _, err := repo.GetNode(companyID, node.NodeID); err != nil {
			t.Fatalf("GetNode after failed delete: %v", err)
		}
		repo.mu.RLock()
		_, draftExists := repo.emailDrafts[communicationsEmailDraftKey(companyID, draftID)]
		attachment := repo.attachments[attachmentKey(companyID, attachmentID)]
		link := repo.resourceAttachments[relationshipID]
		repo.mu.RUnlock()
		if !draftExists || attachment.DeletedTimestamp != nil || link.DeletedTimestamp != nil {
			t.Fatalf("shared draft graph was not rolled back: draft=%v attachment=%+v link=%+v", draftExists, attachment, link)
		}
		assertNoWorkspaceEvents(t, repo, companyID)
	})

	t.Run("relationship create", func(t *testing.T) {
		repo := NewMemoryRepo()
		a, err := repo.CreateNode(companyID, "A")
		if err != nil {
			t.Fatalf("CreateNode A setup: %v", err)
		}
		b, err := repo.CreateNode(companyID, "B")
		if err != nil {
			t.Fatalf("CreateNode B setup: %v", err)
		}
		repo.domainEventAppendErr = errAppend
		_, _, err = repo.CreateNodeRelationshipAndWorkspaceEvent(companyID, a.NodeID, b.NodeID, "Peer", "Peer")
		if !errors.Is(err, errAppend) {
			t.Fatalf("err = %v, want append failure", err)
		}
		rels, err := repo.ListNodeRelationships(companyID)
		if err != nil || len(rels) != 0 {
			t.Fatalf("relationships after failed create = %+v err=%v, want none", rels, err)
		}
		assertNoWorkspaceEvents(t, repo, companyID)
	})

	t.Run("relationship delete", func(t *testing.T) {
		repo := NewMemoryRepo()
		a, err := repo.CreateNode(companyID, "A")
		if err != nil {
			t.Fatalf("CreateNode A setup: %v", err)
		}
		b, err := repo.CreateNode(companyID, "B")
		if err != nil {
			t.Fatalf("CreateNode B setup: %v", err)
		}
		rel, err := repo.CreateNodeRelationship(companyID, a.NodeID, b.NodeID, "Peer", "Peer")
		if err != nil {
			t.Fatalf("CreateNodeRelationship setup: %v", err)
		}
		repo.domainEventAppendErr = errAppend
		_, err = repo.DeleteNodeRelationshipAndWorkspaceEvent(companyID, rel.NodeRelationshipID)
		if !errors.Is(err, errAppend) {
			t.Fatalf("err = %v, want append failure", err)
		}
		rels, err := repo.ListNodeRelationships(companyID)
		if err != nil || len(rels) != 1 || rels[0].NodeRelationshipID != rel.NodeRelationshipID {
			t.Fatalf("relationships after failed delete = %+v err=%v, want original", rels, err)
		}
		assertNoWorkspaceEvents(t, repo, companyID)
	})
}

func assertNoWorkspaceEvents(t *testing.T, repo *MemoryRepo, companyID string) {
	t.Helper()
	events, err := repo.ListDomainEventsAfter(DomainEventReplayQuery{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, AfterSequence: 0, Limit: 10})
	if err != nil {
		t.Fatalf("ListDomainEventsAfter: %v", err)
	}
	if len(events) != 0 {
		t.Fatalf("events after failed mutation = %+v, want none", events)
	}
}
