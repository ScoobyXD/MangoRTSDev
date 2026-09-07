package store

import (
	"encoding/json"
	"strings"
)

type AINodeChatCreateInput struct {
	NodeID           string
	TextboxID        string
	Body             string
	ActorDisplayName string
}

func aiNodeChatInput(run AIRun, input AINodeChatCreateInput) (NodeInformationInput, error) {
	input.NodeID, input.TextboxID = cleanUUIDText(input.NodeID), cleanUUIDText(input.TextboxID)
	input.Body = strings.TrimSpace(input.Body)
	if input.NodeID == "" || input.TextboxID == "" || input.Body == "" || len(input.Body) > 32000 || !aiValidText(input.Body) {
		return NodeInformationInput{}, ErrInvalid
	}
	// Ordinary Node chats store text in message; the authenticated run supplies
	// authorship and scope, never model-provided author or company arguments.
	payload, err := json.Marshal(textboxChatPayload{
		BlockID: input.TextboxID, Message: input.Body, SelectionSource: "text",
		AuthorID: run.UserID, AuthorName: input.ActorDisplayName,
	})
	if err != nil {
		return NodeInformationInput{}, err
	}
	return NodeInformationInput{
		CompanyID: run.CompanyID, NodeID: input.NodeID, Type: "Text block chat", Information: string(payload),
		ActorUserID: run.UserID, ActorDisplayName: input.ActorDisplayName,
	}, nil
}
