package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/openai/openai-go/v3/responses"
)

func assistantBindingTools() []responses.ToolUnionParam {
	return []responses.ToolUnionParam{
		assistantFunction("bind_process", "Bind one exact Process found through Mango's permission-filtered search/read tools for this interaction. Returns its live SOP, Steps, and connections, then limits available Mango tools to this Process. Binding only reads context and never authorizes execution. Ask the user when the target is ambiguous.", map[string]any{"process_id": map[string]any{"type": "string", "format": "uuid"}}),
	}
}

// Both the picker and model discovery use the same fresh authorized definition.
// The foreground dispatcher permits one binding and owns any later Node identity.
func (s *Server) bindAssistantProcess(r *http.Request, processID string, emit func(assistantEvent) error) (*assistantProcessExecution, error) {
	if !isCanonicalUUID(processID) {
		return nil, errors.New("Choose an exact saved Process before continuing.")
	}
	definition, _, err := s.readAssistantProcess(r, processID, "")
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(definition)
	if err != nil || len(encoded) > assistantToolResultLimit {
		return nil, errors.New("This Process's SOP and Steps are too large for this chat request. Nothing was started.")
	}
	if err := r.Context().Err(); err != nil {
		return nil, err
	}
	if err := emit(assistantEvent{Type: "process", ProcessID: definition.Process.LogicGateID, Name: definition.Process.Header}); err != nil {
		return nil, err
	}
	return &assistantProcessExecution{definition: definition, definitionJSON: string(encoded)}, nil
}
