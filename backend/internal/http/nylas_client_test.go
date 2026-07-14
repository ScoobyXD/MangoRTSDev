package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

func assertURLQueryEqual(t *testing.T, got, want url.Values) {
	t.Helper()
	if got.Encode() != want.Encode() {
		t.Fatalf("query = %v, want %v", got, want)
	}
}

func TestNylasRESTClientListMessagesUsesSelectedFields(t *testing.T) {
	t.Parallel()

	var gotQuery url.Values
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v3/grants/grant-1/messages" {
			t.Fatalf("path = %q, want /v3/grants/grant-1/messages", r.URL.Path)
		}
		gotQuery = r.URL.Query()
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
	assertURLQueryEqual(t, gotQuery, url.Values{
		"limit":   {"12"},
		"select":  {nylasMessageListSelect},
		"starred": {"true"},
	})
	if page.NextPageToken != "next-page" {
		t.Fatalf("next page token = %q, want next-page", page.NextPageToken)
	}
}

func TestNylasRESTClientListMessagesNativeSearchUsesOnlyAllowedParameters(t *testing.T) {
	t.Parallel()

	var gotQuery url.Values
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.Query()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"message-1","subject":"Hello","snippet":"Preview","body":"<p>Full body</p>","attachments":[{"id":"attachment-1","filename":"invoice.pdf","content_type":"application/pdf","content":"provider-bytes"}]}],"next_cursor":"next-page"}`))
	}))
	defer server.Close()

	client := NewNylasRESTClient(server.URL, "api-key", "client-id")
	unread := true
	starred := true
	page, err := client.ListMessages(context.Background(), "grant-1", NylasMessageQuery{
		Limit:             communicationsNylasMaxMessageLimit,
		PageToken:         "page-1",
		FolderID:          "INBOX",
		Query:             "invoice",
		SearchQueryNative: "in:inbox -category:social -category:promotions invoice is:unread",
		Unread:            &unread,
		Starred:           &starred,
	})
	if err != nil {
		t.Fatal(err)
	}
	assertURLQueryEqual(t, gotQuery, url.Values{
		"limit":               {"12"},
		"page_token":          {"page-1"},
		"search_query_native": {"in:inbox -category:social -category:promotions invoice is:unread"},
	})
	if page.NextPageToken != "next-page" {
		t.Fatalf("next page token = %q, want next-page", page.NextPageToken)
	}
	if len(page.Messages) != 1 || page.Messages[0].Body != "" || len(page.Messages[0].Attachments) != 1 ||
		page.Messages[0].Attachments[0].ID != "attachment-1" || page.Messages[0].Attachments[0].Content != "" {
		t.Fatalf("native list message = %+v, want preview metadata without body or attachment bytes", page.Messages)
	}
}

func TestNylasRESTClientListMessagesThreadIDTakesPrecedenceOverNativeSearch(t *testing.T) {
	t.Parallel()

	var gotQuery url.Values
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.Query()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[]}`))
	}))
	defer server.Close()

	client := NewNylasRESTClient(server.URL, "api-key", "client-id")
	unread := true
	starred := true
	_, err := client.ListMessages(context.Background(), "grant-1", NylasMessageQuery{
		Limit:             communicationsNylasMaxMessageLimit,
		PageToken:         "thread-page",
		FolderID:          "INBOX",
		ThreadID:          "thread-1",
		Query:             "ignored",
		SearchQueryNative: "in:anywhere",
		Unread:            &unread,
		Starred:           &starred,
	})
	if err != nil {
		t.Fatal(err)
	}
	assertURLQueryEqual(t, gotQuery, url.Values{
		"limit":      {"12"},
		"page_token": {"thread-page"},
		"select":     {nylasMessageListSelect},
		"thread_id":  {"thread-1"},
	})
}

func TestParseNylasAPIErrorParsesNestedErrorObject(t *testing.T) {
	t.Parallel()

	err := parseNylasAPIError(
		http.StatusBadRequest,
		http.Header{"Retry-After": []string{"3"}},
		[]byte(`{"request_id":"request-1","error":{"type":"invalid_request_error","message":"You cannot combine native and structured query parameters."}}`),
	)
	var apiErr NylasAPIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("error = %v, want NylasAPIError", err)
	}
	if apiErr.StatusCode != http.StatusBadRequest || apiErr.Code != "invalid_request_error" ||
		apiErr.Message != "You cannot combine native and structured query parameters." || apiErr.RetryAfter != "3" {
		t.Fatalf("Nylas API error = %+v", apiErr)
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

func TestNylasRESTClientDownloadAttachment(t *testing.T) {
	t.Parallel()

	var gotMessageID string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v3/grants/grant-1/attachments/attachment-1/download" {
			t.Fatalf("path = %q, want attachment download path", r.URL.Path)
		}
		if r.Method != http.MethodGet {
			t.Fatalf("method = %q, want GET", r.Method)
		}
		gotMessageID = r.URL.Query().Get("message_id")
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write([]byte("image-bytes"))
	}))
	defer server.Close()

	client := NewNylasRESTClient(server.URL, "api-key", "client-id")
	content, err := client.DownloadAttachment(context.Background(), "grant-1", "message-1", "attachment-1")
	if err != nil {
		t.Fatal(err)
	}
	if gotMessageID != "message-1" {
		t.Fatalf("message_id = %q, want message-1", gotMessageID)
	}
	if string(content) != "image-bytes" {
		t.Fatalf("content = %q, want image-bytes", string(content))
	}
}

func TestNylasRESTClientGetMessageRawMIME(t *testing.T) {
	t.Parallel()

	var gotFields string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v3/grants/grant-1/messages/message-1" {
			t.Fatalf("path = %q, want message path", r.URL.Path)
		}
		if r.Method != http.MethodGet {
			t.Fatalf("method = %q, want GET", r.Method)
		}
		gotFields = r.URL.Query().Get("fields")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"raw_mime":"From: sender@example.com\r\n\r\nBody"}}`))
	}))
	defer server.Close()

	client := NewNylasRESTClient(server.URL, "api-key", "client-id")
	rawMIME, err := client.GetMessageRawMIME(context.Background(), "grant-1", "message-1")
	if err != nil {
		t.Fatal(err)
	}
	if gotFields != "raw_mime" {
		t.Fatalf("fields = %q, want raw_mime", gotFields)
	}
	if rawMIME != "From: sender@example.com\r\n\r\nBody" {
		t.Fatalf("rawMIME = %q, want raw MIME response", rawMIME)
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
		if got := r.Header.Get("Idempotency-Key"); got != "json-logical-send" {
			t.Fatalf("idempotency key = %q, want json-logical-send", got)
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
		IdempotencyKey:  "json-logical-send",
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
	source := newNylasTrackedReadCloser(io.NopCloser(strings.NewReader("hello")))
	openCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v3/grants/grant-1/messages/send" {
			t.Fatalf("path = %q, want /v3/grants/grant-1/messages/send", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Fatalf("method = %q, want POST", r.Method)
		}
		if got := r.Header.Get("Idempotency-Key"); got != "multipart-logical-send" {
			t.Fatalf("idempotency key = %q, want multipart-logical-send", got)
		}
		if r.ContentLength <= 0 {
			t.Fatalf("content length = %d, want positive deterministic length", r.ContentLength)
		}
		if len(r.TransferEncoding) != 0 {
			t.Fatalf("transfer encoding = %+v, want non-chunked request", r.TransferEncoding)
		}
		if got := r.Header.Get("Content-Type"); !strings.HasPrefix(got, "multipart/form-data;") {
			t.Fatalf("content-type = %q, want multipart/form-data", got)
		}
		countingBody := &nylasCountingReadCloser{ReadCloser: r.Body}
		r.Body = countingBody
		if err := r.ParseMultipartForm(4 << 20); err != nil {
			t.Fatalf("parse multipart: %v", err)
		}
		if countingBody.bytesRead != r.ContentLength {
			t.Fatalf("received multipart bytes = %d, content length = %d", countingBody.bytesRead, r.ContentLength)
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
			Size:        5,
		}},
		OutboundAttachments: []NylasOutboundAttachment{{
			Filename:    "note.txt",
			ContentType: "text/plain",
			Size:        5,
			Open: func(context.Context) (NylasOutboundAttachmentContent, error) {
				openCalls++
				return NylasOutboundAttachmentContent{ContentLength: 5, Body: source}, nil
			},
		}},
		TrackingOptions: &NylasTrackingOptions{Opens: true},
		IdempotencyKey:  "multipart-logical-send",
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
	reads, closes := source.counts()
	if openCalls != 1 || reads == 0 || closes != 1 {
		t.Fatalf("source lifecycle = opens %d reads %d closes %d, want 1, positive, 1", openCalls, reads, closes)
	}
}

func TestNylasRESTClientUsesInlineContentIDAsMultipartFieldName(t *testing.T) {
	t.Parallel()

	const contentID = "mango0123456789abcdef"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(4 << 20); err != nil {
			t.Fatalf("parse multipart: %v", err)
		}
		values := r.MultipartForm.Value["message"]
		if len(values) != 1 || !strings.Contains(values[0], `cid:`+contentID) {
			t.Fatalf("message form values = %+v, want matching cid body", values)
		}
		files := r.MultipartForm.File[contentID]
		if len(files) != 1 {
			t.Fatalf("inline attachment files = %d, want one under CID field", len(files))
		}
		file, err := files[0].Open()
		if err != nil {
			t.Fatal(err)
		}
		defer file.Close()
		raw, err := io.ReadAll(file)
		if err != nil {
			t.Fatal(err)
		}
		if string(raw) != "png-bytes" || files[0].Header.Get("Content-Type") != "image/png" {
			t.Fatalf("inline attachment = %q type=%q", raw, files[0].Header.Get("Content-Type"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"id":"sent-inline"}}`))
	}))
	defer server.Close()

	client := NewNylasRESTClient(server.URL, "api-key", "client-id")
	_, err := client.SendMessage(context.Background(), "grant-1", NylasSendMessageRequest{
		To:      []NylasEmailAddress{{Email: "friend@example.com"}},
		Subject: "Inline screenshot",
		Body:    `<p>Screenshot</p><img src="cid:` + contentID + `">`,
		Attachments: []NylasAttachment{{
			Filename:    "screenshot.png",
			ContentType: "image/png",
			ContentID:   contentID,
			IsInline:    true,
			Size:        9,
		}},
		OutboundAttachments: []NylasOutboundAttachment{{
			Filename:    "screenshot.png",
			ContentType: "image/png",
			ContentID:   contentID,
			Size:        9,
			Open: func(context.Context) (NylasOutboundAttachmentContent, error) {
				return NylasOutboundAttachmentContent{
					ContentLength: 9,
					Body:          io.NopCloser(strings.NewReader("png-bytes")),
				}, nil
			},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestNylasRESTClientMultipartPreservesOrderAndSingleActiveSource(t *testing.T) {
	var lifecycleMu sync.Mutex
	active := 0
	maxActive := 0
	openOrder := make([]string, 0, 2)
	newSource := func(name, content string) (*nylasTrackedReadCloser, NylasOutboundAttachmentOpener) {
		var source *nylasTrackedReadCloser
		source = newNylasTrackedReadCloserWithClose(
			io.NopCloser(strings.NewReader(content)),
			func() {
				lifecycleMu.Lock()
				active--
				lifecycleMu.Unlock()
			},
		)
		open := func(context.Context) (NylasOutboundAttachmentContent, error) {
			lifecycleMu.Lock()
			active++
			if active > maxActive {
				maxActive = active
			}
			openOrder = append(openOrder, name)
			lifecycleMu.Unlock()
			return NylasOutboundAttachmentContent{ContentLength: int64(len(content)), Body: source}, nil
		}
		return source, open
	}
	firstSource, firstOpen := newSource("first", "first-bytes")
	secondSource, secondOpen := newSource("second", "second-bytes")

	serverResult := make(chan error, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		err := func() error {
			mediaType, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
			if err != nil {
				return fmt.Errorf("parse content type: %w", err)
			}
			if mediaType != "multipart/form-data" || params["boundary"] == "" {
				return fmt.Errorf("content type = %q boundary=%q", mediaType, params["boundary"])
			}
			countingBody := &nylasCountingReadCloser{ReadCloser: r.Body}
			reader := multipart.NewReader(countingBody, params["boundary"])
			messagePart, err := reader.NextPart()
			if err != nil {
				return fmt.Errorf("read message part: %w", err)
			}
			if messagePart.FormName() != "message" || messagePart.FileName() != "" {
				return fmt.Errorf("message part metadata = name %q filename %q", messagePart.FormName(), messagePart.FileName())
			}
			messageRaw, err := io.ReadAll(messagePart)
			if err != nil {
				return fmt.Errorf("read message JSON: %w", err)
			}
			var message map[string]any
			if err := json.Unmarshal(messageRaw, &message); err != nil {
				return fmt.Errorf("decode message JSON: %w", err)
			}
			if _, exists := message["attachments"]; exists {
				return errors.New("message JSON unexpectedly includes attachments")
			}
			assertAttachment := func(fieldName, filename, contentType, content string) error {
				part, err := reader.NextPart()
				if err != nil {
					return err
				}
				if part.FormName() != fieldName || part.FileName() != filename {
					return fmt.Errorf("part metadata = name %q filename %q, want %q %q", part.FormName(), part.FileName(), fieldName, filename)
				}
				if got := part.Header.Get("Content-Type"); got != contentType {
					return fmt.Errorf("part content type = %q, want %q", got, contentType)
				}
				raw, err := io.ReadAll(part)
				if err != nil {
					return err
				}
				if string(raw) != content {
					return fmt.Errorf("part content = %q, want %q", raw, content)
				}
				return nil
			}
			if err := assertAttachment("attachment_1", "first.txt", "text/plain", "first-bytes"); err != nil {
				return fmt.Errorf("first attachment: %w", err)
			}
			if err := assertAttachment("inline-cid", "second.png", "image/png", "second-bytes"); err != nil {
				return fmt.Errorf("second attachment: %w", err)
			}
			if _, err := reader.NextPart(); !errors.Is(err, io.EOF) {
				return fmt.Errorf("final multipart boundary: %v", err)
			}
			if countingBody.bytesRead != r.ContentLength {
				return fmt.Errorf("received multipart bytes = %d, content length = %d", countingBody.bytesRead, r.ContentLength)
			}
			return nil
		}()
		serverResult <- err
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("{\"data\":{\"id\":\"sent-ordered\"}}"))
	}))
	defer server.Close()

	client := NewNylasRESTClient(server.URL, "api-key", "client-id")
	_, err := client.SendMessage(context.Background(), "grant-1", NylasSendMessageRequest{
		To:      []NylasEmailAddress{{Email: "friend@example.com"}},
		Subject: "Ordered",
		Body:    "<p>Ordered</p>",
		Attachments: []NylasAttachment{
			{Filename: "first.txt", ContentType: "text/plain", Size: 11},
			{Filename: "second.png", ContentType: "image/png", ContentID: "inline-cid", IsInline: true, Size: 12},
		},
		OutboundAttachments: []NylasOutboundAttachment{
			{Filename: "first.txt", ContentType: "text/plain", Size: 11, Open: firstOpen},
			{Filename: "second.png", ContentType: "image/png", ContentID: "inline-cid", Size: 12, Open: secondOpen},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := waitNylasTestResult(t, serverResult); err != nil {
		t.Fatal(err)
	}
	lifecycleMu.Lock()
	gotActive := active
	gotMaxActive := maxActive
	gotOpenOrder := append([]string(nil), openOrder...)
	lifecycleMu.Unlock()
	if gotActive != 0 || gotMaxActive != 1 || strings.Join(gotOpenOrder, ",") != "first,second" {
		t.Fatalf("stream lifecycle = active %d max %d order %v, want 0, 1, [first second]", gotActive, gotMaxActive, gotOpenOrder)
	}
	for name, source := range map[string]*nylasTrackedReadCloser{"first": firstSource, "second": secondSource} {
		reads, closes := source.counts()
		if reads == 0 || closes != 1 {
			t.Fatalf("%s source lifecycle = reads %d closes %d, want positive and 1", name, reads, closes)
		}
	}
}

func TestNylasRESTClientMultipartStreamsBeforeAttachmentCompletes(t *testing.T) {
	const content = "prefix-suffix"
	sourceReader, sourceWriter := io.Pipe()
	source := newNylasTrackedReadCloser(sourceReader)
	sourceOpened := make(chan struct{})
	prefixReceived := make(chan struct{})
	serverResult := make(chan error, 1)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		err := func() error {
			mediaType, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
			if err != nil {
				return err
			}
			if mediaType != "multipart/form-data" {
				return fmt.Errorf("media type = %q", mediaType)
			}
			reader := multipart.NewReader(r.Body, params["boundary"])
			messagePart, err := reader.NextPart()
			if err != nil {
				return err
			}
			if _, err := io.ReadAll(messagePart); err != nil {
				return err
			}
			attachmentPart, err := reader.NextPart()
			if err != nil {
				return err
			}
			if attachmentPart.FormName() != "attachment_1" || attachmentPart.FileName() != "gated.txt" {
				return fmt.Errorf("attachment metadata = %q %q", attachmentPart.FormName(), attachmentPart.FileName())
			}
			prefix := make([]byte, len("prefix"))
			if _, err := io.ReadFull(attachmentPart, prefix); err != nil {
				return err
			}
			if string(prefix) != "prefix" {
				return fmt.Errorf("prefix = %q", prefix)
			}
			close(prefixReceived)
			rest, err := io.ReadAll(attachmentPart)
			if err != nil {
				return err
			}
			if string(prefix)+string(rest) != content {
				return fmt.Errorf("content = %q", string(prefix)+string(rest))
			}
			if _, err := reader.NextPart(); !errors.Is(err, io.EOF) {
				return fmt.Errorf("final multipart boundary: %v", err)
			}
			return nil
		}()
		serverResult <- err
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("{\"data\":{\"id\":\"sent-streamed\"}}"))
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sendDone := make(chan error, 1)
	client := NewNylasRESTClient(server.URL, "api-key", "client-id")
	go func() {
		_, err := client.SendMessage(ctx, "grant-1", NylasSendMessageRequest{
			To:          []NylasEmailAddress{{Email: "friend@example.com"}},
			Subject:     "Streamed",
			Body:        "<p>Streamed</p>",
			Attachments: []NylasAttachment{{Filename: "gated.txt", ContentType: "text/plain", Size: int64(len(content))}},
			OutboundAttachments: []NylasOutboundAttachment{{
				Filename:    "gated.txt",
				ContentType: "text/plain",
				Size:        int64(len(content)),
				Open: func(context.Context) (NylasOutboundAttachmentContent, error) {
					close(sourceOpened)
					return NylasOutboundAttachmentContent{ContentLength: int64(len(content)), Body: source}, nil
				},
			}},
		})
		sendDone <- err
	}()

	waitNylasTestSignal(t, sourceOpened, "attachment source to open")
	allowRest := make(chan struct{})
	producerDone := make(chan error, 1)
	go func() {
		var producerErr error
		defer func() {
			_ = sourceWriter.CloseWithError(producerErr)
			producerDone <- producerErr
		}()
		if _, producerErr = sourceWriter.Write([]byte("prefix")); producerErr != nil {
			return
		}
		<-allowRest
		_, producerErr = sourceWriter.Write([]byte("-suffix"))
	}()

	waitNylasTestSignal(t, prefixReceived, "server to receive attachment prefix")
	select {
	case err := <-producerDone:
		t.Fatalf("source completed before rest was released: %v", err)
	default:
	}
	close(allowRest)
	if err := waitNylasTestResult(t, producerDone); err != nil {
		t.Fatal(err)
	}
	if err := waitNylasTestResult(t, sendDone); err != nil {
		t.Fatal(err)
	}
	if err := waitNylasTestResult(t, serverResult); err != nil {
		t.Fatal(err)
	}
	_, closes := source.counts()
	if closes != 1 {
		t.Fatalf("source closes = %d, want 1", closes)
	}
}

func TestNylasRESTClientMultipartSupportsZeroSizeAttachment(t *testing.T) {
	source := newNylasTrackedReadCloser(io.NopCloser(strings.NewReader("")))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.ContentLength <= 0 || len(r.TransferEncoding) != 0 {
			t.Errorf("request framing = length %d transfer %v", r.ContentLength, r.TransferEncoding)
		}
		countingBody := &nylasCountingReadCloser{ReadCloser: r.Body}
		r.Body = countingBody
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Errorf("parse multipart: %v", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		files := r.MultipartForm.File["attachment_1"]
		if len(files) != 1 {
			t.Errorf("zero-size file count = %d", len(files))
		} else {
			file, err := files[0].Open()
			if err != nil {
				t.Errorf("open zero-size file: %v", err)
			} else {
				raw, readErr := io.ReadAll(file)
				_ = file.Close()
				if readErr != nil || len(raw) != 0 {
					t.Errorf("zero-size file = %d bytes, err %v", len(raw), readErr)
				}
			}
		}
		if countingBody.bytesRead != r.ContentLength {
			t.Errorf("received multipart bytes = %d, content length = %d", countingBody.bytesRead, r.ContentLength)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("{\"data\":{\"id\":\"sent-empty\"}}"))
	}))
	defer server.Close()

	client := NewNylasRESTClient(server.URL, "api-key", "client-id")
	_, err := client.SendMessage(context.Background(), "grant-1", NylasSendMessageRequest{
		To:          []NylasEmailAddress{{Email: "friend@example.com"}},
		Subject:     "Empty",
		Body:        "<p>Empty</p>",
		Attachments: []NylasAttachment{{Filename: "empty.txt", ContentType: "text/plain", Size: 0}},
		OutboundAttachments: []NylasOutboundAttachment{{
			Filename:    "empty.txt",
			ContentType: "text/plain",
			Size:        0,
			Open: func(context.Context) (NylasOutboundAttachmentContent, error) {
				return NylasOutboundAttachmentContent{ContentLength: 0, Body: source}, nil
			},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	reads, closes := source.counts()
	if reads == 0 || closes != 1 {
		t.Fatalf("zero-size source lifecycle = reads %d closes %d, want positive and 1", reads, closes)
	}
}

func TestNylasRESTClientMultipartRejectsInvalidAttachmentLengthsAndClosesSources(t *testing.T) {
	readFailure := errors.New("source read failure")
	testCases := []struct {
		name           string
		size           int64
		reported       int64
		newReader      func() io.Reader
		want           error
		wantUnderlying error
		wantZeroReads  bool
	}{
		{
			name:          "reported content length mismatch",
			size:          3,
			reported:      4,
			newReader:     func() io.Reader { return strings.NewReader("abc") },
			want:          errNylasOutboundAttachmentContentLengthMismatch,
			wantZeroReads: true,
		},
		{
			name:      "short source",
			size:      4,
			reported:  4,
			newReader: func() io.Reader { return strings.NewReader("abc") },
			want:      errNylasOutboundAttachmentShort,
		},
		{
			name:      "long source",
			size:      3,
			reported:  3,
			newReader: func() io.Reader { return strings.NewReader("abcd") },
			want:      errNylasOutboundAttachmentLong,
		},
		{
			name:           "source read failure",
			size:           4,
			reported:       4,
			newReader:      func() io.Reader { return &nylasFailingReader{content: []byte("ab"), err: readFailure} },
			want:           errNylasOutboundAttachmentRead,
			wantUnderlying: readFailure,
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = io.Copy(io.Discard, r.Body)
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte("{\"data\":{\"id\":\"should-not-send\"}}"))
			}))
			defer server.Close()

			source := newNylasTrackedReadCloser(io.NopCloser(testCase.newReader()))
			client := NewNylasRESTClient(server.URL, "api-key", "client-id")
			_, err := client.SendMessage(context.Background(), "grant-1", NylasSendMessageRequest{
				To:          []NylasEmailAddress{{Email: "friend@example.com"}},
				Subject:     "Invalid source",
				Body:        "<p>Invalid</p>",
				Attachments: []NylasAttachment{{Filename: "invalid.bin", ContentType: "application/octet-stream", Size: testCase.size}},
				OutboundAttachments: []NylasOutboundAttachment{{
					Filename:    "invalid.bin",
					ContentType: "application/octet-stream",
					Size:        testCase.size,
					Open: func(context.Context) (NylasOutboundAttachmentContent, error) {
						return NylasOutboundAttachmentContent{ContentLength: testCase.reported, Body: source}, nil
					},
				}},
			})
			if !errors.Is(err, testCase.want) {
				t.Fatalf("error = %v, want errors.Is(%v)", err, testCase.want)
			}
			if testCase.wantUnderlying != nil && !errors.Is(err, testCase.wantUnderlying) {
				t.Fatalf("error = %v, want wrapped source error %v", err, testCase.wantUnderlying)
			}
			reads, closes := source.counts()
			if closes != 1 {
				t.Fatalf("source closes = %d, want 1", closes)
			}
			if testCase.wantZeroReads && reads != 0 {
				t.Fatalf("source reads = %d, want 0", reads)
			}
			if !testCase.wantZeroReads && reads == 0 {
				t.Fatal("source was never read")
			}
		})
	}
}

func TestNylasRESTClientMultipartWrapsOpenErrorAndClosesReturnedSource(t *testing.T) {
	storageErr := errors.New("storage unavailable")
	source := newNylasTrackedReadCloser(io.NopCloser(strings.NewReader("unused")))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("{\"data\":{\"id\":\"should-not-send\"}}"))
	}))
	defer server.Close()

	client := NewNylasRESTClient(server.URL, "api-key", "client-id")
	_, err := client.SendMessage(context.Background(), "grant-1", NylasSendMessageRequest{
		To:          []NylasEmailAddress{{Email: "friend@example.com"}},
		Subject:     "Open failure",
		Body:        "<p>Open failure</p>",
		Attachments: []NylasAttachment{{Filename: "stored.bin", Size: 6}},
		OutboundAttachments: []NylasOutboundAttachment{{
			Filename: "stored.bin",
			Size:     6,
			Open: func(context.Context) (NylasOutboundAttachmentContent, error) {
				return NylasOutboundAttachmentContent{ContentLength: 6, Body: source}, storageErr
			},
		}},
	})
	if !errors.Is(err, errNylasOutboundAttachmentOpen) || !errors.Is(err, storageErr) {
		t.Fatalf("error = %v, want both open and storage sentinels", err)
	}
	reads, closes := source.counts()
	if reads != 0 || closes != 1 {
		t.Fatalf("source lifecycle = reads %d closes %d, want 0 and 1", reads, closes)
	}
}

func TestNylasRESTClientMultipartCancellationClosesActiveSource(t *testing.T) {
	source := newNylasBlockingReadCloser()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("{\"data\":{\"id\":\"should-not-send\"}}"))
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	sendDone := make(chan error, 1)
	client := NewNylasRESTClient(server.URL, "api-key", "client-id")
	go func() {
		_, err := client.SendMessage(ctx, "grant-1", NylasSendMessageRequest{
			To:          []NylasEmailAddress{{Email: "friend@example.com"}},
			Subject:     "Cancel",
			Body:        "<p>Cancel</p>",
			Attachments: []NylasAttachment{{Filename: "blocked.bin", Size: 1}},
			OutboundAttachments: []NylasOutboundAttachment{{
				Filename: "blocked.bin",
				Size:     1,
				Open: func(context.Context) (NylasOutboundAttachmentContent, error) {
					return NylasOutboundAttachmentContent{ContentLength: 1, Body: source}, nil
				},
			}},
		})
		sendDone <- err
	}()

	waitNylasTestSignal(t, source.started, "attachment read to start")
	cancel()
	err := waitNylasTestResult(t, sendDone)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want context canceled", err)
	}
	if closes := source.closes(); closes != 1 {
		t.Fatalf("source closes = %d, want 1", closes)
	}
}

func TestNylasRESTClientMultipartProviderEarlyFailureClosesActiveSource(t *testing.T) {
	source := newNylasBlockingReadCloser()
	serverResult := make(chan error, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		err := func() error {
			reader, err := r.MultipartReader()
			if err != nil {
				return err
			}
			messagePart, err := reader.NextPart()
			if err != nil {
				return err
			}
			if _, err := io.ReadAll(messagePart); err != nil {
				return err
			}
			attachmentPart, err := reader.NextPart()
			if err != nil {
				return err
			}
			if attachmentPart.FormName() != "attachment_1" {
				return fmt.Errorf("attachment field = %q", attachmentPart.FormName())
			}
			select {
			case <-source.started:
				return nil
			case <-time.After(5 * time.Second):
				return errors.New("attachment read did not start")
			}
		}()
		serverResult <- err
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Connection", "close")
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		_, _ = w.Write([]byte("{\"type\":\"provider_rejected\",\"message\":\"stop streaming\"}"))
	}))
	defer server.Close()

	sendDone := make(chan error, 1)
	client := NewNylasRESTClient(server.URL, "api-key", "client-id")
	go func() {
		_, err := client.SendMessage(context.Background(), "grant-1", NylasSendMessageRequest{
			To:          []NylasEmailAddress{{Email: "friend@example.com"}},
			Subject:     "Provider failure",
			Body:        "<p>Provider failure</p>",
			Attachments: []NylasAttachment{{Filename: "blocked.bin", Size: 1}},
			OutboundAttachments: []NylasOutboundAttachment{{
				Filename: "blocked.bin",
				Size:     1,
				Open: func(context.Context) (NylasOutboundAttachmentContent, error) {
					return NylasOutboundAttachmentContent{ContentLength: 1, Body: source}, nil
				},
			}},
		})
		sendDone <- err
	}()

	err := waitNylasTestResult(t, sendDone)
	if handlerErr := waitNylasTestResult(t, serverResult); handlerErr != nil {
		t.Fatal(handlerErr)
	}
	var apiErr NylasAPIError
	if !errors.As(err, &apiErr) || apiErr.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("error = %v, want Nylas 413", err)
	}
	if closes := source.closes(); closes != 1 {
		t.Fatalf("source closes = %d, want 1", closes)
	}
}

func TestNylasRESTClientRequiresMatchingOutboundAttachmentStreams(t *testing.T) {
	client := NewNylasRESTClient("http://127.0.0.1:1", "api-key", "client-id")
	_, err := client.SendMessage(context.Background(), "grant-1", NylasSendMessageRequest{
		Attachments: []NylasAttachment{{Filename: "missing.bin", Size: 1}},
	})
	if !errors.Is(err, errNylasOutboundAttachmentMissingStream) {
		t.Fatalf("metadata-only error = %v, want missing stream", err)
	}
	_, err = client.SendMessage(context.Background(), "grant-1", NylasSendMessageRequest{
		OutboundAttachments: []NylasOutboundAttachment{{
			Filename: "extra.bin",
			Size:     1,
			Open: func(context.Context) (NylasOutboundAttachmentContent, error) {
				return NylasOutboundAttachmentContent{}, nil
			},
		}},
	})
	if !errors.Is(err, errNylasOutboundAttachmentCountMismatch) {
		t.Fatalf("stream-only error = %v, want count mismatch", err)
	}
}

type nylasCountingReadCloser struct {
	io.ReadCloser
	bytesRead int64
}

func (r *nylasCountingReadCloser) Read(p []byte) (int, error) {
	n, err := r.ReadCloser.Read(p)
	r.bytesRead += int64(n)
	return n, err
}

type nylasTrackedReadCloser struct {
	body      io.ReadCloser
	onClose   func()
	closeOnce sync.Once

	mu         sync.Mutex
	reads      int
	closeCalls int
}

func newNylasTrackedReadCloser(body io.ReadCloser) *nylasTrackedReadCloser {
	return newNylasTrackedReadCloserWithClose(body, nil)
}

func newNylasTrackedReadCloserWithClose(body io.ReadCloser, onClose func()) *nylasTrackedReadCloser {
	return &nylasTrackedReadCloser{body: body, onClose: onClose}
}

func (r *nylasTrackedReadCloser) Read(p []byte) (int, error) {
	r.mu.Lock()
	r.reads++
	r.mu.Unlock()
	return r.body.Read(p)
}

func (r *nylasTrackedReadCloser) Close() error {
	r.mu.Lock()
	r.closeCalls++
	r.mu.Unlock()
	var closeErr error
	r.closeOnce.Do(func() {
		closeErr = r.body.Close()
		if r.onClose != nil {
			r.onClose()
		}
	})
	return closeErr
}

func (r *nylasTrackedReadCloser) counts() (int, int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.reads, r.closeCalls
}

type nylasFailingReader struct {
	content []byte
	err     error
}

func (r *nylasFailingReader) Read(p []byte) (int, error) {
	if len(r.content) > 0 {
		n := copy(p, r.content)
		r.content = r.content[n:]
		return n, nil
	}
	return 0, r.err
}

type nylasBlockingReadCloser struct {
	started   chan struct{}
	closed    chan struct{}
	startOnce sync.Once
	closeOnce sync.Once

	mu         sync.Mutex
	closeCalls int
}

func newNylasBlockingReadCloser() *nylasBlockingReadCloser {
	return &nylasBlockingReadCloser{
		started: make(chan struct{}),
		closed:  make(chan struct{}),
	}
}

func (r *nylasBlockingReadCloser) Read([]byte) (int, error) {
	r.startOnce.Do(func() { close(r.started) })
	<-r.closed
	return 0, io.ErrClosedPipe
}

func (r *nylasBlockingReadCloser) Close() error {
	r.mu.Lock()
	r.closeCalls++
	r.mu.Unlock()
	r.closeOnce.Do(func() { close(r.closed) })
	return nil
}

func (r *nylasBlockingReadCloser) closes() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.closeCalls
}

func waitNylasTestSignal(t *testing.T, signal <-chan struct{}, description string) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(5 * time.Second):
		t.Fatalf("timed out waiting for %s", description)
	}
}

func waitNylasTestResult(t *testing.T, result <-chan error) error {
	t.Helper()
	select {
	case err := <-result:
		return err
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for Nylas multipart operation")
		return nil
	}
}

func TestNylasRESTClientListsEventsByICalUID(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/v3/grants/grant-1/events" {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
		}
		if got := r.URL.Query().Get("calendar_id"); got != "primary" {
			t.Fatalf("calendar_id = %q", got)
		}
		if got := r.URL.Query().Get("ical_uid"); got != "invite+special@example.com" {
			t.Fatalf("ical_uid = %q", got)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer api-key" {
			t.Fatalf("authorization = %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"event-1","calendar_id":"primary","ical_uid":"invite+special@example.com"}]}`))
	}))
	defer server.Close()

	client := NewNylasRESTClient(server.URL, "api-key", "client-id")
	events, err := client.ListEventsByICalUID(context.Background(), "grant-1", "invite+special@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].ID != "event-1" {
		t.Fatalf("events = %+v", events)
	}
}

func TestNylasRESTClientSendsEventRSVP(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.EscapedPath() != "/v3/grants/grant-1/events/event%231/send-rsvp" {
			t.Fatalf("request = %s %s", r.Method, r.URL.EscapedPath())
		}
		if got := r.URL.Query().Get("calendar_id"); got != "calendar-1" {
			t.Fatalf("calendar_id = %q", got)
		}
		if got := r.URL.Query().Get("skip_nylas_email"); got != "true" {
			t.Fatalf("skip_nylas_email = %q", got)
		}
		var body struct {
			Status string `json:"status"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Status != "maybe" {
			t.Fatalf("status = %q", body.Status)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{}}`))
	}))
	defer server.Close()

	client := NewNylasRESTClient(server.URL, "api-key", "client-id")
	if err := client.SendEventRSVP(context.Background(), "grant-1", "event#1", "calendar-1", "maybe"); err != nil {
		t.Fatal(err)
	}
}
