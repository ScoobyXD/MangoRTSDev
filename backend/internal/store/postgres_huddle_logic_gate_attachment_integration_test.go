package store

import (
	"errors"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestPostgresProcessMapHuddleLogicGateAttachmentValidationAndRecycleLifecycle(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	actor, err := repo.UpsertAuthUser(
		"postgres-huddle-attachment-owner",
		"postgres-huddle-attachment-owner@example.test",
		"Postgres Huddle Attachment Owner",
	)
	if err != nil {
		t.Fatal(err)
	}
	company, err := repo.CreateCompany("Postgres Huddle attachment lifecycle")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(actor.CognitoSubject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	huddle, err := repo.CreateHuddleLogicGate(HuddleCreateInput{
		CompanyID: company.CompanyID,
		Name:      "Weekly attachment review",
		ActorID:   actor.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}

	attachmentID := NewUUIDv7String()
	attachment, link, err := repo.CreateAttachmentWithResourceLink(AttachmentCreateInput{
		CompanyID:        company.CompanyID,
		AttachmentID:     attachmentID,
		UploadedByUserID: actor.UserID,
		OriginalFilename: "weekly-agenda.png",
		MimeType:         "image/png",
		ByteSize:         1,
		SHA256:           strings.Repeat("a", 64),
		StorageBucket:    "disposable-test-bucket",
		StorageKey:       "huddle-logic-gate/weekly-agenda.png",
		SourceKind:       AttachmentSourceEditorPaste,
		ResourceLink: ResourceAttachmentInput{
			ResourceAttachmentID: NewUUIDv7String(),
			CompanyID:            company.CompanyID,
			ResourceType:         EntityTypeHuddleLogicGate,
			ResourceID:           huddle.HuddleLogicGateID,
			RelationshipKind:     AttachmentRelationshipInlineImage,
			EditorSurface:        "huddle_logic_gate_editor",
			CreatedByUserID:      actor.UserID,
		},
	})
	if err != nil {
		t.Fatalf("create canonical Huddle Logic Gate attachment: %v", err)
	}
	if attachment.AttachmentID != attachmentID || link.ResourceType != EntityTypeHuddleLogicGate || link.ResourceID != huddle.HuddleLogicGateID {
		t.Fatalf("canonical Huddle attachment/link=%+v/%+v", attachment, link)
	}

	missingHuddleID := NewUUIDv7String()
	_, err = db.Exec(`
insert into attachment_relationships(
  attachment_relationship_id,company_id,resource_type,resource_id,attachment_id,
  editor_surface,relationship_kind,created_by_user_id
) values($1::uuid,$2::uuid,'huddle_logic_gate',$3,$4::uuid,'huddle_logic_gate_editor','inline_image',$5::uuid)`,
		NewUUIDv7String(), company.CompanyID, missingHuddleID, attachmentID, actor.UserID)
	var postgresError *pgconn.PgError
	if !errors.As(err, &postgresError) || postgresError.Code != "23503" || !strings.Contains(postgresError.Message, "Huddle Logic Gate owner does not exist") {
		t.Fatalf("missing exact Huddle owner error=%v", err)
	}

	if err := repo.DeleteHuddleLogicGate(company.CompanyID, huddle.HuddleLogicGateID, actor.UserID); err != nil {
		t.Fatal(err)
	}
	var deletedHuddle, retiredLink, pendingAttachment int
	if err := db.QueryRow(`
select
  (select count(*) from huddle_logic_gates where company_id=$1::uuid and huddle_logic_gate_id=$2::uuid),
  (select count(*) from attachment_relationships where company_id=$1::uuid and attachment_relationship_id=$3::uuid and deleted_timestamp is not null),
  (select count(*) from attachments where company_id=$1::uuid and attachment_id=$4::uuid and deleted_timestamp is not null)`,
		company.CompanyID, huddle.HuddleLogicGateID, link.ResourceAttachmentID, attachmentID,
	).Scan(&deletedHuddle, &retiredLink, &pendingAttachment); err != nil {
		t.Fatal(err)
	}
	if deletedHuddle != 0 || retiredLink != 1 || pendingAttachment != 1 {
		t.Fatalf("recycled Huddle/link/attachment=%d/%d/%d, want 0/1/1", deletedHuddle, retiredLink, pendingAttachment)
	}
	recycleItems, err := repo.ListRecycleBinItems(company.CompanyID, actor.UserID)
	if err != nil || len(recycleItems) != 1 || recycleItems[0].ObjectKind != EntityTypeHuddleLogicGate {
		t.Fatalf("Huddle recycle items=%+v err=%v", recycleItems, err)
	}
	if _, err := repo.RestoreRecycleBinItems(company.CompanyID, actor.UserID, []string{recycleItems[0].RecycleBinItemID}); err != nil {
		t.Fatal(err)
	}

	links, err := repo.ListResourceAttachments(company.CompanyID, EntityTypeHuddleLogicGate, huddle.HuddleLogicGateID)
	if err != nil {
		t.Fatal(err)
	}
	if len(links) != 1 || links[0].ResourceAttachmentID != link.ResourceAttachmentID || links[0].AttachmentID != attachmentID {
		t.Fatalf("restored exact Huddle attachment link=%+v", links)
	}
	var restoredHuddle, restoredLink, restoredAttachment int
	if err := db.QueryRow(`
select
  (select count(*) from huddle_logic_gates where company_id=$1::uuid and huddle_logic_gate_id=$2::uuid),
  (select count(*) from attachment_relationships where company_id=$1::uuid and attachment_relationship_id=$3::uuid and deleted_timestamp is null),
  (select count(*) from attachments where company_id=$1::uuid and attachment_id=$4::uuid and deleted_timestamp is null)`,
		company.CompanyID, huddle.HuddleLogicGateID, link.ResourceAttachmentID, attachmentID,
	).Scan(&restoredHuddle, &restoredLink, &restoredAttachment); err != nil {
		t.Fatal(err)
	}
	if restoredHuddle != 1 || restoredLink != 1 || restoredAttachment != 1 {
		t.Fatalf("restored Huddle/link/attachment=%d/%d/%d, want 1/1/1", restoredHuddle, restoredLink, restoredAttachment)
	}

	if err := repo.DeleteHuddleLogicGate(company.CompanyID, huddle.HuddleLogicGateID, actor.UserID); err != nil {
		t.Fatal(err)
	}
	recycleItems, err = repo.ListRecycleBinItems(company.CompanyID, actor.UserID)
	if err != nil || len(recycleItems) != 1 || recycleItems[0].ObjectKind != EntityTypeHuddleLogicGate || recycleItems[0].ObjectID != huddle.HuddleLogicGateID {
		t.Fatalf("restored Huddle second recycle items=%+v err=%v", recycleItems, err)
	}
	if err := repo.PermanentlyDeleteRecycleBinItems(company.CompanyID, actor.UserID, []string{recycleItems[0].RecycleBinItemID}); err != nil {
		t.Fatal(err)
	}

	var permanentlyDeletedHuddle, liveLink, recyclePayload int
	if err := db.QueryRow(`
select
  (select count(*) from huddle_logic_gates where company_id=$1::uuid and huddle_logic_gate_id=$2::uuid),
  (select count(*) from attachment_relationships where company_id=$1::uuid and attachment_relationship_id=$3::uuid and deleted_timestamp is null),
  (select count(*) from recycle_bin_items where company_id=$1::uuid and object_kind='huddle_logic_gate' and object_id=$2)`,
		company.CompanyID, huddle.HuddleLogicGateID, link.ResourceAttachmentID,
	).Scan(&permanentlyDeletedHuddle, &liveLink, &recyclePayload); err != nil {
		t.Fatal(err)
	}
	if permanentlyDeletedHuddle != 0 || liveLink != 0 || recyclePayload != 0 {
		t.Fatalf("permanently deleted Huddle/live link/recycle payload=%d/%d/%d, want 0/0/0", permanentlyDeletedHuddle, liveLink, recyclePayload)
	}
}
