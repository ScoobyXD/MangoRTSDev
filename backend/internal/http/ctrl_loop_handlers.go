package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"miraeopus/backend/internal/ctrlloopexcel"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

const ctrlLoopMIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

func (s *Server) ctrlLoopOwner(w http.ResponseWriter, r *http.Request) (store.CtrlLoopRepository, string, string, bool) {
	actor, ok := authenticatedActor(r)
	if !ok || actor.User.UserID == "" {
		writeError(w, 401, "Sign in to use [CTRL] Loop.")
		return nil, "", "", false
	}
	if !requireMailboxAccess(w, r) {
		return nil, "", "", false
	}
	c := strings.TrimSpace(r.URL.Query().Get("company_id"))
	if c == "" {
		writeError(w, 400, "company_id_required")
		return nil, "", "", false
	}
	role, err := s.currentActorRoleForCompanyContext(r.Context(), actor, c)
	if err != nil || role == "" {
		writeError(w, 403, "company_access_denied")
		return nil, "", "", false
	}
	repo, ok := s.repo.(store.CtrlLoopRepository)
	if !ok {
		writeError(w, 503, "[CTRL] Loop requires PostgreSQL and its schema rollout.")
		return nil, "", "", false
	}
	return repo, c, actor.User.UserID, true
}
func ctrlLoopError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, 404, "Automation or workbook is unavailable.")
	case errors.Is(err, store.ErrConflict):
		writeError(w, 409, "This company's workbook is being processed or the row changed. Reload and try again.")
	case errors.Is(err, store.ErrInvalid):
		writeError(w, 400, "Check the automation name, instructions, mailbox and timezone.")
	default:
		writeError(w, 503, "[CTRL] Loop could not finish this request. Check the database, queue and file storage setup.")
	}
}
func (s *Server) ctrlLoopConnection(ctx context.Context, c, u, id string) (domain.UserEmailConnection, error) {
	connection, err := s.repo.GetEmailConnectionByIDContext(ctx, c, id)
	if err != nil {
		return connection, err
	}
	if connection.CompanyID != c || connection.EmailConnectionID != id || connection.Scope == "shared" || connection.UserID != u {
		return connection, store.ErrNotFound
	}
	user, err := s.repo.GetAuthUserByIDContext(ctx, u)
	if err != nil {
		return connection, err
	}
	if !user.MailboxEnabled {
		return connection, errMailboxDisabled
	}
	return connection, nil
}
func (s *Server) ctrlLoopSetupError() string {
	if _, err := ctrlLoopAppOrigin(s.appBaseURL); err != nil {
		return err.Error()
	}
	if s.ctrlLoopMCPURL == "" {
		return "Configure MANGORTS_CTRL_LOOP_MCP_URL on the API and email worker before activating a workbook."
	}
	u, err := url.Parse(s.ctrlLoopMCPURL)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "MANGORTS_CTRL_LOOP_MCP_URL must be the HTTPS URL of this app's /v1/ctrl-loop/mcp endpoint."
	}
	if s.aiClient == nil {
		return "Configure OPENAI_API_KEY or OPENAI_API_KEY_SECRET_ARN on the API and email worker."
	}
	if s.emailQueue == nil {
		return "Configure the durable email SQS queue and run the email worker."
	}
	if s.attachmentStorage == nil {
		return "Configure the existing S3 attachment storage."
	}
	return ""
}
func (s *Server) ctrlLoopJobView(j store.CtrlLoopJob) store.CtrlLoopJob {
	if j.CurrentAttachmentID != "" {
		if message := s.ctrlLoopSetupError(); message != "" {
			j.Status = "Error"
			j.Error = message
		}
	}
	return j
}

type ctrlLoopInput struct {
	Name              string `json:"name"`
	Instructions      string `json:"instructions"`
	EmailConnectionID string `json:"email_connection_id"`
	TimeZone          string `json:"time_zone"`
	Revision          int64  `json:"revision"`
}

func (s *Server) handleCtrlLoopJobs(w http.ResponseWriter, r *http.Request) {
	repo, c, u, ok := s.ctrlLoopOwner(w, r)
	if !ok {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	switch r.Method {
	case http.MethodGet:
		jobs, err := repo.ListCtrlLoopJobs(r.Context(), c, u)
		if err != nil {
			ctrlLoopError(w, err)
			return
		}
		connections, err := s.repo.ListUserEmailConnections(u)
		if err != nil {
			ctrlLoopError(w, err)
			return
		}
		mailboxes := []map[string]string{}
		for _, connection := range connections {
			if connection.CompanyID == c && connection.Scope != "shared" {
				mailboxes = append(mailboxes, map[string]string{"email_connection_id": connection.EmailConnectionID, "account_email": connection.AccountEmail, "provider": connection.Provider, "status": connection.Status})
			}
		}
		for i := range jobs {
			jobs[i] = s.ctrlLoopJobView(jobs[i])
		}
		writeJSON(w, 200, map[string]any{"jobs": jobs, "mailboxes": mailboxes})
	case http.MethodPost:
		s.saveCtrlLoopJob(w, r, repo, c, u, "")
	default:
		w.Header().Set("Allow", "GET, POST")
		writeError(w, 405, "method_not_allowed")
	}
}
func (s *Server) saveCtrlLoopJob(w http.ResponseWriter, r *http.Request, repo store.CtrlLoopRepository, c, u, id string) {
	var input ctrlLoopInput
	if !aiDecode(w, r, &input) {
		return
	}
	if input.TimeZone == "" || input.TimeZone == "Local" {
		ctrlLoopError(w, store.ErrInvalid)
		return
	}
	if _, err := s.ctrlLoopConnection(r.Context(), c, u, input.EmailConnectionID); err != nil {
		ctrlLoopError(w, err)
		return
	}
	job, err := repo.SaveCtrlLoopJob(r.Context(), store.CtrlLoopJob{ID: id, CompanyID: c, UserID: u, Name: input.Name, Instructions: input.Instructions, EmailConnectionID: input.EmailConnectionID, TimeZone: input.TimeZone, Revision: input.Revision})
	if err != nil {
		ctrlLoopError(w, err)
		return
	}
	writeJSON(w, 200, s.ctrlLoopJobView(job))
}
func (s *Server) handleCtrlLoopJob(w http.ResponseWriter, r *http.Request) {
	repo, c, u, ok := s.ctrlLoopOwner(w, r)
	if !ok {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/v1/ctrl-loop/jobs/"), "/")
	if len(parts) > 2 || parts[0] == "" {
		writeError(w, 404, "automation_not_found")
		return
	}
	id := parts[0]
	if len(parts) == 1 && r.Method == http.MethodPatch {
		s.saveCtrlLoopJob(w, r, repo, c, u, id)
		return
	}
	job, err := repo.GetCtrlLoopJob(r.Context(), c, u, id)
	if err != nil {
		ctrlLoopError(w, err)
		return
	}
	if _, err = s.ctrlLoopConnection(r.Context(), c, u, job.EmailConnectionID); err != nil {
		ctrlLoopError(w, err)
		return
	}
	if len(parts) == 1 {
		if r.Method == http.MethodDelete {
			if err := repo.DeleteCtrlLoopJob(r.Context(), c, u, id); err != nil {
				ctrlLoopError(w, err)
				return
			}
			s.wakeAttachmentDeletionCleanup()
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			writeError(w, 405, "method_not_allowed")
			return
		}
		writeJSON(w, 200, s.ctrlLoopJobView(job))
		return
	}
	switch parts[1] {
	case "workbook":
		if r.Method == http.MethodPost {
			s.uploadCtrlLoopWorkbook(w, r, repo, job)
			return
		}
		if r.Method != http.MethodGet {
			writeError(w, 405, "method_not_allowed")
			return
		}
		version := r.URL.Query().Get("version")
		if version != "current" && version != "original" {
			writeError(w, 400, "Choose current or original.")
			return
		}
		attachment := job.CurrentAttachmentID
		if version == "original" {
			attachment = job.OriginalAttachmentID
		}
		data, err := s.ctrlLoopWorkbookBytes(r.Context(), job.CompanyID, attachment)
		if err != nil {
			ctrlLoopError(w, err)
			return
		}
		w.Header().Set("Content-Type", ctrlLoopMIME)
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": job.FileName}))
		w.Header().Set("Content-Length", strconv.Itoa(len(data)))
		w.WriteHeader(200)
		_, _ = w.Write(data)
	case "open":
		if r.Method != http.MethodGet {
			writeError(w, 405, "method_not_allowed")
			return
		}
		attachment, err := s.ctrlLoopWorkbookAttachment(c, job.CurrentAttachmentID)
		if err != nil {
			ctrlLoopError(w, err)
			return
		}
		storage, ok := s.attachmentStorage.(AttachmentDownloadStorage)
		if !ok {
			ctrlLoopError(w, ErrAttachmentStorageUnavailable)
			return
		}
		link, err := storage.PresignGetObject(r.Context(), AttachmentPresignGetInput{
			Key: attachment.StorageKey, Filename: job.FileName, ContentType: ctrlLoopMIME,
		})
		if err != nil {
			ctrlLoopError(w, err)
			return
		}
		writeJSON(w, 200, map[string]any{"url": link.URL, "expires_at": link.ExpiresAt})
	case "changes":
		if r.Method != http.MethodGet {
			writeError(w, 405, "method_not_allowed")
			return
		}
		before := r.URL.Query().Get("before_id")
		if before != "" {
			if n, e := strconv.ParseInt(before, 10, 64); e != nil || n <= 0 {
				writeError(w, 400, "invalid_history_cursor")
				return
			}
		}
		changes, runs, more, err := repo.ListCtrlLoopHistory(r.Context(), c, u, id, before)
		if err != nil {
			ctrlLoopError(w, err)
			return
		}
		writeJSON(w, 200, map[string]any{"changes": changes, "runs": runs, "has_more": more})
	case "seen":
		if r.Method != http.MethodPost {
			writeError(w, 405, "method_not_allowed")
			return
		}
		var input struct {
			IDs []string `json:"change_ids"`
		}
		if !aiDecode(w, r, &input) {
			return
		}
		if err := repo.MarkCtrlLoopSeen(r.Context(), c, u, id, input.IDs); err != nil {
			ctrlLoopError(w, err)
			return
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
	default:
		writeError(w, 404, "automation_not_found")
	}
}
func (s *Server) uploadCtrlLoopWorkbook(w http.ResponseWriter, r *http.Request, repo store.CtrlLoopRepository, job store.CtrlLoopJob) {
	if message := s.ctrlLoopSetupError(); message != "" {
		writeError(w, 503, message)
		return
	}
	filename, err := url.PathUnescape(r.Header.Get("X-Filename"))
	if err != nil || filename == "" || len(filename) > 240 || filepath.Base(filename) != filename || strings.ContainsAny(filename, "/\\\r\n") || !strings.EqualFold(filepath.Ext(filename), ".xlsx") {
		writeError(w, 400, "Choose an Excel .xlsx file.")
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, ctrlloopexcel.MaxFileBytes))
	if err != nil {
		writeError(w, 413, "Workbook must be at most 25 MB.")
		return
	}
	if err = ctrlloopexcel.Validate(data); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	err = repo.WithCtrlLoopCompanyLock(r.Context(), job.CompanyID, func() error {
		fresh, e := repo.GetCtrlLoopJob(r.Context(), job.CompanyID, job.UserID, job.ID)
		if e != nil {
			return e
		}
		if fresh.OriginalAttachmentID != "" || fresh.Revision != job.Revision {
			return store.ErrConflict
		}
		connection, e := s.ctrlLoopConnection(r.Context(), job.CompanyID, job.UserID, job.EmailConnectionID)
		if e != nil {
			return e
		}
		if connection.Status != "connected" {
			return store.ErrConflict
		}
		attachment, e := s.saveCtrlLoopWorkbook(r.Context(), job, filename, data)
		if e != nil {
			return e
		}
		return repo.AttachCtrlLoopWorkbook(r.Context(), job.CompanyID, job.UserID, job.ID, job.Revision, attachment)
	})
	if err != nil {
		ctrlLoopError(w, err)
		return
	}
	job, err = repo.GetCtrlLoopJob(r.Context(), job.CompanyID, job.UserID, job.ID)
	if err != nil {
		ctrlLoopError(w, err)
		return
	}
	writeJSON(w, 200, s.ctrlLoopJobView(job))
}
func (s *Server) saveCtrlLoopWorkbook(ctx context.Context, job store.CtrlLoopJob, filename string, data []byte) (string, error) {
	if s.attachmentStorage == nil {
		return "", ErrAttachmentStorageUnavailable
	}
	id := store.NewUUIDv7String()
	key := attachmentOriginalObjectKey(job.CompanyID, id)
	digest := sha256.Sum256(data)
	sha := hex.EncodeToString(digest[:])
	_, _, err := s.repo.CreateAttachmentWithResourceLinkContext(ctx, store.AttachmentCreateInput{CompanyID: job.CompanyID, AttachmentID: id, UploadedByUserID: job.UserID, OriginalFilename: filename, MimeType: ctrlLoopMIME, ByteSize: int64(len(data)), SHA256: sha, SHA256VerificationMethod: "server_stream", StorageChecksumAlgorithm: "SHA256", StorageChecksumValue: rawSHA256Base64(sha), StorageChecksumType: "FULL_OBJECT", StorageBucket: s.attachmentStorage.Bucket(), StorageKey: key, SourceKind: store.AttachmentSourceUserUpload, SourceProvider: "ctrl_loop", CreatedTimestamp: time.Now().UTC(), ResourceLink: store.ResourceAttachmentInput{CompanyID: job.CompanyID, ResourceType: "ctrl_loop_job", ResourceID: job.ID, RelationshipKind: store.AttachmentRelationshipFileAttachment, CreatedByUserID: job.UserID}, StoreObject: func(ctx context.Context) error {
		return s.attachmentStorage.PutObject(ctx, AttachmentPutObjectInput{Key: key, ContentType: ctrlLoopMIME, ContentLength: int64(len(data)), SHA256: sha, Body: bytes.NewReader(data)})
	}})
	return id, err
}
func (s *Server) ctrlLoopWorkbookAttachment(c, id string) (domain.Attachment, error) {
	if id == "" {
		return domain.Attachment{}, store.ErrNotFound
	}
	if s.attachmentStorage == nil {
		return domain.Attachment{}, ErrAttachmentStorageUnavailable
	}
	a, err := s.repo.GetAttachment(c, id)
	if err != nil {
		return domain.Attachment{}, err
	}
	if a.CompanyID != c || a.DeletedTimestamp != nil || a.ByteSize < 0 || a.ByteSize > ctrlloopexcel.MaxFileBytes || a.StorageBucket != s.attachmentStorage.Bucket() {
		return domain.Attachment{}, store.ErrNotFound
	}
	return a, nil
}
func (s *Server) ctrlLoopWorkbookBytes(ctx context.Context, c, id string) ([]byte, error) {
	a, err := s.ctrlLoopWorkbookAttachment(c, id)
	if err != nil {
		return nil, err
	}
	obj, err := s.attachmentStorage.GetObject(ctx, AttachmentGetObjectInput{Key: a.StorageKey})
	if err != nil {
		return nil, err
	}
	defer obj.Body.Close()
	data, err := io.ReadAll(io.LimitReader(obj.Body, ctrlloopexcel.MaxFileBytes+1))
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(data)
	if len(data) > ctrlloopexcel.MaxFileBytes || hex.EncodeToString(digest[:]) != a.SHA256 {
		return nil, errors.New("workbook integrity check failed")
	}
	return data, nil
}
