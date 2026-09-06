package httpapi

import (
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"

	"miraeopus/backend/internal/store"
)

// Source descriptions accompany inspection events only. They are neither model
// instructions nor a second resource identity or permission system.
type assistantInputSource struct {
	Kind           string            `json:"kind"`
	Label          string            `json:"label"`
	Delivery       string            `json:"delivery"`
	Path           string            `json:"path,omitempty"`
	Symbol         string            `json:"symbol,omitempty"`
	Table          string            `json:"table,omitempty"`
	Columns        []string          `json:"columns,omitempty"`
	Key            map[string]string `json:"key,omitempty"`
	Revision       int64             `json:"revision,omitempty"`
	Route          string            `json:"route,omitempty"`
	Note           string            `json:"note,omitempty"`
	DeployRevision string            `json:"deploy_revision,omitempty"`
}

type assistantOperationSourcesKey struct{}

func assistantContextSources(actor ActorContext, process *assistantProcessExecution) []assistantInputSource {
	sources := []assistantInputSource{
		{Kind: "file", Label: "Current context assembly", Delivery: "context message", Path: "backend/internal/http/assistant_pi.go", Symbol: "runAssistant", DeployRevision: os.Getenv("MANGORTS_DEPLOY_REVISION")},
		{Kind: "database", Label: "Authenticated user profile", Delivery: "context message", Path: "backend/internal/store/postgres_auth.go", Symbol: "GetAuthUserContext / ResolveAuthUserContext", Table: "public.users", Columns: []string{"user_id", "display_name", "email"}, Key: map[string]string{"user_id": actor.User.UserID}, Note: "Selected fields from the authenticated actor; may be served by the bounded auth cache. Local in-memory mode uses the same repository contract without PostgreSQL."},
		{Kind: "database", Label: "Current effective company role", Delivery: "context message", Path: "backend/internal/http/auth_middleware.go", Symbol: "currentActorRoleForCompanyContext", Table: "public.company_memberships", Columns: []string{"user_id", "company_id", "role"}, Key: map[string]string{"user_id": actor.User.UserID}, Note: "Current role is derived for selected company " + actor.CompanyID + "; global developer access may come from another company membership. This is not a claim that one selected-company membership row supplied the role."},
		{Kind: "request", Label: "Selected company", Delivery: "context message", Path: "frontend/src/modules/assistant/assistantApi.ts", Symbol: "streamAssistantChat", Key: map[string]string{"company_id": actor.CompanyID}, Route: "POST /v1/assistant/chat?company_id=" + actor.CompanyID, Note: "Query-scoped company is verified by backend authorization."},
		{Kind: "request", Label: "Current message and prior conversation", Delivery: "current user message and prior history", Path: "frontend/src/app/AppAssistant.tsx", Symbol: "AppAssistant", Note: "The browser sends messages from its current conversation state. This request does not retrieve prior chat history, saved memories, or ai_runs from the database."},
		{Kind: "file", Label: "Configured model", Delivery: "provider configuration", Path: "backend/cmd/miraeopus-api/assistant_config.go", Symbol: "buildAssistantConfigFromEnvironment", Note: "MANGORTS_ASSISTANT_MODEL supplies the configured model; the exact effective model is captured in runtime and provider_request. Credentials are never source content."},
		{Kind: "request", Label: "Requested reasoning effort", Delivery: "provider configuration", Path: "frontend/src/app/AppAssistant.tsx", Symbol: "loadReasoningEffort / saveReasoningEffort", Note: "localStorage key mangorts.assistant.reasoningEffort.v1, otherwise ASSISTANT_DEFAULT_REASONING_EFFORT (medium) from assistantApi.ts. streamAssistantChat sends reasoning_effort; runtime captures requested and effective effort."},
		{Kind: "file", Label: "Foreground execution limits", Delivery: "provider configuration and execution controls", Path: "backend/internal/http/assistant.go", Symbol: "assistantTimeout / assistantMaxSteps / assistantMaxOutputBytes", Note: "Server supplies tool/response/output limits to runAssistant; ai/runtime/runtime.mjs LIMITS/settings and streamFunction set matching controls including max_output_tokens=4096, no retries, and no compaction. These are code settings, not user memories."},
	}
	if process != nil {
		sources = append(sources, assistantProcessSources(actor.CompanyID, process)...)
	}
	return sources
}

func assistantProcessSources(companyID string, process *assistantProcessExecution) []assistantInputSource {
	definition := process.definition
	processID := definition.Process.LogicGateID
	sources := []assistantInputSource{
		{Kind: "database", Label: "Selected Process identity and name", Delivery: "context message or bind_process tool output", Path: "backend/internal/store/postgres_logic_gate_work.go", Symbol: "GetLogicGateWork", Table: "public.logic_gates", Columns: []string{"company_id", "logic_gate_id", "header"}, Key: map[string]string{"company_id": companyID, "logic_gate_id": processID}},
		{Kind: "database", Label: "Process effective default access", Delivery: "context message or bind_process tool output", Path: "backend/internal/store/postgres_logic_gate_work.go", Symbol: "GetLogicGateWork", Table: "public.resource_permission_settings", Columns: []string{"default_access"}, Note: "Derived through mangorts_v2_resolve_permission_policy for the exact Process; the resolved policy-owner row is not included in this capture."},
		{Kind: "file", Label: "Process context selection", Delivery: "context message or bind_process tool output", Path: "backend/internal/http/assistant_process.go", Symbol: "readAssistantProcess", Note: "Includes Process header/default access, Step IDs/names/order, directed connections, and live Process textboxes. Step body_json/revision, map geometry, and unrelated Nodes are not included in this model context."},
	}
	for _, step := range definition.Steps {
		sources = append(sources, assistantInputSource{Kind: "database", Label: "Process Step metadata", Delivery: "context message or bind_process tool output", Path: "backend/internal/store/postgres_logic_gate_work.go", Symbol: "GetLogicGateWork", Table: "public.process_steps", Columns: []string{"process_step_id", "logic_gate_id", "name", "position"}, Key: map[string]string{"company_id": companyID, "process_step_id": step.ID, "logic_gate_id": processID}})
	}
	for _, relationship := range definition.Relationships {
		sources = append(sources, assistantInputSource{Kind: "database", Label: "Directed Step connection", Delivery: "context message or bind_process tool output", Path: "backend/internal/store/postgres_logic_gate_work.go", Symbol: "GetLogicGateWork", Table: "public.resource_operational_relationships", Columns: []string{"resource_operational_relationship_id", "source_resource_type", "source_resource_id", "target_resource_type", "target_resource_id", "created_timestamp"}, Key: map[string]string{"company_id": companyID, "resource_operational_relationship_id": relationship.ResourceOperationalRelationshipID}})
	}
	for _, sop := range definition.SOP {
		sources = append(sources, assistantInputSource{Kind: "database", Label: "Process SOP document", Delivery: "context message or bind_process tool output", Path: "backend/internal/store/postgres_editor_textboxes.go", Symbol: "getPostgresEditorTextboxSnapshot", Table: "public.logic_gate_textboxes", Columns: []string{"body_json", "revision", "deleted_timestamp"}, Key: map[string]string{"company_id": companyID, "logic_gate_id": processID, "textbox_id": sop.TextboxID}, Revision: sop.Revision, Note: "body_json is decoded into the canonical document; only the document and its revision are included in the Process SOP input."})
	}
	return sources
}

func assistantToolSources(process *assistantProcessExecution) []assistantInputSource {
	sources := make([]assistantInputSource, 0)
	for _, tool := range assistantCatalog(process) {
		path, symbol := "backend/internal/http/assistant_tools.go", "assistantTools"
		switch tool.Name {
		case "bind_process":
			path, symbol = "backend/internal/http/assistant_binding.go", "assistantBindingTools"
		case "list_chat_users":
			path, symbol = "backend/internal/http/assistant_node_chat.go", "assistantChatUsersTool"
		case "send_node_chat", "send_process_node_chat":
			path, symbol = "backend/internal/http/assistant_node_chat.go", "assistantNodeChatTool"
		default:
			if process != nil {
				path, symbol = "backend/internal/http/assistant_process.go", "assistantProcessTools"
			}
		}
		sources = append(sources, assistantInputSource{Kind: "file", Label: tool.Name, Delivery: "tool schema", Path: path, Symbol: symbol, Note: "Exact advertised schema is captured in runtime/tools or tool_catalog. Actual handler routes and result IDs are captured when this tool runs."})
	}
	return sources
}

// Observe the route already selected by the real dispatcher, including generated
// IDs and nested canonical reads. Do not maintain a parallel route catalog.
func recordAssistantOperationSource(r *http.Request, name, method, route string, args map[string]any, output []byte) {
	sources, _ := r.Context().Value(assistantOperationSourcesKey{}).(*[]assistantInputSource)
	if sources == nil {
		return
	}
	keys := map[string]string{}
	assistantSourceResultIDs(args, "arguments", keys)
	var result any
	if json.Unmarshal(output, &result) == nil {
		assistantSourceResultIDs(result, "result", keys)
	}
	*sources = append(*sources, assistantInputSource{Kind: "file", Label: name, Delivery: "tool operation", Path: "backend/internal/http/assistant_tools.go", Symbol: "dispatchAssistantOperation", Route: method + " " + route, Key: keys, Note: "Actual authorized handler route. Nested reads may validate work rather than enter the returned tool output. IDs come from exact arguments/results; this is not an exhaustive database-row lineage claim."})
	resourceType, _ := args["resource_type"].(string)
	resourceID, _ := args["resource_id"].(string)
	if (name == "get_textbox" || name == "save_textbox" || name == "delete_textbox") && (resourceType == "node" || resourceType == "logic_gate") {
		actor, _ := authenticatedActor(r)
		path := strings.SplitN(route, "?", 2)[0]
		var snapshot store.EditorJSONSnapshot
		_ = json.Unmarshal(output, &snapshot)
		symbol := "getPostgresEditorTextboxSnapshot"
		if name == "save_textbox" {
			symbol = "commitPostgresEditorTextboxDocument"
		} else if name == "delete_textbox" {
			symbol = "deletePostgresEditorTextboxDocument"
		}
		*sources = append(*sources, assistantInputSource{Kind: "database", Label: "Canonical editor document", Delivery: "tool operation", Path: "backend/internal/store/postgres_editor_textboxes.go", Symbol: symbol, Table: "public." + resourceType + "_textboxes", Columns: []string{"body_json", "revision", "deleted_timestamp", "updated_timestamp"}, Key: map[string]string{"company_id": actor.CompanyID, resourceType + "_id": resourceID, "textbox_id": path[strings.LastIndex(path, "/")+1:]}, Revision: snapshot.Revision, Note: "Known canonical storage mapping; local in-memory mode implements the same editor contract. The parent tool event distinguishes returned output from nested validation reads."})
	}
}

func assistantSourceResultIDs(value any, path string, ids map[string]string) {
	switch value := value.(type) {
	case map[string]any:
		for name, item := range value {
			if id, ok := item.(string); ok && strings.HasSuffix(name, "_id") && id != "" {
				ids[path+"."+name] = id
			}
			switch item.(type) {
			case map[string]any, []any:
				assistantSourceResultIDs(item, path+"."+name, ids)
			}
		}
	case []any:
		for index, item := range value {
			assistantSourceResultIDs(item, path+"["+strconv.Itoa(index)+"]", ids)
		}
	}
}
