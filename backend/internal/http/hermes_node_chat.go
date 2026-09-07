package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"

	"miraeopus/backend/internal/store"
)

func (s *Server) handleHermesCreateNodeChat(w http.ResponseWriter, r *http.Request, run store.AIRun, raw json.RawMessage) {
	var args struct {
		NodeID    string `json:"node_id"`
		TextboxID string `json:"textbox_id"`
		Body      string `json:"body"`
	}
	if !decodeHermesArguments(raw, &args) || !isCanonicalUUID(args.NodeID) || !isCanonicalUUID(args.TextboxID) {
		writeError(w, http.StatusBadRequest, "invalid_action_arguments")
		return
	}
	args.NodeID, args.TextboxID = strings.ToLower(args.NodeID), strings.ToLower(args.TextboxID)
	args.Body = strings.TrimSpace(args.Body)
	if args.Body == "" || len(args.Body) > 32000 || strings.ContainsRune(args.Body, '\x00') {
		writeError(w, http.StatusBadRequest, "invalid_chat_body")
		return
	}
	if !s.requireEntityEdit(w, r, run.CompanyID, store.EntityTypeNode, args.NodeID, "node_not_found") {
		return
	}
	_, actorName := nodeChangeActorPayload(r)
	item, err := s.repo.AICreateNodeChat(r.Context(), run, hermesArgumentKey(args), store.AINodeChatCreateInput{
		NodeID: args.NodeID, TextboxID: args.TextboxID, Body: args.Body, ActorDisplayName: actorName,
	})
	if err != nil {
		writeAIStoreError(w, err)
		return
	}
	s.wakeRealtimeSpine()
	s.recordNodeChatNotification(r, run.CompanyID, args.NodeID, item.InformationID, item.Type, item.Information)
	writeJSON(w, http.StatusOK, map[string]any{
		"node_id": args.NodeID, "textbox_id": args.TextboxID, "chat_id": item.InformationID,
		"body": args.Body, "created_timestamp": item.CreatedTimestamp,
	})
}
