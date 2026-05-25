package store

import (
	"strings"
	"testing"
)

func TestUnseenNodeContentChangesExcludeViewerOwnEdits(t *testing.T) {
	t.Parallel()

	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111201"
	viewerID := "22222222-2222-4222-8222-222222222201"
	otherID := "33333333-3333-4333-8333-333333333201"
	informationID := "44444444-4444-4444-8444-444444444201"

	node, err := repo.CreateNode(companyID, "Change ownership")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID:        companyID,
		NodeID:           node.NodeID,
		Type:             "Text box",
		Information:      "base",
		InformationID:    informationID,
		ActorUserID:      otherID,
		ActorDisplayName: "Other Writer",
	}); err != nil {
		t.Fatalf("AddNodeInformationWithActor initial: %v", err)
	}
	if _, err := repo.MarkNodeContentChangeSeen(NodeContentChangeSeenInput{
		CompanyID: companyID,
		NodeID:    node.NodeID,
		UserID:    viewerID,
	}); err != nil {
		t.Fatalf("MarkNodeContentChangeSeen all: %v", err)
	}
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID:        companyID,
		NodeID:           node.NodeID,
		Type:             "Text box",
		Information:      "base mine",
		InformationID:    informationID,
		ActorUserID:      viewerID,
		ActorDisplayName: "Viewer",
	}); err != nil {
		t.Fatalf("AddNodeInformationWithActor viewer edit: %v", err)
	}
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID:        companyID,
		NodeID:           node.NodeID,
		Type:             "Text box",
		Information:      "base mine other",
		InformationID:    informationID,
		ActorUserID:      otherID,
		ActorDisplayName: "Other Writer",
	}); err != nil {
		t.Fatalf("AddNodeInformationWithActor other edit: %v", err)
	}

	changes, err := repo.ListUnseenNodeContentChanges(NodeContentChangeListInput{
		CompanyID: companyID,
		NodeID:    node.NodeID,
		UserID:    viewerID,
	})
	if err != nil {
		t.Fatalf("ListUnseenNodeContentChanges: %v", err)
	}
	if len(changes) != 1 {
		t.Fatalf("change count = %d, want 1: %+v", len(changes), changes)
	}
	if changes[0].ActorUserID != otherID || changes[0].Text != " other" {
		t.Fatalf("change = %+v, want only the other user's appended text", changes[0])
	}
	if strings.Contains(changes[0].Text, "mine") {
		t.Fatalf("change text includes viewer-owned content: %q", changes[0].Text)
	}
}
