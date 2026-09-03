package store

import (
	"context"
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"testing"
)

func memoryNodeTextBlockInformation(t *testing.T, document string) string {
	t.Helper()
	payload, err := json.Marshal(map[string]string{
		"title":    "Notes",
		"document": document,
	})
	if err != nil {
		t.Fatalf("Marshal text block failed: %v", err)
	}
	return editorTextBlockProjectionPrefix + string(payload)
}

func memoryRevision(value int64) *int64 {
	return &value
}

func TestMemoryRepoUpsertAuthUserPreservesDisplayNameOnBlankOrEmailClaims(t *testing.T) {
	repo := NewMemoryRepo()
	const subject = "display-name-preserve-subject"

	if _, err := repo.UpsertAuthUser(subject, "jonathan@example.com", "Jonathan Kim"); err != nil {
		t.Fatalf("initial UpsertAuthUser failed: %v", err)
	}
	if _, err := repo.UpsertAuthUser(subject, "jonathan@example.com", ""); err != nil {
		t.Fatalf("blank-name UpsertAuthUser failed: %v", err)
	}
	user, err := repo.GetAuthUser(subject)
	if err != nil {
		t.Fatalf("GetAuthUser after blank-name upsert failed: %v", err)
	}
	if user.DisplayName != "Jonathan Kim" {
		t.Fatalf("display name after blank claim = %q, want Jonathan Kim", user.DisplayName)
	}

	if _, err := repo.UpsertAuthUser(subject, "jonathan.new@example.com", "jonathan.new@example.com"); err != nil {
		t.Fatalf("email-like-name UpsertAuthUser failed: %v", err)
	}
	user, err = repo.GetAuthUser(subject)
	if err != nil {
		t.Fatalf("GetAuthUser after email-like-name upsert failed: %v", err)
	}
	if user.Email != "jonathan.new@example.com" || user.DisplayName != "Jonathan Kim" {
		t.Fatalf("user after email-like claim = %+v, want updated email and preserved display name", user)
	}

	if _, err := repo.UpsertAuthUser(subject, "jonathan.new@example.com", "Jon Kim"); err != nil {
		t.Fatalf("real-name UpsertAuthUser failed: %v", err)
	}
	user, err = repo.GetAuthUser(subject)
	if err != nil {
		t.Fatalf("GetAuthUser after real-name upsert failed: %v", err)
	}
	if user.DisplayName != "Jon Kim" {
		t.Fatalf("display name after real claim = %q, want Jon Kim", user.DisplayName)
	}
}

func TestMemoryRepo_AddNodeInformation_ProjectionKeyStaysStableWhenInformationIDProvided(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"

	node, err := repo.CreateNode(companyID, "Projection stability node")
	if err != nil {
		t.Fatalf("CreateNode failed: %v", err)
	}

	const stableProjectionID = "22222222-2222-4222-8222-222222222222"
	if _, err := repo.AddNodeInformation(companyID, node.NodeID, "Text box", "first snapshot", stableProjectionID); err != nil {
		t.Fatalf("first AddNodeInformation failed: %v", err)
	}
	if _, err := repo.AddNodeInformation(companyID, node.NodeID, "Text box", "second snapshot", stableProjectionID); err != nil {
		t.Fatalf("second AddNodeInformation failed: %v", err)
	}

	projections, err := repo.ListNodeProjections(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("ListNodeProjections failed: %v", err)
	}
	if len(projections) != 1 {
		t.Fatalf("expected 1 projection row for stable information_id, got %d", len(projections))
	}
	if projections[0].InformationID != stableProjectionID {
		t.Fatalf("expected projection information_id %s, got %s", stableProjectionID, projections[0].InformationID)
	}
	if projections[0].Information != "second snapshot" {
		t.Fatalf("expected latest projection information to be updated, got %q", projections[0].Information)
	}
}

func TestMemoryRepo_NodeProjectionAutosaveDoesNotAppendInformationAndSaveVersionRestoresProjection(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"
	actorID := "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	const informationID = "22222222-2222-4222-8222-222222222222"

	node, err := repo.CreateNode(companyID, "Projection-only autosave node")
	if err != nil {
		t.Fatalf("CreateNode failed: %v", err)
	}
	if _, err := repo.UpsertNodeProjectionWithActor(NodeInformationInput{
		CompanyID:        companyID,
		NodeID:           node.NodeID,
		Type:             "Text box",
		Information:      memoryNodeTextBlockInformation(t, "alpha"),
		InformationID:    informationID,
		ActorUserID:      actorID,
		ActorDisplayName: "Ada Lovelace",
		ExpectedRevision: memoryRevision(0),
	}); err != nil {
		t.Fatalf("initial UpsertNodeProjectionWithActor failed: %v", err)
	}
	if _, err := repo.UpsertNodeProjectionWithActor(NodeInformationInput{
		CompanyID:        companyID,
		NodeID:           node.NodeID,
		Type:             "Text box",
		Information:      memoryNodeTextBlockInformation(t, "beta"),
		InformationID:    informationID,
		ActorUserID:      actorID,
		ActorDisplayName: "Ada Lovelace",
		ExpectedRevision: memoryRevision(1),
	}); err != nil {
		t.Fatalf("second UpsertNodeProjectionWithActor failed: %v", err)
	}

	details, err := repo.GetNodeDetails(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("GetNodeDetails failed: %v", err)
	}
	if len(details.Information) != 0 {
		t.Fatalf("projection autosaves appended %d information rows, want 0", len(details.Information))
	}

	version, err := repo.CreateNodeEditorSaveVersion(EditorSaveVersionInput{
		CompanyID:        companyID,
		ResourceID:       node.NodeID,
		SaveKind:         "manual",
		ActorUserID:      actorID,
		ActorDisplayName: "Ada Lovelace",
	})
	if err != nil {
		t.Fatalf("CreateNodeEditorSaveVersion failed: %v", err)
	}
	if version.SaveKind != "manual" || version.ItemCount != 1 || version.SavedByUserID != actorID || version.SavedByDisplayName != "Ada Lovelace" {
		t.Fatalf("save version metadata = %+v, want one manual save by actor", version)
	}
	if version.Items[0].SourceInformationID != informationID || version.Items[0].Information != memoryNodeTextBlockInformation(t, "beta") {
		t.Fatalf("saved version item = %+v, want beta snapshot from projection %s", version.Items[0], informationID)
	}

	if _, err := repo.UpsertNodeProjectionWithActor(NodeInformationInput{
		CompanyID:        companyID,
		NodeID:           node.NodeID,
		Type:             "Text box",
		Information:      memoryNodeTextBlockInformation(t, "gamma"),
		InformationID:    informationID,
		ActorUserID:      actorID,
		ExpectedRevision: memoryRevision(2),
	}); err != nil {
		t.Fatalf("third UpsertNodeProjectionWithActor failed: %v", err)
	}
	if _, err := repo.RestoreNodeEditorSaveVersion(EditorSaveVersionRestoreInput{
		CompanyID:   companyID,
		ResourceID:  node.NodeID,
		SaveID:      version.SaveID,
		ActorUserID: actorID,
	}); err != nil {
		t.Fatalf("RestoreNodeEditorSaveVersion failed: %v", err)
	}
	projections, err := repo.ListNodeProjections(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("ListNodeProjections failed: %v", err)
	}
	if len(projections) != 1 || projections[0].InformationID != informationID || projections[0].Information != memoryNodeTextBlockInformation(t, "beta") {
		t.Fatalf("restored projections = %+v, want beta projection restored at stable ID", projections)
	}
	details, err = repo.GetNodeDetails(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("GetNodeDetails after save failed: %v", err)
	}
	if len(details.Information) != 1 || details.Information[0].SaveBatchID != version.SaveID {
		t.Fatalf("saved information rows = %+v, want exactly one saved-version row", details.Information)
	}
}

func TestMemoryRepoCompanyExplorerDeleteMovesNodeToRecycleBinAndRestores(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"
	deleterUserID := "22222222-2222-4222-8222-222222222222"
	repo.EnsureCompany(companyID, "Recycle Company")

	node, err := repo.CreateNode(companyID, "Restorable node")
	if err != nil {
		t.Fatalf("CreateNode failed: %v", err)
	}

	if _, err := repo.DeleteCompanyExplorerTargets(companyID, []CompanyExplorerDeleteTargetInput{{Kind: "node", ID: node.NodeID}}, deleterUserID); err != nil {
		t.Fatalf("DeleteCompanyExplorerTargets failed: %v", err)
	}
	if _, err := repo.GetNode(companyID, node.NodeID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetNode after recycle delete err = %v, want ErrNotFound", err)
	}
	items, err := repo.ListRecycleBinItems(companyID, deleterUserID)
	if err != nil {
		t.Fatalf("ListRecycleBinItems failed: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("recycle item count = %d, want 1", len(items))
	}
	if items[0].ObjectKind != "node" || items[0].ObjectID != node.NodeID || items[0].ObjectLabel != "Restorable node" {
		t.Fatalf("recycle item = %+v, want deleted node metadata", items[0])
	}
	if items[0].DeletedByUserID != deleterUserID {
		t.Fatalf("recycle item deleted_by_user_id = %q, want %q", items[0].DeletedByUserID, deleterUserID)
	}

	result, err := repo.RestoreRecycleBinItems(companyID, deleterUserID, []string{items[0].RecycleBinItemID})
	if err != nil {
		t.Fatalf("RestoreRecycleBinItems failed: %v", err)
	}
	if len(result.Targets) != 1 || result.Targets[0].Kind != "node" || result.Targets[0].ID != node.NodeID {
		t.Fatalf("restore targets = %+v, want restored node target", result.Targets)
	}
	restored, err := repo.GetNode(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("GetNode after restore failed: %v", err)
	}
	if restored.Title != "Restorable node" {
		t.Fatalf("restored title = %q, want original", restored.Title)
	}
	remaining, err := repo.ListRecycleBinItems(companyID, deleterUserID)
	if err != nil {
		t.Fatalf("ListRecycleBinItems after restore failed: %v", err)
	}
	if len(remaining) != 0 {
		t.Fatalf("recycle items after restore = %+v, want empty", remaining)
	}
}

func TestMemoryRepoRecycleBinItemsAreScopedToDeletedByUser(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111111"
	userAID := "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	userBID := "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	repo.EnsureCompany(companyID, "Recycle Scope Company")

	nodeA, err := repo.CreateNode(companyID, "User A deleted node")
	if err != nil {
		t.Fatalf("CreateNode A failed: %v", err)
	}
	nodeB, err := repo.CreateNode(companyID, "User B deleted node")
	if err != nil {
		t.Fatalf("CreateNode B failed: %v", err)
	}
	if _, err := repo.DeleteCompanyExplorerTargets(companyID, []CompanyExplorerDeleteTargetInput{{Kind: "node", ID: nodeA.NodeID}}, userAID); err != nil {
		t.Fatalf("DeleteCompanyExplorerTargets A failed: %v", err)
	}
	if _, err := repo.DeleteCompanyExplorerTargets(companyID, []CompanyExplorerDeleteTargetInput{{Kind: "node", ID: nodeB.NodeID}}, userBID); err != nil {
		t.Fatalf("DeleteCompanyExplorerTargets B failed: %v", err)
	}

	itemsA, err := repo.ListRecycleBinItems(companyID, userAID)
	if err != nil {
		t.Fatalf("ListRecycleBinItems A failed: %v", err)
	}
	if len(itemsA) != 1 || itemsA[0].ObjectID != nodeA.NodeID || itemsA[0].DeletedByUserID != userAID {
		t.Fatalf("user A recycle items = %+v, want only node A", itemsA)
	}
	itemsB, err := repo.ListRecycleBinItems(companyID, userBID)
	if err != nil {
		t.Fatalf("ListRecycleBinItems B failed: %v", err)
	}
	if len(itemsB) != 1 || itemsB[0].ObjectID != nodeB.NodeID || itemsB[0].DeletedByUserID != userBID {
		t.Fatalf("user B recycle items = %+v, want only node B", itemsB)
	}
	if _, err := repo.RestoreRecycleBinItems(companyID, userBID, []string{itemsA[0].RecycleBinItemID}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("RestoreRecycleBinItems cross-user err = %v, want ErrNotFound", err)
	}
	if err := repo.PermanentlyDeleteRecycleBinItems(companyID, userBID, []string{itemsA[0].RecycleBinItemID}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("PermanentlyDeleteRecycleBinItems cross-user err = %v, want ErrNotFound", err)
	}
	if _, err := repo.RestoreRecycleBinItems(companyID, userAID, []string{itemsA[0].RecycleBinItemID}); err != nil {
		t.Fatalf("RestoreRecycleBinItems owner failed: %v", err)
	}
}

func TestMemoryRepo_AddNodeInformation_TextBoxProjectionsRemainIndependent(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"

	node, err := repo.CreateNode(companyID, "Single editor document node")
	if err != nil {
		t.Fatalf("CreateNode failed: %v", err)
	}

	if _, err := repo.AddNodeInformation(companyID, node.NodeID, "Text box", "old document", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"); err != nil {
		t.Fatalf("first AddNodeInformation failed: %v", err)
	}
	if _, err := repo.AddNodeInformation(companyID, node.NodeID, "Text box", "current document", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"); err != nil {
		t.Fatalf("second AddNodeInformation failed: %v", err)
	}

	projections, err := repo.ListNodeProjections(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("ListNodeProjections failed: %v", err)
	}
	if len(projections) != 2 {
		t.Fatalf("expected two Text box projections, got %d", len(projections))
	}
	if projections[0].Information != "old document" || projections[1].Information != "current document" {
		t.Fatalf("projection information = %+v, want both text boxes in created order", projections)
	}
}

func TestMemoryRepo_DeleteNode_RemovesProjectionRows(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"

	node, err := repo.CreateNode(companyID, "Delete cleanup node")
	if err != nil {
		t.Fatalf("CreateNode failed: %v", err)
	}
	if _, err := repo.AddNodeInformation(companyID, node.NodeID, "Text box", "payload", "33333333-3333-4333-8333-333333333333"); err != nil {
		t.Fatalf("AddNodeInformation failed: %v", err)
	}

	if err := repo.DeleteNode(companyID, node.NodeID); err != nil {
		t.Fatalf("DeleteNode failed: %v", err)
	}

	if _, err := repo.ListNodeProjections(companyID, node.NodeID); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound after delete, got %v", err)
	}
}

func TestMemoryRepo_DeleteNodeProjection_ClearsLatestDocumentWithoutDeletingHistory(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"

	node, err := repo.CreateNode(companyID, "Clear document node")
	if err != nil {
		t.Fatalf("CreateNode failed: %v", err)
	}
	const stableProjectionID = "66666666-6666-4666-8666-666666666666"
	if _, err := repo.AddNodeInformation(companyID, node.NodeID, "Text box", "payload", stableProjectionID); err != nil {
		t.Fatalf("AddNodeInformation failed: %v", err)
	}
	if err := repo.DeleteNodeProjectionWithActor(NodeProjectionDeleteInput{
		CompanyID: companyID, NodeID: node.NodeID, InformationID: stableProjectionID, ExpectedRevision: memoryRevision(1),
	}); err != nil {
		t.Fatalf("DeleteNodeProjection failed: %v", err)
	}

	projections, err := repo.ListNodeProjections(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("ListNodeProjections failed: %v", err)
	}
	if len(projections) != 0 {
		t.Fatalf("expected cleared projection rows, got %d", len(projections))
	}
	details, err := repo.GetNodeDetails(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("GetNodeDetails failed: %v", err)
	}
	if len(details.Information) != 1 {
		t.Fatalf("expected history to remain append-only, got %d rows", len(details.Information))
	}
}

func TestMemoryRepo_AddLogicGateInformation_ProjectionKeyStaysStableAndHistoryAppends(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"

	logicGate, err := repo.CreateLogicGate(companyID, "Projection stability logic gate")
	if err != nil {
		t.Fatalf("CreateLogicGate failed: %v", err)
	}

	const stableProjectionID = "44444444-4444-4444-8444-444444444444"
	if _, err := repo.AddLogicGateInformation(companyID, logicGate.LogicGateID, "Text box", "first logic snapshot", stableProjectionID); err != nil {
		t.Fatalf("first AddLogicGateInformation failed: %v", err)
	}
	if _, err := repo.AddLogicGateInformation(companyID, logicGate.LogicGateID, "Text box", "second logic snapshot", stableProjectionID); err != nil {
		t.Fatalf("second AddLogicGateInformation failed: %v", err)
	}

	details, err := repo.GetLogicGateDetails(companyID, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("GetLogicGateDetails failed: %v", err)
	}
	if len(details.Information) != 2 {
		t.Fatalf("expected 2 history rows, got %d", len(details.Information))
	}
	if details.Information[0].InformationID == stableProjectionID || details.Information[1].InformationID == stableProjectionID {
		t.Fatalf("history rows should use durable history IDs, not the stable projection key")
	}

	projections, err := repo.ListLogicGateProjections(companyID, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("ListLogicGateProjections failed: %v", err)
	}
	if len(projections) != 1 {
		t.Fatalf("expected 1 projection row for stable information_id, got %d", len(projections))
	}
	if projections[0].InformationID != stableProjectionID {
		t.Fatalf("expected projection information_id %s, got %s", stableProjectionID, projections[0].InformationID)
	}
	if projections[0].Information != "second logic snapshot" {
		t.Fatalf("expected latest projection information to be updated, got %q", projections[0].Information)
	}
}

func TestMemoryRepo_LogicGateProjectionAutosaveDoesNotAppendInformationAndSaveVersionRestoresProjection(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"
	actorID := "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	const informationID = "44444444-4444-4444-8444-444444444444"

	logicGate, err := repo.CreateLogicGate(companyID, "Projection-only autosave gate")
	if err != nil {
		t.Fatalf("CreateLogicGate failed: %v", err)
	}
	if _, err := repo.UpsertLogicGateProjection(LogicGateProjectionInput{
		CompanyID:        companyID,
		LogicGateID:      logicGate.LogicGateID,
		Type:             "Text box",
		Information:      "<p>alpha</p>",
		InformationID:    informationID,
		ActorUserID:      actorID,
		ActorDisplayName: "Ada Lovelace",
		ExpectedRevision: memoryRevision(0),
	}); err != nil {
		t.Fatalf("initial UpsertLogicGateProjection failed: %v", err)
	}
	if _, err := repo.UpsertLogicGateProjection(LogicGateProjectionInput{
		CompanyID:        companyID,
		LogicGateID:      logicGate.LogicGateID,
		Type:             "Text box",
		Information:      "<p>beta</p>",
		InformationID:    informationID,
		ActorUserID:      actorID,
		ActorDisplayName: "Ada Lovelace",
		ExpectedRevision: memoryRevision(1),
	}); err != nil {
		t.Fatalf("second UpsertLogicGateProjection failed: %v", err)
	}

	details, err := repo.GetLogicGateDetails(companyID, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("GetLogicGateDetails failed: %v", err)
	}
	if len(details.Information) != 0 {
		t.Fatalf("projection autosaves appended %d logic gate information rows, want 0", len(details.Information))
	}

	version, err := repo.CreateLogicGateEditorSaveVersion(EditorSaveVersionInput{
		CompanyID:        companyID,
		ResourceID:       logicGate.LogicGateID,
		SaveKind:         "auto",
		ActorUserID:      actorID,
		ActorDisplayName: "Ada Lovelace",
	})
	if err != nil {
		t.Fatalf("CreateLogicGateEditorSaveVersion failed: %v", err)
	}
	if version.SaveKind != "auto" || version.ItemCount != 1 || version.Items[0].Information != "<p>beta</p>" {
		t.Fatalf("save version = %+v, want one auto beta snapshot", version)
	}

	if _, err := repo.UpsertLogicGateProjection(LogicGateProjectionInput{
		CompanyID:        companyID,
		LogicGateID:      logicGate.LogicGateID,
		Type:             "Text box",
		Information:      "<p>gamma</p>",
		InformationID:    informationID,
		ActorUserID:      actorID,
		ExpectedRevision: memoryRevision(2),
	}); err != nil {
		t.Fatalf("third UpsertLogicGateProjection failed: %v", err)
	}
	if _, err := repo.RestoreLogicGateEditorSaveVersion(EditorSaveVersionRestoreInput{
		CompanyID:   companyID,
		ResourceID:  logicGate.LogicGateID,
		SaveID:      version.SaveID,
		ActorUserID: actorID,
	}); err != nil {
		t.Fatalf("RestoreLogicGateEditorSaveVersion failed: %v", err)
	}
	projections, err := repo.ListLogicGateProjections(companyID, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("ListLogicGateProjections failed: %v", err)
	}
	if len(projections) != 1 || projections[0].InformationID != informationID || projections[0].Information != "<p>beta</p>" {
		t.Fatalf("restored logic gate projections = %+v, want beta projection restored at stable ID", projections)
	}

	details, err = repo.GetLogicGateDetails(companyID, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("GetLogicGateDetails after save failed: %v", err)
	}
	if len(details.Information) != 1 || details.Information[0].SaveBatchID != version.SaveID {
		t.Fatalf("saved logic gate information rows = %+v, want exactly one saved-version row", details.Information)
	}
}

func TestMemoryRepo_AddLogicGateInformation_TextBoxProjectionCollapsesToOneCurrentDocument(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"

	logicGate, err := repo.CreateLogicGate(companyID, "Single editor document gate")
	if err != nil {
		t.Fatalf("CreateLogicGate failed: %v", err)
	}

	if _, err := repo.AddLogicGateInformation(companyID, logicGate.LogicGateID, "Text box", "old logic document", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"); err != nil {
		t.Fatalf("first AddLogicGateInformation failed: %v", err)
	}
	if _, err := repo.AddLogicGateInformation(companyID, logicGate.LogicGateID, "Text box", "current logic document", "dddddddd-dddd-4ddd-8ddd-dddddddddddd"); err != nil {
		t.Fatalf("second AddLogicGateInformation failed: %v", err)
	}

	projections, err := repo.ListLogicGateProjections(companyID, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("ListLogicGateProjections failed: %v", err)
	}
	if len(projections) != 1 {
		t.Fatalf("expected one current Text box projection, got %d", len(projections))
	}
	if projections[0].Information != "current logic document" {
		t.Fatalf("projection information = %q, want current logic document", projections[0].Information)
	}
}

func TestMemoryRepo_DeleteLogicGate_RemovesProjectionRows(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"

	logicGate, err := repo.CreateLogicGate(companyID, "Delete cleanup logic gate")
	if err != nil {
		t.Fatalf("CreateLogicGate failed: %v", err)
	}
	if _, err := repo.AddLogicGateInformation(companyID, logicGate.LogicGateID, "Text box", "payload", "55555555-5555-4555-8555-555555555555"); err != nil {
		t.Fatalf("AddLogicGateInformation failed: %v", err)
	}

	if err := repo.DeleteLogicGate(companyID, logicGate.LogicGateID); err != nil {
		t.Fatalf("DeleteLogicGate failed: %v", err)
	}

	if _, err := repo.ListLogicGateProjections(companyID, logicGate.LogicGateID); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound after delete, got %v", err)
	}
}

func TestMemoryRepo_DeleteLogicGateProjection_ClearsLatestDocumentWithoutDeletingHistory(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"

	logicGate, err := repo.CreateLogicGate(companyID, "Clear document logic gate")
	if err != nil {
		t.Fatalf("CreateLogicGate failed: %v", err)
	}
	const stableProjectionID = "77777777-7777-4777-8777-777777777777"
	if _, err := repo.AddLogicGateInformation(companyID, logicGate.LogicGateID, "Text box", "payload", stableProjectionID); err != nil {
		t.Fatalf("AddLogicGateInformation failed: %v", err)
	}
	if err := repo.DeleteLogicGateProjection(LogicGateProjectionDeleteInput{
		CompanyID:        companyID,
		LogicGateID:      logicGate.LogicGateID,
		InformationID:    stableProjectionID,
		ExpectedRevision: memoryRevision(1),
	}); err != nil {
		t.Fatalf("DeleteLogicGateProjection failed: %v", err)
	}

	projections, err := repo.ListLogicGateProjections(companyID, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("ListLogicGateProjections failed: %v", err)
	}
	if len(projections) != 0 {
		t.Fatalf("expected cleared projection rows, got %d", len(projections))
	}
	details, err := repo.GetLogicGateDetails(companyID, logicGate.LogicGateID)
	if err != nil {
		t.Fatalf("GetLogicGateDetails failed: %v", err)
	}
	if len(details.Information) != 1 {
		t.Fatalf("expected history to remain append-only, got %d rows", len(details.Information))
	}
}

func assertMemoryNoLogicGateAssignmentSource(t *testing.T, repo *MemoryRepo, companyID, nodeID string) {
	t.Helper()
	assignments, err := repo.ListNodeLogicGateAssignments(companyID, nodeID)
	if err != nil {
		t.Fatalf("ListNodeLogicGateAssignments failed: %v", err)
	}
	if len(assignments) != 0 {
		t.Fatalf("assignments = %+v, want none", assignments)
	}
}

func TestMemoryRepo_CompanyProvisioningCreatesUnifiedCompanyExplorerDefaults(t *testing.T) {
	assertProvisioned := func(t *testing.T, repo *MemoryRepo, companyID string) {
		t.Helper()
		defaults := companyExplorerDefaultFolderIDs(companyID)
		repo.mu.RLock()
		defer repo.mu.RUnlock()
		for _, folderID := range []string{defaults.UnfiledFolderID, defaults.ProjectsFolderID, defaults.LogicGatesFolderID} {
			if _, ok := repo.folders[key(companyID, folderID)]; !ok {
				t.Fatalf("missing unified Company Explorer default folder %s", folderID)
			}
		}
	}

	repo := NewMemoryRepo()
	created, err := repo.CreateCompany("Provisioned Company")
	if err != nil {
		t.Fatalf("CreateCompany failed: %v", err)
	}
	assertProvisioned(t, repo, created.CompanyID)

	ensuredID := "22222222-2222-4222-8222-222222222222"
	repo.EnsureCompany(ensuredID, "Ensured Company")
	assertProvisioned(t, repo, ensuredID)
}

func TestMemoryRepo_CompanyExplorerSubtreeSummariesAreBounded(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111111"

	nodeParent, err := repo.CreateCompanyExplorerFolder(companyID, "", "node", "Node parent")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder node parent failed: %v", err)
	}
	logicParent, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Logic parent")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder logic parent failed: %v", err)
	}
	logicChild, err := repo.CreateCompanyExplorerFolder(companyID, logicParent.FolderID, "logic_gate", "Logic child")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder logic child failed: %v", err)
	}
	logicSibling, err := repo.CreateCompanyExplorerFolder(companyID, "", "logic_gate", "Logic sibling")
	if err != nil {
		t.Fatalf("CreateCompanyExplorerFolder logic sibling failed: %v", err)
	}

	nodeA, err := repo.CreateNode(companyID, "Node A")
	if err != nil {
		t.Fatalf("CreateNode A failed: %v", err)
	}
	if _, err := repo.CreateNode(companyID, "Node unplaced"); err != nil {
		t.Fatalf("CreateNode unplaced failed: %v", err)
	}
	gateA, err := repo.CreateLogicGate(companyID, "Gate A")
	if err != nil {
		t.Fatalf("CreateLogicGate A failed: %v", err)
	}
	gateB, err := repo.CreateLogicGate(companyID, "Gate B")
	if err != nil {
		t.Fatalf("CreateLogicGate B failed: %v", err)
	}
	gateOutside, err := repo.CreateLogicGate(companyID, "Gate outside")
	if err != nil {
		t.Fatalf("CreateLogicGate outside failed: %v", err)
	}
	if _, err := repo.CreateLogicGate(companyID, "Gate unplaced"); err != nil {
		t.Fatalf("CreateLogicGate unplaced failed: %v", err)
	}

	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, nodeParent.FolderID, "node", nodeA.NodeID, 1000); !errors.Is(err, ErrInvalid) {
		t.Fatalf("Assign node A error = %v, want ErrInvalid", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, logicParent.FolderID, "logic_gate", gateA.LogicGateID, 1000); err != nil {
		t.Fatalf("Assign gate A failed: %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, logicChild.FolderID, "logic_gate", gateB.LogicGateID, 2000); err != nil {
		t.Fatalf("Assign gate B failed: %v", err)
	}
	if _, _, err := repo.AssignCompanyExplorerFolderItem(companyID, logicSibling.FolderID, "logic_gate", gateOutside.LogicGateID, 3000); err != nil {
		t.Fatalf("Assign outside gate failed: %v", err)
	}

	nodes, err := repo.ListCompanyExplorerNodeSummariesInFolderSubtree(companyID, nodeParent.FolderID)
	if err != nil {
		t.Fatalf("ListCompanyExplorerNodeSummariesInFolderSubtree failed: %v", err)
	}
	if len(nodes) != 0 {
		t.Fatalf("node subtree summaries = %+v, want none because nodes are not Company Explorer folder items", nodes)
	}

	logicGates, err := repo.ListCompanyExplorerLogicGateSummariesInFolderSubtree(companyID, logicParent.FolderID)
	if err != nil {
		t.Fatalf("ListCompanyExplorerLogicGateSummariesInFolderSubtree failed: %v", err)
	}
	logicGateIDs := map[string]bool{}
	for _, gate := range logicGates {
		logicGateIDs[gate.LogicGateID] = true
	}
	if len(logicGateIDs) != 2 || !logicGateIDs[gateA.LogicGateID] || !logicGateIDs[gateB.LogicGateID] || logicGateIDs[gateOutside.LogicGateID] {
		t.Fatalf("logic gate subtree summaries = %+v, want parent and child only", logicGates)
	}
}

func TestMemoryRepoUserEmailConnectionLifecycle(t *testing.T) {
	t.Parallel()

	repo := NewMemoryRepo()
	user, err := repo.UpsertAuthUser("subject-email", "User@Example.com", "Email User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetUserEmailConnection(user.UserID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing connection error = %v, want ErrNotFound", err)
	}
	connection, err := repo.UpsertUserEmailConnection(UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "gmail",
		AccountEmail: "User@Example.com",
		GrantID:      "grant-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if connection.Provider != "google" || connection.AccountEmail != "user@example.com" || connection.GrantID != "grant-1" || connection.Status != "connected" {
		t.Fatalf("connection = %+v, want normalized connected google grant", connection)
	}
	updated, err := repo.UpdateUserEmailConnectionStatus(user.UserID, "user@example.com", "reauth_required")
	if err != nil {
		t.Fatal(err)
	}
	if updated.Status != "reauth_required" {
		t.Fatalf("status = %q, want reauth_required", updated.Status)
	}
	if err := repo.DeleteUserEmailConnection(user.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetUserEmailConnection(user.UserID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("connection after delete error = %v, want ErrNotFound", err)
	}
}

func TestMemoryRepoUserEmailConnectionsArePersonalOnly(t *testing.T) {
	t.Parallel()

	repo := NewMemoryRepo()
	const companyID = "11111111-1111-1111-1111-111111111111"
	repo.EnsureCompany(companyID, "Email Company")
	user, err := repo.UpsertAuthUser("subject-email", "user@example.com", "Email User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: "user@example.com",
		GrantID:      "personal-grant",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: "shared@example.com",
		Scope:        "shared",
		GrantID:      "shared-grant",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	personal, err := repo.GetUserEmailConnection(user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if personal.AccountEmail != "user@example.com" || personal.GrantID != "personal-grant" {
		t.Fatalf("personal connection = %+v, want user@example.com personal-grant", personal)
	}
	companyConnection, err := repo.GetCompanyEmailConnectionByAccountEmail(companyID, "shared@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if companyConnection.AccountEmail != "shared@example.com" || companyConnection.GrantID != "shared-grant" {
		t.Fatalf("company shared connection = %+v, want shared account company grant", companyConnection)
	}
	if _, err := repo.UpdateUserEmailConnectionStatus(user.UserID, "shared@example.com", "reauth_required"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("shared user connection status error = %v, want ErrNotFound", err)
	}
	personal, err = repo.GetUserEmailConnection(user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if personal.Status != "connected" {
		t.Fatalf("personal status = %q, want connected after shared reauth", personal.Status)
	}
	if err := repo.DeleteUserEmailConnection(user.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetUserEmailConnection(user.UserID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("personal after delete error = %v, want ErrNotFound", err)
	}
	if _, err := repo.GetUserEmailConnectionByGrantIDContext(context.Background(), "shared-grant"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("shared grant user lookup error = %v, want ErrNotFound", err)
	}
	companyConnection, err = repo.GetCompanyEmailConnectionByAccountEmail(companyID, "shared@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if companyConnection.Status != "connected" {
		t.Fatalf("company shared status = %q, want connected after personal delete", companyConnection.Status)
	}
}

func TestMemoryRepoUserEmailConnectionRequiresPersonalAccountEmail(t *testing.T) {
	t.Parallel()

	repo := NewMemoryRepo()
	user, err := repo.UpsertAuthUser("subject-email", "profile@example.com", "Email User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: "mailbox@example.com",
		GrantID:      "mailbox-grant",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetUserEmailConnection(user.UserID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("mismatched personal account error = %v, want ErrNotFound", err)
	}
	if _, err := repo.UpsertUserEmailConnection(UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: "profile@example.com",
		GrantID:      "profile-grant",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	connection, err := repo.GetUserEmailConnection(user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if connection.AccountEmail != "profile@example.com" || connection.GrantID != "profile-grant" {
		t.Fatalf("connection = %+v, want exact personal profile mailbox", connection)
	}
	if err := repo.DeleteUserEmailConnection(user.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetUserEmailConnectionByGrantIDContext(context.Background(), "profile-grant"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("connection after delete error = %v, want ErrNotFound", err)
	}
	if _, err := repo.GetUserEmailConnectionByGrantIDContext(context.Background(), "mailbox-grant"); err != nil {
		t.Fatalf("mismatched personal account should remain by grant: %v", err)
	}
}

func TestMemoryRepoUserEmailConnectionDoesNotUseSharedInboxFallback(t *testing.T) {
	t.Parallel()

	repo := NewMemoryRepo()
	const subject = "subject-email"
	const companyID = "11111111-1111-1111-1111-111111111111"
	user, err := repo.UpsertAuthUser(subject, "profile@example.com", "Email User")
	if err != nil {
		t.Fatal(err)
	}
	repo.EnsureCompany(companyID, "Company")
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: "shared@example.com",
		Scope:        "shared",
		GrantID:      "shared-grant",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	_, err = repo.CreateCommunicationsSharedInboxFolder(companyID, "", "Shared", "shared@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetUserEmailConnection(user.UserID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("shared-only connection error = %v, want ErrNotFound", err)
	}
	if _, err := repo.UpsertUserEmailConnection(UserEmailConnectionInput{
		UserID:       user.UserID,
		Provider:     "google",
		AccountEmail: "profile@example.com",
		GrantID:      "mailbox-grant",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	connection, err := repo.GetUserEmailConnection(user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if connection.AccountEmail != "profile@example.com" || connection.GrantID != "mailbox-grant" {
		t.Fatalf("connection = %+v, want exact personal mailbox", connection)
	}
}

func TestMemoryRepoUserEmailConnectionReclaimsDuplicateGrant(t *testing.T) {
	t.Parallel()

	repo := NewMemoryRepo()
	oldUser, err := repo.UpsertAuthUser("old-subject", "old@example.com", "Old User")
	if err != nil {
		t.Fatal(err)
	}
	newUser, err := repo.UpsertAuthUser("new-subject", "new@example.com", "New User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UpsertUserEmailConnection(UserEmailConnectionInput{
		UserID:       oldUser.UserID,
		Provider:     "google",
		AccountEmail: "old@example.com",
		GrantID:      "same-grant",
		Status:       "connected",
	}); err != nil {
		t.Fatal(err)
	}
	connection, err := repo.UpsertUserEmailConnection(UserEmailConnectionInput{
		UserID:       newUser.UserID,
		Provider:     "google",
		AccountEmail: "new@example.com",
		GrantID:      "same-grant",
		Status:       "connected",
	})
	if err != nil {
		t.Fatal(err)
	}
	if connection.UserID != newUser.UserID || connection.AccountEmail != "new@example.com" || connection.GrantID != "same-grant" {
		t.Fatalf("connection = %+v, want grant reassigned to new user", connection)
	}
	if _, err := repo.GetUserEmailConnection(oldUser.UserID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("old user connection error = %v, want ErrNotFound", err)
	}
	loaded, err := repo.GetUserEmailConnectionByGrantIDContext(context.Background(), "same-grant")
	if err != nil {
		t.Fatal(err)
	}
	if loaded.UserID != newUser.UserID {
		t.Fatalf("grant owner = %s, want %s", loaded.UserID, newUser.UserID)
	}
}

func TestMemoryRepoConvertCommunicationsTriageItemsAddsAttachedEmailProjection(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"

	user, err := repo.UpsertAuthUser("subject-triage", "triage@example.com", "Triage User")
	if err != nil {
		t.Fatalf("UpsertAuthUser failed: %v", err)
	}
	if _, err := repo.UpsertUserEmailConnection(UserEmailConnectionInput{
		UserID: user.UserID, Provider: "google", AccountEmail: user.Email, GrantID: "triage-grant", Status: "connected",
	}); err != nil {
		t.Fatalf("UpsertUserEmailConnection: %v", err)
	}
	logicGate, err := repo.CreateLogicGate(companyID, "Support Gate")
	if err != nil {
		t.Fatalf("CreateLogicGate failed: %v", err)
	}
	message := domain.EmailMessageSnapshot{
		ID:       "message-1",
		ThreadID: "thread-1",
		Subject:  "Customer escalation",
		Snippet:  "Need help with onboarding",
		Date:     1770000000,
		From:     []domain.EmailAddressSnapshot{{Name: "Customer", Email: "customer@example.com"}},
		Unread:   true,
	}
	if _, err := repo.UpsertCommunicationsTriageItem(user.UserID, message); err != nil {
		t.Fatalf("UpsertCommunicationsTriageItem failed: %v", err)
	}

	result, err := repo.ConvertCommunicationsTriageItems(context.Background(), CommunicationsTriageConversionInput{
		UserID:       user.UserID,
		CompanyID:    companyID,
		AccountEmail: user.Email,
		LogicGateID:  logicGate.LogicGateID,
		MessageIDs:   []string{message.ID},
	})
	if err != nil {
		t.Fatalf("ConvertCommunicationsTriageItems failed: %v", err)
	}
	if len(result.Nodes) != 1 {
		t.Fatalf("expected one converted node, got %d", len(result.Nodes))
	}

	if result.Nodes[0].Status == nil || *result.Nodes[0].Status != "Pending" {
		t.Fatalf("converted node status = %+v, want Pending read model", result.Nodes[0].Status)
	}
	if len(result.FolderItems) != 0 {
		t.Fatalf("folder items = %+v, want none", result.FolderItems)
	}
	projections, err := repo.ListNodeProjections(companyID, result.Nodes[0].NodeID)
	if err != nil {
		t.Fatalf("ListNodeProjections failed: %v", err)
	}
	if len(projections) != 1 || projections[0].Type != "Attached email" {
		t.Fatalf("projection rows = %+v, want one Attached email", projections)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(projections[0].Information), &payload); err != nil {
		t.Fatalf("attached email payload is not JSON: %v", err)
	}
	if payload["message_id"] != message.ID || payload["thread_id"] != message.ThreadID || payload["subject"] != message.Subject {
		t.Fatalf("attached email payload = %+v, want original message identifiers", payload)
	}
	if payload["from"] != "Customer <customer@example.com>" {
		t.Fatalf("from payload = %v, want formatted sender", payload["from"])
	}
	if payload["attached_timestamp"] == "" {
		t.Fatalf("attached_timestamp missing from payload: %+v", payload)
	}
}
