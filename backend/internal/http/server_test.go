package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"miraeopus/backend/internal/store"
)

func TestIsLegalNodeRelationshipPositionPair(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		a    string
		b    string
		want bool
	}{
		{name: "parent_child", a: "Parent", b: "Child", want: true},
		{name: "child_parent", a: "Child", b: "Parent", want: true},
		{name: "peer_peer", a: "Peer", b: "Peer", want: true},
		{name: "parent_parent", a: "Parent", b: "Parent", want: false},
		{name: "child_child", a: "Child", b: "Child", want: false},
		{name: "parent_peer", a: "Parent", b: "Peer", want: false},
		{name: "peer_child", a: "Peer", b: "Child", want: false},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := isLegalNodeRelationshipPositionPair(tc.a, tc.b)
			if got != tc.want {
				t.Fatalf("isLegalNodeRelationshipPositionPair(%q, %q) = %t, want %t", tc.a, tc.b, got, tc.want)
			}
		})
	}
}

func TestUpdateNodeTitleViaPut(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-rename-test"
	node, err := repo.CreateNode(companyID, "old title")
	if err != nil {
		t.Fatalf("CreateNode() error = %v", err)
	}

	body, _ := json.Marshal(map[string]string{
		"company_id": companyID,
		"title":      "new title",
	})
	req := httptest.NewRequest(http.MethodPut, "/v1/nodes/"+node.NodeID, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT status = %d, want %d", rec.Code, http.StatusOK)
	}

	details, err := repo.GetNodeDetails(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("GetNodeDetails() error = %v", err)
	}
	if details.Node.Title != "new title" {
		t.Fatalf("node title = %q, want %q", details.Node.Title, "new title")
	}
}

func TestWorkspaceSnapshotReturnsNotModifiedWhenDataUnchanged(t *testing.T) {
	t.Parallel()

	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	companyID := "company-etag-test"

	_, err := repo.CreateNode(companyID, "alpha")
	if err != nil {
		t.Fatalf("CreateNode() error = %v", err)
	}

	firstReq := httptest.NewRequest(http.MethodGet, "/v1/workspace/snapshot?company_id="+companyID, nil)
	firstRec := httptest.NewRecorder()
	handler.ServeHTTP(firstRec, firstReq)
	if firstRec.Code != http.StatusOK {
		t.Fatalf("first snapshot status = %d, want %d", firstRec.Code, http.StatusOK)
	}

	etag := firstRec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("first snapshot ETag is empty")
	}

	secondReq := httptest.NewRequest(http.MethodGet, "/v1/workspace/snapshot?company_id="+companyID, nil)
	secondReq.Header.Set("If-None-Match", etag)
	secondRec := httptest.NewRecorder()
	handler.ServeHTTP(secondRec, secondReq)

	if secondRec.Code != http.StatusNotModified {
		t.Fatalf("second snapshot status = %d, want %d", secondRec.Code, http.StatusNotModified)
	}
}

func TestWorkspaceContextEventWriteAndProjectionRead(t *testing.T) {
	t.Parallel()
	repo := store.NewMemoryRepo()
	server := NewServer(repo)
	handler := server.Routes()
	body, _ := json.Marshal(map[string]any{
		"company_id":       "11111111-1111-1111-1111-111111111111",
		"workspace_id":     "22222222-2222-2222-2222-222222222222",
		"context_id":       "active_node_selection",
		"source_module_id": "node-map-frame-1",
		"sequence":         1,
		"user_action_type": "node_selection_changed",
		"payload": map[string]any{
			"selected_node_id": "abc",
		},
	})
	writeReq := httptest.NewRequest(http.MethodPost, "/v1/workspace/context-events", bytes.NewReader(body))
	writeReq.Header.Set("Content-Type", "application/json")
	writeRec := httptest.NewRecorder()
	handler.ServeHTTP(writeRec, writeReq)
	if writeRec.Code != http.StatusCreated {
		t.Fatalf("POST context-events status = %d, want %d", writeRec.Code, http.StatusCreated)
	}

	readReq := httptest.NewRequest(http.MethodGet, "/v1/workspace/context-projections?company_id=11111111-1111-1111-1111-111111111111&workspace_id=22222222-2222-2222-2222-222222222222&context_id=active_node_selection", nil)
	readRec := httptest.NewRecorder()
	handler.ServeHTTP(readRec, readReq)
	if readRec.Code != http.StatusOK {
		t.Fatalf("GET context-projections status = %d, want %d", readRec.Code, http.StatusOK)
	}
}
