package store

import (
	"context"
	"encoding/json"
	"errors"
	"maps"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
)

func TestMemoryEmailConversionAtomicallyPersistsEmailThreadTextBoxAndInitialChat(t *testing.T) {
	repo, companyID, user, node, message := setupAtomicEmailConversion(t, "11111111-1111-4111-8111-111111111192")
	textBlockID := "44444444-4444-4444-8444-444444444492"
	chatID := "55555555-5555-4555-8555-555555555592"

	result, err := repo.ConvertCommunicationsTriageItems(context.Background(), CommunicationsTriageConversionInput{
		UserID: user.UserID, CompanyID: companyID, AccountEmail: user.Email,
		ActorUserID: user.UserID, PermissionUserID: user.UserID,
		Target:     CommunicationsTriageConversionTarget{Mode: CommunicationsEmailConversionTargetExistingNode, NodeID: node.NodeID},
		MessageIDs: []string{message.ID},
		LinkedTextBlock: &NodeInformationInput{
			InformationID: textBlockID, Type: "Text box",
			Information: editorTextBlockProjectionPrefix + `{"title":"Imported email","document":"","attachments":[],"color":"#0EA5E9"}`,
			ActorUserID: user.UserID,
		},
		InitialChat: &NodeInformationInput{
			InformationID: chatID, Type: CommunicationsEmailCollaborationChatInformationType,
			Information: `{"block_id":"44444444-4444-4444-8444-444444444492","selection_source":"email","selection_message_id":"","message":"Imported email for review"}`,
			ActorUserID: user.UserID,
		},
	})
	if err != nil {
		t.Fatalf("ConvertCommunicationsTriageItems atomic import: %v", err)
	}
	if result.LinkedTextBlockID != textBlockID || result.InitialChatID != chatID ||
		len(result.AttachedEmailInformationIDs) != 1 || len(result.EmailThreadIDs) != 1 || len(result.EmailMessageIDs) != 1 {
		t.Fatalf("atomic identifiers = %+v", result)
	}
	projections, err := repo.ListNodeProjections(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("ListNodeProjections: %v", err)
	}
	types := map[string]bool{}
	for _, projection := range projections {
		types[projection.Type] = true
	}
	for _, required := range []string{"Attached email", "Text box", CommunicationsEmailCollaborationChatInformationType} {
		if !types[required] {
			t.Fatalf("node projections missing %q: %+v", required, projections)
		}
	}
	for _, projection := range projections {
		if projection.Type != "Text box" && projection.Type != CommunicationsEmailCollaborationChatInformationType {
			continue
		}
		information := strings.TrimPrefix(projection.Information, editorTextBlockProjectionPrefix)
		var payload map[string]any
		if err := json.Unmarshal([]byte(information), &payload); err != nil {
			t.Fatalf("parse %s projection: %v", projection.Type, err)
		}
		if projection.Type == "Text box" {
			if _, exists := payload["email_message_id"]; exists {
				t.Fatalf("conversion textbox retained singular email authority: %+v", payload)
			}
			messageIDs, ok := payload["email_message_ids"].([]any)
			if !ok || len(messageIDs) != 1 || messageIDs[0] != result.EmailMessageIDs[0] {
				t.Fatalf("derived conversion textbox membership: %+v", payload)
			}
		} else if payload["selection_message_id"] != result.EmailMessageIDs[0] {
			t.Fatalf("chat selection_message_id = %v, want %s", payload["selection_message_id"], result.EmailMessageIDs[0])
		}
	}
	storedTextboxInformation := strings.TrimPrefix(repo.nodeText[key(companyID, node.NodeID)][textBlockID].Information, editorTextBlockProjectionPrefix)
	var storedTextboxPayload map[string]any
	if err := json.Unmarshal([]byte(storedTextboxInformation), &storedTextboxPayload); err != nil {
		t.Fatal(err)
	}
	if _, exists := storedTextboxPayload["email_message_id"]; exists {
		t.Fatalf("stored conversion textbox retained singular relationship authority: %+v", storedTextboxPayload)
	}
	if _, exists := storedTextboxPayload["email_message_ids"]; exists {
		t.Fatalf("stored conversion textbox retained relationship list authority: %+v", storedTextboxPayload)
	}

	stored, err := repo.GetCommunicationsNodeEmailThread(companyID, node.NodeID, result.EmailThreadIDs[0])
	if err != nil {
		t.Fatalf("GetCommunicationsNodeEmailThread: %v", err)
	}
	if stored.SelectedMessageID != stored.Thread.Messages[0].EmailMessageID || len(stored.Thread.Messages) != 1 ||
		stored.Thread.Messages[0].Message.Body != message.Body {
		t.Fatalf("stored imported thread = %+v", stored)
	}
	if len(communicationsTriageItemsForTest(repo, user.UserID)) != 0 {
		t.Fatal("successful atomic import left the source triage item behind")
	}
}

func TestMemoryEmailConversionAppendsChatToExistingEmailTextBox(t *testing.T) {
	repo, companyID, user, node, message := setupAtomicEmailConversion(t, "11111111-1111-4111-8111-111111111194")
	textBlockID := "44444444-4444-4444-8444-444444444494"
	chatID := "55555555-5555-4555-8555-555555555594"

	first, err := repo.ConvertCommunicationsTriageItems(context.Background(), CommunicationsTriageConversionInput{
		UserID: user.UserID, CompanyID: companyID, AccountEmail: user.Email,
		ActorUserID: user.UserID, PermissionUserID: user.UserID,
		Target:     CommunicationsTriageConversionTarget{Mode: CommunicationsEmailConversionTargetExistingNode, NodeID: node.NodeID},
		MessageIDs: []string{message.ID},
		LinkedTextBlock: &NodeInformationInput{
			InformationID: textBlockID, Type: "Text box",
			Information: editorTextBlockProjectionPrefix + `{"title":"Imported email","document":"","attachments":[]}`,
			ActorUserID: user.UserID,
		},
	})
	if err != nil {
		t.Fatalf("ConvertCommunicationsTriageItems initial link: %v", err)
	}
	if first.LinkedTextBlockID != textBlockID || len(first.EmailMessageIDs) != 1 {
		t.Fatalf("initial link result = %+v", first)
	}
	if _, err := repo.UpsertCommunicationsTriageItem(user.UserID, message); err != nil {
		t.Fatalf("UpsertCommunicationsTriageItem second send: %v", err)
	}

	result, err := repo.ConvertCommunicationsTriageItems(context.Background(), CommunicationsTriageConversionInput{
		UserID: user.UserID, CompanyID: companyID, AccountEmail: user.Email,
		ActorUserID: user.UserID, PermissionUserID: user.UserID,
		Target:     CommunicationsTriageConversionTarget{Mode: CommunicationsEmailConversionTargetExistingNode, NodeID: node.NodeID},
		MessageIDs: []string{message.ID},
		InitialChat: &NodeInformationInput{
			InformationID: chatID, Type: CommunicationsEmailCollaborationChatInformationType,
			Information: `{"block_id":"44444444-4444-4444-8444-444444444494","selection_source":"email","selection_message_id":"","message":"Follow-up from triage"}`,
			ActorUserID: user.UserID,
		},
	})
	if err != nil {
		t.Fatalf("ConvertCommunicationsTriageItems existing text-box chat: %v", err)
	}
	if result.LinkedTextBlockID != "" || result.InitialChatID != chatID || len(result.EmailMessageIDs) != 1 {
		t.Fatalf("existing text-box chat result = %+v", result)
	}

	projections, err := repo.ListNodeProjections(companyID, node.NodeID)
	if err != nil {
		t.Fatalf("ListNodeProjections: %v", err)
	}
	textBoxCount := 0
	chatCount := 0
	for _, projection := range projections {
		switch projection.Type {
		case "Text box":
			textBoxCount++
		case CommunicationsEmailCollaborationChatInformationType:
			chatCount++
			information := strings.TrimPrefix(projection.Information, editorTextBlockProjectionPrefix)
			var payload map[string]any
			if err := json.Unmarshal([]byte(information), &payload); err != nil {
				t.Fatalf("parse appended chat projection: %v", err)
			}
			if payload["block_id"] != textBlockID || payload["selection_message_id"] != result.EmailMessageIDs[0] {
				t.Fatalf("appended chat payload = %+v", payload)
			}
		}
	}
	if textBoxCount != 1 || chatCount != 1 {
		t.Fatalf("projection counts: text boxes=%d chats=%d projections=%+v", textBoxCount, chatCount, projections)
	}
}

func TestMemoryDirectEmailTextboxRelationshipsAssignAndPreservePermanentColor(t *testing.T) {
	repo, companyID, user, node, messageA := setupAtomicEmailConversion(t, "11111111-1111-4111-8111-111111111196")
	wideA, err := repo.ConvertCommunicationsTriageItems(context.Background(), CommunicationsTriageConversionInput{
		UserID: user.UserID, CompanyID: companyID, AccountEmail: user.Email,
		ActorUserID: user.UserID, PermissionUserID: user.UserID,
		Target:     CommunicationsTriageConversionTarget{Mode: CommunicationsEmailConversionTargetExistingNode, NodeID: node.NodeID},
		MessageIDs: []string{messageA.ID},
	})
	if err != nil || len(wideA.EmailMessageIDs) != 1 {
		t.Fatalf("store first Node-wide message=%+v err=%v", wideA, err)
	}
	messageB := messageA
	messageB.ID = "mail-atomic-second"
	messageB.Subject = "Second atomic import"
	messageB.Date = 41
	if _, err := repo.UpsertCommunicationsTriageItem(user.UserID, messageB); err != nil {
		t.Fatal(err)
	}
	wideB, err := repo.ConvertCommunicationsTriageItems(context.Background(), CommunicationsTriageConversionInput{
		UserID: user.UserID, CompanyID: companyID, AccountEmail: user.Email,
		ActorUserID: user.UserID, PermissionUserID: user.UserID,
		Target:     CommunicationsTriageConversionTarget{Mode: CommunicationsEmailConversionTargetExistingNode, NodeID: node.NodeID},
		MessageIDs: []string{messageB.ID},
	})
	if err != nil || len(wideB.EmailMessageIDs) != 1 {
		t.Fatalf("store second Node-wide message=%+v err=%v", wideB, err)
	}

	textboxID := "44444444-4444-4444-8444-444444444496"
	conflictTextboxID := "44444444-4444-4444-8444-444444444497"
	for _, id := range []string{textboxID, conflictTextboxID} {
		if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
			CompanyID: companyID, NodeID: node.NodeID, InformationID: id, Type: "Text box",
			Information: editorTextBlockProjectionPrefix + `{"title":"Notes","document":"","attachments":[],"color":""}`,
			ActorUserID: user.UserID,
		}); err != nil {
			t.Fatalf("create textbox %s: %v", id, err)
		}
	}
	versionBefore, err := repo.CurrentNodeViewVersion(companyID, node.NodeID, user.UserID)
	if err != nil {
		t.Fatal(err)
	}
	withoutColor, _ := json.Marshal(nodeAttachedEmailPayload{
		BlockID: textboxID, EmailMessageID: wideA.EmailMessageIDs[0], LinkScope: "message",
	})
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: companyID, NodeID: node.NodeID, InformationID: "55555555-5555-4555-8555-555555555596",
		Type: "Attached email", Information: string(withoutColor), ActorUserID: user.UserID,
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("uncolored textbox attach without color err=%v", err)
	}
	versionAfterFailure, _ := repo.CurrentNodeViewVersion(companyID, node.NodeID, user.UserID)
	if versionAfterFailure.Shared != versionBefore.Shared {
		t.Fatalf("failed attach changed Node view version before=%+v after=%+v", versionBefore, versionAfterFailure)
	}

	linkAID := "55555555-5555-4555-8555-555555555597"
	linkA, _ := json.Marshal(nodeAttachedEmailPayload{
		BlockID: textboxID, EmailMessageID: wideA.EmailMessageIDs[0], TextboxColor: "#0EA5E9", LinkScope: "message",
	})
	createdA, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: companyID, NodeID: node.NodeID, InformationID: linkAID,
		Type: "Attached email", Information: string(linkA), ActorUserID: user.UserID,
	})
	if err != nil || createdA.InformationID != linkAID {
		t.Fatalf("direct link A=%+v err=%v", createdA, err)
	}
	versionAfterA, _ := repo.CurrentNodeViewVersion(companyID, node.NodeID, user.UserID)
	if versionAfterA.Shared <= versionBefore.Shared {
		t.Fatalf("successful direct attach did not bump Node view version before=%+v after=%+v", versionBefore, versionAfterA)
	}

	idempotentA, _ := json.Marshal(nodeAttachedEmailPayload{
		BlockID: textboxID, EmailMessageID: wideA.EmailMessageIDs[0], TextboxColor: "#F59E0B", LinkScope: "message",
	})
	converged, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: companyID, NodeID: node.NodeID, InformationID: "55555555-5555-4555-8555-555555555598",
		Type: "Attached email", Information: string(idempotentA), ActorUserID: user.UserID,
	})
	if err != nil || converged.InformationID != linkAID {
		t.Fatalf("idempotent direct link=%+v err=%v", converged, err)
	}
	versionAfterIdempotent, _ := repo.CurrentNodeViewVersion(companyID, node.NodeID, user.UserID)
	if versionAfterIdempotent.Shared != versionAfterA.Shared {
		t.Fatalf("idempotent attach changed Node view version before=%+v after=%+v", versionAfterA, versionAfterIdempotent)
	}

	linkB, _ := json.Marshal(nodeAttachedEmailPayload{
		BlockID: textboxID, EmailMessageID: wideB.EmailMessageIDs[0], TextboxColor: "#14B8A6", LinkScope: "message",
	})
	linkBID := "55555555-5555-4555-8555-555555555599"
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: companyID, NodeID: node.NodeID, InformationID: linkBID,
		Type: "Attached email", Information: string(linkB), ActorUserID: user.UserID,
	}); err != nil {
		t.Fatalf("direct link B to shared textbox: %v", err)
	}
	conflict, _ := json.Marshal(nodeAttachedEmailPayload{
		BlockID: conflictTextboxID, EmailMessageID: wideA.EmailMessageIDs[0], TextboxColor: "#8B5CF6", LinkScope: "message",
	})
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: companyID, NodeID: node.NodeID, InformationID: "55555555-5555-4555-8555-555555555590",
		Type: "Attached email", Information: string(conflict), ActorUserID: user.UserID,
	}); !errors.Is(err, ErrEmailMessageTextboxConflict) {
		t.Fatalf("same message second textbox err=%v", err)
	}

	for _, metadataColor := range []string{"", "#F59E0B"} {
		if _, err := repo.UpdateEditorJSONMetadata(EditorJSONMetadataInput{
			Document: EditorDocumentRef{CompanyID: companyID, ResourceType: EntityTypeNode,
				ResourceID: node.NodeID, DocumentID: textboxID},
			Title: "Metadata after email link", Color: metadataColor,
		}); err != nil {
			t.Fatalf("linked textbox metadata color %q: %v", metadataColor, err)
		}
	}

	projections, err := repo.ListNodeProjections(companyID, node.NodeID)
	if err != nil {
		t.Fatal(err)
	}
	var linkedIDs []string
	for _, projection := range projections {
		if projection.InformationID != textboxID && projection.InformationID != conflictTextboxID {
			continue
		}
		var payload struct {
			Color           string   `json:"color"`
			EmailMessageIDs []string `json:"email_message_ids"`
		}
		if json.Unmarshal([]byte(strings.TrimPrefix(projection.Information, editorTextBlockProjectionPrefix)), &payload) != nil {
			t.Fatalf("parse textbox projection: %s", projection.Information)
		}
		if projection.InformationID == textboxID {
			if payload.Color != "#0EA5E9" {
				t.Fatalf("linked textbox permanent color=%q", payload.Color)
			}
			linkedIDs = payload.EmailMessageIDs
		} else if payload.Color != "" || len(payload.EmailMessageIDs) != 0 {
			t.Fatalf("conflict leaked color or membership: %+v", payload)
		}
	}
	if len(linkedIDs) != 2 || linkedIDs[0] != wideB.EmailMessageIDs[0] || linkedIDs[1] != wideA.EmailMessageIDs[0] {
		t.Fatalf("timestamp-ordered shared textbox messages=%v", linkedIDs)
	}
	versionBeforeRemoval, _ := repo.CurrentNodeViewVersion(companyID, node.NodeID, user.UserID)
	if err := repo.DeleteNodeProjection(companyID, node.NodeID, linkBID); err != nil {
		t.Fatalf("remove one of two textbox email relationships: %v", err)
	}
	versionAfterFirstRemoval, _ := repo.CurrentNodeViewVersion(companyID, node.NodeID, user.UserID)
	if versionAfterFirstRemoval.Shared <= versionBeforeRemoval.Shared {
		t.Fatalf("first detach did not bump Node view version before=%+v after=%+v", versionBeforeRemoval, versionAfterFirstRemoval)
	}
	projections, _ = repo.ListNodeProjections(companyID, node.NodeID)
	for _, projection := range projections {
		if projection.InformationID != textboxID {
			continue
		}
		var payload struct {
			Color           string   `json:"color"`
			EmailMessageIDs []string `json:"email_message_ids"`
		}
		_ = json.Unmarshal([]byte(strings.TrimPrefix(projection.Information, editorTextBlockProjectionPrefix)), &payload)
		if payload.Color != "#0EA5E9" || len(payload.EmailMessageIDs) != 1 || payload.EmailMessageIDs[0] != wideA.EmailMessageIDs[0] {
			t.Fatalf("remove one of two changed permanent color/membership: %+v", payload)
		}
	}
	if err := repo.DeleteNodeProjection(companyID, node.NodeID, linkAID); err != nil {
		t.Fatalf("remove final textbox email relationship: %v", err)
	}
	versionAfterLastRemoval, _ := repo.CurrentNodeViewVersion(companyID, node.NodeID, user.UserID)
	if versionAfterLastRemoval.Shared <= versionAfterFirstRemoval.Shared {
		t.Fatalf("final detach did not bump Node view version before=%+v after=%+v", versionAfterFirstRemoval, versionAfterLastRemoval)
	}
	if _, err := repo.UpdateEditorJSONMetadata(EditorJSONMetadataInput{
		Document: EditorDocumentRef{CompanyID: companyID, ResourceType: EntityTypeNode,
			ResourceID: node.NodeID, DocumentID: textboxID},
		Title: "Stale metadata after final detach", Color: "#0EA5E9",
	}); err != nil {
		t.Fatalf("stale metadata after final detach: %v", err)
	}
	projections, _ = repo.ListNodeProjections(companyID, node.NodeID)
	for _, projection := range projections {
		if projection.InformationID != textboxID {
			continue
		}
		var payload struct {
			Color           string   `json:"color"`
			EmailMessageIDs []string `json:"email_message_ids"`
		}
		_ = json.Unmarshal([]byte(strings.TrimPrefix(projection.Information, editorTextBlockProjectionPrefix)), &payload)
		if payload.Color != "" || len(payload.EmailMessageIDs) != 0 {
			t.Fatalf("final detach did not neutralize textbox: %+v", payload)
		}
	}
}

func TestMemoryFirstEmailChatAtomicallyLinksAnotherExactMessageToExistingTextbox(t *testing.T) {
	repo, companyID, user, node, messageA := setupAtomicEmailConversion(t, "11111111-1111-4111-8111-111111111197")
	wideA, err := repo.ConvertCommunicationsTriageItems(context.Background(), CommunicationsTriageConversionInput{
		UserID: user.UserID, CompanyID: companyID, AccountEmail: user.Email,
		ActorUserID: user.UserID, PermissionUserID: user.UserID,
		Target:     CommunicationsTriageConversionTarget{Mode: CommunicationsEmailConversionTargetExistingNode, NodeID: node.NodeID},
		MessageIDs: []string{messageA.ID},
	})
	if err != nil || len(wideA.EmailMessageIDs) != 1 {
		t.Fatalf("store first Node-wide message=%+v err=%v", wideA, err)
	}
	messageB := messageA
	messageB.ID = "mail-atomic-enter-second"
	messageB.Subject = "Second Enter message"
	messageB.Date = 41
	if _, err := repo.UpsertCommunicationsTriageItem(user.UserID, messageB); err != nil {
		t.Fatal(err)
	}
	wideB, err := repo.ConvertCommunicationsTriageItems(context.Background(), CommunicationsTriageConversionInput{
		UserID: user.UserID, CompanyID: companyID, AccountEmail: user.Email,
		ActorUserID: user.UserID, PermissionUserID: user.UserID,
		Target:     CommunicationsTriageConversionTarget{Mode: CommunicationsEmailConversionTargetExistingNode, NodeID: node.NodeID},
		MessageIDs: []string{messageB.ID},
	})
	if err != nil || len(wideB.EmailMessageIDs) != 1 {
		t.Fatalf("store second Node-wide message=%+v err=%v", wideB, err)
	}

	textboxID := "44444444-4444-4444-8444-444444444498"
	chatAID := "55555555-5555-4555-8555-555555555581"
	chatBID := "55555555-5555-4555-8555-555555555582"
	chatPayload := func(messageID, quote, message, color string) string {
		raw, _ := json.Marshal(map[string]any{
			"block_id": textboxID, "ensure_email_textbox_link_on_send": true,
			"email_textbox_color_on_send": color,
			"selection_source":            "email", "selection_block_id": textboxID,
			"selection_message_id": messageID, "selection_quote": quote,
			"selection_start": 0, "selection_end": len(quote),
			"author_id": user.UserID, "author_name": "Atomic Enter User", "message": message,
			"attachments": []any{}, "entity_links": []any{},
			"mentioned_user_ids": []string{}, "mentioned_group_ids": []string{},
		})
		return string(raw)
	}
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: companyID, NodeID: node.NodeID, InformationID: chatAID,
		Type:        CommunicationsEmailCollaborationChatInformationType,
		Information: chatPayload(wideA.EmailMessageIDs[0], "First exact message", "Anchor A", "#0EA5E9"),
		ActorUserID: user.UserID,
	}); err != nil {
		t.Fatalf("first exact message Enter: %v", err)
	}
	versionBeforeFailedB, _ := repo.CurrentNodeViewVersion(companyID, node.NodeID, user.UserID)
	forced := errors.New("forced first-chat outbox failure")
	repo.realtimeOutboxErr = forced
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: companyID, NodeID: node.NodeID, InformationID: chatBID,
		Type:        CommunicationsEmailCollaborationChatInformationType,
		Information: chatPayload(wideB.EmailMessageIDs[0], "Second exact message", "Anchor B", "#14B8A6"),
		ActorUserID: user.UserID,
	}); !errors.Is(err, forced) {
		t.Fatalf("forced second-message Enter error=%v", err)
	}
	repo.realtimeOutboxErr = nil
	versionAfterFailedB, _ := repo.CurrentNodeViewVersion(companyID, node.NodeID, user.UserID)
	if versionAfterFailedB.Shared != versionBeforeFailedB.Shared {
		t.Fatalf("failed second-message Enter changed view version before=%+v after=%+v", versionBeforeFailedB, versionAfterFailedB)
	}
	if _, exists := repo.nodeText[key(companyID, node.NodeID)][chatBID]; exists {
		t.Fatal("failed second-message Enter leaked chat")
	}
	for _, projection := range repo.nodeText[key(companyID, node.NodeID)] {
		if !strings.EqualFold(projection.Type, "Attached email") {
			continue
		}
		var relationship nodeAttachedEmailPayload
		if json.Unmarshal([]byte(projection.Information), &relationship) == nil &&
			cleanUUIDText(relationship.BlockID) == textboxID &&
			cleanUUIDText(relationship.EmailMessageID) == wideB.EmailMessageIDs[0] {
			t.Fatal("failed second-message Enter leaked exact relationship")
		}
	}

	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: companyID, NodeID: node.NodeID, InformationID: chatBID,
		Type:        CommunicationsEmailCollaborationChatInformationType,
		Information: chatPayload(wideB.EmailMessageIDs[0], "Second exact message", "Anchor B", "#14B8A6"),
		ActorUserID: user.UserID,
	}); err != nil {
		t.Fatalf("second exact message Enter retry: %v", err)
	}

	providerTextboxID := "44444444-4444-4444-8444-444444444499"
	providerPayload := strings.ReplaceAll(
		chatPayload(messageB.ID, "Provider identity", "Must fail", "#8B5CF6"), textboxID, providerTextboxID,
	)
	versionBeforeProvider, _ := repo.CurrentNodeViewVersion(companyID, node.NodeID, user.UserID)
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: companyID, NodeID: node.NodeID, InformationID: "55555555-5555-4555-8555-555555555583",
		Type: CommunicationsEmailCollaborationChatInformationType, Information: providerPayload, ActorUserID: user.UserID,
	}); !errors.Is(err, ErrEmailMessageIdentityInvalid) {
		t.Fatalf("provider first-chat identity err=%v", err)
	}
	versionAfterProvider, _ := repo.CurrentNodeViewVersion(companyID, node.NodeID, user.UserID)
	if versionAfterProvider.Shared != versionBeforeProvider.Shared {
		t.Fatalf("provider failure changed view version before=%+v after=%+v", versionBeforeProvider, versionAfterProvider)
	}
	if _, exists := repo.nodeText[key(companyID, node.NodeID)][providerTextboxID]; exists {
		t.Fatal("provider first-chat failure leaked temporary textbox")
	}
	if _, exists := repo.nodeText[key(companyID, node.NodeID)]["55555555-5555-4555-8555-555555555583"]; exists {
		t.Fatal("provider first-chat failure leaked chat")
	}

	conflictTextboxID := "44444444-4444-4444-8444-444444444490"
	conflictPayload := strings.ReplaceAll(
		chatPayload(wideA.EmailMessageIDs[0], "Conflicting destination", "Must fail", "#8B5CF6"), textboxID, conflictTextboxID,
	)
	if _, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: companyID, NodeID: node.NodeID, InformationID: "55555555-5555-4555-8555-555555555584",
		Type: CommunicationsEmailCollaborationChatInformationType, Information: conflictPayload, ActorUserID: user.UserID,
	}); !errors.Is(err, ErrEmailMessageTextboxConflict) {
		t.Fatalf("first-chat destination conflict err=%v", err)
	}
	if _, exists := repo.nodeText[key(companyID, node.NodeID)][conflictTextboxID]; exists {
		t.Fatal("first-chat destination conflict leaked temporary textbox")
	}
	if _, exists := repo.nodeText[key(companyID, node.NodeID)]["55555555-5555-4555-8555-555555555584"]; exists {
		t.Fatal("first-chat destination conflict leaked chat")
	}

	projections, err := repo.ListNodeProjections(companyID, node.NodeID)
	if err != nil {
		t.Fatal(err)
	}
	var linkedIDs []string
	chatSelections := map[string]bool{}
	for _, projection := range projections {
		switch {
		case projection.InformationID == textboxID:
			var payload struct {
				Color           string   `json:"color"`
				EmailMessageIDs []string `json:"email_message_ids"`
			}
			if json.Unmarshal([]byte(strings.TrimPrefix(projection.Information, editorTextBlockProjectionPrefix)), &payload) != nil {
				t.Fatal("parse first-chat textbox projection")
			}
			if payload.Color != "#0EA5E9" {
				t.Fatalf("second-message Enter replaced permanent textbox color=%q", payload.Color)
			}
			linkedIDs = payload.EmailMessageIDs
		case projection.InformationID == chatAID || projection.InformationID == chatBID:
			var payload nodeTextboxChatPayload
			if json.Unmarshal([]byte(projection.Information), &payload) != nil {
				t.Fatalf("parse first-chat projection %s", projection.InformationID)
			}
			chatSelections[cleanUUIDText(payload.SelectionMessageID)] = true
		}
	}
	if len(linkedIDs) != 2 || linkedIDs[0] != wideB.EmailMessageIDs[0] || linkedIDs[1] != wideA.EmailMessageIDs[0] {
		t.Fatalf("second-message Enter textbox membership=%v", linkedIDs)
	}
	if !chatSelections[wideA.EmailMessageIDs[0]] || !chatSelections[wideB.EmailMessageIDs[0]] || len(chatSelections) != 2 {
		t.Fatalf("first-chat exact selections=%v", chatSelections)
	}
}

func TestMemoryEmailTextboxRelationshipRemovalMatchesTheCanonicalChatGuard(t *testing.T) {
	repo, companyID, user, node, message := setupAtomicEmailConversion(t, "11111111-1111-4111-8111-111111111195")
	textBlockID := "44444444-4444-4444-8444-444444444495"
	first, err := repo.ConvertCommunicationsTriageItems(context.Background(), CommunicationsTriageConversionInput{
		UserID: user.UserID, CompanyID: companyID, AccountEmail: user.Email,
		ActorUserID: user.UserID, PermissionUserID: user.UserID,
		Target:     CommunicationsTriageConversionTarget{Mode: CommunicationsEmailConversionTargetExistingNode, NodeID: node.NodeID},
		MessageIDs: []string{message.ID},
		LinkedTextBlock: &NodeInformationInput{
			InformationID: textBlockID, Type: "Text box",
			Information: editorTextBlockProjectionPrefix + `{"title":"Imported email","document":"","attachments":[]}`,
			ActorUserID: user.UserID,
		},
	})
	if err != nil || len(first.EmailMessageIDs) != 1 {
		t.Fatalf("initial chat-free relationship=%+v err=%v", first, err)
	}
	findRelationshipID := func() string {
		for informationID, projection := range repo.nodeText[key(companyID, node.NodeID)] {
			if !strings.EqualFold(projection.Type, "Attached email") {
				continue
			}
			var payload nodeAttachedEmailPayload
			if json.Unmarshal([]byte(projection.Information), &payload) == nil && cleanUUIDText(payload.BlockID) == textBlockID {
				return informationID
			}
		}
		return ""
	}
	chatFreeRelationshipID := findRelationshipID()
	if chatFreeRelationshipID == "" {
		t.Fatal("chat-free typed relationship missing")
	}
	if err := repo.DeleteNodeProjection(companyID, node.NodeID, chatFreeRelationshipID); err != nil {
		t.Fatalf("remove chat-free relationship: %v", err)
	}
	projections, err := repo.ListNodeProjections(companyID, node.NodeID)
	if err != nil {
		t.Fatal(err)
	}
	for _, projection := range projections {
		if projection.InformationID != textBlockID {
			continue
		}
		var payload struct {
			EmailMessageIDs []string `json:"email_message_ids"`
		}
		if json.Unmarshal([]byte(strings.TrimPrefix(projection.Information, editorTextBlockProjectionPrefix)), &payload) != nil || len(payload.EmailMessageIDs) != 0 {
			t.Fatalf("chat-free relationship remained in derived textbox projection: %s", projection.Information)
		}
	}
	if _, ok := repo.nodeEmailThreads[memoryNodeEmailThreadKey(companyID, node.NodeID, first.EmailThreadIDs[0])]; !ok {
		t.Fatal("textbox relationship removal deleted the Node-wide thread edge")
	}

	if _, err := repo.UpsertCommunicationsTriageItem(user.UserID, message); err != nil {
		t.Fatal(err)
	}
	chatID := "55555555-5555-4555-8555-555555555595"
	if _, err := repo.ConvertCommunicationsTriageItems(context.Background(), CommunicationsTriageConversionInput{
		UserID: user.UserID, CompanyID: companyID, AccountEmail: user.Email,
		ActorUserID: user.UserID, PermissionUserID: user.UserID,
		Target:     CommunicationsTriageConversionTarget{Mode: CommunicationsEmailConversionTargetExistingNode, NodeID: node.NodeID},
		MessageIDs: []string{message.ID},
		InitialChat: &NodeInformationInput{
			InformationID: chatID, Type: CommunicationsEmailCollaborationChatInformationType,
			Information: `{"block_id":"44444444-4444-4444-8444-444444444495","selection_source":"email","selection_message_id":"","message":"Anchored chat"}`,
			ActorUserID: user.UserID,
		},
	}); err != nil {
		t.Fatalf("relink with anchored chat: %v", err)
	}
	anchoredRelationshipID := findRelationshipID()
	if anchoredRelationshipID == "" {
		t.Fatal("anchored typed relationship missing")
	}
	if err := repo.DeleteNodeProjection(companyID, node.NodeID, anchoredRelationshipID); !errors.Is(err, ErrEmailRelationshipRequiredByChat) {
		t.Fatalf("anchored relationship removal err=%v", err)
	}
	if _, exists := repo.nodeText[key(companyID, node.NodeID)][anchoredRelationshipID]; !exists {
		t.Fatal("blocked removal deleted the relationship")
	}
	if _, exists := repo.nodeText[key(companyID, node.NodeID)][chatID]; !exists {
		t.Fatal("blocked removal deleted the anchored chat")
	}
	deletedChat := repo.nodeText[key(companyID, node.NodeID)][chatID]
	deletedChat.IsDeleted = true
	repo.nodeText[key(companyID, node.NodeID)][chatID] = deletedChat
	if err := repo.DeleteNodeProjection(companyID, node.NodeID, anchoredRelationshipID); err != nil {
		t.Fatalf("remove relationship after anchored chat deletion: %v", err)
	}
}

func TestMemoryNodeTextboxDeleteReleasesItsMessageAndPreservesTheWideRelationship(t *testing.T) {
	repo, companyID, user, node, message := setupAtomicEmailConversion(t, "11111111-1111-4111-8111-111111111196")
	firstTextboxID := "44444444-4444-4444-8444-444444444496"
	secondTextboxID := "66666666-6666-4666-8666-666666666696"
	chatID := "55555555-5555-4555-8555-555555555596"
	result, err := repo.ConvertCommunicationsTriageItems(context.Background(), CommunicationsTriageConversionInput{
		UserID: user.UserID, CompanyID: companyID, AccountEmail: user.Email,
		ActorUserID: user.UserID, PermissionUserID: user.UserID,
		Target:     CommunicationsTriageConversionTarget{Mode: CommunicationsEmailConversionTargetExistingNode, NodeID: node.NodeID},
		MessageIDs: []string{message.ID},
		LinkedTextBlock: &NodeInformationInput{
			InformationID: firstTextboxID, Type: "Text box",
			Information: editorTextBlockProjectionPrefix + `{"title":"Imported email","document":"","attachments":[],"color":"#0EA5E9"}`,
			ActorUserID: user.UserID,
		},
		InitialChat: &NodeInformationInput{
			InformationID: chatID, Type: CommunicationsEmailCollaborationChatInformationType,
			Information: `{"block_id":"44444444-4444-4444-8444-444444444496","selection_source":"email","selection_message_id":"","message":"Anchored chat"}`,
			ActorUserID: user.UserID,
		},
	})
	if err != nil || len(result.EmailMessageIDs) != 1 || len(result.AttachedEmailInformationIDs) != 1 {
		t.Fatalf("initial linked textbox=%+v err=%v", result, err)
	}
	textboxRelationshipID := ""
	for informationID, projection := range repo.nodeText[key(companyID, node.NodeID)] {
		if !strings.EqualFold(projection.Type, "Attached email") {
			continue
		}
		var relationship nodeAttachedEmailPayload
		if json.Unmarshal([]byte(projection.Information), &relationship) == nil && cleanUUIDText(relationship.BlockID) == firstTextboxID {
			textboxRelationshipID = informationID
			break
		}
	}
	if textboxRelationshipID == "" {
		t.Fatal("initial exact textbox relationship missing")
	}
	current := repo.nodeText[key(companyID, node.NodeID)][firstTextboxID]
	if current.Revision < 1 {
		current.Revision = 1
	}
	if err := repo.DeleteNodeProjectionWithActor(NodeProjectionDeleteInput{
		CompanyID: companyID, NodeID: node.NodeID, InformationID: firstTextboxID,
		ExpectedRevision: &current.Revision, ActorUserID: user.UserID,
	}); err != nil {
		t.Fatalf("delete first textbox: %v", err)
	}
	projections := repo.nodeText[key(companyID, node.NodeID)]
	if _, exists := projections[chatID]; exists {
		t.Fatal("textbox delete retained its chat")
	}
	if _, exists := projections[textboxRelationshipID]; exists {
		t.Fatal("textbox delete retained its exact email relationship")
	}
	if _, exists := projections[result.AttachedEmailInformationIDs[0]]; !exists {
		t.Fatal("textbox delete removed the Node-wide email projection")
	}
	if _, exists := repo.nodeEmailThreads[memoryNodeEmailThreadKey(companyID, node.NodeID, result.EmailThreadIDs[0])]; !exists {
		t.Fatal("textbox delete removed the Node-wide email relationship")
	}
	details, err := repo.GetNodeDetails(companyID, node.NodeID)
	if err != nil {
		t.Fatal(err)
	}
	informationIDs := map[string]bool{}
	for _, item := range details.Information {
		informationIDs[item.InformationID] = true
	}
	if informationIDs[chatID] || informationIDs[textboxRelationshipID] || !informationIDs[result.AttachedEmailInformationIDs[0]] {
		t.Fatalf("textbox delete detail cleanup chat/relationship/wide=%v/%v/%v",
			informationIDs[chatID], informationIDs[textboxRelationshipID], informationIDs[result.AttachedEmailInformationIDs[0]])
	}
	if _, err := repo.AddNodeInformation(companyID, node.NodeID, "Text box",
		editorTextBlockProjectionPrefix+`{"title":"Second textbox","document":"","attachments":[],"color":""}`, secondTextboxID); err != nil {
		t.Fatalf("create second textbox: %v", err)
	}
	linkPayload, _ := json.Marshal(map[string]any{
		"block_id": secondTextboxID, "email_message_id": result.EmailMessageIDs[0],
		"link_scope": "message", "textbox_color": "#14B8A6",
	})
	linked, err := repo.AddNodeInformationWithActor(NodeInformationInput{
		CompanyID: companyID, NodeID: node.NodeID, InformationID: "77777777-7777-4777-8777-777777777796",
		Type: "Attached email", Information: string(linkPayload), ActorUserID: user.UserID,
	})
	if err != nil || linked.InformationID == "" {
		t.Fatalf("link released message to second textbox=%+v err=%v", linked, err)
	}
}

func TestMemoryEmailConversionRollsBackEveryAtomicImportWrite(t *testing.T) {
	repo, companyID, user, node, message := setupAtomicEmailConversion(t, "11111111-1111-4111-8111-111111111193")
	beforeOutbox := maps.Clone(repo.realtimeOutbox)
	forced := errors.New("forced initial chat outbox failure")
	repo.realtimeOutboxErr = forced

	_, err := repo.ConvertCommunicationsTriageItems(context.Background(), CommunicationsTriageConversionInput{
		UserID: user.UserID, CompanyID: companyID, AccountEmail: user.Email,
		ActorUserID: user.UserID,
		Target:      CommunicationsTriageConversionTarget{Mode: CommunicationsEmailConversionTargetExistingNode, NodeID: node.NodeID},
		MessageIDs:  []string{message.ID},
		LinkedTextBlock: &NodeInformationInput{
			InformationID: "66666666-6666-4666-8666-666666666693", Type: "Text box",
			Information: `{"title":"Imported email","document":"","attachments":[]}`,
			ActorUserID: user.UserID,
		},
		InitialChat: &NodeInformationInput{
			InformationID: "77777777-7777-4777-8777-777777777793", Type: CommunicationsEmailCollaborationChatInformationType,
			Information: `{"block_id":"66666666-6666-4666-8666-666666666693","message":"Imported email for review"}`,
			ActorUserID: user.UserID,
		},
	})
	if !errors.Is(err, forced) {
		t.Fatalf("atomic import error = %v, want forced outbox failure", err)
	}
	projections, listErr := repo.ListNodeProjections(companyID, node.NodeID)
	if listErr != nil || len(projections) != 0 {
		t.Fatalf("partial node projections after rollback = %+v err=%v", projections, listErr)
	}
	if items := communicationsTriageItemsForTest(repo, user.UserID); len(items) != 1 || items[0].MessageID != message.ID {
		t.Fatalf("source triage item after rollback = %+v", items)
	}
	if len(repo.emailThreads) != 0 || len(repo.emailThreadScopeIDs) != 0 || len(repo.nodeEmailThreads) != 0 || !maps.EqualFunc(repo.realtimeOutbox, beforeOutbox, func(a, b RealtimeOutboxEvent) bool { return a.EventID == b.EventID }) {
		t.Fatalf("partial durable state after rollback: threads=%d scopes=%d links=%d outbox=%d",
			len(repo.emailThreads), len(repo.emailThreadScopeIDs), len(repo.nodeEmailThreads), len(repo.realtimeOutbox))
	}
}

func setupAtomicEmailConversion(t *testing.T, companyID string) (*MemoryRepo, string, domain.User, domain.Node, domain.EmailMessageSnapshot) {
	t.Helper()
	repo := NewMemoryRepo()
	repo.EnsureCompany(companyID, "Atomic Email Import Company")
	user, _ := setupEmailConversionUserAndGate(t, repo, companyID)
	node, err := repo.CreateNode(companyID, "Existing import target")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	message := domain.EmailMessageSnapshot{
		ID: "mail-atomic", ThreadID: "thread-atomic", Subject: "Atomic import",
		Body: "<p><strong>Stored rich body</strong></p>", Snippet: "Stored rich body", Date: 42,
	}
	if _, err := repo.UpsertCommunicationsTriageItem(user.UserID, message); err != nil {
		t.Fatalf("UpsertCommunicationsTriageItem: %v", err)
	}
	return repo, companyID, user, node, message
}
