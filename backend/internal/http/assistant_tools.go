package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

const assistantToolResultLimit = 64 << 10

type assistantFunctionTool struct {
	Type        string         `json:"type"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Strict      bool           `json:"strict"`
	Parameters  map[string]any `json:"parameters"`
}

// These are fixed internal operations. Every call below goes through the same
// handler as the app; model arguments never supply a company, actor or URL.
func assistantTools() []assistantFunctionTool {
	id := map[string]any{"type": "string", "format": "uuid"}
	text := map[string]any{"type": "string", "minLength": 1, "maxLength": 500}
	optionalText := map[string]any{"type": []string{"string", "null"}, "maxLength": 500}
	optionalID := map[string]any{"type": []string{"string", "null"}, "format": "uuid"}
	revision := map[string]any{"type": "integer", "minimum": 0}
	resourceType := map[string]any{"type": "string", "enum": []string{"node", "logic_gate"}}
	attachmentResource := map[string]any{"type": "string", "enum": []string{"node", "logic_gate", "company_explorer_folder"}}
	textboxID := map[string]any{"type": "string", "minLength": 1, "maxLength": 128}
	optionalTextboxID := map[string]any{"type": []string{"string", "null"}, "minLength": 1, "maxLength": 128}
	return []assistantFunctionTool{
		assistantFunction("get_me", "Read the signed-in user and selected company membership.", map[string]any{}),
		assistantChatUsersTool(),
		assistantNodeChatTool(false),
		assistantFunction("list_my_processes", "Read the signed-in user's assigned Processes in the selected company. Use this for 'my processes' or 'what processes am I assigned to'. Mango filters by current RACI assignments, including inherited and group assignments, and current Process access. Includes any R, A, C, or I role; does not scan only the first 50 company Processes.", map[string]any{}),
		assistantFunction("list_processes", "Find visible Processes (canonical logic_gate resources); returns at most 50. Use query to narrow results.", map[string]any{"query": optionalText}),
		assistantFunction("get_process", "Read one Process and its textbox IDs.", map[string]any{"process_id": id}),
		assistantFunction("get_process_nodes", "Read one Process's current work and Nodes using its normal work permissions.", map[string]any{"process_id": id}),
		assistantFunction("create_process", "Create a Process using Mango's normal creation command.", map[string]any{"name": text}),
		assistantFunction("update_process", "Rename a Process.", map[string]any{"process_id": id, "name": text}),
		assistantFunction("delete_process", "Delete a Process through Mango's recycle/deletion rules. The user must explicitly supply their display name as confirmation; never infer it from get_me.", map[string]any{"process_id": id, "confirmation_display_name": text}),
		assistantFunction("get_node", "Read a Node and its textbox IDs.", map[string]any{"node_id": id}),
		assistantFunction("create_node", "Create an unassigned Node. Use move_node_to_process separately to assign it.", map[string]any{"name": text}),
		assistantFunction("update_node", "Update a Node. Null fields are unchanged; an empty due_date clears it. Priority 0 clears priority, 1-5 sets it.", map[string]any{"node_id": id, "name": optionalText, "status": optionalText, "due_date": optionalText, "priority": map[string]any{"type": []string{"integer", "null"}, "minimum": 0, "maximum": 5}}),
		assistantFunction("delete_node", "Delete a Node through Mango's recycle/deletion rules. The user must explicitly supply their display name as confirmation; never infer it from get_me.", map[string]any{"node_id": id, "confirmation_display_name": text}),
		assistantFunction("move_node_to_process", "Assign or move a Node to a Process using its canonical stored assignment. Status null preserves the Node's current status. Moving to another Process clears its previous step.", map[string]any{"node_id": id, "process_id": id, "status": optionalText}),
		assistantFunction("get_textbox", "Read the complete canonical textbox document and its revision before changing it.", map[string]any{"resource_type": resourceType, "resource_id": id, "textbox_id": textboxID}),
		assistantFunction("save_textbox", "Save complete plain text in one canonical textbox operation. Replacement removes rich formatting, inline content and annotations; explain this and obtain the user's agreement before replacing existing rich content. New textbox: textbox_id null, base_revision 0. Existing: exact ID and last-read revision. Mango applies its existing concurrency rules, which may merge concurrent blocks; read get_textbox afterward before claiming exact final content. Never retry a failed save.", map[string]any{"resource_type": resourceType, "resource_id": id, "textbox_id": optionalTextboxID, "base_revision": revision, "plain_text": map[string]any{"type": "string", "maxLength": 16000}}),
		assistantFunction("delete_textbox", "Delete exactly one textbox at its current revision, with normal chat/relationship cleanup. Never retry a failed delete.", map[string]any{"resource_type": resourceType, "resource_id": id, "textbox_id": textboxID, "base_revision": revision}),
		assistantFunction("list_explorer", "Read Company Explorer children. parent_folder_id null reads company root; query searches visible folders and Processes instead.", map[string]any{"parent_folder_id": optionalID, "query": optionalText}),
		assistantFunction("create_folder", "Create a Company Explorer folder and its existing Process Map placement. parent_folder_id null means company root.", map[string]any{"name": text, "parent_folder_id": optionalID}),
		assistantFunction("rename_folder", "Rename one Company Explorer folder.", map[string]any{"folder_id": id, "name": text}),
		assistantFunction("move_folder", "Move one Company Explorer folder through the canonical command, synchronizing Process Map. parent_folder_id null means company root.", map[string]any{"folder_id": id, "parent_folder_id": optionalID}),
		assistantFunction("delete_folder", "Delete a Company Explorer folder using Mango's normal target-deletion rules. The user must explicitly supply their display name as confirmation; never infer it from get_me.", map[string]any{"folder_id": id, "confirmation_display_name": text}),
		assistantFunction("list_attachments", "List actual stored attachments on a resource.", map[string]any{"resource_type": attachmentResource, "resource_id": id}),
		assistantFunction("create_attachment_upload", "Prepare Mango's existing direct byte upload. This does NOT upload a file. Supply a real file's exact size and lowercase SHA-256. A client must upload actual bytes using the returned upload descriptor before completion; this chat has no file-byte upload tool. Never claim preparation uploaded a file.", map[string]any{"resource_type": attachmentResource, "resource_id": id, "filename": text, "size_bytes": map[string]any{"type": "integer", "minimum": 0}, "sha256": map[string]any{"type": "string", "minLength": 64, "maxLength": 64}, "content_type": text}),
		assistantFunction("get_attachment_upload", "Check an upload intent in this selected company. This reads status only; it does not upload file bytes.", map[string]any{"upload_intent_id": id}),
		assistantFunction("complete_attachment_upload", "Complete an existing upload only after a client uploaded the actual bytes. Mango verifies stored size/checksum before marking it completed. Never retry an uncertain completion.", map[string]any{"upload_intent_id": id}),
		assistantFunction("link_attachment", "Link an already stored, readable attachment to a resource using the existing file_attachment relationship.", map[string]any{"resource_type": attachmentResource, "resource_id": id, "attachment_id": id}),
	}
}

func assistantFunction(name, description string, properties map[string]any) assistantFunctionTool {
	required := make([]string, 0, len(properties))
	for key := range properties {
		required = append(required, key)
	}
	sort.Strings(required)
	return assistantFunctionTool{
		Type: "function", Name: name, Description: description, Strict: true,
		Parameters: map[string]any{"type": "object", "properties": properties, "required": required, "additionalProperties": false},
	}
}

// Validate inputs against the exact schema sent to the model.
// The ordinary handler remains responsible for all business validation.
func assistantToolArguments(name, arguments string) (map[string]any, error) {
	return assistantArgumentsForTools(assistantTools(), name, arguments)
}

func assistantArgumentsForTools(tools []assistantFunctionTool, name, arguments string) (map[string]any, error) {
	if len(arguments) > 32<<10 {
		return nil, errors.New("Mango tool arguments are too large.")
	}
	var properties map[string]any
	for _, tool := range tools {
		if tool.Name == name {
			properties = tool.Parameters["properties"].(map[string]any)
			break
		}
	}
	if properties == nil {
		return nil, errors.New("Unknown Mango tool.")
	}
	var args map[string]any
	if json.Unmarshal([]byte(arguments), &args) != nil || args == nil || len(args) != len(properties) {
		return nil, errors.New("Invalid Mango tool arguments.")
	}
	for key, value := range args {
		raw, exists := properties[key]
		if !exists {
			return nil, errors.New("Unknown Mango tool argument.")
		}
		property := raw.(map[string]any)
		kind, scalar := property["type"].(string)
		if !scalar {
			if value == nil {
				delete(args, key)
				continue
			}
			kind = property["type"].([]string)[0]
		}
		valid := false
		switch kind {
		case "array":
			if values, ok := value.([]any); ok {
				valid = len(values) <= property["maxItems"].(int)
				seen := make(map[string]bool, len(values))
				for _, value := range values {
					id, ok := value.(string)
					if !ok || !isCanonicalUUID(id) || seen[id] {
						valid = false
					}
					seen[id] = true
				}
			}
		case "string":
			if str, ok := value.(string); ok {
				valid = true
				if min, ok := property["minLength"].(int); ok && len(strings.TrimSpace(str)) < min {
					valid = false
				}
				if max, ok := property["maxLength"].(int); ok && len(str) > max {
					valid = false
				}
				if property["format"] == "uuid" && !isCanonicalUUID(str) {
					valid = false
				}
				if choices, ok := property["enum"].([]string); ok {
					valid = false
					for _, choice := range choices {
						valid = valid || str == choice
					}
				}
			}
		case "integer":
			if number, ok := value.(float64); ok && math.Trunc(number) == number && number <= 1<<53 {
				valid = true
				if min, ok := property["minimum"].(int); ok && number < float64(min) {
					valid = false
				}
				if max, ok := property["maximum"].(int); ok && number > float64(max) {
					valid = false
				}
			}
		}
		if !valid {
			return nil, errors.New("Invalid Mango tool argument value.")
		}
	}
	return args, nil
}

func (s *Server) dispatchAssistantTool(r *http.Request, name, arguments string) (string, error) {
	args, err := assistantToolArguments(name, arguments)
	if err != nil {
		return "", err
	}
	return s.dispatchAssistantOperation(r, name, args)
}

// Call only after validating the selected tool's arguments. Process execution
// supplies its own tracked resource IDs, never IDs chosen by the model.
func (s *Server) dispatchAssistantOperation(r *http.Request, name string, args map[string]any) (string, error) {
	if err := r.Context().Err(); err != nil {
		return "", errors.New("Mango request stopped before the action began.")
	}
	actor, ok := authenticatedActor(r)
	if !ok || actor.User.UserID == "" || !isCanonicalUUID(actor.CompanyID) {
		return "", errors.New("Sign in and select a company before using Mango chat.")
	}
	companyID := actor.CompanyID
	role, err := s.currentActorRoleForCompanyContext(r.Context(), actor, companyID)
	if err != nil || role == "" {
		return "", errors.New("Your company access could not be verified. The action was stopped.")
	}
	// Upload-intent lookup otherwise searches every membership. Narrow the
	// cloned actor to this request's company without changing its identity.
	actor.Memberships = []domain.CompanyMembership{{CompanyID: companyID, UserID: actor.User.UserID, Role: role}}
	actor.CompanyRole, actor.IsDevAdmin = role, role == domain.RoleDevAdmin
	call := r.Clone(context.WithValue(r.Context(), actorContextKey{}, actor))
	call.Header = make(http.Header)
	call.Header.Set("Content-Type", "application/json")
	call.Header.Set(attachmentCompanyContextHeader, companyID)
	operationID := store.NewUUIDv7String()
	call.Header.Set("Idempotency-Key", operationID)
	query := url.Values{"company_id": []string{companyID}}
	body := map[string]any{"company_id": companyID}
	for key, value := range args {
		body[key] = value
	}
	str := func(key string) string { value, _ := args[key].(string); return value }
	method, path := http.MethodGet, ""
	var handler http.HandlerFunc
	var textboxID string
	switch name {
	case "get_me":
		path, handler = "/v1/me", s.handleMe
	case "list_chat_users":
		path, handler = "/v1/companies/"+companyID+"/users", s.handleCompanySubresource
		query.Set("mentionable", "true")
		query.Set("q", str("query"))
	case "send_node_chat":
		information, err := s.assistantNodeChatInformation(call, args)
		if err != nil {
			return "", err
		}
		method, path, handler = http.MethodPost, "/v1/nodes/"+str("node_id")+"/information", s.handleNodeSubresource
		body = map[string]any{"company_id": companyID, "information_id": operationID, "type": "Text block chat", "information": information}
	case "list_my_processes":
		path, handler = "/v1/logic-gates", s.handleLogicGates
		query.Set("assigned_to_me", "true")
	case "list_processes":
		path, handler = "/v1/logic-gates", s.handleLogicGates
		query.Set("limit", "50")
		query.Set("q", str("query"))
	case "get_process", "update_process", "delete_process":
		path, handler = "/v1/logic-gates/"+str("process_id"), s.handleLogicGateSubresource
		if name == "update_process" {
			method, body = http.MethodPut, map[string]any{"company_id": companyID, "header": str("name")}
		} else if name == "delete_process" {
			method = http.MethodDelete
			call.Header.Set(confirmationDisplayNameHeader, str("confirmation_display_name"))
		}
	case "get_process_nodes":
		path, handler = "/v2/logic-gates/"+str("process_id")+"/work", s.handleLogicGateWorkV2Subresource
	case "create_process":
		method, path, handler = http.MethodPost, "/v1/logic-gates", s.handleLogicGates
		body = map[string]any{"company_id": companyID, "header": str("name")}
	case "get_node", "update_node", "delete_node":
		path, handler = "/v1/nodes/"+str("node_id"), s.handleNodeSubresource
		delete(body, "node_id")
		if name == "update_node" {
			method = http.MethodPut
		} else if name == "delete_node" {
			method = http.MethodDelete
			call.Header.Set(confirmationDisplayNameHeader, str("confirmation_display_name"))
		} else {
			path, handler = "/v2/nodes/"+str("node_id")+"/view", s.handleNodeViewV2Subresource
		}
	case "create_node":
		method, path, handler = http.MethodPost, "/v1/nodes", s.handleNodes
	case "move_node_to_process":
		method, path, handler = http.MethodPost, "/v2/logic-gates/"+str("process_id")+"/nodes", s.handleLogicGateWorkV2Subresource
		delete(body, "process_id")
	case "create_process_node":
		method, path, handler = http.MethodPost, "/v2/logic-gates/"+str("process_id")+"/nodes", s.handleLogicGateWorkV2Subresource
		body = map[string]any{"company_id": companyID, "create_node_title": str("name"), "process_step_id": str("process_step_id"), "status": "In Progress"}
	case "move_process_node_to_step":
		method, path, handler = http.MethodPut, "/v2/logic-gates/"+str("process_id")+"/nodes/"+str("node_id")+"/state", s.handleLogicGateWorkV2Subresource
		body = map[string]any{"company_id": companyID, "process_step_id": str("process_step_id")}
	case "get_textbox", "save_textbox", "delete_textbox":
		textboxID = str("textbox_id")
		if name == "save_textbox" && textboxID == "" {
			if args["base_revision"] != float64(0) {
				return "", errors.New("A new textbox must use base revision zero.")
			}
			textboxID = store.NewUUIDv7String()
		}
		if textboxID == "." || textboxID == ".." || strings.ContainsAny(textboxID, "/\\?#%") {
			return "", errors.New("Invalid textbox ID.")
		}
		path, handler = editorJSONRoutePrefix+str("resource_type")+"/"+str("resource_id")+"/documents/"+textboxID, s.handleEditorJSON
		body = map[string]any{"operation_id": operationID, "client_id": "mango-assistant", "base_revision": args["base_revision"]}
		if name == "save_textbox" {
			method = http.MethodPost
			paragraphs := make([]any, 0)
			for _, line := range strings.Split(strings.ReplaceAll(str("plain_text"), "\r\n", "\n"), "\n") {
				paragraph := map[string]any{"type": "paragraph"}
				if line != "" {
					paragraph["content"] = []any{map[string]any{"type": "text", "text": line}}
				}
				paragraphs = append(paragraphs, paragraph)
			}
			body["schema_version"] = store.MangoTiptapSchemaVersion
			body["document"] = map[string]any{"format": store.MangoTiptapFormat, "schema_version": store.MangoTiptapSchemaVersion, "document": map[string]any{"type": "doc", "content": paragraphs}}
			body["annotations"] = []any{}
		} else if name == "delete_textbox" {
			method = http.MethodDelete
		}
	case "list_explorer":
		path, handler = "/v1/company-explorer/children", s.handleCompanyExplorerChildren
		parent := str("parent_folder_id")
		if parent == "" {
			parent = companyID
		}
		query.Set("parent_id", parent)
		if str("query") != "" {
			path, handler = "/v1/company-explorer/search", s.handleCompanyExplorerSearch
			query.Set("q", str("query"))
			query.Set("resource_types", store.CompanyExplorerV2EntityFolder+","+store.EntityTypeLogicGate)
			query.Set("limit", "50")
		}
	case "create_folder":
		method, path, handler = http.MethodPost, "/v1/company-explorer/folders", s.handleCompanyExplorerFolders
	case "rename_folder", "move_folder":
		method, path, handler = http.MethodPut, "/v1/company-explorer/folders/"+str("folder_id"), s.handleCompanyExplorerFolderByID
		delete(body, "folder_id")
		if name == "move_folder" {
			body["parent_folder_id"] = str("parent_folder_id")
		}
	case "delete_folder":
		method, path, handler = http.MethodPost, "/v1/company-explorer/delete-targets", s.handleCompanyExplorerDeleteTargets
		body = map[string]any{"company_id": companyID, "confirmation_display_name": str("confirmation_display_name"), "targets": []any{map[string]any{"kind": "folder", "id": str("folder_id")}}}
	case "list_attachments", "link_attachment":
		path, handler = "/v1/resources/"+str("resource_type")+"/"+str("resource_id")+"/attachments", s.handleResourceSubresource
		if name == "link_attachment" {
			method = http.MethodPost
			body = map[string]any{"company_id": companyID, "attachment_id": str("attachment_id"), "relationship_kind": "file_attachment"}
		}
	case "create_attachment_upload":
		method, path, handler = http.MethodPost, "/v1/attachments/upload-intents", s.handleAttachmentByID
		body = map[string]any{"clientRequestId": operationID, "filename": str("filename"), "sizeBytes": args["size_bytes"], "sha256": str("sha256"), "contentType": str("content_type"), "resourceType": str("resource_type"), "resourceId": str("resource_id"), "relationshipKind": "file_attachment", "sourceKind": "user_upload"}
	case "get_attachment_upload", "complete_attachment_upload":
		path, handler = "/v1/attachments/upload-intents/"+str("upload_intent_id"), s.handleAttachmentByID
		if name == "complete_attachment_upload" {
			method, path = http.MethodPost, path+"/complete"
		}
	default:
		return "", errors.New("Unknown Mango tool.")
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return "", errors.New("Invalid Mango tool request.")
	}
	call.Method, call.URL = method, &url.URL{Path: path, RawQuery: query.Encode()}
	call.RequestURI = call.URL.RequestURI()
	call.Body, call.ContentLength = io.NopCloser(bytes.NewReader(encoded)), int64(len(encoded))
	result := &assistantToolResponse{header: make(http.Header)}
	if !s.authorizeCompanyRequest(result, call, actor, companyID, role) {
		return "", errors.New("Company access denied.")
	}
	if err := r.Context().Err(); err != nil {
		return "", errors.New("Mango request stopped before the action began.")
	}
	handler(result, call)
	recordAssistantOperationSource(r, name, method, call.RequestURI, args, result.body.Bytes())
	if result.status < 200 || result.status >= 300 {
		// Even a failed response may follow a committed write. Stop the whole
		// request instead of giving the model a reason to redispatch it.
		message := "Mango could not confirm that the action completed."
		switch result.status {
		case http.StatusForbidden, http.StatusNotFound:
			message = "Mango could not access that resource or verify the required confirmation."
		case http.StatusConflict:
			message = "The action conflicted with Mango's current saved state."
		}
		return "", errors.New(message + " Check Mango before trying again; changes may already be saved.")
	}
	if result.overflow {
		return "", errors.New("Mango returned more data than chat can read. The action may have completed; check Mango before trying again.")
	}
	// Keep a confirmed response even when Stop arrived during the handler. The
	// foreground dispatcher records it and checks cancellation before any next call.
	output := result.body.Bytes()
	if !json.Valid(output) {
		return "", errors.New("Mango returned an unreadable result. The action may have completed; check Mango before trying again.")
	}
	if name == "save_textbox" {
		output, _ = json.Marshal(map[string]any{"textbox_id": textboxID, "result": json.RawMessage(output)})
	}
	return string(output), nil
}

// Bound captured handler output before it can enter a model continuation.
type assistantToolResponse struct {
	header   http.Header
	status   int
	body     bytes.Buffer
	overflow bool
}

func (w *assistantToolResponse) Header() http.Header { return w.header }
func (w *assistantToolResponse) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
}
func (w *assistantToolResponse) Write(p []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	remaining := assistantToolResultLimit - w.body.Len()
	if len(p) > remaining {
		w.overflow = true
		_, _ = w.body.Write(p[:remaining])
	} else {
		_, _ = w.body.Write(p)
	}
	return len(p), nil
}
