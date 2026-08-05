package store

import (
	"strings"
	"testing"
)

func TestPostgresLogicGateFinalTextboxHistoryEmailAndAttachmentStorage(t *testing.T) {
	db, repo := openRealtimePostgresIntegration(t)
	company, err := repo.CreateCompany("Logic Gate final storage integration")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec("delete from companies where company_id=$1::uuid", company.CompanyID) })
	actor, err := repo.UpsertAuthUser("logic-gate-final-storage", "logic-gate-final-storage@example.test", "Logic Gate Final Storage")
	if err != nil {
		t.Fatal(err)
	}
	gate, err := repo.CreateLogicGate(company.CompanyID, "Final Logic Gate")
	if err != nil {
		t.Fatal(err)
	}
	textboxID := "00000000-0000-4000-8000-000000000401"
	if _, err := repo.UpdateEditorJSONMetadata(EditorJSONMetadataInput{
		Document: EditorDocumentRef{
			CompanyID: company.CompanyID, ResourceType: EntityTypeLogicGate,
			ResourceID: gate.LogicGateID, DocumentID: textboxID,
		},
		Title: "Final Logic Gate Notes",
	}); err != nil {
		t.Fatal(err)
	}
	ref := EditorJSONDocumentRef{
		CompanyID: company.CompanyID, ResourceType: EntityTypeLogicGate,
		ResourceID: gate.LogicGateID, DocumentID: textboxID,
	}
	if _, err := repo.EnsureEditorJSONCollaborationDocument(ref); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateLogicGateEditorSaveVersion(EditorSaveVersionInput{
		CompanyID: company.CompanyID, ResourceID: gate.LogicGateID, ActorUserID: actor.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	versions, err := repo.ListLogicGateEditorSaveVersions(company.CompanyID, gate.LogicGateID)
	if err != nil || len(versions) != 1 || len(versions[0].Items) != 1 || versions[0].Items[0].InformationID != textboxID {
		t.Fatalf("final Logic Gate save versions=%+v err=%v", versions, err)
	}

	emailThreadID := "00000000-0000-4000-8000-000000000402"
	emailMessageID := "00000000-0000-4000-8000-000000000403"
	if _, err := db.Exec(`insert into email_threads(
  company_id,email_thread_id,email_account_type,personal_user_id,personal_account_email,
  email_account_email,provider,provider_thread_key,provider_thread_id,root_provider_message_id
) values($1::uuid,$2::uuid,'personal_email_account',$3::uuid,'logic-gate-final-storage@example.test',
  'logic-gate-final-storage@example.test','google','logic-thread-key','logic-provider-thread','logic-provider-message')`,
		company.CompanyID, emailThreadID, actor.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`insert into email_messages(
  company_id,email_message_id,email_thread_id,provider_message_id,message_order,subject,snippet,sender_snapshot
) values($1::uuid,$2::uuid,$3::uuid,'logic-provider-message',0,'Exact Logic Gate email','Logic Gate snippet',
  '[{"name":"Sender","email":"sender@example.test"}]'::jsonb)`,
		company.CompanyID, emailMessageID, emailThreadID); err != nil {
		t.Fatal(err)
	}
	emailRelationshipID := "00000000-0000-4000-8000-000000000404"
	if _, err := db.Exec(`insert into email_relationships(
  company_id,email_relationship_id,email_thread_id,email_message_id,resource_type,resource_id,resource_textbox_id
) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'logic_gate',$5::uuid,$6)`,
		company.CompanyID, emailRelationshipID, emailThreadID, emailMessageID, gate.LogicGateID, textboxID); err != nil {
		t.Fatal(err)
	}
	attachmentID := "00000000-0000-4000-8000-000000000405"
	if _, err := db.Exec(`insert into attachments(
  attachment_id,company_id,uploaded_by_user_id,original_filename,mime_type,byte_size,sha256,
  storage_bucket,storage_key,source_kind
) values($1::uuid,$2::uuid,$3::uuid,'logic-gate-file.txt','text/plain',5,
  '0000000000000000000000000000000000000000000000000000000000000000',
  'disposable-test-bucket','logic-gate-final-storage/file.txt','editor_paste')`,
		attachmentID, company.CompanyID, actor.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`insert into attachment_relationships(
  attachment_relationship_id,company_id,resource_type,resource_id,attachment_id,information_id,
  message_id,editor_surface,relationship_kind,created_by_user_id
) values($1::uuid,$2::uuid,'logic_gate',$3,$4::uuid,$5::uuid,
  '','logic_gate_editor','file_attachment',$6::uuid)`,
		"00000000-0000-4000-8000-000000000406", company.CompanyID, gate.LogicGateID,
		attachmentID, textboxID, actor.UserID); err != nil {
		t.Fatal(err)
	}

	projections, err := repo.ListLogicGateProjections(company.CompanyID, gate.LogicGateID)
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	for _, projection := range projections {
		found[projection.InformationID] = true
		if projection.InformationID == textboxID &&
			(!strings.Contains(projection.Information, "Final Logic Gate Notes") ||
				!strings.Contains(projection.Information, attachmentID)) {
			t.Fatalf("Logic Gate textbox projection lost final metadata: %s", projection.Information)
		}
		if projection.InformationID == emailRelationshipID && !strings.Contains(projection.Information, emailMessageID) {
			t.Fatalf("Logic Gate email projection lost exact message identity: %s", projection.Information)
		}
	}
	for _, id := range []string{textboxID, emailRelationshipID} {
		if !found[id] {
			t.Fatalf("final Logic Gate projection %s missing: %+v", id, projections)
		}
	}
	if err := repo.DeleteLogicGateProjection(LogicGateProjectionDeleteInput{
		CompanyID: company.CompanyID, LogicGateID: gate.LogicGateID, InformationID: emailRelationshipID,
	}); err != nil {
		t.Fatal(err)
	}
	var remainingEmailRelationships int
	if err := db.QueryRow(`select count(*) from email_relationships
where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`,
		company.CompanyID, gate.LogicGateID).Scan(&remainingEmailRelationships); err != nil {
		t.Fatal(err)
	}
	if remainingEmailRelationships != 0 {
		t.Fatalf("remaining Logic Gate email relationships=%d, want 0", remainingEmailRelationships)
	}
}
