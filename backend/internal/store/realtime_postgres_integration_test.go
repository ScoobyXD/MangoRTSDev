package store

import (
	"database/sql"
	"errors"
	"fmt"
	"miraeopus/backend/internal/domain"
	"os"
	"strings"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func openRealtimePostgresIntegration(t *testing.T) (*sql.DB, *PostgresRepo) {
	t.Helper()
	if os.Getenv("MANGORTS_REALTIME_POSTGRES_TEST") != "1" || os.Getenv("DB_NAME") != "mangorts_realtime_test" {
		t.Skip("disposable realtime PostgreSQL integration database not configured")
	}
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		os.Getenv("DB_HOST"), os.Getenv("DB_PORT"), os.Getenv("DB_USER"),
		os.Getenv("DB_PASSWORD"), os.Getenv("DB_NAME"), os.Getenv("DB_SSLMODE"),
	)
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.Ping(); err != nil {
		t.Fatal(err)
	}
	return db, NewPostgresRepo(db)
}

func installRealtimeOutboxFailureTrigger(t *testing.T, db *sql.DB) {
	t.Helper()
	_, err := db.Exec(`
create table if not exists mangorts_realtime_test_failures (
  event_type text primary key
);
create or replace function mangorts_realtime_test_fail_outbox()
returns trigger language plpgsql as $$
begin
  if exists(select 1 from mangorts_realtime_test_failures where event_type=new.event_type) then
    raise exception 'forced realtime outbox failure for %', new.event_type;
  end if;
  return new;
end;
$$;
drop trigger if exists mangorts_realtime_test_fail_outbox_trigger on realtime_outbox;
create trigger mangorts_realtime_test_fail_outbox_trigger
before insert on realtime_outbox
for each row execute function mangorts_realtime_test_fail_outbox();
truncate mangorts_realtime_test_failures;`)
	if err != nil {
		t.Fatalf("install outbox failure trigger: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(`drop trigger if exists mangorts_realtime_test_fail_outbox_trigger on realtime_outbox;
drop function if exists mangorts_realtime_test_fail_outbox();
drop table if exists mangorts_realtime_test_failures;`)
	})
}

func forceRealtimeOutboxEvent(t *testing.T, db *sql.DB, eventType string, enabled bool) {
	t.Helper()
	var err error
	if enabled {
		_, err = db.Exec("insert into mangorts_realtime_test_failures(event_type) values ($1) on conflict do nothing", eventType)
	} else {
		_, err = db.Exec("delete from mangorts_realtime_test_failures where event_type=$1", eventType)
	}
	if err != nil {
		t.Fatal(err)
	}
}

func countPostgresRows(t *testing.T, db *sql.DB, query string, args ...any) int {
	t.Helper()
	var count int
	if err := db.QueryRow(query, args...).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func TestPostgresRealtimeProducersAreTransactionallyAtomic(t *testing.T) {
	db, repo := openRealtimePostgresIntegration(t)
	installRealtimeOutboxFailureTrigger(t, db)

	company, err := repo.CreateCompany("Realtime atomicity")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec("delete from companies where company_id=$1::uuid", company.CompanyID) })
	user, err := repo.UpsertAuthUser("realtime-pg-user", "realtime-pg-user@example.test", "Realtime PG User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership("realtime-pg-user", company.CompanyID, "company_admin"); err != nil {
		t.Fatal(err)
	}

	t.Run("Logic Gate create update and mounted board", func(t *testing.T) {
		forceRealtimeOutboxEvent(t, db, "kanban.changed", true)
		if _, _, err := repo.CreateLogicGateWithWorkspaceEvent(company.CompanyID, "rolled back"); err == nil {
			t.Fatal("Logic Gate create succeeded with forced outbox failure")
		}
		if got := countPostgresRows(t, db, "select count(*) from logic_gates where company_id=$1::uuid and header='rolled back'", company.CompanyID); got != 0 {
			t.Fatalf("rolled-back Logic Gate rows = %d", got)
		}
		if got := countPostgresRows(t, db, "select count(*) from domain_events where company_id=$1::uuid", company.CompanyID); got != 0 {
			t.Fatalf("rolled-back domain events = %d", got)
		}

		forceRealtimeOutboxEvent(t, db, "kanban.changed", false)
		gate, event, err := repo.CreateLogicGateWithWorkspaceEvent(company.CompanyID, "committed")
		if err != nil || event.Type != "logic_gate_created" {
			t.Fatalf("committed Logic Gate = %+v event=%+v err=%v", gate, event, err)
		}
		forceRealtimeOutboxEvent(t, db, "kanban.changed", true)
		if _, _, err := repo.UpdateLogicGateHeaderWithWorkspaceEvent(company.CompanyID, gate.LogicGateID, "not committed"); err == nil {
			t.Fatal("Logic Gate update succeeded with forced outbox failure")
		}
		stored, err := repo.GetLogicGate(company.CompanyID, gate.LogicGateID)
		if err != nil || stored.Header != "committed" {
			t.Fatalf("Logic Gate after failed update = %+v err=%v", stored, err)
		}
		if _, _, err := repo.UpdateLogicGateHeaderWithWorkspaceEvent(company.CompanyID, "00000000-0000-4000-8000-000000000099", "missing"); !errors.Is(err, ErrNotFound) {
			t.Fatalf("missing Logic Gate update = %v", err)
		}
		forceRealtimeOutboxEvent(t, db, "kanban.changed", false)
	})

	node, err := repo.CreateNode(company.CompanyID, "Realtime node")
	if err != nil {
		t.Fatal(err)
	}

	t.Run("Node chat", func(t *testing.T) {
		forceRealtimeOutboxEvent(t, db, "chat.message.created", true)
		input := NodeInformationInput{
			CompanyID: company.CompanyID, NodeID: node.NodeID, Type: "Text block chat",
			Information:   `{"block_id":"00000000-0000-4000-8000-000000000111","text":"hello"}`,
			InformationID: "00000000-0000-4000-8000-000000000112", ActorUserID: user.UserID,
		}
		if _, err := repo.AddNodeInformationWithActor(input); err == nil {
			t.Fatal("chat create succeeded with forced outbox failure")
		}
		if got := countPostgresRows(t, db, "select count(*) from node_information where company_id=$1::uuid and information_id=$2::uuid", company.CompanyID, input.InformationID); got != 0 {
			t.Fatalf("rolled-back chat rows = %d", got)
		}
		forceRealtimeOutboxEvent(t, db, "chat.message.created", false)
	})

	t.Run("notification", func(t *testing.T) {
		source, err := repo.AppendDomainEvent(workspaceDomainEventInput(company.CompanyID, "realtime_test_source", map[string]any{"node_id": node.NodeID}))
		if err != nil {
			t.Fatal(err)
		}
		forceRealtimeOutboxEvent(t, db, "notification.created", true)
		created, err := repo.CreateNotifications(CreateNotificationsInput{Notifications: []NotificationCreateInput{{
			CompanyID: company.CompanyID, RecipientUserID: user.UserID, Type: "node.updated",
			SourceEventID: source.EventID, EntityType: EntityTypeNode, EntityID: node.NodeID,
			NodeID: node.NodeID, Title: "Updated",
		}}})
		if err == nil || len(created) != 0 {
			t.Fatalf("notification create = %+v err=%v, want rollback", created, err)
		}
		if got := countPostgresRows(t, db, "select count(*) from notifications where source_event_id=$1::uuid", source.EventID); got != 0 {
			t.Fatalf("rolled-back notification rows = %d", got)
		}
		forceRealtimeOutboxEvent(t, db, "notification.created", false)
	})

	t.Run("email collaboration mailbox hint", func(t *testing.T) {
		peer, err := repo.UpsertAuthUser("realtime-pg-peer", "realtime-pg-peer@example.test", "Realtime PG Peer")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := repo.AddCompanyMembership("realtime-pg-peer", company.CompanyID, "company_user"); err != nil {
			t.Fatal(err)
		}
		for _, connection := range []UserEmailConnectionInput{
			{UserID: user.UserID, Provider: "google", AccountEmail: user.Email, GrantID: "realtime-pg-creator-grant", Status: "connected"},
			{UserID: peer.UserID, Provider: "microsoft", AccountEmail: peer.Email, GrantID: "realtime-pg-peer-grant", Status: "connected"},
		} {
			if _, err := repo.UpsertUserEmailConnection(connection); err != nil {
				t.Fatal(err)
			}
		}
		created, err := repo.EnsureCommunicationsEmailCollaboration(CommunicationsEmailCollaborationEnsureInput{
			CompanyID: company.CompanyID, PersonalUserID: user.UserID, PersonalAccountEmail: user.Email,
			CreatedByUserID: user.UserID,
			Message:         domain.EmailMessageSnapshot{ID: "pg-mailbox-root", ThreadID: "pg-mailbox-thread", Subject: "Root", Date: 10},
		})
		if err != nil {
			t.Fatalf("email collaboration ensure stage=%s sqlstate=%s category=%s", EmailCollaborationEnsureErrorStage(err), EmailCollaborationEnsureErrorSQLState(err), EmailCollaborationEnsureErrorCategory(err))
		}
		if _, err := repo.AddCommunicationsEmailCollaborationParticipants(CommunicationsEmailCollaborationParticipantInput{
			CompanyID: company.CompanyID, CollaborationID: created.Collaboration.CollaborationID,
			ActorUserID: user.UserID, MentionedUserIDs: []string{peer.UserID},
		}); err != nil {
			t.Fatal(err)
		}
		input := CommunicationsEmailCollaborationMessageInput{
			CompanyID: company.CompanyID, PersonalUserID: user.UserID, PersonalAccountEmail: user.Email,
			Message: domain.EmailMessageSnapshot{ID: "pg-mailbox-next", ThreadID: "pg-mailbox-thread", Subject: "Next", Date: 20},
		}
		forceRealtimeOutboxEvent(t, db, "mailbox.message.changed", true)
		if _, err := repo.UpdateCommunicationsEmailCollaborationMessage(input); err == nil {
			t.Fatal("email collaboration update succeeded with forced mailbox outbox failure")
		}
		var latestMessageID string
		if err := db.QueryRow(
			"select latest_message_id from communications_email_collaborations where company_id=$1::uuid and collaboration_id=$2::uuid",
			company.CompanyID, created.Collaboration.CollaborationID,
		).Scan(&latestMessageID); err != nil || latestMessageID != "pg-mailbox-root" {
			t.Fatalf("mailbox snapshot after rollback = %q err=%v", latestMessageID, err)
		}
		scope := "mailbox:personal:account:" + peer.UserID + ":" + peer.Email
		if got := countPostgresRows(t, db, "select count(*) from realtime_outbox where company_id=$1::uuid and scope=$2", company.CompanyID, scope); got != 0 {
			t.Fatalf("rolled-back mailbox outbox rows = %d", got)
		}
		forceRealtimeOutboxEvent(t, db, "mailbox.message.changed", false)
		if _, err := repo.UpdateCommunicationsEmailCollaborationMessage(input); err != nil {
			t.Fatal(err)
		}
		if _, err := repo.UpdateCommunicationsEmailCollaborationMessage(input); err != nil {
			t.Fatal(err)
		}
		if got := countPostgresRows(t, db, "select count(*) from realtime_outbox where company_id=$1::uuid and scope=$2 and event_type='mailbox.message.changed'", company.CompanyID, scope); got != 1 {
			t.Fatalf("idempotent mailbox outbox rows = %d, want 1", got)
		}
	})

	t.Run("structured editor and canonical limit", func(t *testing.T) {
		documentID := "00000000-0000-4000-8000-000000000121"
		ref := EditorDocumentRef{CompanyID: company.CompanyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID, DocumentID: documentID}
		forceRealtimeOutboxEvent(t, db, EditorCollaborationEventType, true)
		if _, err := repo.CommitEditorCollaborationOperation(EditorCollaborationOperationInput{
			Document: ref, OperationID: "pg-editor-outbox-failure", ClientID: "pg-editor-client",
			ActorUserID: user.UserID, BaseRevision: 0,
			Delta: EditorCollaborationDelta{Ops: []EditorCollaborationOp{{Insert: "hello"}}},
		}); err == nil {
			t.Fatal("editor commit succeeded with forced outbox failure")
		}
		if got := countPostgresRows(t, db, "select count(*) from editor_collaboration_documents where company_id=$1::uuid and document_id=$2::uuid", company.CompanyID, documentID); got != 0 {
			t.Fatalf("rolled-back editor documents = %d", got)
		}
		forceRealtimeOutboxEvent(t, db, EditorCollaborationEventType, false)

		limitDocumentID := "00000000-0000-4000-8000-000000000122"
		text := strings.Repeat("x", EditorCollaborationDocumentMaxBytes-len("<p></p>"))
		if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
			CompanyID: company.CompanyID, NodeID: node.NodeID, Type: "Text box",
			Information: "<p>" + text + "</p>", InformationID: limitDocumentID, ActorUserID: user.UserID,
		}); err != nil {
			t.Fatalf("seed boundary document: %v", err)
		}
		limitRef := EditorDocumentRef{CompanyID: company.CompanyID, ResourceType: EntityTypeNode, ResourceID: node.NodeID, DocumentID: limitDocumentID}
		if _, err := repo.CommitEditorCollaborationOperation(EditorCollaborationOperationInput{
			Document: limitRef, OperationID: "pg-editor-too-large", ClientID: "pg-editor-client",
			ActorUserID: user.UserID, BaseRevision: 0,
			Delta: EditorCollaborationDelta{Ops: []EditorCollaborationOp{{Retain: len(text)}, {Insert: "y"}}},
		}); !errors.Is(err, ErrEditorDocumentTooLarge) {
			t.Fatalf("oversized editor commit error = %v", err)
		}
		if got := countPostgresRows(t, db, "select count(*) from editor_collaboration_operations where company_id=$1::uuid and document_id=$2::uuid", company.CompanyID, limitDocumentID); got != 0 {
			t.Fatalf("oversized operation rows = %d", got)
		}
		if got := countPostgresRows(t, db, "select count(*) from realtime_outbox where company_id=$1::uuid and scope=$2", company.CompanyID, EditorRealtimeScope(limitRef)); got != 0 {
			t.Fatalf("oversized outbox rows = %d", got)
		}
	})
}

func TestPostgresRealtimeOutboxRetryAndDuplicateCompletion(t *testing.T) {
	db, repo := openRealtimePostgresIntegration(t)
	company, err := repo.CreateCompany("Realtime dispatcher retry")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec("delete from companies where company_id=$1::uuid", company.CompanyID) })
	event, err := repo.EnqueueRealtimeOutbox(RealtimeOutboxInput{
		CompanyID: company.CompanyID, Scope: "notifications:user:dispatcher-test",
		EventType: "notification.created", Payload: []byte(`{"type":"notification.created"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	var published bool
	if err := db.QueryRow("select published_timestamp is not null from realtime_outbox where event_id=$1::uuid", event.EventID).Scan(&published); err != nil || published {
		t.Fatalf("post-commit retryable row published=%v err=%v", published, err)
	}
	claimed, err := repo.ClaimRealtimeOutbox(RealtimeOutboxClaimQuery{Limit: 10, LeaseDuration: time.Second})
	if err != nil || len(claimed) != 1 {
		t.Fatalf("first claim=%+v err=%v", claimed, err)
	}
	if err := repo.MarkRealtimeOutboxFailed(event.EventID, claimed[0].ClaimToken, "simulated_prepublication_failure"); err != nil {
		t.Fatal(err)
	}
	claimed, err = repo.ClaimRealtimeOutbox(RealtimeOutboxClaimQuery{Limit: 10, LeaseDuration: time.Second})
	if err != nil || len(claimed) != 1 || claimed[0].AttemptCount != 2 {
		t.Fatalf("retry claim=%+v err=%v", claimed, err)
	}
	if err := repo.MarkRealtimeOutboxPublished(event.EventID, claimed[0].ClaimToken); err != nil {
		t.Fatal(err)
	}
	if err := repo.MarkRealtimeOutboxPublished(event.EventID, claimed[0].ClaimToken); err != nil {
		t.Fatalf("duplicate publication completion must be idempotent: %v", err)
	}
}
