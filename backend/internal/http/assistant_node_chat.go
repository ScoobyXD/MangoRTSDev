package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"miraeopus/backend/internal/store"
)

func assistantChatUsersTool() assistantFunctionTool {
	return assistantFunction("list_chat_users", "Find users available for chat mentions in the selected company, including global administrators, by name or email; returns at most 50. Use exact returned user_id values. Ask the user to choose when names are ambiguous; never guess a recipient.", map[string]any{"query": map[string]any{"type": []string{"string", "null"}, "maxLength": 500}})
}

func assistantNodeChatTool(bound bool) assistantFunctionTool {
	ids := map[string]any{"type": "array", "items": map[string]any{"type": "string", "format": "uuid"}, "maxItems": 20}
	properties := map[string]any{
		"textbox_id":         map[string]any{"type": "string", "format": "uuid"},
		"message":            map[string]any{"type": "string", "minLength": 1, "maxLength": 16000},
		"mentioned_user_ids": ids, "urgent_user_ids": ids,
	}
	name, target := "send_node_chat", "the exact Node and existing textbox read from get_node/get_textbox"
	if bound {
		name, target = "send_process_node_chat", "this request's tracked Node and an existing textbox returned by write_process_node"
	} else {
		properties["node_id"] = map[string]any{"type": "string", "format": "uuid"}
	}
	return assistantFunction(name, "Post one real chat message as the signed-in user on "+target+". Use only when the user or selected Process SOP requests a chat. Resolve recipient IDs with list_chat_users; normal @ mentions go in mentioned_user_ids, urgent ! mentions in urgent_user_ids, empty arrays mean no mentions. Mango adds the actual mention tokens; message must contain the body without typed mentions. Uses the existing Node chat and notification rules; no email is sent. Never retry a failed or uncertain send.", properties)
}

func (s *Server) assistantNodeChatInformation(r *http.Request, args map[string]any) (string, error) {
	actor, _ := authenticatedActor(r)
	nodeID, _ := args["node_id"].(string)
	textboxID, _ := args["textbox_id"].(string)
	readArgs, _ := json.Marshal(map[string]any{"resource_type": "node", "resource_id": nodeID, "textbox_id": textboxID})
	result, err := s.dispatchAssistantTool(r, "get_textbox", string(readArgs))
	if err != nil {
		return "", err
	}
	var snapshot store.EditorJSONSnapshot
	if json.Unmarshal([]byte(result), &snapshot) != nil || snapshot.Deleted || snapshot.Revision == 0 {
		return "", errors.New("Choose an existing textbox on this Node before sending chat.")
	}
	directory, err := s.repo.ListMentionableCompanyUsers(actor.CompanyID)
	if err != nil {
		return "", errors.New("Mango could not read the chat mention directory.")
	}
	message, _ := args["message"].(string)
	message = strings.TrimSpace(message)
	for _, kind := range []string{"regular", "urgent"} {
		mentioned, err := s.notifications.ResolveMentionedUserIDOccurrencesByKind(actor.CompanyID, message, kind)
		if err != nil {
			return "", errors.New("Mango could not verify the chat message body.")
		}
		if len(mentioned) != 0 {
			return "", errors.New("Put mention recipients in the selected user IDs and keep typed mentions out of the message body.")
		}
	}
	allIDs := make([]string, 0)
	selected := make(map[string]bool)
	prefixes := make([]string, 0)
	byKind := make(map[string]map[string]bool)
	for _, entry := range []struct{ argument, kind, trigger string }{{"mentioned_user_ids", "regular", "@"}, {"urgent_user_ids", "urgent", "!"}} {
		byKind[entry.kind] = make(map[string]bool)
		for _, rawID := range args[entry.argument].([]any) {
			id := rawID.(string)
			if selected[id] {
				return "", errors.New("Choose only one mention kind for each user.")
			}
			label := ""
			for _, user := range directory {
				if user.UserID == id {
					label = strings.TrimSpace(firstNonEmptyString(user.Email, user.DisplayName))
					break
				}
			}
			if label == "" {
				return "", errors.New("The mention recipient is no longer available in this company's chat directory. Work stopped before sending chat.")
			}
			selected[id], byKind[entry.kind][id] = true, true
			allIDs = append(allIDs, id)
			prefixes = append(prefixes, entry.trigger+label)
		}
	}
	if len(prefixes) > 0 {
		message = strings.Join(prefixes, " ") + " " + message
	}
	payload := map[string]any{
		"block_id": textboxID, "parent_id": "", "selection_source": "text",
		"author_id": actor.User.UserID, "author_name": firstNonEmptyString(actor.User.DisplayName, actor.User.Email),
		"message": message, "created_timestamp": time.Now().UTC().Format(time.RFC3339Nano),
		"attachments": []any{}, "entity_links": []any{}, "mentioned_user_ids": allIDs, "mentioned_group_ids": []string{},
	}
	encoded, _ := json.Marshal(payload)
	// Use the exact same parser as ordinary chat notifications. The model cannot
	// smuggle a typed alias or HTML mention that targets an unselected principal.
	for kind, expected := range byKind {
		resolved, err := s.notifications.ResolveMentionedUserIDOccurrencesByKind(actor.CompanyID, string(encoded), kind)
		if err != nil {
			return "", errors.New("Mango could not verify the chat mention recipients.")
		}
		actual := make(map[string]bool)
		for _, id := range resolved {
			actual[id] = true
		}
		if len(actual) != len(expected) || len(resolved) != len(expected) {
			return "", errors.New("Chat mentions are ambiguous or include typed recipients. Use only exact selected user IDs and a message body without mentions.")
		}
		for id := range actual {
			if !expected[id] {
				return "", errors.New("Chat mentions do not match the selected recipients. Work stopped before sending chat.")
			}
		}
	}
	return string(encoded), nil
}
