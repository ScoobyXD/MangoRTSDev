package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

type assistantArchiveRepo struct {
	store.Repository
	mu             sync.Mutex
	runs           []store.AIRun
	saveErr        error
	contextErr     error
	deadline       time.Time
	savedAt        time.Time
	failMembership atomic.Bool
}

func (r *assistantArchiveRepo) SaveAIRunContext(ctx context.Context, run store.AIRun) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.contextErr = ctx.Err()
	r.deadline, _ = ctx.Deadline()
	r.savedAt = time.Now()
	r.runs = append(r.runs, run)
	return r.saveErr
}

func (r *assistantArchiveRepo) ListUserMembershipsContext(ctx context.Context, userID string) ([]domain.CompanyMembership, error) {
	if r.failMembership.Load() {
		return nil, errors.New("membership lookup failed")
	}
	return r.Repository.ListUserMembershipsContext(ctx, userID)
}

func (r *assistantArchiveRepo) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.runs)
}

func assistantSavedInspection(t *testing.T, repo *assistantArchiveRepo, userID, requestID, status string, before, after time.Time) []assistantTrace {
	t.Helper()
	repo.mu.Lock()
	defer repo.mu.Unlock()
	if len(repo.runs) != 1 {
		t.Fatalf("archive saves=%d, want exactly one", len(repo.runs))
	}
	run := repo.runs[0]
	if run.CompanyID != assistantTestCompany || run.UserID != userID || run.AIRunsID != requestID {
		t.Fatalf("archive did not use authenticated company/user and Send ID: %+v", run)
	}
	if run.StartTime.Before(before) || run.FinishTime.After(after) || run.FinishTime.Before(run.StartTime) || run.FinishTime.After(repo.savedAt) {
		t.Fatalf("archive times do not bound foreground execution: start=%v finish=%v", run.StartTime, run.FinishTime)
	}
	if repo.contextErr != nil || repo.deadline.IsZero() || !repo.deadline.After(repo.savedAt) || repo.deadline.Sub(repo.savedAt) > 5*time.Second {
		t.Fatalf("final archive needs a live bounded context: error=%v deadline=%v saved=%v", repo.contextErr, repo.deadline, repo.savedAt)
	}
	var events []assistantTrace
	if err := json.Unmarshal(run.InspectionJSON, &events); err != nil || len(events) == 0 {
		t.Fatalf("archive is not a complete JSON event array: %v", err)
	}
	previous := run.StartTime
	for i, event := range events {
		occurred, err := time.Parse(time.RFC3339Nano, event.Time)
		if err != nil || occurred.Before(previous) || occurred.After(run.FinishTime) || event.Sequence != i+1 || event.Kind == "" || event.Status == "" || !json.Valid(event.Data) {
			t.Fatalf("invalid ordered event with actual timestamp: %+v", event)
		}
		if event.Kind == "termination" && i != len(events)-1 {
			t.Fatal("archive has an early or duplicate terminal event")
		}
		previous = occurred
	}
	last := events[len(events)-1]
	if last.Kind != "termination" || last.Status != status {
		t.Fatalf("archive terminal event=%+v, want %s", last, status)
	}
	return events
}

func TestAssistantArchiveSavesCompleteCaptureOnceAndCannotUndoSuccess(t *testing.T) {
	for _, inspect := range []bool{true, false} {
		name := "inspected"
		if !inspect {
			name = "ordinary_send_archive_failure"
		}
		t.Run(name, func(t *testing.T) {
			var calls atomic.Int32
			var archive *assistantArchiveRepo
			server, memory := assistantTestServer(t, func(w http.ResponseWriter, r *http.Request) {
				if archive.count() != 0 {
					t.Error("inspection was saved before the Send ended")
				}
				switch calls.Add(1) {
				case 1:
					assistantProviderComplete(w, assistantProviderCall("archive_skill", "read", `{"path":"skills/mango-process/SKILL.md"}`))
					return
				case 2:
					assistantProviderComplete(w,
						map[string]any{"type": "reasoning", "id": "rs_archive", "summary": []any{}, "encrypted_content": "private-archive-reasoning"},
						assistantProviderCall("archive_create", "create_process", `{"name":"Archived successful action"}`))
					return
				}
				assistantProviderComplete(w)
			})
			archive = &assistantArchiveRepo{Repository: memory}
			if !inspect {
				archive.saveErr = errors.New("archive unavailable")
			} else if _, err := memory.AddCompanyMembership("assistant-user", assistantTestCompany, domain.RoleDevAdmin); err != nil {
				t.Fatal(err)
			}
			server.repo = archive
			user, err := memory.GetAuthUser("assistant-user")
			if err != nil {
				t.Fatal(err)
			}
			id := store.NewUUIDv7String()
			response := httptest.NewRecorder()
			before := time.Now()
			server.Routes().ServeHTTP(response, assistantContextChatRequest(assistantRequest{RequestID: id, InspectContext: inspect,
				Messages: []assistantMessage{{Role: "user", Content: "Create a Process. unit-test-key https://objects.example.test/file?X-Amz-Signature=private-archive-signature"}}}))
			events := assistantSavedInspection(t, archive, user.UserID, id, "completed", before, time.Now())
			if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"type":"done"`) || strings.Contains(response.Body.String(), `"type":"error"`) {
				t.Fatalf("archive changed successful Send outcome: %d %s", response.Code, response.Body.String())
			}
			encoded, _ := json.Marshal(events)
			for _, secret := range []string{"unit-test-key", "private-archive-signature", "private-archive-reasoning"} {
				if strings.Contains(string(encoded), secret) {
					t.Errorf("archive included omitted credential or private reasoning: %s", secret)
				}
			}
			for _, kind := range []string{"context", "runtime", "skill_load", "provider_request", "provider_response", "tool", "tool_result", "interaction"} {
				if !strings.Contains(string(encoded), `"kind":"`+kind+`"`) {
					t.Errorf("archive omitted existing %s events", kind)
				}
			}
			streamed := assistantTraceEvents(t, response.Body.String())
			if inspect {
				var archived []map[string]any
				if json.Unmarshal(encoded, &archived) != nil || !reflect.DeepEqual(streamed, archived) {
					t.Fatal("saved sequence/time/kind/status/data differs from streamed inspection")
				}
				capture := server.assistant.captures[assistantTestCompany+":"+user.UserID+":"+id]
				if capture == nil || !capture.finished || !reflect.DeepEqual(capture.events, events) {
					t.Fatal("archive differs from the retained immutable capture")
				}
			} else if len(streamed) != 0 {
				t.Fatal("ordinary Send exposed developer inspection")
			}
			replay := httptest.NewRecorder()
			server.Routes().ServeHTTP(replay, assistantChatRequest(id, "Create again"))
			processes, err := memory.ListLogicGates(assistantTestCompany)
			if err != nil || len(processes) != 1 || calls.Load() != 3 || archive.count() != 1 || replay.Code != http.StatusConflict {
				t.Fatalf("archive failure or replay repeated/lost work: processes=%d calls=%d saves=%d replay=%d error=%v", len(processes), calls.Load(), archive.count(), replay.Code, err)
			}
		})
	}
}

func TestAssistantArchiveKeepsFailureAndStopAfterCommittedAction(t *testing.T) {
	for _, stop := range []bool{false, true} {
		name, status := "provider_failure", "failed"
		if stop {
			name, status = "user_stop", "stopped"
		}
		t.Run(name, func(t *testing.T) {
			var calls atomic.Int32
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			server, memory := assistantTestServer(t, func(w http.ResponseWriter, r *http.Request) {
				if calls.Add(1) == 1 {
					assistantProviderComplete(w, assistantProviderCall("archive_saved", "create_process", `{"name":"Keep after terminal error"}`))
					return
				}
				if stop {
					if _, err := io.Copy(io.Discard, r.Body); err != nil {
						t.Error(err)
						return
					}
					cancel()
					select {
					case <-r.Context().Done():
					case <-time.After(5 * time.Second):
						t.Error("Stop did not cancel the provider connection")
					}
					return
				}
				http.Error(w, "private-provider-error unit-test-key", http.StatusInternalServerError)
			})
			if _, err := memory.AddCompanyMembership("assistant-user", assistantTestCompany, domain.RoleDevAdmin); err != nil {
				t.Fatal(err)
			}
			archive := &assistantArchiveRepo{Repository: memory}
			server.repo = archive
			user, err := memory.GetAuthUser("assistant-user")
			if err != nil {
				t.Fatal(err)
			}
			id := store.NewUUIDv7String()
			response := httptest.NewRecorder()
			before := time.Now()
			server.Routes().ServeHTTP(response, assistantContextChatRequest(assistantRequest{RequestID: id, InspectContext: true,
				Messages: []assistantMessage{{Role: "user", Content: "Create a Process"}}}).WithContext(ctx))
			events := assistantSavedInspection(t, archive, user.UserID, id, status, before, time.Now())
			capture := server.assistant.captures[assistantTestCompany+":"+user.UserID+":"+id]
			if capture == nil || !capture.finished || !reflect.DeepEqual(capture.events, events) {
				t.Fatal("terminal failure or Stop lost retained events")
			}
			processes, err := memory.ListLogicGates(assistantTestCompany)
			if err != nil || len(processes) != 1 || calls.Load() != 2 || strings.Contains(response.Body.String(), `"type":"done"`) {
				t.Fatalf("terminal failure repeated or lost business work: processes=%d calls=%d error=%v", len(processes), calls.Load(), err)
			}
			encoded, _ := json.Marshal(events)
			if !strings.Contains(string(encoded), processes[0].LogicGateID) || !strings.Contains(string(encoded), `"status":"saved"`) || strings.Contains(string(encoded), "private-provider-error") {
				t.Fatal("archive lost saved result or leaked the raw provider error")
			}
			replay := httptest.NewRecorder()
			server.Routes().ServeHTTP(replay, assistantChatRequest(id, "Try again"))
			if replay.Code != http.StatusConflict || archive.count() != 1 || calls.Load() != 2 {
				t.Fatal("terminal Send was archived or executed twice")
			}
		})
	}
}

type assistantArchiveConnection struct {
	*httptest.ResponseRecorder
	writeErr error
	flushErr error
	onFlush  func()
}

func (w *assistantArchiveConnection) Write(body []byte) (int, error) {
	if w.writeErr != nil {
		return 0, w.writeErr
	}
	return w.ResponseRecorder.Write(body)
}

func (w *assistantArchiveConnection) WriteString(body string) (int, error) {
	return w.Write([]byte(body))
}

func (w *assistantArchiveConnection) FlushError() error {
	if w.onFlush != nil {
		w.onFlush()
	}
	return w.flushErr
}

func TestAssistantArchiveFinalizesAdmissionBeforeRuntimeStarts(t *testing.T) {
	for _, failure := range []string{"write", "flush", "role_lookup"} {
		t.Run(failure, func(t *testing.T) {
			var calls atomic.Int32
			server, memory := assistantTestServer(t, func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				assistantProviderComplete(w)
			})
			archive := &assistantArchiveRepo{Repository: memory}
			server.repo = archive
			user, err := memory.GetAuthUser("assistant-user")
			if err != nil {
				t.Fatal(err)
			}
			response := &assistantArchiveConnection{ResponseRecorder: httptest.NewRecorder()}
			switch failure {
			case "write":
				response.writeErr = io.ErrClosedPipe
			case "flush":
				response.flushErr = io.ErrClosedPipe
			case "role_lookup":
				response.onFlush = func() { archive.failMembership.Store(true) }
			}
			id := store.NewUUIDv7String()
			before := time.Now()
			server.handleAssistantChat(response, requestWithActorForTest(assistantChatRequest(id, "Hello"), user, assistantTestCompany))
			events := assistantSavedInspection(t, archive, user.UserID, id, "failed", before, time.Now())
			if len(events) != 1 || calls.Load() != 0 {
				t.Fatalf("failure before runtime lost terminal or dispatched provider: events=%d calls=%d", len(events), calls.Load())
			}
		})
	}
}

func TestAssistantArchiveRejectsUntrustedIdentityBeforeAdmission(t *testing.T) {
	var calls atomic.Int32
	server, memory := assistantTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		assistantProviderComplete(w)
	})
	archive := &assistantArchiveRepo{Repository: memory}
	server.repo = archive
	for _, scenario := range []string{"unauthenticated", "other_company", "actor_in_body"} {
		t.Run(scenario, func(t *testing.T) {
			request := assistantChatRequest(store.NewUUIDv7String(), "Hello")
			want := http.StatusBadRequest
			switch scenario {
			case "unauthenticated":
				request.Header.Del("Authorization")
				want = http.StatusUnauthorized
			case "other_company":
				request.URL.RawQuery = "company_id=99999999-9999-4999-8999-999999999999"
				want = http.StatusForbidden
			case "actor_in_body":
				body, err := io.ReadAll(request.Body)
				if err != nil {
					t.Fatal(err)
				}
				request.Body = io.NopCloser(strings.NewReader(strings.TrimSuffix(string(body), "}") + `,"user_id":"99999999-9999-4999-8999-999999999999"}`))
			}
			response := httptest.NewRecorder()
			server.Routes().ServeHTTP(response, request)
			if response.Code != want || archive.count() != 0 || calls.Load() != 0 {
				t.Fatalf("untrusted identity reached archive/runtime: status=%d saves=%d calls=%d", response.Code, archive.count(), calls.Load())
			}
		})
	}
}

func TestAssistantArchiveUsesGlobalDeveloperSelectedCompanyWithoutMembership(t *testing.T) {
	server, memory := assistantTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		assistantProviderComplete(w)
	})
	const homeCompany = "92929292-9292-4292-8292-929292929292"
	memory.EnsureCompany(homeCompany, "Developer home company")
	user := mustRealtimeAuthUser(t, memory, homeCompany, "global-developer", domain.RoleDevAdmin)
	archive := &assistantArchiveRepo{Repository: memory}
	server.repo = archive
	id := store.NewUUIDv7String()
	before := time.Now()
	response := httptest.NewRecorder()
	server.handleAssistantChat(response, requestWithActorForTest(assistantChatRequest(id, "Explain Mango"), user, assistantTestCompany))
	assistantSavedInspection(t, archive, user.UserID, id, "completed", before, time.Now())
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"type":"done"`) {
		t.Fatalf("authorized global developer Send failed: %d %s", response.Code, response.Body.String())
	}
	memberships, err := memory.ListUserMemberships(user.UserID)
	if err != nil || len(memberships) != 1 || memberships[0].CompanyID != homeCompany {
		t.Fatalf("archive introduced a company membership: %+v error=%v", memberships, err)
	}
}
