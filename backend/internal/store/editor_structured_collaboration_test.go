package store

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"
)

func editorTestApply(t *testing.T, state EditorCollaborationState, operation EditorCollaborationDelta) EditorCollaborationState {
	t.Helper()
	next, err := ApplyEditorCollaborationDelta(state, operation)
	if err != nil {
		t.Fatalf("apply operation %+v: %v", operation, err)
	}
	return next
}

func editorTestTransform(t *testing.T, committed, concurrent EditorCollaborationDelta) EditorCollaborationDelta {
	t.Helper()
	transformed, err := TransformStructuredEditorOperation(committed, concurrent, true)
	if err != nil {
		t.Fatalf("transform operation: %v", err)
	}
	return transformed
}

func TestStructuredEditorRoundTripPreservesSupportedRichContent(t *testing.T) {
	source := editorCollaborationRichTextPrefix + `<h2><strong>Hello</strong> <em>world</em></h2><ul><li>One</li><li><span data-mention-user-id="user-1">@Ada</span></li></ul><table data-mango-editor-table-id="table-1"><tbody><tr><th>Key</th><td><span data-mango-editor-image="true" data-mango-editor-attachment-id="attachment-1"><img src="mango-attachment:attachment-1" data-mango-attachment-id="attachment-1" alt="diagram" width="320" height="180"></span></td></tr></tbody></table>`
	state, err := EditorCollaborationStateFromHTML(source)
	if err != nil {
		t.Fatal(err)
	}
	materialized, err := MaterializeEditorCollaborationState(state)
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{editorCollaborationRichTextPrefix, "<h2>", "<strong>Hello</strong>", "<em>world</em>", "<ul>", "data-mention-user-id=\"user-1\"", "<table", "data-mango-editor-attachment-id=\"attachment-1\"", `alt="diagram"`, `width="320"`, `height="180"`} {
		if !strings.Contains(materialized, required) {
			t.Fatalf("materialized rich document is missing %q: %s", required, materialized)
		}
	}
	reparsed, err := EditorCollaborationStateFromHTML(materialized)
	if err != nil {
		t.Fatal(err)
	}
	again, err := MaterializeEditorCollaborationState(reparsed)
	if err != nil || again != materialized {
		t.Fatalf("structured roundtrip is not stable: err=%v\nfirst=%s\nsecond=%s", err, materialized, again)
	}
}

func TestStructuredEditorOTConvergesDisjointLargeAndUnicodeEdits(t *testing.T) {
	emoji := "\U0001F642"
	rightText := "\u53f3"
	text := strings.Repeat("a", 5000) + emoji + strings.Repeat("b", 5000)
	initial := NewEditorCollaborationState("<p>" + text + "</p>")
	left := EditorCollaborationDelta{Ops: []EditorCollaborationOp{{Retain: 100}, {Insert: "LEFT"}}}
	right := EditorCollaborationDelta{Ops: []EditorCollaborationOp{{Retain: 5202}, {Insert: rightText}}}

	leftState := editorTestApply(t, initial, left)
	leftThenRight := editorTestApply(t, leftState, editorTestTransform(t, left, right))
	rightState := editorTestApply(t, initial, right)
	rightTransform, err := TransformStructuredEditorOperation(right, left, false)
	if err != nil {
		t.Fatal(err)
	}
	rightThenLeft := editorTestApply(t, rightState, rightTransform)
	first, _ := MaterializeEditorCollaborationState(leftThenRight)
	second, _ := MaterializeEditorCollaborationState(rightThenLeft)
	if first != second || strings.Count(first, "LEFT") != 1 || strings.Count(first, rightText) != 1 || strings.Count(first, emoji) != 1 {
		t.Fatalf("large Unicode operations did not converge exactly once: equal=%v left=%d right=%d emoji=%d", first == second, strings.Count(first, "LEFT"), strings.Count(first, rightText), strings.Count(first, emoji))
	}
}

func TestStructuredEditorAppliesRealisticLargeRichPasteBatches(t *testing.T) {
	state := NewEditorCollaborationState("<p>Lost acknowledgement committed once</p>")
	bold := map[string]any{"bold": true}
	for index := 0; index < 17; index++ {
		retain := 12 + index*24_576
		ops := []EditorCollaborationOp{{Retain: retain}, {Insert: strings.Repeat("Rich paste line ", 1_536), Attributes: bold}}
		if index == 0 {
			ops = []EditorCollaborationOp{
				{Retain: 1},
				{Insert: "arge paste"},
				{Insert: "\n", Attributes: map[string]any{"block": "h3"}},
				{Insert: strings.Repeat("Rich paste line ", 1_536), Attributes: bold},
			}
		}
		state = editorTestApply(t, state, EditorCollaborationDelta{Ops: ops})
	}
	final := EditorCollaborationDelta{Ops: []EditorCollaborationOp{
		{Retain: 417_804},
		{Insert: strings.Repeat("Rich paste line ", 1_888), Attributes: bold},
		{Insert: "\n", Attributes: map[string]any{"block": "p"}},
		{Insert: "Tail one"},
		{Insert: "\n", Attributes: map[string]any{"block": "li", "list": "bullet", "indent": 0}},
		{Insert: "Tail two"},
		{Delete: 34},
		{Retain: 1, Attributes: map[string]any{"block": "li", "list": "bullet", "indent": 0}},
	}}
	state = editorTestApply(t, state, final)
	materialized, err := MaterializeEditorCollaborationState(state)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(materialized, editorCollaborationRichTextPrefix+"<h3>Large paste</h3>") ||
		strings.Count(materialized, "Rich paste line ") != 28_000 ||
		!strings.Contains(materialized, "<ul>") ||
		!strings.Contains(materialized, "<li>Tail one</li>") ||
		!strings.Contains(materialized, "<li>Tail two</li>") {
		t.Fatalf("large rich paste did not survive ordered batches: length=%d repeats=%d has_ul=%v has_one=%v has_two=%v prefix=%q suffix=%q", len(materialized), strings.Count(materialized, "Rich paste line "), strings.Contains(materialized, "<ul>"), strings.Contains(materialized, "<li>Tail one</li>"), strings.Contains(materialized, "<li>Tail two</li>"), materialized[:min(len(materialized), 120)], materialized[max(0, len(materialized)-200):])
	}
}

func TestStructuredEditorOTConvergesFormattingAndBlockChanges(t *testing.T) {
	initial := NewEditorCollaborationState("<p>abcdef</p>")
	bold := EditorCollaborationDelta{Ops: []EditorCollaborationOp{{Retain: 1}, {Retain: 3, Attributes: map[string]any{"bold": true}}}}
	italic := EditorCollaborationDelta{Ops: []EditorCollaborationOp{{Retain: 2}, {Retain: 3, Attributes: map[string]any{"italic": true}}}}
	heading := EditorCollaborationDelta{Ops: []EditorCollaborationOp{{Retain: 6}, {Retain: 1, Attributes: map[string]any{"block": "h2"}}}}

	for _, concurrent := range []EditorCollaborationDelta{italic, heading} {
		left := editorTestApply(t, editorTestApply(t, initial, bold), editorTestTransform(t, bold, concurrent))
		rightTransform, err := TransformStructuredEditorOperation(concurrent, bold, false)
		if err != nil {
			t.Fatal(err)
		}
		right := editorTestApply(t, editorTestApply(t, initial, concurrent), rightTransform)
		leftHTML, leftErr := MaterializeEditorCollaborationState(left)
		rightHTML, rightErr := MaterializeEditorCollaborationState(right)
		if leftErr != nil || rightErr != nil || leftHTML != rightHTML {
			t.Fatalf("rich operations did not converge: left=%q right=%q errors=%v/%v", leftHTML, rightHTML, leftErr, rightErr)
		}
		visible := strings.NewReplacer("<strong>", "", "</strong>", "", "<em>", "", "</em>", "", "<p>", "", "</p>", "", "<h2>", "", "</h2>", "").Replace(leftHTML)
		if strings.Count(visible, "abcdef") != 1 {
			t.Fatalf("visible content duplicated by rich operation: %s", leftHTML)
		}
	}
}

func TestStructuredEditorMultiOperationBatchAndDuplicateCommit(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-1111-1111-111111111111"
	node, err := repo.CreateNode(companyID, "Collaborative node")
	if err != nil {
		t.Fatal(err)
	}
	ref := EditorDocumentRef{CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID, DocumentID: "22222222-2222-2222-2222-222222222222"}
	input := EditorCollaborationOperationInput{
		Document: ref, OperationID: "client-a:operation-1", ClientID: "client-a",
		Delta: EditorCollaborationDelta{Ops: []EditorCollaborationOp{{Insert: "A\U0001F642B\n", Attributes: map[string]any{"block": "p"}}}},
	}
	first, err := repo.CommitEditorCollaborationOperation(input)
	if err != nil {
		t.Fatal(err)
	}
	second, err := repo.CommitEditorCollaborationOperation(input)
	if err != nil {
		t.Fatal(err)
	}
	if !second.Deduplicated || second.Revision != first.Revision || second.EventID != first.EventID || second.Snapshot.HTML != editorCollaborationRichTextPrefix+"<p>A\U0001F642B</p>" {
		t.Fatalf("duplicate commit was not proven idempotent: first=%+v second=%+v", first, second)
	}
	claimed, err := repo.ClaimRealtimeOutbox(RealtimeOutboxClaimQuery{Limit: 10, LeaseDuration: time.Second})
	if err != nil || len(claimed) != 1 {
		t.Fatalf("outbox events=%+v err=%v", claimed, err)
	}
	var payload map[string]any
	if json.Unmarshal(claimed[0].Payload, &payload) != nil || payload["operation_id"] != input.OperationID {
		t.Fatalf("invalid outbox payload: %s", claimed[0].Payload)
	}
}

func TestStructuredEditorConcurrentServerCommitsTransformAgainstCanonicalOrder(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "31313131-3131-4131-8131-313131313131"
	node, _ := repo.CreateNode(companyID, "Concurrent node")
	ref := EditorDocumentRef{CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID, DocumentID: "32323232-3232-4232-8232-323232323232"}
	seed, err := repo.CommitEditorCollaborationOperation(EditorCollaborationOperationInput{
		Document: ref, OperationID: "seed", ClientID: "seed", Delta: EditorCollaborationDelta{Ops: []EditorCollaborationOp{{Insert: "abcd"}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	left := EditorCollaborationOperationInput{Document: ref, OperationID: "left", ClientID: "left", BaseRevision: seed.Revision, Delta: EditorCollaborationDelta{Ops: []EditorCollaborationOp{{Retain: 1}, {Insert: "L"}}}}
	right := EditorCollaborationOperationInput{Document: ref, OperationID: "right", ClientID: "right", BaseRevision: seed.Revision, Delta: EditorCollaborationDelta{Ops: []EditorCollaborationOp{{Retain: 3}, {Insert: "R"}}}}
	if _, err := repo.CommitEditorCollaborationOperation(left); err != nil {
		t.Fatal(err)
	}
	commit, err := repo.CommitEditorCollaborationOperation(right)
	if err != nil {
		t.Fatal(err)
	}
	if commit.Snapshot.HTML != editorCollaborationRichTextPrefix+"aLbcRd" {
		t.Fatalf("server did not transform stale operation against canonical order: %q", commit.Snapshot.HTML)
	}
}

func TestStructuredEditorDocumentLimitRejectsAtomically(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "41414141-4141-4141-8141-414141414141"
	node, _ := repo.CreateNode(companyID, "Bounded node")
	ref := EditorDocumentRef{CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID, DocumentID: "42424242-4242-4242-8242-424242424242"}
	const chunkSize = 60_000
	for revision := 0; revision < 34; revision++ {
		operation := EditorCollaborationDelta{Ops: []EditorCollaborationOp{{Insert: strings.Repeat("x", chunkSize)}}}
		if revision > 0 {
			operation.Ops = append([]EditorCollaborationOp{{Retain: revision * chunkSize}}, operation.Ops...)
		}
		if _, err := repo.CommitEditorCollaborationOperation(EditorCollaborationOperationInput{
			Document: ref, OperationID: "within-limit-" + strconv.Itoa(revision), ClientID: "client",
			BaseRevision: int64(revision), Delta: operation,
		}); err != nil {
			t.Fatalf("within-boundary batch %d: %v", revision, err)
		}
	}
	_, err := repo.CommitEditorCollaborationOperation(EditorCollaborationOperationInput{
		Document: ref, OperationID: "too-large", ClientID: "client", BaseRevision: 34,
		Delta: EditorCollaborationDelta{Ops: []EditorCollaborationOp{{Retain: 34 * chunkSize}, {Insert: strings.Repeat("y", chunkSize)}}},
	})
	if !errors.Is(err, ErrEditorDocumentTooLarge) {
		t.Fatalf("oversized document error=%v", err)
	}
	snapshot, snapshotErr := repo.GetEditorCollaborationSnapshot(ref)
	if snapshotErr != nil || snapshot.Revision != 34 || len(snapshot.HTML) != len(editorCollaborationRichTextPrefix)+34*chunkSize {
		t.Fatalf("oversized operation changed canonical state: snapshot=%+v err=%v", snapshot, snapshotErr)
	}
	claimed, claimErr := repo.ClaimRealtimeOutbox(RealtimeOutboxClaimQuery{Limit: 100})
	if claimErr != nil || len(claimed) != 34 {
		t.Fatalf("oversized operation leaked outbox event: %+v err=%v", claimed, claimErr)
	}
}

func TestStructuredEditorRejectsUnsafeEmbedWithoutOutbox(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "51515151-5151-4151-8151-515151515151"
	node, _ := repo.CreateNode(companyID, "Safe node")
	ref := EditorDocumentRef{CompanyID: companyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID, DocumentID: "52525252-5252-4252-8252-525252525252"}
	_, err := repo.CommitEditorCollaborationOperation(EditorCollaborationOperationInput{
		Document: ref, OperationID: "unsafe", ClientID: "client",
		Delta: EditorCollaborationDelta{Ops: []EditorCollaborationOp{{Insert: map[string]any{"attachment": map[string]any{"attachment_id": "id", "presigned_url": "https://example.test/?X-Amz-Signature=secret"}}}}},
	})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("unsafe embed error=%v", err)
	}
	claimed, _ := repo.ClaimRealtimeOutbox(RealtimeOutboxClaimQuery{})
	if len(claimed) != 0 {
		t.Fatalf("unsafe embed leaked outbox: %+v", claimed)
	}
}

func TestRealtimeOutboxLeaseRetriesAndRejectsStaleClaimStructured(t *testing.T) {
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
