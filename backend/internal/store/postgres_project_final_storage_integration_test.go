package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestPostgresProjectFinalTextboxChatAndEmailStorage(t *testing.T) {
	db, repo := openRealtimePostgresIntegration(t)
	company, err := repo.CreateCompany("Project final storage integration")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec("delete from companies where company_id=$1::uuid", company.CompanyID) })
	actor, err := repo.UpsertAuthUser("project-final-storage", "project-final-storage@example.test", "Project Final Storage")
	if err != nil {
		t.Fatal(err)
	}
	projectResult, err := repo.CreateProject(ProjectInput{
		CompanyID: company.CompanyID, Name: "Final storage", Status: ProjectDefaultStatus,
		Health: "On track", ActorUserID: actor.UserID,
	})
	if err != nil || projectResult.Project == nil {
		t.Fatalf("CreateProject=%+v err=%v", projectResult, err)
	}
	projectID := projectResult.Project.ProjectID
	textboxID := "00000000-0000-4000-8000-000000000301"
	ref := EditorJSONDocumentRef{CompanyID: company.CompanyID, ResourceType: EntityTypeProject, ResourceID: projectID, DocumentID: textboxID}
	var textboxExists bool
	if err := db.QueryRow(`select exists(
		select 1 from project_textboxes where company_id=$1::uuid and project_id=$2::uuid and textbox_id=$3
	)`, company.CompanyID, projectID, textboxID).Scan(&textboxExists); err != nil {
		t.Fatal(err)
	}
	if textboxExists {
		t.Fatal("new Project textbox unexpectedly existed before its first metadata save")
	}
	if _, err := repo.UpdateEditorJSONMetadata(EditorJSONMetadataInput{
		Document: EditorDocumentRef{CompanyID: company.CompanyID, ResourceType: EntityTypeProject, ResourceID: projectID, DocumentID: textboxID},
		Title:    "Final Project Notes",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.EnsureEditorJSONCollaborationDocument(ref); err != nil {
		t.Fatal(err)
	}
	var storedTitle, bodyFormat string
	if err := db.QueryRow(`select title,body_json->>'format'
		from project_textboxes where company_id=$1::uuid and project_id=$2::uuid and textbox_id=$3`,
		company.CompanyID, projectID, textboxID).Scan(&storedTitle, &bodyFormat); err != nil {
		t.Fatal(err)
	}
	if storedTitle != "Final Project Notes" || bodyFormat != MangoTiptapFormat {
		t.Fatalf("metadata-first Project textbox title=%q body format=%q", storedTitle, bodyFormat)
	}

	emailConnectionID := "00000000-0000-4000-8000-000000000302"
	emailThreadID := "00000000-0000-4000-8000-000000000303"
	emailMessageID := "00000000-0000-4000-8000-000000000304"
	if _, err := db.Exec(`insert into email_connections(
  email_connection_id,company_id,connection_type,personal_user_id,provider,account_email,grant_id,connected_by_user_id
) values($1::uuid,$2::uuid,'personal',$3::uuid,'google','project-final-storage@example.test',
  'project-final-storage-test-grant',$3::uuid)`, emailConnectionID, company.CompanyID, actor.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`insert into email_threads(
	company_id,email_thread_id,email_connection_id,provider_thread_key,provider_thread_id,root_provider_message_id
) values($1::uuid,$2::uuid,$3::uuid,'thread-key','provider-thread','provider-message')`,
		company.CompanyID, emailThreadID, emailConnectionID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`insert into email_messages(
  company_id,email_message_id,email_thread_id,provider_message_id,message_order,subject,snippet,sender_snapshot
) values($1::uuid,$2::uuid,$3::uuid,'provider-message',0,'Exact final email','Email snippet',
  '[{"name":"Sender","email":"sender@example.test"}]'::jsonb)`, company.CompanyID, emailMessageID, emailThreadID); err != nil {
		t.Fatal(err)
	}
	missingWidePayload, _ := json.Marshal(map[string]any{
		"block_id": textboxID, "email_message_id": emailMessageID, "textbox_color": "#0EA5E9",
	})
	if _, err := repo.AddProjectInformation(ProjectInformationInput{
		CompanyID: company.CompanyID, ProjectID: projectID,
		InformationID: "00000000-0000-4000-8000-000000000305",
		Type:          "Attached email", Information: string(missingWidePayload), ActorUserID: actor.UserID,
	}); !errors.Is(err, ErrEmailMessageNotAttachedToProject) {
		t.Fatalf("exact Project link without wide relationship err=%v", err)
	}
	var exactBeforeWide int
	var colorBeforeWide sql.NullString
	if err := db.QueryRow(`select
  (select count(*) from email_relationships where company_id=$1::uuid and resource_type='project'
    and resource_id=$2::uuid and resource_textbox_id=$3),
  (select color from project_textboxes where company_id=$1::uuid and project_id=$2::uuid and textbox_id=$3)`,
		company.CompanyID, projectID, textboxID).Scan(&exactBeforeWide, &colorBeforeWide); err != nil {
		t.Fatal(err)
	}
	if exactBeforeWide != 0 || colorBeforeWide.Valid {
		t.Fatalf("failed exact link wrote relationships=%d color=%v", exactBeforeWide, colorBeforeWide)
	}

	attachmentID := "00000000-0000-4000-8000-000000000307"
	if _, err := db.Exec(`insert into attachments(
  attachment_id,company_id,uploaded_by_user_id,original_filename,mime_type,byte_size,sha256,
  storage_bucket,storage_key,source_kind
) values($1::uuid,$2::uuid,$3::uuid,'shared-project-file.txt','text/plain',5,
  '0000000000000000000000000000000000000000000000000000000000000000',
  'disposable-test-bucket','project-final-storage/shared-project-file.txt','chat_upload')`,
		attachmentID, company.CompanyID, actor.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`insert into attachment_relationships(
  attachment_relationship_id,company_id,resource_type,resource_id,attachment_id,information_id,
  message_id,editor_surface,relationship_kind,created_by_user_id
) values
  ('00000000-0000-4000-8000-000000000308',$1::uuid,'project',$2,$3::uuid,$4::uuid,
   '','project_textbox','file_attachment',$5::uuid),
  ('00000000-0000-4000-8000-000000000309',$1::uuid,'email_message',$6,$3::uuid,null,
   '','email_message','email_attachment',$5::uuid)`,
		company.CompanyID, projectID, attachmentID, textboxID, actor.UserID, emailMessageID); err != nil {
		t.Fatal(err)
	}
	wideEmailRelationshipID := "00000000-0000-4000-8000-000000000310"
	wideEmailPayload, _ := json.Marshal(map[string]any{
		"email_message_id": emailMessageID, "link_scope": "message",
		"attached_timestamp": time.Now().UTC().Format(time.RFC3339Nano),
	})
	if _, err := repo.AddProjectInformation(ProjectInformationInput{
		CompanyID: company.CompanyID, ProjectID: projectID, InformationID: wideEmailRelationshipID,
		Type: "Attached email", Information: string(wideEmailPayload), ActorUserID: actor.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	wideDeleteTx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := wideDeleteTx.Exec(`delete from email_relationships
where company_id=$1::uuid and email_relationship_id=$2::uuid`, company.CompanyID, wideEmailRelationshipID); err != nil {
		_ = wideDeleteTx.Rollback()
		t.Fatal(err)
	}
	exactRaceResult := make(chan error, 1)
	go func() {
		_, addErr := repo.AddProjectInformation(ProjectInformationInput{
			CompanyID: company.CompanyID, ProjectID: projectID,
			InformationID: "00000000-0000-4000-8000-000000000315",
			Type:          "Attached email", Information: string(missingWidePayload), ActorUserID: actor.UserID,
		})
		exactRaceResult <- addErr
	}()
	select {
	case addErr := <-exactRaceResult:
		_ = wideDeleteTx.Rollback()
		t.Fatalf("exact Project link did not wait for concurrent wide deletion: %v", addErr)
	case <-time.After(150 * time.Millisecond):
	}
	if err := wideDeleteTx.Commit(); err != nil {
		t.Fatal(err)
	}
	select {
	case addErr := <-exactRaceResult:
		if !errors.Is(addErr, ErrEmailMessageNotAttachedToProject) {
			t.Fatalf("exact Project link after concurrent wide deletion err=%v", addErr)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("exact Project link remained blocked after concurrent wide deletion committed")
	}
	if _, err := repo.AddProjectInformation(ProjectInformationInput{
		CompanyID: company.CompanyID, ProjectID: projectID, InformationID: wideEmailRelationshipID,
		Type: "Attached email", Information: string(wideEmailPayload), ActorUserID: actor.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	exactRaceRelationshipID := "00000000-0000-4000-8000-000000000316"
	if _, err := repo.AddProjectInformation(ProjectInformationInput{
		CompanyID: company.CompanyID, ProjectID: projectID, InformationID: exactRaceRelationshipID,
		Type: "Attached email", Information: string(missingWidePayload), ActorUserID: actor.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	exactDeleteTx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := exactDeleteTx.Exec(`delete from email_relationships
where company_id=$1::uuid and email_relationship_id=$2::uuid`, company.CompanyID, exactRaceRelationshipID); err != nil {
		_ = exactDeleteTx.Rollback()
		t.Fatal(err)
	}
	chatRaceID := "00000000-0000-4000-8000-000000000317"
	chatRacePayload, _ := json.Marshal(map[string]any{
		"block_id": textboxID, "selection_source": "email", "selection_block_id": textboxID,
		"selection_message_id": emailMessageID, "selection_quote": "Concurrent exact selection",
		"author_id": actor.UserID, "author_name": "Project Final Storage", "message": "Must not outlive its exact link",
		"attachments": []any{}, "entity_links": []any{}, "mentioned_user_ids": []string{}, "mentioned_group_ids": []string{},
	})
	chatRaceResult := make(chan error, 1)
	go func() {
		_, addErr := repo.AddProjectInformation(ProjectInformationInput{
			CompanyID: company.CompanyID, ProjectID: projectID, InformationID: chatRaceID,
			Type: CommunicationsEmailCollaborationChatInformationType, Information: string(chatRacePayload), ActorUserID: actor.UserID,
		})
		chatRaceResult <- addErr
	}()
	select {
	case addErr := <-chatRaceResult:
		_ = exactDeleteTx.Rollback()
		t.Fatalf("Project email chat did not wait for concurrent exact-link deletion: %v", addErr)
	case <-time.After(150 * time.Millisecond):
	}
	if err := exactDeleteTx.Commit(); err != nil {
		t.Fatal(err)
	}
	select {
	case addErr := <-chatRaceResult:
		if !errors.Is(addErr, ErrEmailMessageNotAttachedToProject) {
			t.Fatalf("Project email chat after concurrent exact-link deletion err=%v", addErr)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Project email chat remained blocked after concurrent exact-link deletion committed")
	}
	var racedChatCount int
	if err := db.QueryRow(`select count(*) from project_textbox_chats
where company_id=$1::uuid and project_id=$2::uuid and chat_id=$3::uuid`, company.CompanyID, projectID, chatRaceID).
		Scan(&racedChatCount); err != nil {
		t.Fatal(err)
	}
	if racedChatCount != 0 {
		t.Fatalf("concurrent exact-link deletion left %d Project email chats", racedChatCount)
	}
	rolledBackTextboxID := "00000000-0000-4000-8000-000000000311"
	invalidFirstChatPayload, _ := json.Marshal(map[string]any{
		"block_id": rolledBackTextboxID, "ensure_email_textbox_link_on_send": true,
		"email_textbox_color_on_send": "#0EA5E9", "selection_source": "email",
		"selection_block_id": rolledBackTextboxID, "selection_message_id": emailMessageID,
		"selection_quote": "Exact selection", "author_id": actor.UserID,
		"author_name": "Project Final Storage", "message": "", "attachments": []any{},
		"entity_links": []any{}, "mentioned_user_ids": []string{}, "mentioned_group_ids": []string{},
	})
	if _, err := repo.AddProjectInformation(ProjectInformationInput{
		CompanyID: company.CompanyID, ProjectID: projectID,
		InformationID: "00000000-0000-4000-8000-000000000312",
		Type:          CommunicationsEmailCollaborationChatInformationType, Information: string(invalidFirstChatPayload), ActorUserID: actor.UserID,
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid first Project email chat err=%v, want ErrInvalid", err)
	}
	var rolledBackTextboxCount, rolledBackRelationshipCount int
	if err := db.QueryRow(`select
  (select count(*) from project_textboxes where company_id=$1::uuid and project_id=$2::uuid and textbox_id=$3),
  (select count(*) from email_relationships where company_id=$1::uuid and resource_type='project'
    and resource_id=$2::uuid and resource_textbox_id=$3)`, company.CompanyID, projectID, rolledBackTextboxID).
		Scan(&rolledBackTextboxCount, &rolledBackRelationshipCount); err != nil {
		t.Fatal(err)
	}
	if rolledBackTextboxCount != 0 || rolledBackRelationshipCount != 0 {
		t.Fatalf("invalid first chat left textbox=%d exact relationships=%d", rolledBackTextboxCount, rolledBackRelationshipCount)
	}

	chatID := "00000000-0000-4000-8000-000000000313"
	created := time.Now().UTC().Add(-time.Minute)
	chatPayload, _ := json.Marshal(map[string]any{
		"block_id": textboxID, "ensure_email_textbox_link_on_send": true,
		"email_textbox_color_on_send": "#0EA5E9", "selection_source": "email",
		"selection_block_id": textboxID, "selection_message_id": emailMessageID,
		"selection_quote": "Exact selection",
		"author_id":       actor.UserID, "author_name": "Project Final Storage", "message": "Exact selection",
		"created_timestamp": created.Format(time.RFC3339Nano), "attachments": []any{map[string]any{"attachment_id": attachmentID}},
		"entity_links": []any{}, "mentioned_user_ids": []string{}, "mentioned_group_ids": []string{},
	})
	if _, err := repo.AddProjectInformation(ProjectInformationInput{
		CompanyID: company.CompanyID, ProjectID: projectID, InformationID: chatID,
		Type: CommunicationsEmailCollaborationChatInformationType, Information: string(chatPayload), ActorUserID: actor.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	var emailRelationshipID string
	if err := db.QueryRow(`select email_relationship_id::text from email_relationships
where company_id=$1::uuid and resource_type='project' and resource_id=$2::uuid
  and resource_textbox_id=$3 and email_message_id=$4::uuid`,
		company.CompanyID, projectID, textboxID, emailMessageID).Scan(&emailRelationshipID); err != nil {
		t.Fatal(err)
	}

	edited := time.Now().UTC()
	editedPayload, _ := json.Marshal(map[string]any{
		"block_id": textboxID, "selection_source": "email", "selection_message_id": emailMessageID,
		"author_id": actor.UserID, "author_name": "Project Final Storage", "message": "Edited exact selection",
		"created_timestamp": created.Format(time.RFC3339Nano), "edited_timestamp": edited.Format(time.RFC3339Nano),
		"attachments":  []any{map[string]any{"attachment_id": attachmentID}},
		"entity_links": []any{}, "mentioned_user_ids": []string{}, "mentioned_group_ids": []string{},
	})
	updatedChat, err := repo.AddProjectInformation(ProjectInformationInput{
		CompanyID: company.CompanyID, ProjectID: projectID, InformationID: chatID,
		Type: CommunicationsEmailCollaborationChatInformationType, Information: string(editedPayload), ActorUserID: actor.UserID,
	})
	if err != nil || updatedChat.InformationID != chatID || !strings.Contains(updatedChat.Information, "Edited exact selection") {
		t.Fatalf("updated Project chat=%+v err=%v", updatedChat, err)
	}

	otherActor, err := repo.UpsertAuthUser("project-final-storage-other", "project-final-storage-other@example.test", "Other Project User")
	if err != nil {
		t.Fatal(err)
	}
	forbiddenEditPayload, _ := json.Marshal(map[string]any{
		"block_id": textboxID, "selection_source": "email", "selection_message_id": emailMessageID,
		"author_id": otherActor.UserID, "author_name": "Other Project User", "message": "Forbidden edit",
		"created_timestamp": created.Format(time.RFC3339Nano), "edited_timestamp": edited.Format(time.RFC3339Nano),
		"attachments":  []any{map[string]any{"attachment_id": attachmentID}},
		"entity_links": []any{}, "mentioned_user_ids": []string{}, "mentioned_group_ids": []string{},
	})
	if _, err := repo.AddProjectInformation(ProjectInformationInput{
		CompanyID: company.CompanyID, ProjectID: projectID, InformationID: chatID,
		Type: CommunicationsEmailCollaborationChatInformationType, Information: string(forbiddenEditPayload), ActorUserID: otherActor.UserID,
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("other-author Project chat edit err=%v, want ErrInvalid", err)
	}
	replyID := "00000000-0000-4000-8000-000000000314"
	replyPayload, _ := json.Marshal(map[string]any{
		"block_id": textboxID, "parent_id": chatID, "selection_source": "text",
		"author_id": actor.UserID, "author_name": "Project Final Storage", "message": "Final reply",
		"created_timestamp": edited.Add(time.Second).Format(time.RFC3339Nano), "attachments": []any{},
		"entity_links": []any{}, "mentioned_user_ids": []string{}, "mentioned_group_ids": []string{},
	})
	if _, err := repo.AddProjectInformation(ProjectInformationInput{
		CompanyID: company.CompanyID, ProjectID: projectID, InformationID: replyID,
		Type: CommunicationsEmailCollaborationChatInformationType, Information: string(replyPayload), ActorUserID: actor.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	projections, err := repo.ListProjectProjections(company.CompanyID, projectID)
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	for _, projection := range projections {
		found[projection.InformationID] = true
		if projection.InformationID == textboxID && (!strings.Contains(projection.Information, "Final Project Notes") ||
			!strings.Contains(projection.Information, attachmentID) ||
			!strings.Contains(projection.Information, `"color": "#0EA5E9"`) ||
			!strings.Contains(projection.Information, emailMessageID)) {
			t.Fatalf("textbox projection lost final metadata: %s", projection.Information)
		}
		if projection.InformationID == emailRelationshipID && !strings.Contains(projection.Information, emailMessageID) {
			t.Fatalf("email projection lost exact message ID: %s", projection.Information)
		}
		if projection.InformationID == chatID && (!strings.Contains(projection.Information, emailMessageID) || !strings.Contains(projection.Information, attachmentID) || !strings.Contains(projection.Information, "Edited exact selection")) {
			t.Fatalf("chat projection lost exact email selection: %s", projection.Information)
		}
		if projection.InformationID == replyID && !strings.Contains(projection.Information, chatID) {
			t.Fatalf("reply projection lost exact parent chat: %s", projection.Information)
		}
	}
	for _, id := range []string{textboxID, emailRelationshipID, chatID, replyID} {
		if !found[id] {
			t.Fatalf("final Project projection %s missing: %+v", id, projections)
		}
	}
	if err := repo.DeleteProjectProjection(ProjectProjectionDeleteInput{
		CompanyID: company.CompanyID, ProjectID: projectID, InformationID: emailRelationshipID, ActorUserID: actor.UserID,
	}); !errors.Is(err, ErrEmailRelationshipRequiredByChat) {
		t.Fatalf("delete exact Project relationship with chat err=%v", err)
	}
	if err := repo.DeleteProjectProjection(ProjectProjectionDeleteInput{
		CompanyID: company.CompanyID, ProjectID: projectID, InformationID: wideEmailRelationshipID, ActorUserID: actor.UserID,
	}); !errors.Is(err, ErrEmailRelationshipHasProjectWork) {
		t.Fatalf("delete Project-wide relationship with textbox work err=%v", err)
	}
	if err := repo.DeleteProjectProjection(ProjectProjectionDeleteInput{
		CompanyID: company.CompanyID, ProjectID: projectID, InformationID: replyID, ActorUserID: actor.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	var remainingReply int
	if err := db.QueryRow(`select count(*) from project_textbox_chats
where company_id=$1::uuid and project_id=$2::uuid and chat_id=$3::uuid`, company.CompanyID, projectID, replyID).Scan(&remainingReply); err != nil {
		t.Fatal(err)
	}
	if remainingReply != 0 {
		t.Fatalf("deleted Project reply rows=%d, want 0", remainingReply)
	}
	for _, table := range []string{"project_information", "project_projection_table"} {
		var relationName sql.NullString
		if err := db.QueryRow("select to_regclass($1)::text", "public."+table).Scan(&relationName); err != nil {
			t.Fatal(err)
		}
		if relationName.Valid {
			t.Fatalf("retired Project table %s still exists", table)
		}
	}

	if _, err := repo.DeleteEditorJSONDocument(EditorJSONDeleteInput{
		Document: ref, OperationID: "project-final-delete", ClientID: "project-final-client",
		ActorUserID: actor.UserID, BaseRevision: 0,
	}); err != nil {
		t.Fatal(err)
	}
	for table, query := range map[string]string{
		"project_textbox_chats":     "select count(*) from project_textbox_chats where company_id=$1::uuid and project_id=$2::uuid",
		"exact email_relationships": "select count(*) from email_relationships where company_id=$1::uuid and resource_type='project' and resource_id=$2::uuid and resource_textbox_id is not null",
	} {
		var count int
		if err := db.QueryRow(query, company.CompanyID, projectID).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("%s rows after textbox delete=%d, want 0", table, count)
		}
	}
	var remainingWideRelationships int
	if err := db.QueryRow(`select count(*) from email_relationships
where company_id=$1::uuid and resource_type='project' and resource_id=$2::uuid
  and resource_textbox_id is null`, company.CompanyID, projectID).Scan(&remainingWideRelationships); err != nil {
		t.Fatal(err)
	}
	if remainingWideRelationships != 1 {
		t.Fatalf("wide Project email rows after textbox delete=%d, want 1", remainingWideRelationships)
	}
	var activeEmailLinks, activeProjectLinks, activeChatLinks int
	if err := db.QueryRow(`select
  count(*) filter(where resource_type='email_message' and deleted_timestamp is null),
  count(*) filter(where resource_type='project' and deleted_timestamp is null),
  count(*) filter(where resource_type='project_chat_message' and deleted_timestamp is null)
from attachment_relationships
where company_id=$1::uuid and attachment_id=$2::uuid`, company.CompanyID, attachmentID).
		Scan(&activeEmailLinks, &activeProjectLinks, &activeChatLinks); err != nil {
		t.Fatal(err)
	}
	if activeEmailLinks != 1 || activeProjectLinks != 0 || activeChatLinks != 0 {
		t.Fatalf("active links after textbox delete email=%d project=%d chat=%d", activeEmailLinks, activeProjectLinks, activeChatLinks)
	}
	var attachmentActive bool
	if err := db.QueryRow(`select deleted_timestamp is null from attachments
where company_id=$1::uuid and attachment_id=$2::uuid`, company.CompanyID, attachmentID).Scan(&attachmentActive); err != nil {
		t.Fatal(err)
	}
	if !attachmentActive {
		t.Fatal("shared attachment was marked pending while its exact email_message owner survived")
	}
}
