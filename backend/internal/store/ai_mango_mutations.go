package store

import (
	"encoding/json"
	"strings"
	"time"

	"miraeopus/backend/internal/domain"
)

type AINodeUpdateResult struct {
	Node  domain.Node        `json:"node"`
	Event domain.DomainEvent `json:"event"`
}

type AIEditorCreateResult struct {
	Document EditorJSONDocumentRef `json:"document_ref"`
	Commit   EditorJSONCommit      `json:"commit"`
}

func aiNewEditorInput(run AIRun, actionKey string, input EditorJSONCommitInput) (EditorJSONCommitInput, error) {
	if input.Document.ResourceType != EntityTypeNode && input.Document.ResourceType != EntityTypeProject {
		return EditorJSONCommitInput{}, ErrInvalid
	}
	input.Document.DocumentID = NewUUIDv7String()
	input.BaseRevision = 0
	return aiEditorInput(run, actionKey, input)
}

func aiMutationEvent(action aiActionKey) AIHistoryEvent {
	data, _ := json.Marshal(map[string]string{"action_name": action.Name, "action_key": action.Key})
	return AIHistoryEvent{ID: "action:" + action.Name + ":" + action.Key, Type: "action_committed", CreatedAt: aiTime(time.Now()), Data: data}
}

func aiMutationRunMatches(run, requested AIRun, action aiActionKey) bool {
	return run.Status == "running" && run.HermesRunID != "" && run.HermesRunID == requested.HermesRunID && strings.TrimSpace(action.Key) != ""
}

func aiEditorInput(run AIRun, actionKey string, input EditorJSONCommitInput) (EditorJSONCommitInput, error) {
	input.Document.CompanyID, input.ActorUserID = run.CompanyID, run.UserID
	input.OperationID = "ai:" + run.RunID + ":" + actionKey
	input.ClientID = "ai:" + run.RunID
	switch input.Document.ResourceType {
	case EntityTypeNode, EntityTypeLogicGate, EntityTypeProcessStep, EntityTypeProject:
	default:
		return EditorJSONCommitInput{}, ErrInvalid
	}
	return NormalizeEditorJSONCommit(input)
}
