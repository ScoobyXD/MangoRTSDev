package store

import (
	"encoding/json"
	"errors"
	"miraeopus/backend/internal/domain"
	"testing"
	"time"
)

const (
	memoryProjectEmailCompanyID = "11111111-1111-4111-8111-111111111801"
	memoryProjectEmailActorID   = "22222222-2222-4222-8222-222222222801"
	memoryProjectEmailThreadID  = "33333333-3333-4333-8333-333333333801"
	memoryProjectEmailMessageA  = "44444444-4444-4444-8444-444444444801"
	memoryProjectEmailMessageB  = "44444444-4444-4444-8444-444444444802"
	memoryProjectEmailProjectA  = "55555555-5555-4555-8555-555555555801"
	memoryProjectEmailProjectB  = "55555555-5555-4555-8555-555555555802"
	memoryProjectEmailTextboxA  = "66666666-6666-4666-8666-666666666801"
	memoryProjectEmailTextboxB  = "66666666-6666-4666-8666-666666666802"
)

func setupMemoryProjectEmailRelationships(t *testing.T) *MemoryRepo {
	t.Helper()
	repo := NewMemoryRepo()
	repo.EnsureCompany(memoryProjectEmailCompanyID, "Project email relationships")
	if err := repo.SetEditorDataFormatForTests(EditorDataFormatGate{
		CompanyID: memoryProjectEmailCompanyID, EditorFormat: EditorFormatTiptapJSON,
		MigrationState: EditorMigrationReady, DocumentSchemaVersion: MangoTiptapSchemaVersion,
	}); err != nil {
		t.Fatal(err)
	}
	for _, projectID := range []string{memoryProjectEmailProjectA, memoryProjectEmailProjectB} {
		if _, err := repo.CreateProject(ProjectInput{
			CompanyID: memoryProjectEmailCompanyID, ProjectID: projectID,
			Name: "Email Project", Status: ProjectDefaultStatus, ActorUserID: memoryProjectEmailActorID,
		}); err != nil {
			t.Fatalf("CreateProject(%s): %v", projectID, err)
		}
		now := time.Now().UTC()
		repo.projectText[key(memoryProjectEmailCompanyID, projectID)] = map[string]domain.ProjectProjection{
			memoryProjectEmailTextboxA: {
				CompanyID: memoryProjectEmailCompanyID, ProjectID: projectID, InformationID: memoryProjectEmailTextboxA,
				Type: "Text box", Information: editorTextBlockProjectionPrefix + `{"title":"First","document":"","attachments":[],"color":""}`,
				CreatedTimestamp: now, UpdatedTimestamp: now,
			},
			memoryProjectEmailTextboxB: {
				CompanyID: memoryProjectEmailCompanyID, ProjectID: projectID, InformationID: memoryProjectEmailTextboxB,
				Type: "Text box", Information: editorTextBlockProjectionPrefix + `{"title":"Second","document":"","attachments":[],"color":""}`,
				CreatedTimestamp: now.Add(time.Millisecond), UpdatedTimestamp: now.Add(time.Millisecond),
			},
		}
	}
	repo.emailThreads[key(memoryProjectEmailCompanyID, memoryProjectEmailThreadID)] = domain.CommunicationsEmailThread{
		CompanyID: memoryProjectEmailCompanyID, EmailThreadID: memoryProjectEmailThreadID,
		ProviderThreadID: "provider-thread", AccountEmail: "project@example.com",
		Messages: []domain.CommunicationsEmailMessage{
			{
				CompanyID: memoryProjectEmailCompanyID, EmailThreadID: memoryProjectEmailThreadID,
				EmailMessageID: memoryProjectEmailMessageA, ProviderMessageID: "77777777-7777-4777-8777-777777777801",
				Message: domain.EmailMessageSnapshot{ID: "77777777-7777-4777-8777-777777777801", ThreadID: "provider-thread", Subject: "First", Date: 10, DownloadComplete: true},
			},
			{
				CompanyID: memoryProjectEmailCompanyID, EmailThreadID: memoryProjectEmailThreadID,
				EmailMessageID: memoryProjectEmailMessageB, ProviderMessageID: "77777777-7777-4777-8777-777777777802",
				Message: domain.EmailMessageSnapshot{ID: "77777777-7777-4777-8777-777777777802", ThreadID: "provider-thread", Subject: "Second", Date: 20, DownloadComplete: true},
			},
		},
	}
	return repo
}

func addMemoryProjectEmailRelationshipForTest(
	t *testing.T,
	repo *MemoryRepo,
	projectID, relationshipID, messageID, textboxID, color, linkScope string,
) domain.ProjectInformation {
	t.Helper()
	payload, err := json.Marshal(emailTextboxRelationshipPayload{
		BlockID: textboxID, EmailMessageID: messageID, TextboxColor: color, LinkScope: linkScope,
	})
	if err != nil {
		t.Fatal(err)
	}
	item, err := repo.AddProjectInformation(ProjectInformationInput{
		CompanyID: memoryProjectEmailCompanyID, ProjectID: projectID, InformationID: relationshipID,
		Type: "Attached email", Information: string(payload), ActorUserID: memoryProjectEmailActorID,
	})
	if err != nil {
		t.Fatalf("AddProjectInformation attached email: %v", err)
	}
	return item
}

func memoryProjectTextboxPayloadForTest(t *testing.T, projections []domain.ProjectProjection, textboxID string) map[string]any {
	t.Helper()
	for _, projection := range projections {
		if projection.InformationID != textboxID || !isEditorTextBoxType(projection.Type) {
			continue
		}
		_, payload, err := parseMemoryProjectTextboxInformation(projection.Information)
		if err != nil {
			t.Fatal(err)
		}
		return payload
	}
	t.Fatalf("textbox %s not found in %+v", textboxID, projections)
	return nil
}

func TestMemoryProjectEmailTextboxRelationshipsUseTypedOwnerLocalCardinality(t *testing.T) {
	repo := setupMemoryProjectEmailRelationships(t)
	wideA := addMemoryProjectEmailRelationshipForTest(t, repo, memoryProjectEmailProjectA,
		"88888888-8888-4888-8888-888888888801", memoryProjectEmailMessageA, "", "", "thread")
	addMemoryProjectEmailRelationshipForTest(t, repo, memoryProjectEmailProjectB,
		"88888888-8888-4888-8888-888888888802", memoryProjectEmailMessageA, "", "", "thread")

	exactA := addMemoryProjectEmailRelationshipForTest(t, repo, memoryProjectEmailProjectA,
		"99999999-9999-4999-8999-999999999801", memoryProjectEmailMessageA, memoryProjectEmailTextboxA, "#0EA5E9", "message")
	idempotent := addMemoryProjectEmailRelationshipForTest(t, repo, memoryProjectEmailProjectA,
		"99999999-9999-4999-8999-999999999802", memoryProjectEmailMessageA, memoryProjectEmailTextboxA, "#8B5CF6", "message")
	if idempotent.InformationID != exactA.InformationID {
		t.Fatalf("same owner/message/textbox created another relationship: first=%s second=%s", exactA.InformationID, idempotent.InformationID)
	}

	conflictPayload, _ := json.Marshal(emailTextboxRelationshipPayload{
		BlockID: memoryProjectEmailTextboxB, EmailMessageID: memoryProjectEmailMessageA,
		TextboxColor: "#8B5CF6", LinkScope: "message",
	})
	if _, err := repo.AddProjectInformation(ProjectInformationInput{
		CompanyID: memoryProjectEmailCompanyID, ProjectID: memoryProjectEmailProjectA,
		InformationID: "99999999-9999-4999-8999-999999999803", Type: "Attached email",
		Information: string(conflictPayload), ActorUserID: memoryProjectEmailActorID,
	}); !errors.Is(err, ErrEmailMessageTextboxConflict) {
		t.Fatalf("same Project/message second textbox error = %v, want conflict", err)
	}

	addMemoryProjectEmailRelationshipForTest(t, repo, memoryProjectEmailProjectA,
		"99999999-9999-4999-8999-999999999804", memoryProjectEmailMessageB, memoryProjectEmailTextboxA, "#8B5CF6", "message")
	addMemoryProjectEmailRelationshipForTest(t, repo, memoryProjectEmailProjectB,
		"99999999-9999-4999-8999-999999999805", memoryProjectEmailMessageA, memoryProjectEmailTextboxB, "#14B8A6", "message")
	if _, err := repo.UpdateEditorJSONMetadata(EditorJSONMetadataInput{
		Document: EditorDocumentRef{CompanyID: memoryProjectEmailCompanyID, ResourceType: EntityTypeProject,
			ResourceID: memoryProjectEmailProjectA, DocumentID: memoryProjectEmailTextboxA},
		Title: "Saved after email links",
	}); err != nil {
		t.Fatalf("save linked Project textbox metadata: %v", err)
	}
	if _, err := repo.UpdateEditorJSONMetadata(EditorJSONMetadataInput{
		Document: EditorDocumentRef{CompanyID: memoryProjectEmailCompanyID, ResourceType: EntityTypeProject,
			ResourceID: memoryProjectEmailProjectA, DocumentID: memoryProjectEmailTextboxA},
		Title: "Client color is forbidden", Color: "#8B5CF6",
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("Project client-owned color error = %v, want invalid", err)
	}

	projections, err := repo.ListProjectProjections(memoryProjectEmailCompanyID, memoryProjectEmailProjectA)
	if err != nil {
		t.Fatal(err)
	}
	payload := memoryProjectTextboxPayloadForTest(t, projections, memoryProjectEmailTextboxA)
	if payload["color"] != "#0EA5E9" {
		t.Fatalf("textbox color = %v, want stable first color", payload["color"])
	}
	messageIDs, ok := payload["email_message_ids"].([]any)
	if !ok || len(messageIDs) != 2 || messageIDs[0] != memoryProjectEmailMessageA || messageIDs[1] != memoryProjectEmailMessageB {
		t.Fatalf("derived email_message_ids = %#v", payload["email_message_ids"])
	}
	_, storedPayload, err := parseMemoryProjectTextboxInformation(repo.projectText[key(memoryProjectEmailCompanyID, memoryProjectEmailProjectA)][memoryProjectEmailTextboxA].Information)
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := storedPayload["email_message_ids"]; exists {
		t.Fatalf("stored textbox became relationship authority: %+v", storedPayload)
	}
	if len(repo.projectEmailRelationships) != 7 {
		t.Fatalf("typed Project relationship rows = %d, want 7 (four wide plus three exact)", len(repo.projectEmailRelationships))
	}
	if wideA.InformationID == "" {
		t.Fatal("wide relationship ID is blank")
	}
}

func TestMemoryProjectEmailFirstChatIsAtomicAndGuardsRemoval(t *testing.T) {
	repo := setupMemoryProjectEmailRelationships(t)
	delete(repo.projectText[key(memoryProjectEmailCompanyID, memoryProjectEmailProjectA)], memoryProjectEmailTextboxB)
	wide := addMemoryProjectEmailRelationshipForTest(t, repo, memoryProjectEmailProjectA,
		"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa801", memoryProjectEmailMessageA, "", "", "message")
	beforeRelationships := len(repo.projectEmailRelationships)

	invalidChat := `{"block_id":"66666666-6666-4666-8666-666666666802","ensure_email_textbox_link_on_send":true,"email_textbox_color_on_send":"#0EA5E9","selection_source":"email","selection_block_id":"66666666-6666-4666-8666-666666666802","selection_message_id":"44444444-4444-4444-8444-444444444801","selection_quote":"Quote","author_id":"22222222-2222-4222-8222-222222222801","message":"First chat","mentioned_user_ids":["not-a-uuid"]}`
	if _, err := repo.AddProjectInformation(ProjectInformationInput{
		CompanyID: memoryProjectEmailCompanyID, ProjectID: memoryProjectEmailProjectA,
		InformationID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb801", Type: CommunicationsEmailCollaborationChatInformationType,
		Information: invalidChat, ActorUserID: memoryProjectEmailActorID,
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid first chat error = %v, want invalid", err)
	}
	if _, exists := repo.projectText[key(memoryProjectEmailCompanyID, memoryProjectEmailProjectA)][memoryProjectEmailTextboxB]; exists || len(repo.projectEmailRelationships) != beforeRelationships {
		t.Fatalf("failed first chat left partial state: textbox=%v relationships=%d", exists, len(repo.projectEmailRelationships))
	}

	chatID := "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb802"
	validChat := `{"block_id":"66666666-6666-4666-8666-666666666802","ensure_email_textbox_link_on_send":true,"email_textbox_color_on_send":"#0EA5E9","selection_source":"email","selection_block_id":"66666666-6666-4666-8666-666666666802","selection_message_id":"44444444-4444-4444-8444-444444444801","selection_quote":"Quote","author_id":"22222222-2222-4222-8222-222222222801","message":"First chat"}`
	if _, err := repo.AddProjectInformation(ProjectInformationInput{
		CompanyID: memoryProjectEmailCompanyID, ProjectID: memoryProjectEmailProjectA,
		InformationID: chatID, Type: CommunicationsEmailCollaborationChatInformationType,
		Information: validChat, ActorUserID: memoryProjectEmailActorID,
	}); err != nil {
		t.Fatalf("valid first chat: %v", err)
	}
	exact, exists := repo.memoryProjectEmailRelationshipLocked(memoryProjectEmailCompanyID, memoryProjectEmailProjectA, memoryProjectEmailMessageA, memoryProjectEmailTextboxB)
	if !exists {
		t.Fatal("first send did not create exact message relationship")
	}
	if _, exists := repo.projectText[key(memoryProjectEmailCompanyID, memoryProjectEmailProjectA)][chatID]; !exists {
		t.Fatal("first send did not create chat")
	}
	if err := repo.DeleteProjectProjection(ProjectProjectionDeleteInput{
		CompanyID: memoryProjectEmailCompanyID, ProjectID: memoryProjectEmailProjectA, InformationID: exact.RelationshipID,
	}); !errors.Is(err, ErrEmailRelationshipRequiredByChat) {
		t.Fatalf("anchored exact removal error = %v, want chat guard", err)
	}
	if err := repo.DeleteProjectProjection(ProjectProjectionDeleteInput{
		CompanyID: memoryProjectEmailCompanyID, ProjectID: memoryProjectEmailProjectA, InformationID: wide.InformationID,
	}); !errors.Is(err, ErrEmailRelationshipHasProjectWork) {
		t.Fatalf("wide removal error = %v, want Project-work guard", err)
	}
	if err := repo.DeleteProjectProjection(ProjectProjectionDeleteInput{
		CompanyID: memoryProjectEmailCompanyID, ProjectID: memoryProjectEmailProjectA, InformationID: chatID,
	}); err != nil {
		t.Fatal(err)
	}
	if err := repo.DeleteProjectProjection(ProjectProjectionDeleteInput{
		CompanyID: memoryProjectEmailCompanyID, ProjectID: memoryProjectEmailProjectA, InformationID: exact.RelationshipID,
	}); err != nil {
		t.Fatal(err)
	}
	color, err := repo.memoryProjectTextboxColorLocked(memoryProjectEmailCompanyID, memoryProjectEmailProjectA, memoryProjectEmailTextboxB)
	if err != nil || color != "" {
		t.Fatalf("last exact removal color=%q err=%v, want neutral", color, err)
	}
	if err := repo.DeleteProjectProjection(ProjectProjectionDeleteInput{
		CompanyID: memoryProjectEmailCompanyID, ProjectID: memoryProjectEmailProjectA, InformationID: wide.InformationID,
	}); err != nil {
		t.Fatalf("work-free wide removal: %v", err)
	}
}

func TestMemoryProjectEmailRejectsProviderIdentityAndPermanentDocumentDestination(t *testing.T) {
	repo := setupMemoryProjectEmailRelationships(t)
	addMemoryProjectEmailRelationshipForTest(t, repo, memoryProjectEmailProjectA,
		"cccccccc-cccc-4ccc-8ccc-ccccccccc801", memoryProjectEmailMessageA, "", "", "message")
	addMemoryProjectEmailRelationshipForTest(t, repo, memoryProjectEmailProjectA,
		"cccccccc-cccc-4ccc-8ccc-ccccccccc802", memoryProjectEmailMessageB, memoryProjectEmailTextboxA, "#0EA5E9", "message")

	for name, testCase := range map[string]struct {
		projectID string
		messageID string
		textboxID string
		want      error
	}{
		"provider message ID":               {projectID: memoryProjectEmailProjectA, messageID: "77777777-7777-4777-8777-777777777801", textboxID: memoryProjectEmailTextboxA, want: ErrEmailMessageNotAttachedToProject},
		"missing Project-wide relationship": {projectID: memoryProjectEmailProjectB, messageID: memoryProjectEmailMessageA, textboxID: memoryProjectEmailTextboxA, want: ErrEmailMessageNotAttachedToProject},
		"permanent document":                {projectID: memoryProjectEmailProjectA, messageID: memoryProjectEmailMessageA, textboxID: memoryProjectEmailProjectA, want: ErrInvalid},
	} {
		t.Run(name, func(t *testing.T) {
			payload, _ := json.Marshal(emailTextboxRelationshipPayload{
				BlockID: testCase.textboxID, EmailMessageID: testCase.messageID, TextboxColor: "#0EA5E9", LinkScope: "message",
			})
			_, err := repo.AddProjectInformation(ProjectInformationInput{
				CompanyID: memoryProjectEmailCompanyID, ProjectID: testCase.projectID,
				InformationID: newUUIDv7String(), Type: "Attached email", Information: string(payload), ActorUserID: memoryProjectEmailActorID,
			})
			if !errors.Is(err, testCase.want) {
				t.Fatalf("error = %v, want %v", err, testCase.want)
			}
		})
	}
	providerWidePayload, _ := json.Marshal(emailTextboxRelationshipPayload{
		EmailMessageID: "77777777-7777-4777-8777-777777777801", LinkScope: "message",
	})
	if _, err := repo.AddProjectInformation(ProjectInformationInput{
		CompanyID: memoryProjectEmailCompanyID, ProjectID: memoryProjectEmailProjectA,
		InformationID: newUUIDv7String(), Type: "Attached email",
		Information: string(providerWidePayload), ActorUserID: memoryProjectEmailActorID,
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("provider ID wide attach error = %v, want invalid", err)
	}
	permanentDocumentChat := `{"block_id":"55555555-5555-4555-8555-555555555801","ensure_email_textbox_link_on_send":true,"email_textbox_color_on_send":"#0EA5E9","selection_source":"email","selection_block_id":"55555555-5555-4555-8555-555555555801","selection_message_id":"44444444-4444-4444-8444-444444444801","selection_quote":"Quote","author_id":"22222222-2222-4222-8222-222222222801","message":"Invalid permanent document chat"}`
	if _, err := repo.AddProjectInformation(ProjectInformationInput{
		CompanyID: memoryProjectEmailCompanyID, ProjectID: memoryProjectEmailProjectA,
		InformationID: "dddddddd-dddd-4ddd-8ddd-ddddddddd801", Type: CommunicationsEmailCollaborationChatInformationType,
		Information: permanentDocumentChat, ActorUserID: memoryProjectEmailActorID,
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("permanent document chat error = %v, want invalid", err)
	}
}

func TestMemoryCompletedEmailMessageInheritsOnlyProjectWideDestination(t *testing.T) {
	const companyID = "11111111-1111-4111-8111-111111111811"
	const projectID = "55555555-5555-4555-8555-555555555811"
	repo := NewMemoryRepo()
	repo.EnsureCompany(companyID, "Project email inheritance")
	user, _ := setupEmailConversionUserAndGate(t, repo, companyID)
	if _, err := repo.CreateProject(ProjectInput{CompanyID: companyID, ProjectID: projectID, Name: "Inherited email", ActorUserID: user.UserID}); err != nil {
		t.Fatal(err)
	}
	firstSnapshot := domain.EmailMessageSnapshot{
		ID: "provider-first", ThreadID: "provider-inherited-thread", Subject: "First", Date: 1, DownloadComplete: true,
	}
	thread, err := repo.UpsertCommunicationsEmailThread(CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, PersonalUserID: user.UserID, PersonalAccountEmail: user.Email,
		Provider: "google", ProviderThreadID: firstSnapshot.ThreadID, SelectedMessageID: firstSnapshot.ID,
		Messages: []domain.EmailMessageSnapshot{firstSnapshot}, FetchedAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	firstMessageID := thread.Messages[0].EmailMessageID
	payload, _ := json.Marshal(emailTextboxRelationshipPayload{EmailMessageID: firstMessageID, LinkScope: "message"})
	if _, err := repo.AddProjectInformation(ProjectInformationInput{
		CompanyID: companyID, ProjectID: projectID, InformationID: "88888888-8888-4888-8888-888888888811",
		Type: "Attached email", Information: string(payload), ActorUserID: user.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	secondSnapshot := domain.EmailMessageSnapshot{
		ID: "provider-second", ThreadID: firstSnapshot.ThreadID, Subject: "Second", Date: 2, DownloadComplete: true,
	}
	thread, err = repo.UpsertCommunicationsEmailThread(CommunicationsEmailThreadUpsertInput{
		CompanyID: companyID, PersonalUserID: user.UserID, PersonalAccountEmail: user.Email,
		Provider: "google", ProviderThreadID: firstSnapshot.ThreadID, SelectedMessageID: firstSnapshot.ID,
		Messages: []domain.EmailMessageSnapshot{firstSnapshot, secondSnapshot}, FetchedAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	var secondMessageID string
	for _, message := range thread.Messages {
		if message.ProviderMessageID == secondSnapshot.ID {
			secondMessageID = message.EmailMessageID
		}
	}
	if secondMessageID == "" {
		t.Fatal("second internal message ID is blank")
	}
	wide, wideExists := repo.memoryProjectEmailRelationshipLocked(companyID, projectID, secondMessageID, "")
	if !wideExists || wide.EmailThreadID != thread.EmailThreadID {
		t.Fatalf("new completed message wide relationship = %+v exists=%v", wide, wideExists)
	}
	for _, relationship := range repo.projectEmailRelationships {
		if relationship.CompanyID == companyID && relationship.ProjectID == projectID && relationship.EmailMessageID == secondMessageID &&
			relationship.ResourceTextboxID != "" {
			t.Fatalf("new message inherited textbox relationship: %+v", relationship)
		}
	}
}
