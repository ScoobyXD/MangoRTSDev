package store

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"
)

func applyHTMLPatchForTest(t *testing.T, html string, patch EditorHTMLPatch) string {
	t.Helper()
	next, err := ApplyEditorHTMLPatch(html, patch)
	if err != nil {
		t.Fatalf("apply patch %+v: %v", patch, err)
	}
	return next
}

func newEditorMemoryTestDocument(t *testing.T, companyID, title, documentID string) (*MemoryRepo, EditorDocumentRef) {
	t.Helper()
	repo := NewMemoryRepo()
	node, err := repo.CreateNode(companyID, title)
	if err != nil {
		t.Fatal(err)
	}
	return repo, EditorDocumentRef{CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID, DocumentID: documentID}
}

func TestEditorHTMLPatchPreservesCompleteRichHTMLExactly(t *testing.T) {
	source := `<!-- mango-editor-html-v1 --><h2 style="text-align:center"><strong>Heading</strong></h2><p>First&nbsp; row<br>second row</p><p><br></p><ul data-mango-editor-list="bullet"><li data-mango-editor-list-item="bullet">Bullet</li></ul><ul data-mango-editor-list="checklist"><li data-mango-editor-list-item="checklist" data-mango-editor-checklist-checked="true">✓ Checklist</li></ul><ol><li>One</li><li style="margin-left:32px">Indented</li></ol><p><span style="font-size:18px;background-color:#fff59d"><em><u>Format</u></em></span> <a href="https://example.test">link</a> <span data-mango-mention="true" data-mango-mention-user-id="user-1" contenteditable="false">@Ada</span></p><table data-mango-editor-table-id="table-1"><tbody><tr><th>Key</th><td>Value</td></tr></tbody></table><p><span data-mango-editor-image="true" data-mango-editor-attachment-id="attachment-1"><img src="mango-attachment:attachment-1" data-mango-attachment-id="attachment-1" alt="diagram" width="320" height="180"></span></p>`
	repo, ref := newEditorMemoryTestDocument(t, "11111111-1111-1111-1111-111111111111", "Rich HTML", "22222222-2222-4222-8222-222222222222")
	commit, err := repo.CommitEditorCollaborationOperation(EditorCollaborationOperationInput{
		Document: ref, OperationID: "rich-html", ClientID: "client-a",
		Patch: EditorHTMLPatch{Insert: source},
	})
	if err != nil {
		t.Fatal(err)
	}
	if commit.Patch.Insert != source {
		t.Fatalf("commit changed HTML: %q", commit.Patch.Insert)
	}
	snapshot, err := repo.GetEditorCollaborationSnapshot(ref)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.HTML != source {
		t.Fatalf("canonical HTML changed\nwant=%s\n got=%s", source, snapshot.HTML)
	}
	projection := repo.nodeText[key(ref.CompanyID, ref.ResourceID)][ref.DocumentID]
	if projection.Information != source {
		t.Fatalf("projection was not updated atomically: %q", projection.Information)
	}
}

func TestEditorHTMLPatchUTF8AndDisjointTransformsConverge(t *testing.T) {
	initial := "<p>ab🙂cd</p>"
	left := EditorHTMLPatch{StartUTF8: len([]byte("<p>a")), Insert: "LEFT"}
	right := EditorHTMLPatch{StartUTF8: len([]byte("<p>ab🙂c")), Insert: "右"}
	leftThenRight := applyHTMLPatchForTest(t, applyHTMLPatchForTest(t, initial, left), TransformEditorHTMLPatch(left, right, true))
	rightThenLeft := applyHTMLPatchForTest(t, applyHTMLPatchForTest(t, initial, right), TransformEditorHTMLPatch(right, left, false))
	if leftThenRight != rightThenLeft || strings.Count(leftThenRight, "LEFT") != 1 || strings.Count(leftThenRight, "右") != 1 || strings.Count(leftThenRight, "🙂") != 1 {
		t.Fatalf("disjoint UTF-8 patches did not converge: left=%q right=%q", leftThenRight, rightThenLeft)
	}
	if _, err := ApplyEditorHTMLPatch(initial, EditorHTMLPatch{StartUTF8: len([]byte("<p>ab")) + 1, DeleteUTF8: 1, Insert: "x"}); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("patch splitting UTF-8 code point error=%v", err)
	}
}

func TestEditorHTMLPatchDuplicateCommitAndBoundedOutbox(t *testing.T) {
	repo, ref := newEditorMemoryTestDocument(t, "31313131-3131-4131-8131-313131313131", "Dedupe", "32323232-3232-4232-8232-323232323232")
	input := EditorCollaborationOperationInput{
		Document: ref, OperationID: "client-a:operation-1", ClientID: "client-a",
		Patch: EditorHTMLPatch{Insert: `<!-- mango-editor-html-v1 --><p>A🙂B</p>`},
	}
	first, err := repo.CommitEditorCollaborationOperation(input)
	if err != nil {
		t.Fatal(err)
	}
	second, err := repo.CommitEditorCollaborationOperation(input)
	if err != nil {
		t.Fatal(err)
	}
	if !second.Deduplicated || second.Revision != first.Revision || second.EventID != first.EventID {
		t.Fatalf("duplicate commit was not idempotent: first=%+v second=%+v", first, second)
	}
	claimed, err := repo.ClaimRealtimeOutbox(RealtimeOutboxClaimQuery{Limit: 10, LeaseDuration: time.Second})
	if err != nil || len(claimed) != 1 {
		t.Fatalf("outbox=%+v err=%v", claimed, err)
	}
	var payload map[string]any
	if json.Unmarshal(claimed[0].Payload, &payload) != nil || payload["operation_id"] != input.OperationID || payload["patch"] == nil {
		t.Fatalf("invalid outbox payload: %s", claimed[0].Payload)
	}
	for _, forbidden := range []string{"html", "state", "ops", "snapshot"} {
		if _, exists := payload[forbidden]; exists {
			t.Fatalf("routine event contains %q: %s", forbidden, claimed[0].Payload)
		}
	}
}

func TestEditorHTMLPatchServerRebasesStaleDisjointEdit(t *testing.T) {
	repo, ref := newEditorMemoryTestDocument(t, "41414141-4141-4141-8141-414141414141", "Concurrent", "42424242-4242-4242-8242-424242424242")
	seedHTML := `<!-- mango-editor-html-v1 --><p>abcd</p>`
	seed, err := repo.CommitEditorCollaborationOperation(EditorCollaborationOperationInput{
		Document: ref, OperationID: "seed", ClientID: "seed", Patch: EditorHTMLPatch{Insert: seedHTML},
	})
	if err != nil {
		t.Fatal(err)
	}
	leftAt := strings.Index(seedHTML, "b")
	rightAt := strings.LastIndex(seedHTML, "d")
	left := EditorCollaborationOperationInput{Document: ref, OperationID: "left", ClientID: "left", BaseRevision: seed.Revision, Patch: EditorHTMLPatch{StartUTF8: leftAt, Insert: "L"}}
	right := EditorCollaborationOperationInput{Document: ref, OperationID: "right", ClientID: "right", BaseRevision: seed.Revision, Patch: EditorHTMLPatch{StartUTF8: rightAt, Insert: "R"}}
	if _, err := repo.CommitEditorCollaborationOperation(left); err != nil {
		t.Fatal(err)
	}
	commit, err := repo.CommitEditorCollaborationOperation(right)
	if err != nil {
		t.Fatal(err)
	}
	if len(commit.ConcurrentOperations) != 1 {
		t.Fatalf("concurrent operations=%+v", commit.ConcurrentOperations)
	}
	snapshot, err := repo.GetEditorCollaborationSnapshot(ref)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(snapshot.HTML, "aLbcRd") {
		t.Fatalf("stale disjoint edit was not rebased: %q", snapshot.HTML)
	}
}

func TestEditorHTMLPatchDocumentLimitRejectsAtomically(t *testing.T) {
	repo, ref := newEditorMemoryTestDocument(t, "51515151-5151-4151-8151-515151515151", "Bounded", "52525252-5252-4252-8252-525252525252")
	const chunkSize = 60_000
	for revision := 0; revision < 34; revision++ {
		if _, err := repo.CommitEditorCollaborationOperation(EditorCollaborationOperationInput{
			Document: ref, OperationID: "within-limit-" + strconv.Itoa(revision), ClientID: "client",
			BaseRevision: int64(revision), Patch: EditorHTMLPatch{StartUTF8: revision * chunkSize, Insert: strings.Repeat("x", chunkSize)},
		}); err != nil {
			t.Fatalf("within-boundary batch %d: %v", revision, err)
		}
	}
	_, err := repo.CommitEditorCollaborationOperation(EditorCollaborationOperationInput{
		Document: ref, OperationID: "too-large", ClientID: "client", BaseRevision: 34,
		Patch: EditorHTMLPatch{StartUTF8: 34 * chunkSize, Insert: strings.Repeat("y", chunkSize)},
	})
	if !errors.Is(err, ErrEditorDocumentTooLarge) {
		t.Fatalf("oversized error=%v", err)
	}
	snapshot, snapshotErr := repo.GetEditorCollaborationSnapshot(ref)
	if snapshotErr != nil || snapshot.Revision != 34 || len(snapshot.HTML) != 34*chunkSize {
		t.Fatalf("oversized operation changed canonical state: snapshot=%+v err=%v", snapshot, snapshotErr)
	}
	claimed, claimErr := repo.ClaimRealtimeOutbox(RealtimeOutboxClaimQuery{Limit: 100})
	if claimErr != nil || len(claimed) != 34 {
		t.Fatalf("oversized operation leaked outbox: %d err=%v", len(claimed), claimErr)
	}
}

func TestEditorHTMLPatchRejectsUnsafeContentWithoutOutbox(t *testing.T) {
	repo, ref := newEditorMemoryTestDocument(t, "61616161-6161-4161-8161-616161616161", "Safe", "62626262-6262-4262-8262-626262626262")
	_, err := repo.CommitEditorCollaborationOperation(EditorCollaborationOperationInput{
		Document: ref, OperationID: "unsafe", ClientID: "client",
		Patch: EditorHTMLPatch{Insert: `<img src="https://example.test/?X-Amz-Signature=secret">`},
	})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("unsafe patch error=%v", err)
	}
	claimed, _ := repo.ClaimRealtimeOutbox(RealtimeOutboxClaimQuery{})
	if len(claimed) != 0 {
		t.Fatalf("unsafe patch leaked outbox: %+v", claimed)
	}
}

func TestRealtimeOutboxLeaseRetriesAndRejectsStaleClaim(t *testing.T) {
	repo := NewMemoryRepo()
	created, err := repo.EnqueueRealtimeOutbox(RealtimeOutboxInput{
		CompanyID: "11111111-1111-1111-1111-111111111111", Scope: "board:22222222-2222-2222-2222-222222222222",
		EventType: "test", Payload: json.RawMessage(`{"type":"test"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	first, err := repo.ClaimRealtimeOutbox(RealtimeOutboxClaimQuery{LeaseDuration: time.Nanosecond})
	if err != nil || len(first) != 1 {
		t.Fatalf("first claim=%+v err=%v", first, err)
	}
	time.Sleep(time.Millisecond)
	second, err := repo.ClaimRealtimeOutbox(RealtimeOutboxClaimQuery{LeaseDuration: time.Second})
	if err != nil || len(second) != 1 || second[0].AttemptCount != 2 {
		t.Fatalf("second claim=%+v err=%v", second, err)
	}
	if err := repo.MarkRealtimeOutboxPublished(created.EventID, first[0].ClaimToken); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("stale claim error=%v", err)
	}
	if err := repo.MarkRealtimeOutboxPublished(created.EventID, second[0].ClaimToken); err != nil {
		t.Fatal(err)
	}
}
