package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNylasRESTClientListMessagesUsesSelectedFields(t *testing.T) {
	t.Parallel()

	var gotSelect string
	var gotLimit string
	var gotStarred string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v3/grants/grant-1/messages" {
			t.Fatalf("path = %q, want /v3/grants/grant-1/messages", r.URL.Path)
		}
		gotSelect = r.URL.Query().Get("select")
		gotLimit = r.URL.Query().Get("limit")
		gotStarred = r.URL.Query().Get("starred")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"message-1","subject":"Hello","unread":true,"starred":false}],"next_cursor":"next-page"}`))
	}))
	defer server.Close()

	client := NewNylasRESTClient(server.URL, "api-key", "client-id")
	starred := true
	page, err := client.ListMessages(context.Background(), "grant-1", NylasMessageQuery{Limit: communicationsNylasMaxMessageLimit, Starred: &starred})
	if err != nil {
		t.Fatal(err)
	}
	if gotSelect != nylasMessageListSelect {
		t.Fatalf("select = %q, want %q", gotSelect, nylasMessageListSelect)
	}
	if gotLimit != "20" {
		t.Fatalf("limit = %q, want 20", gotLimit)
	}
	if gotStarred != "true" {
		t.Fatalf("starred = %q, want true", gotStarred)
	}
	if page.NextPageToken != "next-page" {
		t.Fatalf("next page token = %q, want next-page", page.NextPageToken)
	}
}

func TestNylasRESTClientUpdateMessageRequestsListShapedResponse(t *testing.T) {
	t.Parallel()

	var gotSelect string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v3/grants/grant-1/messages/message-1" {
			t.Fatalf("path = %q, want /v3/grants/grant-1/messages/message-1", r.URL.Path)
		}
		if r.Method != http.MethodPut {
			t.Fatalf("method = %q, want PUT", r.Method)
		}
		gotSelect = r.URL.Query().Get("select")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"id":"message-1","subject":"Hello","unread":false,"starred":false}}`))
	}))
	defer server.Close()

	client := NewNylasRESTClient(server.URL, "api-key", "client-id")
	if _, err := client.UpdateMessage(context.Background(), "grant-1", "message-1", NylasMessageUpdate{Folders: []string{"archive"}}); err != nil {
		t.Fatal(err)
	}
	if gotSelect != nylasMessageListSelect {
		t.Fatalf("select = %q, want %q", gotSelect, nylasMessageListSelect)
	}
}
