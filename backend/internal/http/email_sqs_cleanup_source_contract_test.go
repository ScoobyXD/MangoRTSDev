package httpapi

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func requireSourceDoesNotContain(t *testing.T, path string, forbidden ...string) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Clean(path))
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	for _, value := range forbidden {
		if strings.Contains(source, value) {
			t.Errorf("%s retained obsolete source %q", path, value)
		}
	}
}

func TestEmailSQSObsoleteExecutionPathsDoNotReturn(t *testing.T) {
	requireSourceDoesNotContain(t, "communications_handlers.go",
		"func (s *Server) archiveCommunicationsMessage(", "archiveCommunicationsMessagesBatch", "enqueueCommunicationsReconciliationControl")
	for _, path := range []string{
		"communications_email_queue.go",
		"communications_email_ingestion_worker.go",
		"communications_archive_worker.go",
	} {
		requireSourceDoesNotContain(t, path,
			"ThreadDownloadJob", "thread_download_worker", "ChangeMessageVisibility", "context.Background()",
			"recoverUnsentEmailSQSWork", "emailReconciliationUnsentAge", "ListUnsentCommunications")
	}
	requireSourceDoesNotContain(t, "../store/repository.go",
		"EnsureCommunicationsEmailThreadDownloadJobContext", "ThreadDownloadJob", "ListUnsentCommunications")
	for _, path := range []string{
		"../store/memory_email_ingestion_jobs.go",
		"../store/postgres_email_ingestion_jobs.go",
	} {
		requireSourceDoesNotContain(t, path, "ThreadDownloadJob", "available_at", "processing_started_at")
	}
	requireSourceDoesNotContain(t, "../../../frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx",
		"storedThreadPollVersion", "setStoredThreadPollVersion", "storedThreadPollTimer",
		"setTimeout(() => { void refreshStoredThread")
	requireSourceDoesNotContain(t, "../../../frontend/src/pages/home/HomePage.tsx",
		"ARCHIVE_BACKGROUND_CONFIRMATION_TIMEOUT_MS", "archivePendingReleaseTimerIDsRef", "releasePendingArchiveMessagesLater",
		"refreshActiveArchiveJobs", "refreshArchiveJobsRef")
	requireSourceDoesNotContain(t, "../../../frontend/src/modules/communications/communicationsApi.ts", "export async function archiveEmailMessage(")
}

func TestRealtimeCoruscantLayersDoNotReturn(t *testing.T) {
	requireSourceDoesNotContain(t, "realtime_publish.go",
		"publishRealtimeMessage(",
		"publishRealtimeMessageContext(",
		"publishRealtimeMessageResultContext(",
		"publishRealtimeMessageToCurrentEntityAudience(",
		"publishRealtimeMessageToCurrentEntityAudienceResult(",
		"publishRealtimeMessageToCurrentEntityAudienceResultContext(",
		"publishRealtimeMessageWithAudience(",
		"publishRealtimeMessageWithAudienceContext(",
		"publishRealtimeMessageWithAudienceResultContext(",
		"publishRealtimeMessageWithAudienceUnlocked(",
		"publishNodeChatCreated(", "publishNodeChatDeleted(", "publishNodeChatUpdated(", "publishCapturedKanbanDeletes(",
		"realtimeAllowedUserIDList(", "resolveRealtimeEntityAudienceUnlocked(")
	requireSourceDoesNotContain(t, "realtime_spine.go", "realtime.NewLocalBackplane()")
	requireSourceDoesNotContain(t, "realtime_spine.go", "func (s *Server) enqueueRealtimeOutbox(")
	requireSourceDoesNotContain(t, "../store/postgres_editor_json_metadata.go", "insertRealtimeOutboxTx(")
	requireSourceDoesNotContain(t, "../store/postgres_realtime_outbox.go", "var _ = time.Second")
}
