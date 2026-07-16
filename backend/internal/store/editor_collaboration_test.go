package store

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestEditorCollaborationRGAConvergesIndependentOfCommitOrder(t *testing.T) {
	initial := NewEditorCollaborationState("ab")
	left := EditorCollaborationDelta{Inserts: []EditorCollaborationAtom{{ID: "client-a:op-1:0", AfterID: "0:00000000", Value: "X"}}}
	right := EditorCollaborationDelta{Inserts: []EditorCollaborationAtom{{ID: "client-b:op-1:0", AfterID: "0:00000000", Value: "Y"}}}

	leftThenRight, err := ApplyEditorCollaborationDelta(initial, left)
	if err != nil {
		t.Fatalf("apply left: %v", err)
	}
	leftThenRight, err = ApplyEditorCollaborationDelta(leftThenRight, right)
	if err != nil {
		t.Fatalf("apply right: %v", err)
	}
	rightThenLeft, err := ApplyEditorCollaborationDelta(initial, right)
	if err != nil {
		t.Fatalf("apply right first: %v", err)
	}
	rightThenLeft, err = ApplyEditorCollaborationDelta(rightThenLeft, left)
	if err != nil {
		t.Fatalf("apply left second: %v", err)
	}

	first, err := MaterializeEditorCollaborationState(leftThenRight)
	if err != nil {
		t.Fatalf("materialize left then right: %v", err)
	}
	second, err := MaterializeEditorCollaborationState(rightThenLeft)
	if err != nil {
		t.Fatalf("materialize right then left: %v", err)
	}
	if first != second || first != "aYXb" {
		t.Fatalf("concurrent states did not converge: first=%q second=%q", first, second)
	}
}

func TestEditorCollaborationCompactAtomsSupportLargeDocuments(t *testing.T) {
	html := strings.Repeat("<p><strong>Ω🙂</strong><span data-mention-user-id=\"user-1\">@Ada</span></p>", 16_000)
	state := NewEditorCollaborationState(html)
	if len(state.Atoms) >= 2_000 {
		t.Fatalf("compact snapshot atoms = %d, want fewer than 2000", len(state.Atoms))
	}
	for _, atom := range state.Atoms {
		if count := utf8.RuneCountInString(atom.Value); count < 1 || count > EditorCollaborationAtomMaxRunes {
			t.Fatalf("atom rune count = %d, want 1..%d", count, EditorCollaborationAtomMaxRunes)
		}
	}
	materialized, err := MaterializeEditorCollaborationState(state)
	if err != nil || materialized != html {
		t.Fatalf("large compact state materialization err=%v exact=%v", err, materialized == html)
	}

	ref := EditorDocumentRef{
		CompanyID: "11111111-1111-4111-8111-111111111119", ResourceType: EntityTypeNode,
		ResourceID: "22222222-2222-4222-8222-222222222229", DocumentID: "33333333-3333-4333-8333-333333333339",
	}
	value := strings.Repeat("Ω", EditorCollaborationAtomMaxRunes)
	if _, _, err := NormalizeEditorCollaborationOperation(EditorCollaborationOperationInput{
		Document: ref, OperationID: "compact-operation", ClientID: "compact-client",
		Delta: EditorCollaborationDelta{Inserts: []EditorCollaborationAtom{{ID: "compact-operation:0", Value: value}}},
	}); err != nil {
		t.Fatalf("bounded compact atom rejected: %v", err)
	}
	if _, _, err := NormalizeEditorCollaborationOperation(EditorCollaborationOperationInput{
		Document: ref, OperationID: "oversized-atom", ClientID: "compact-client",
		Delta: EditorCollaborationDelta{Inserts: []EditorCollaborationAtom{{ID: "oversized-atom:0", Value: value + "Ω"}}},
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("oversized compact atom err=%v, want ErrInvalid", err)
	}
}

func TestEditorCollaborationCommitIsIdempotentAndOutboxBacked(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"
	node, err := repo.CreateNode(companyID, "Collaborative node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	ref := EditorDocumentRef{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID,
		DocumentID: "22222222-2222-2222-2222-222222222222",
	}
	input := EditorCollaborationOperationInput{
		Document: ref, OperationID: "client-a:operation-1", ClientID: "client-a",
		ActorUserID: "33333333-3333-3333-3333-333333333333", BaseRevision: 0,
		Delta: EditorCollaborationDelta{Inserts: []EditorCollaborationAtom{{ID: "client-a:operation-1:0", Value: "A"}}},
	}
	first, err := repo.CommitEditorCollaborationOperation(input)
	if err != nil {
		t.Fatalf("CommitEditorCollaborationOperation: %v", err)
	}
	second, err := repo.CommitEditorCollaborationOperation(input)
	if err != nil {
		t.Fatalf("deduplicated commit: %v", err)
	}
	if first.Revision != 1 || second.Revision != first.Revision || second.EventID != first.EventID || !second.Deduplicated {
		t.Fatalf("unexpected idempotency result: first=%+v second=%+v", first, second)
	}
	if second.Snapshot.HTML != "A" {
		t.Fatalf("snapshot HTML=%q, want A", second.Snapshot.HTML)
	}

	claimed, err := repo.ClaimRealtimeOutbox(RealtimeOutboxClaimQuery{Limit: 10, LeaseDuration: time.Second})
	if err != nil {
		t.Fatalf("ClaimRealtimeOutbox: %v", err)
	}
	if len(claimed) != 1 || claimed[0].EventID != first.EventID || claimed[0].Scope != EditorRealtimeScope(ref) {
		t.Fatalf("unexpected claimed events: %+v", claimed)
	}
	var payload map[string]any
	if err := json.Unmarshal(claimed[0].Payload, &payload); err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	if payload["type"] != EditorCollaborationEventType || payload["operation_id"] != input.OperationID {
		t.Fatalf("unexpected payload: %+v", payload)
	}
	if err := repo.MarkRealtimeOutboxPublished(claimed[0].EventID, claimed[0].ClaimToken); err != nil {
		t.Fatalf("MarkRealtimeOutboxPublished: %v", err)
	}
	published, err := repo.ListPublishedRealtimeOutboxAfter(0, 10)
	if err != nil || len(published) != 1 || published[0].EventID != first.EventID {
		t.Fatalf("published events=%+v err=%v", published, err)
	}
}

func TestEditorSaveVersionMaterializesCanonicalCollaborationHead(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "71717171-7171-4171-8171-717171717171"
	node, err := repo.CreateNode(companyID, "Saved collaboration node")
	if err != nil {
		t.Fatal(err)
	}
	ref := EditorDocumentRef{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID,
		DocumentID: "72727272-7272-4272-8272-727272727272",
	}
	if _, err := repo.CommitEditorCollaborationOperation(EditorCollaborationOperationInput{
		Document: ref, OperationID: "save-op-1", ClientID: "save-client",
		Delta: EditorCollaborationDelta{Inserts: []EditorCollaborationAtom{{ID: "save-op-1:0", Value: "A"}}},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CommitEditorCollaborationOperation(EditorCollaborationOperationInput{
		Document: ref, OperationID: "save-op-2", ClientID: "save-client", BaseRevision: 1,
		Delta: EditorCollaborationDelta{Inserts: []EditorCollaborationAtom{{ID: "save-op-2:0", AfterID: "save-op-1:0", Value: "B"}}},
	}); err != nil {
		t.Fatal(err)
	}
	beforeSave, err := repo.ListNodeProjections(companyID, node.NodeID)
	if err != nil || len(beforeSave) != 1 || beforeSave[0].Information != "A" {
		t.Fatalf("pre-save derived projection=%+v err=%v, want deliberately compacted revision A", beforeSave, err)
	}
	version, err := repo.CreateNodeEditorSaveVersion(EditorSaveVersionInput{CompanyID: companyID, ResourceID: node.NodeID, SaveKind: "manual"})
	if err != nil || len(version.Items) != 1 || version.Items[0].Information != "AB" {
		t.Fatalf("saved version=%+v err=%v, want canonical collaboration head AB", version, err)
	}
}

func TestEditorCollaborationRejectsUnsafeOrCausallyUnknownDeltaWithoutOutbox(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"
	node, err := repo.CreateNode(companyID, "Safe node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	ref := EditorDocumentRef{CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID, DocumentID: "22222222-2222-2222-2222-222222222222"}
	_, err = repo.CommitEditorCollaborationOperation(EditorCollaborationOperationInput{
		Document: ref, OperationID: "unknown-predecessor", ClientID: "client-a",
		Delta: EditorCollaborationDelta{Inserts: []EditorCollaborationAtom{{ID: "client-a:1", AfterID: "missing", Value: "x"}}},
	})
	if !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("unknown predecessor err=%v, want ErrVersionConflict", err)
	}
	claimed, claimErr := repo.ClaimRealtimeOutbox(RealtimeOutboxClaimQuery{})
	if claimErr != nil || len(claimed) != 0 {
		t.Fatalf("invalid operation leaked outbox event: events=%+v err=%v", claimed, claimErr)
	}

	unsafe := "data:image/png;base64,AAAA"
	inserts := make([]EditorCollaborationAtom, 0, len(unsafe))
	afterID := ""
	for index, value := range unsafe {
		id := "unsafe:" + string(rune('a'+index))
		inserts = append(inserts, EditorCollaborationAtom{ID: id, AfterID: afterID, Value: string(value)})
		afterID = id
	}
	_, err = repo.CommitEditorCollaborationOperation(EditorCollaborationOperationInput{
		Document: ref, OperationID: "unsafe-content", ClientID: "client-a", Delta: EditorCollaborationDelta{Inserts: inserts},
	})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("unsafe payload err=%v, want ErrInvalid", err)
	}
}

func TestEditorCollaborationMetadataNeverAcceptsOrOverwritesDocumentBody(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "61616161-6161-4161-8161-616161616161"
	node, err := repo.CreateNode(companyID, "Metadata-safe collaboration node")
	if err != nil {
		t.Fatal(err)
	}
	ref := EditorDocumentRef{
		CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID,
		DocumentID: "62626262-6262-4262-8262-626262626262",
	}
	_, err = repo.CommitEditorCollaborationOperation(EditorCollaborationOperationInput{
		Document: ref, OperationID: "metadata-body-op", ClientID: "metadata-client",
		Delta: EditorCollaborationDelta{Inserts: []EditorCollaborationAtom{{ID: "metadata-body-op:0", Value: "A"}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	commit, err := repo.UpdateEditorCollaborationMetadata(EditorCollaborationMetadataInput{
		Document: ref, Title: " Shared title ",
		Attachments: []EditorCollaborationAttachmentReference{{
			ID: "63636363-6363-4363-8363-636363636363", AttachmentID: "63636363-6363-4363-8363-636363636363",
			Name: "image.png", Filename: "image.png", Type: "image/png", MIMEType: "image/png", Size: 12, ByteSize: 12,
		}},
	})
	if err != nil || commit.ProjectionRevision < 2 {
		t.Fatalf("metadata commit=%+v err=%v", commit, err)
	}
	snapshot, err := repo.GetEditorCollaborationSnapshot(ref)
	if err != nil || snapshot.HTML != "A" || snapshot.Revision != 1 {
		t.Fatalf("metadata changed collaboration body/revision: snapshot=%+v err=%v", snapshot, err)
	}
	projections, err := repo.ListNodeProjections(companyID, node.NodeID)
	if err != nil || len(projections) != 1 {
		t.Fatalf("projections=%+v err=%v", projections, err)
	}
	var payload struct {
		Title       string                                   `json:"title"`
		Document    string                                   `json:"document"`
		Attachments []EditorCollaborationAttachmentReference `json:"attachments"`
	}
	if !strings.HasPrefix(projections[0].Information, editorCollaborationTextBlockPrefix) || json.Unmarshal([]byte(strings.TrimPrefix(projections[0].Information, editorCollaborationTextBlockPrefix)), &payload) != nil {
		t.Fatalf("invalid metadata projection=%q", projections[0].Information)
	}
	if payload.Title != "Shared title" || payload.Document != "A" || len(payload.Attachments) != 1 {
		t.Fatalf("metadata projection payload=%+v", payload)
	}
}
func TestRealtimeOutboxLeaseRetriesAndRejectsStaleClaim(t *testing.T) {
	repo := NewMemoryRepo()
	payload := json.RawMessage(`{"type":"test"}`)
	created, err := repo.EnqueueRealtimeOutbox(RealtimeOutboxInput{
		CompanyID: "11111111-1111-1111-1111-111111111111", Scope: "board:22222222-2222-2222-2222-222222222222",
		EventType: "test", Payload: payload,
	})
	if err != nil {
		t.Fatalf("EnqueueRealtimeOutbox: %v", err)
	}
	first, err := repo.ClaimRealtimeOutbox(RealtimeOutboxClaimQuery{LeaseDuration: time.Nanosecond})
	if err != nil || len(first) != 1 {
		t.Fatalf("first claim=%+v err=%v", first, err)
	}
	time.Sleep(time.Millisecond)
	second, err := repo.ClaimRealtimeOutbox(RealtimeOutboxClaimQuery{LeaseDuration: time.Second})
	if err != nil || len(second) != 1 || second[0].EventID != created.EventID || second[0].AttemptCount != 2 {
		t.Fatalf("retry claim=%+v err=%v", second, err)
	}
	if err := repo.MarkRealtimeOutboxPublished(created.EventID, first[0].ClaimToken); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("stale claim err=%v, want ErrVersionConflict", err)
	}
	if err := repo.MarkRealtimeOutboxPublished(created.EventID, second[0].ClaimToken); err != nil {
		t.Fatalf("current claim publish: %v", err)
	}
}
