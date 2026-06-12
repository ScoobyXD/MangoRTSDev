package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestNylasRESTClientSendMessageIncludesTrackingOptions(t *testing.T) {
	t.Parallel()

	var gotBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v3/grants/grant-1/messages/send" {
			t.Fatalf("path = %q, want /v3/grants/grant-1/messages/send", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Fatalf("method = %q, want POST", r.Method)
		}
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"id":"sent-1","subject":"Hello","unread":false,"starred":false}}`))
	}))
	defer server.Close()

	client := NewNylasRESTClient(server.URL, "api-key", "client-id")
	if _, err := client.SendMessage(context.Background(), "grant-1", NylasSendMessageRequest{
		To:              []NylasEmailAddress{{Email: "friend@example.com"}},
		Subject:         "Hello",
		Body:            "<p>Hello</p>",
		TrackingOptions: &NylasTrackingOptions{Opens: true},
	}); err != nil {
		t.Fatal(err)
	}
	tracking, ok := gotBody["tracking_options"].(map[string]any)
	if !ok || tracking["opens"] != true {
		t.Fatalf("tracking_options = %+v, want opens true", gotBody["tracking_options"])
	}
}

func TestNylasRESTClientSendMessageWithAttachmentsUsesMultipart(t *testing.T) {
	t.Parallel()

	var gotMessage map[string]any
	var gotAttachment string
	var gotAttachmentContentType string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v3/grants/grant-1/messages/send" {
			t.Fatalf("path = %q, want /v3/grants/grant-1/messages/send", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Fatalf("method = %q, want POST", r.Method)
		}
		if got := r.Header.Get("Content-Type"); !strings.HasPrefix(got, "multipart/form-data;") {
			t.Fatalf("content-type = %q, want multipart/form-data", got)
		}
		if err := r.ParseMultipartForm(4 << 20); err != nil {
			t.Fatalf("parse multipart: %v", err)
		}
		values := r.MultipartForm.Value["message"]
		if len(values) != 1 {
			t.Fatalf("message form values = %d, want 1", len(values))
		}
		if err := json.Unmarshal([]byte(values[0]), &gotMessage); err != nil {
			t.Fatalf("decode message part: %v", err)
		}
		if _, ok := gotMessage["attachments"]; ok {
			t.Fatalf("message part includes attachments content: %+v", gotMessage["attachments"])
		}
		files := r.MultipartForm.File["attachment_1"]
		if len(files) != 1 {
			t.Fatalf("attachment files = %d, want 1", len(files))
		}
		gotAttachmentContentType = files[0].Header.Get("Content-Type")
		file, err := files[0].Open()
		if err != nil {
			t.Fatalf("open attachment: %v", err)
		}
		defer file.Close()
		raw, err := io.ReadAll(file)
		if err != nil {
			t.Fatalf("read attachment: %v", err)
		}
		gotAttachment = string(raw)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"id":"sent-1","subject":"Hello","unread":false,"starred":false}}`))
	}))
	defer server.Close()

	client := NewNylasRESTClient(server.URL, "api-key", "client-id")
	if _, err := client.SendMessage(context.Background(), "grant-1", NylasSendMessageRequest{
		To:      []NylasEmailAddress{{Email: "friend@example.com"}},
		Subject: "Hello",
		Body:    "<p>Hello</p>",
		Attachments: []NylasAttachment{{
			Filename:    "note.txt",
			ContentType: "text/plain",
			Content:     "aGVsbG8=",
		}},
		TrackingOptions: &NylasTrackingOptions{Opens: true},
	}); err != nil {
		t.Fatal(err)
	}
	if gotMessage["subject"] != "Hello" {
		t.Fatalf("message part = %+v, want subject", gotMessage)
	}
	tracking, ok := gotMessage["tracking_options"].(map[string]any)
	if !ok || tracking["opens"] != true {
		t.Fatalf("tracking_options = %+v, want opens true", gotMessage["tracking_options"])
	}
	if gotAttachment != "hello" || gotAttachmentContentType != "text/plain" {
		t.Fatalf("attachment = %q type=%q, want hello text/plain", gotAttachment, gotAttachmentContentType)
	}
}
