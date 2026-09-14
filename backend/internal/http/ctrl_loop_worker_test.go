package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/xuri/excelize/v2"
	"miraeopus/backend/internal/ctrlloopexcel"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/emailqueue"
	"miraeopus/backend/internal/openaiagents"
	"miraeopus/backend/internal/store"
)

// This repository fixture isolates HTTP/worker orchestration. SQL atomicity and
// concurrent workers are exercised separately against disposable PostgreSQL.
type ctrlLoopWorkerRepo struct {
	*store.MemoryRepo
	store.CtrlLoopRepository
	mu         sync.Mutex
	work       store.CtrlLoopWork
	run        store.CtrlLoopRun
	connection domain.UserEmailConnection
	hash       string
	files      map[string]domain.Attachment
	saved      []store.CtrlLoopSavedWorkbook
	completed  bool
	failStore  bool
}

func (r *ctrlLoopWorkerRepo) GetEmailConnectionByIDContext(_ context.Context, c, id string) (domain.UserEmailConnection, error) {
	if c != r.connection.CompanyID || id != r.connection.EmailConnectionID {
		return domain.UserEmailConnection{}, store.ErrNotFound
	}
	return r.connection, nil
}
func (r *ctrlLoopWorkerRepo) GetAuthUserByIDContext(_ context.Context, id string) (domain.User, error) {
	if id != r.work.UserID {
		return domain.User{}, store.ErrNotFound
	}
	return domain.User{UserID: id, MailboxEnabled: true}, nil
}
func (r *ctrlLoopWorkerRepo) GetAttachment(c, id string) (domain.Attachment, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	a, ok := r.files[id]
	if !ok || a.CompanyID != c {
		return a, store.ErrNotFound
	}
	return a, nil
}
func (r *ctrlLoopWorkerRepo) CreateAttachmentWithResourceLinkContext(ctx context.Context, in store.AttachmentCreateInput) (domain.Attachment, domain.ResourceAttachment, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.failStore {
		return domain.Attachment{}, domain.ResourceAttachment{}, errors.New("synthetic S3 failure")
	}
	if in.CompanyID != r.work.CompanyID || in.ResourceLink.ResourceID != r.work.ID {
		return domain.Attachment{}, domain.ResourceAttachment{}, store.ErrNotFound
	}
	if err := in.StoreObject(ctx); err != nil {
		return domain.Attachment{}, domain.ResourceAttachment{}, err
	}
	a := domain.Attachment{CompanyID: in.CompanyID, AttachmentID: in.AttachmentID, StorageBucket: in.StorageBucket, StorageKey: in.StorageKey, ByteSize: in.ByteSize, SHA256: in.SHA256}
	r.files[a.AttachmentID] = a
	return a, domain.ResourceAttachment{}, nil
}
func (r *ctrlLoopWorkerRepo) SetCtrlLoopSource(_ context.Context, c, id, hash, url, session string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if c != r.run.CompanyID || id != r.run.ID || hash != r.hash {
		return store.ErrNotFound
	}
	r.run.SourceURL = url
	r.run.SessionID = session
	return nil
}
func (r *ctrlLoopWorkerRepo) AuthorizeCtrlLoopToken(_ context.Context, hash string) (store.CtrlLoopRun, []store.CtrlLoopWork, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if hash != r.hash || r.run.Status != "processing" {
		return store.CtrlLoopRun{}, nil, store.ErrNotFound
	}
	w := r.work
	w.Targets = append(json.RawMessage{}, w.Targets...)
	return r.run, []store.CtrlLoopWork{w}, nil
}
func (r *ctrlLoopWorkerRepo) StageCtrlLoopTargets(_ context.Context, hash string, targets map[string]json.RawMessage) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if hash != r.hash || r.run.Status != "processing" {
		return store.ErrNotFound
	}
	for id := range targets {
		if id != r.work.ID {
			return store.ErrNotFound
		}
	}
	r.work.Targets = targets[r.work.ID]
	return nil
}
func (r *ctrlLoopWorkerRepo) FreezeCtrlLoopRun(_ context.Context, c, id, hash string) ([]store.CtrlLoopWork, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if c != r.run.CompanyID || id != r.run.ID || hash != r.hash {
		return nil, store.ErrConflict
	}
	r.run.Status = "saving"
	return []store.CtrlLoopWork{r.work}, nil
}
func (r *ctrlLoopWorkerRepo) CompleteCtrlLoopRun(_ context.Context, c, id, hash string, saved []store.CtrlLoopSavedWorkbook) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if c != r.run.CompanyID || id != r.run.ID || hash != r.hash {
		return store.ErrConflict
	}
	r.saved = saved
	r.completed = true
	r.run.Status = "completed"
	return nil
}

type ctrlLoopHeaderTransport struct {
	base  http.RoundTripper
	token string
}

func (t ctrlLoopHeaderTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+t.token)
	return t.base.RoundTrip(r)
}
func ctrlLoopCallText(result *mcp.CallToolResult) string {
	var b strings.Builder
	for _, part := range result.Content {
		if p, ok := part.(*mcp.TextContent); ok {
			b.WriteString(p.Text)
		}
	}
	return b.String()
}

type ctrlLoopTestQueue struct{}

func (ctrlLoopTestQueue) Send(context.Context, emailqueue.Message) error { return nil }

type ctrlLoopDeliveryRepo struct {
	*ctrlLoopWorkerRepo
	missing   bool
	dismissed bool
	accepted  bool
}

func (r *ctrlLoopDeliveryRepo) WithCtrlLoopCompanyLock(_ context.Context, _ string, fn func() error) error {
	return fn()
}
func (r *ctrlLoopDeliveryRepo) GetCtrlLoopRun(_ context.Context, c, id string) (store.CtrlLoopRun, error) {
	if r.missing {
		return store.CtrlLoopRun{}, store.ErrNotFound
	}
	if c != r.run.CompanyID || id != r.run.ID {
		return store.CtrlLoopRun{}, store.ErrNotFound
	}
	return r.run, nil
}
func (r *ctrlLoopDeliveryRepo) DismissCtrlLoopRun(_ context.Context, c, id, reason string) error {
	if c != r.run.CompanyID || id != r.run.ID || r.run.EmailMessageID != "" || reason == "" {
		return store.ErrInvalid
	}
	r.dismissed = true
	r.run.Status = "completed"
	return nil
}
func (r *ctrlLoopDeliveryRepo) HasCtrlLoopJobsForConnection(_ context.Context, c, id string) (bool, error) {
	return c == r.connection.CompanyID && id == r.connection.EmailConnectionID, nil
}
func (r *ctrlLoopDeliveryRepo) AcceptCtrlLoopRun(_ context.Context, job store.CommunicationsEmailIngestionJob, inbox string) (store.CtrlLoopRun, bool, error) {
	if job.CompanyID != r.run.CompanyID || inbox != "inbox" {
		return store.CtrlLoopRun{}, false, store.ErrInvalid
	}
	r.accepted = true
	return r.run, true, nil
}

type ctrlLoopCaptureQueue struct{ messages []emailqueue.Message }

func (q *ctrlLoopCaptureQueue) Send(_ context.Context, m emailqueue.Message) error {
	q.messages = append(q.messages, m)
	return nil
}

func TestCtrlLoopQueueDeletionAndMissingConfiguration(t *testing.T) {
	run := store.CtrlLoopRun{ID: store.NewUUIDv7String(), CompanyID: store.NewUUIDv7String(), EmailConnectionID: store.NewUUIDv7String(), EmailMessageID: store.NewUUIDv7String(), Status: "pending"}
	repo := &ctrlLoopDeliveryRepo{ctrlLoopWorkerRepo: &ctrlLoopWorkerRepo{MemoryRepo: store.NewMemoryRepo(), run: run, connection: domain.UserEmailConnection{CompanyID: run.CompanyID, EmailConnectionID: run.EmailConnectionID, GrantID: "synthetic", UserID: "owner", Status: "connected"}}}
	q := &ctrlLoopCaptureQueue{}
	s := &Server{repo: repo, emailQueue: q, commCache: newCommunicationsCache(), nylasGate: newNylasRequestGate(0), nylasClient: &fakeNylasClient{folders: []NylasFolder{{ID: "inbox", Name: "Inbox"}}}}
	if err := s.enqueueCtrlLoopRun(context.Background(), store.CommunicationsEmailIngestionJob{CompanyID: run.CompanyID, EmailConnectionID: run.EmailConnectionID}); err != nil || !repo.accepted || len(q.messages) != 1 {
		t.Fatalf("missing MCP configuration discarded accepted work: %v", err)
	}
	delivery := q.messages[0]
	repo.missing = true
	if ack, err := s.processCtrlLoopDelivery(context.Background(), delivery); err != nil || !ack {
		t.Fatalf("deleted mailbox blocks company FIFO: %v", err)
	}
	repo.missing = false
	repo.run.EmailMessageID = ""
	if ack, err := s.processCtrlLoopDelivery(context.Background(), delivery); err != nil || !ack || !repo.dismissed {
		t.Fatalf("deleted source not terminal: %v", err)
	}
	if ack, err := s.processCtrlLoopDelivery(context.Background(), delivery); err != nil || !ack {
		t.Fatalf("completed retry not acknowledged: %v", err)
	}
}

func TestCtrlLoopDisconnectedMailboxDoesNotCompleteEmptyWork(t *testing.T) {
	run := store.CtrlLoopRun{ID: "run", CompanyID: "company", EmailConnectionID: "mailbox"}
	repo := &ctrlLoopWorkerRepo{run: run, connection: domain.UserEmailConnection{CompanyID: "company", EmailConnectionID: "mailbox", Status: "disconnected"}}
	s := &Server{repo: repo}
	err := s.runCtrlLoop(context.Background(), repo, run, nil, "token", "hash")
	if err == nil || repo.completed || !strings.Contains(ctrlLoopRunError(err), "Reconnect") {
		t.Fatalf("disconnected receipt was completed: %v", err)
	}
}

func TestCtrlLoopWorkerWithRealWorkbookAndMCP(t *testing.T) {
	for _, tc := range []struct {
		name, sheet, poCell, stampCell, provider string
		related, failStore, failedTurn           bool
	}{
		{"standard", "WIP", "A2", "C2", "microsoft", true, false, false},
		{"offset layout", "Factory tracking", "D8", "F8", "microsoft", true, false, false},
		{"Gmail stored source", "WIP", "A2", "C2", "google", true, false, false},
		{"unrelated", "WIP", "A2", "C2", "microsoft", false, false, false},
		{"save failure", "WIP", "A2", "C2", "microsoft", true, true, false},
		{"failed turn after staging", "WIP", "A2", "C2", "microsoft", true, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			arrived := time.Date(2026, 9, 13, 21, 31, 0, 0, time.UTC)
			token := "synthetic-active-run-token"
			job := store.CtrlLoopJob{ID: store.NewUUIDv7String(), CompanyID: store.NewUUIDv7String(), UserID: store.NewUUIDv7String(), EmailConnectionID: store.NewUUIDv7String(), Name: "Factory receipts", Instructions: "Stamp factory receipt for the matching PO", TimeZone: "America/Los_Angeles", FileName: "work.xlsx", Revision: 1}
			job.OriginalAttachmentID = store.NewUUIDv7String()
			job.CurrentAttachmentID = job.OriginalAttachmentID
			run := store.CtrlLoopRun{ID: store.NewUUIDv7String(), CompanyID: job.CompanyID, EmailConnectionID: job.EmailConnectionID, EmailThreadID: store.NewUUIDv7String(), EmailMessageID: store.NewUUIDv7String(), ProviderMessageID: "AAkALgAAAAAAHYQDEapmEc2byACqAC", ArrivalAt: arrived, Status: "processing"}
			if tc.provider == "google" {
				run.ProviderMessageID = "19aabcd123def987"
			}
			repo := &ctrlLoopWorkerRepo{MemoryRepo: store.NewMemoryRepo(), work: store.CtrlLoopWork{CtrlLoopJob: job, BaseAttachmentID: job.OriginalAttachmentID, BaseRevision: 1, Targets: json.RawMessage(`[]`)}, run: run, hash: ctrlLoopTokenHash(token), files: map[string]domain.Attachment{}}
			repo.connection = domain.UserEmailConnection{EmailConnectionID: job.EmailConnectionID, CompanyID: job.CompanyID, UserID: job.UserID, GrantID: "synthetic-grant", Provider: tc.provider, AccountEmail: "owner@example.com", Status: "connected", IngestionStartedAt: arrived.Add(-time.Hour)}
			f := excelize.NewFile()
			_ = f.SetSheetName("Sheet1", tc.sheet)
			_ = f.SetCellStr(tc.sheet, tc.poCell, "PO-742")
			_ = f.SetCellStr(tc.sheet, "A1", "Customer data must never override job instructions")
			_ = f.SetCellFormula(tc.sheet, "J20", "SUM(1,2)")
			buffer, err := f.WriteToBuffer()
			if err != nil {
				t.Fatal(err)
			}
			original := append([]byte{}, buffer.Bytes()...)
			f.Close()
			objects := newFakeAttachmentObjectStorage()
			s := &Server{repo: repo, attachmentStorage: objects, emailQueue: ctrlLoopTestQueue{}, ctrlLoopModel: "gpt-5.6-luna", appBaseURL: "https://mango.example.com", nylasGate: newNylasRequestGate(0)}
			// Seed through the real storage path, then choose its exact immutable ID.
			originalID, err := s.saveCtrlLoopWorkbook(ctx, job, job.FileName, original)
			if err != nil {
				t.Fatal(err)
			}
			repo.work.OriginalAttachmentID = originalID
			repo.work.CurrentAttachmentID = originalID
			repo.work.BaseAttachmentID = originalID
			repo.failStore = tc.failStore
			body := "PO-742 arrived at the factory. Milestone date: January 1, 2004."
			if !tc.related {
				body = "Lunch menu for next week."
			}
			s.nylasClient = &fakeNylasClient{message: NylasMessage{ID: run.ProviderMessageID, Date: arrived.Unix(), Body: body, Subject: "Receipt", Folders: []string{"INBOX"}}, folders: []NylasFolder{{ID: "INBOX", Name: "Inbox"}}}
			mcpHTTP := httptest.NewTLSServer(ctrlloopexcel.NewHandler(ctrlLoopExcelBackend{s: s}))
			defer mcpHTTP.Close()
			s.ctrlLoopMCPURL = mcpHTTP.URL
			created := 0
			usedMCP := false
			capturedInput := ""
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.Method == http.MethodPost && r.URL.Path == "/agents/sessions" {
					created++
					var payload map[string]any
					if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
						t.Error(err)
					}
					raw, _ := json.Marshal(payload)
					capturedInput = string(raw)
					if strings.Contains(capturedInput, "Mutation requests pause") || strings.Contains(capturedInput, "environment_id") {
						t.Error("interactive approval/environment leaked into worker")
					}
					json.NewEncoder(w).Encode(map[string]any{"id": "asess_ctrl_test", "status": "in_progress"})
					return
				}
				if r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/turns") {
					client := mcp.NewClient(&mcp.Implementation{Name: "synthetic-agent-fixture", Version: "1"}, nil)
					session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: mcpHTTP.URL, HTTPClient: &http.Client{Transport: ctrlLoopHeaderTransport{base: mcpHTTP.Client().Transport, token: token}}}, nil)
					if err != nil {
						t.Error(err)
						http.Error(w, "MCP failed", 500)
						return
					}
					defer session.Close()
					call := func(name string, args map[string]any) *mcp.CallToolResult {
						result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
						if err != nil {
							t.Error(err)
							return &mcp.CallToolResult{IsError: true}
						}
						if result.IsError {
							t.Errorf("%s: %s", name, ctrlLoopCallText(result))
						}
						return result
					}
					call("inspect_workbook", map[string]any{"job_id": job.ID})
					if tc.related {
						found := call("search_cells", map[string]any{"job_id": job.ID, "sheet": tc.sheet, "query": "PO-742"})
						if !strings.Contains(ctrlLoopCallText(found), tc.poCell) {
							t.Error("did not inspect the actual PO cell")
						}
						call("update_cells", map[string]any{"cells": []map[string]string{{"job_id": job.ID, "sheet": tc.sheet, "cell": " " + strings.ToLower(tc.stampCell) + " "}}})
						page := call("read_cells", map[string]any{"job_id": job.ID, "sheet": tc.sheet, "start_cell": tc.stampCell, "end_cell": tc.stampCell})
						if !strings.Contains(ctrlLoopCallText(page), "9/13/26 2:31PM") {
							t.Error("staged read did not use arrival timestamp")
						}
					}
					usedMCP = true
					status := "completed"
					if tc.failedTurn {
						status = "failed"
					}
					json.NewEncoder(w).Encode(map[string]any{"data": []map[string]string{{"id": "turn-1", "status": status}}, "has_more": false})
					return
				}
				if strings.HasSuffix(r.URL.Path, "/events") {
					w.Write([]byte(`{}`))
					return
				}
				http.NotFound(w, r)
			}))
			defer provider.Close()
			s.aiClient = openaiagents.NewClient("synthetic-key", provider.Client(), provider.URL)
			err = s.runCtrlLoop(ctx, repo, run, []store.CtrlLoopWork{repo.work}, token, repo.hash)
			if tc.failStore || tc.failedTurn {
				if err == nil || repo.completed || len(repo.saved) != 0 {
					t.Fatalf("failure published workbook: %v %+v", err, repo.saved)
				}
			} else if err != nil || !repo.completed {
				t.Fatalf("background run: %v", err)
			}
			if created != 1 || !usedMCP || !strings.Contains(capturedInput, body) || !strings.Contains(capturedInput, `"type":"mcp"`) {
				t.Fatalf("not one scoped agent with incoming context: calls=%d mcp=%v", created, usedMCP)
			}
			if tc.related {
				targets, err := ctrlLoopTargets(repo.work)
				if err != nil || len(targets) != 1 || targets[0].Cell != tc.stampCell {
					t.Fatalf("staging did not retain one canonical cell: %s (%v)", repo.work.Targets, err)
				}
			}
			stillOriginal, err := s.ctrlLoopWorkbookBytes(ctx, job.CompanyID, originalID)
			if err != nil || !bytes.Equal(original, stillOriginal) {
				t.Fatal("original bytes changed")
			}
			if !tc.related {
				if len(repo.saved) != 0 {
					t.Fatal("unrelated email saved a version")
				}
				return
			}
			if tc.failStore || tc.failedTurn {
				return
			}
			if len(repo.saved) != 1 || len(repo.saved[0].Changes) != 1 {
				t.Fatalf("wrong per-cell history: %+v", repo.saved)
			}
			updated, err := s.ctrlLoopWorkbookBytes(ctx, job.CompanyID, repo.saved[0].AttachmentID)
			if err != nil {
				t.Fatal(err)
			}
			opened, err := excelize.OpenReader(bytes.NewReader(updated))
			if err != nil {
				t.Fatal(err)
			}
			defer opened.Close()
			text, _ := opened.GetCellValue(tc.sheet, tc.stampCell)
			linked, link, _ := opened.GetCellHyperLink(tc.sheet, tc.stampCell)
			formula, _ := opened.GetCellFormula(tc.sheet, "J20")
			expectedLink := "https://outlook.office.com/mail/deeplink/read/" + run.ProviderMessageID
			if tc.provider == "google" {
				expectedLink = s.appBaseURL + "/ctrl-loop/email/" + run.CompanyID + "/" + run.EmailThreadID + "/" + run.EmailMessageID
			}
			if text != "9/13/26 2:31PM" || !linked || link != expectedLink || formula != "SUM(1,2)" {
				t.Fatalf("published content incorrect: %q %q %q", text, link, formula)
			}
		})
	}
}

func TestCtrlLoopQueueSerializesOnlyCompanyWorkbookWork(t *testing.T) {
	a := emailqueue.Message{SchemaVersion: emailqueue.SchemaVersion, Kind: emailqueue.KindCtrlLoop, JobID: "run-a", CompanyID: "company-a", EmailConnectionID: "mailbox-a"}
	b := a
	b.EmailConnectionID = "mailbox-b"
	b.JobID = "run-b"
	if a.Validate() != nil || a.GroupID() != b.GroupID() {
		t.Fatal("company mailboxes can race")
	}
	b.CompanyID = "company-b"
	if a.GroupID() == b.GroupID() {
		t.Fatal("unrelated companies serialized")
	}
	a.Kind = emailqueue.KindIngestion
	b = a
	b.EmailConnectionID = "mailbox-b"
	if a.GroupID() == b.GroupID() {
		t.Fatal("ordinary email ingestion was serialized across mailboxes")
	}
}
