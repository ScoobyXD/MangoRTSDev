package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"

	"github.com/openai/openai-go/v3/responses"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

type assistantProcessStep struct {
	ID       string `json:"process_step_id"`
	Name     string `json:"name"`
	Position int    `json:"position"`
}

type assistantProcessSOP struct {
	TextboxID string          `json:"textbox_id"`
	Revision  int64           `json:"revision"`
	Document  json.RawMessage `json:"document"`
}

// This is the current request's input, not a new persisted Process or Run model.
// It deliberately contains no geometry, unrelated Nodes, or credentials.
type assistantProcessDefinition struct {
	User                   map[string]string                        `json:"user"`
	Process                domain.LogicGateWorkHeader               `json:"process"`
	Steps                  []assistantProcessStep                   `json:"steps"`
	Relationships          []domain.ResourceOperationalRelationship `json:"relationships"`
	SOP                    []assistantProcessSOP                    `json:"sop"`
	ExecutionBlockedReason string                                   `json:"execution_blocked_reason,omitempty"`
}

type assistantProcessExecution struct {
	definition        assistantProcessDefinition
	definitionJSON    string
	nodeID            string
	stepID            string
	status            string
	assignmentVersion int64
}

type assistantExpectedNodeWorkKey struct{}

// A successful save remains confirmed even if Stop prevents its canonical read.
// The bridge retains this result independently and never retries the write.
type assistantSavedResultError struct {
	error
	Result json.RawMessage
}

func assistantExpectedNodeWork(r *http.Request) *store.NodeWorkPrecondition {
	expected, _ := r.Context().Value(assistantExpectedNodeWorkKey{}).(*store.NodeWorkPrecondition)
	return expected
}

func assistantProcessTools() []responses.ToolUnionParam {
	stepID := map[string]any{"type": "string", "format": "uuid"}
	return []responses.ToolUnionParam{
		assistantFunction("create_process_node", "Create the one Node for this request in the selected Process and starting Step. Call once. Returns the saved Node identity and Step.", map[string]any{"name": map[string]any{"type": "string", "minLength": 1, "maxLength": 240}, "process_step_id": stepID}),
		assistantFunction("write_process_node", "Add a new text box with the work for the current Step to this request's Node. Existing text is preserved. Returns the actual saved document.", map[string]any{"plain_text": map[string]any{"type": "string", "minLength": 1, "maxLength": 16000}}),
		assistantFunction("move_process_node_to_step", "Move this request's Node to another supplied Step of the selected Process after doing the current work. Preserve Node status.", map[string]any{"process_step_id": stepID}),
	}
}

func (s *Server) readAssistantProcess(r *http.Request, processID, nodeID string) (assistantProcessDefinition, *domain.LogicGateWorkNode, error) {
	var definition assistantProcessDefinition
	actor, ok := authenticatedActor(r)
	if !ok || actor.User.UserID == "" || !isCanonicalUUID(actor.CompanyID) || r.Context().Err() != nil {
		return definition, nil, errors.New("The Process request stopped. Sign in and select your company before trying again.")
	}
	role, err := s.currentActorRoleForCompanyContext(r.Context(), actor, actor.CompanyID)
	if err != nil || role == "" {
		return definition, nil, errors.New("Your current company access could not be verified. The Process request stopped.")
	}
	actor.Memberships = []domain.CompanyMembership{{CompanyID: actor.CompanyID, UserID: actor.User.UserID, Role: role}}
	actor.CompanyRole, actor.IsDevAdmin = role, role == domain.RoleDevAdmin
	r = r.Clone(context.WithValue(r.Context(), actorContextKey{}, actor))
	access := &assistantToolResponse{header: make(http.Header)}
	if _, _, ok := s.requireLogicGateWorkReadAccess(access, r, actor.CompanyID, processID); !ok {
		return definition, nil, errors.New("Mango could not access the selected Process for this request.")
	}
	work, err := s.repo.GetLogicGateWork(actor.CompanyID, processID, actor.User.UserID)
	if err != nil {
		return definition, nil, errors.New("Mango could not read the selected Process and its Steps.")
	}
	definition.User = assistantUserContext(actor, role)
	definition.Steps = []assistantProcessStep{}
	definition.SOP = []assistantProcessSOP{}
	definition.Process = work.LogicGate
	definition.Relationships = work.Relationships
	for _, step := range work.Steps {
		definition.Steps = append(definition.Steps, assistantProcessStep{ID: step.ProcessStepID, Name: step.Name, Position: step.Position})
	}
	sort.Slice(definition.Steps, func(i, j int) bool {
		if definition.Steps[i].Position != definition.Steps[j].Position {
			return definition.Steps[i].Position < definition.Steps[j].Position
		}
		return definition.Steps[i].ID < definition.Steps[j].ID
	})
	projections, err := s.repo.ListLogicGateProjections(actor.CompanyID, processID)
	if err != nil {
		return definition, nil, errors.New("Mango could not read the selected Process's SOP.")
	}
	for _, projection := range projections {
		if !strings.EqualFold(projection.Type, "Text box") {
			continue
		}
		arguments, _ := json.Marshal(map[string]any{"resource_type": "logic_gate", "resource_id": processID, "textbox_id": projection.InformationID})
		result, err := s.dispatchAssistantTool(r, "get_textbox", string(arguments))
		if err != nil {
			return definition, nil, err
		}
		var snapshot store.EditorJSONSnapshot
		if json.Unmarshal([]byte(result), &snapshot) != nil {
			return definition, nil, errors.New("Mango could not read the selected Process's SOP.")
		}
		if snapshot.Deleted || snapshot.Revision == 0 {
			continue
		}
		definition.SOP = append(definition.SOP, assistantProcessSOP{TextboxID: projection.InformationID, Revision: snapshot.Revision, Document: snapshot.JSONDocument})
	}
	if len(definition.SOP) == 0 {
		definition.ExecutionBlockedReason = "Write the Process's SOP before asking Mango to carry it out."
	}
	if len(definition.Steps) == 0 {
		definition.ExecutionBlockedReason = "Add Steps to this Process before asking Mango to carry it out."
	}
	var currentNode *domain.LogicGateWorkNode
	for i := range work.Nodes {
		if work.Nodes[i].NodeID == nodeID {
			currentNode = &work.Nodes[i]
			break
		}
	}
	return definition, currentNode, nil
}

func (s *Server) dispatchAssistantProcessTool(r *http.Request, execution *assistantProcessExecution, name, arguments string, emit func(assistantEvent) error) (string, error) {
	args, err := assistantArgumentsForTools(assistantProcessTools(), name, arguments)
	if err != nil {
		return "", err
	}
	processID := execution.definition.Process.LogicGateID
	current, node, err := s.readAssistantProcess(r, processID, execution.nodeID)
	if err != nil {
		return "", err
	}
	if current.ExecutionBlockedReason != "" {
		return "", errors.New(current.ExecutionBlockedReason)
	}
	encoded, err := json.Marshal(current)
	if err != nil || string(encoded) != execution.definitionJSON {
		return "", errors.New("The Process's SOP or Steps changed during this request. Work stopped; review the saved Node before starting again.")
	}
	if execution.nodeID != "" && (node == nil || node.ProcessStepID == nil || *node.ProcessStepID != execution.stepID || node.Status != execution.status) {
		return "", errors.New("The Node was moved, changed, or is no longer accessible. Work stopped without moving it back.")
	}
	stepID, _ := args["process_step_id"].(string)
	if stepID != "" {
		found := false
		for _, step := range current.Steps {
			found = found || step.ID == stepID
		}
		if !found {
			return "", errors.New("That Step is not part of the selected Process. Work stopped.")
		}
	}
	if name == "create_process_node" {
		if execution.nodeID != "" {
			return "", errors.New("This request already created its Node. A second Node was not created.")
		}
	} else if execution.nodeID == "" {
		return "", errors.New("Create this request's Node before writing or moving it.")
	}
	if execution.nodeID != "" {
		expected := &store.NodeWorkPrecondition{LogicGateID: processID, ProcessStepID: execution.stepID, Status: execution.status, AssignmentVersion: execution.assignmentVersion}
		r = r.Clone(context.WithValue(r.Context(), assistantExpectedNodeWorkKey{}, expected))
	}
	if name == "write_process_node" {
		// A fresh text box cannot overwrite a person's edits or remove their rich content.
		saveArgs, _ := json.Marshal(map[string]any{"resource_type": "node", "resource_id": execution.nodeID, "textbox_id": nil, "base_revision": 0, "plain_text": args["plain_text"]})
		result, err := s.dispatchAssistantTool(r, "save_textbox", string(saveArgs))
		if err != nil {
			return "", err
		}
		var saved struct {
			TextboxID string `json:"textbox_id"`
		}
		if json.Unmarshal([]byte(result), &saved) != nil || saved.TextboxID == "" {
			return "", &assistantSavedResultError{error: errors.New("The saved text could not be read. Check the Node before trying again."), Result: json.RawMessage(result)}
		}
		readArgs, _ := json.Marshal(map[string]any{"resource_type": "node", "resource_id": execution.nodeID, "textbox_id": saved.TextboxID})
		document, err := s.dispatchAssistantTool(r, "get_textbox", string(readArgs))
		if err != nil {
			return "", &assistantSavedResultError{error: err, Result: json.RawMessage(result)}
		}
		return document, nil
	}
	args["process_id"] = processID
	if execution.nodeID != "" {
		args["node_id"] = execution.nodeID
	}
	result, err := s.dispatchAssistantOperation(r, name, args)
	if err != nil {
		return "", err
	}
	var saved struct {
		Node struct {
			NodeID string `json:"node_id"`
			Status string `json:"status"`
		} `json:"node"`
		Assignment struct {
			LogicGateID string  `json:"logic_gate_id"`
			StepID      *string `json:"process_step_id"`
			Version     int64   `json:"version"`
		} `json:"assignment"`
	}
	if json.Unmarshal([]byte(result), &saved) != nil || !isCanonicalUUID(saved.Node.NodeID) || saved.Assignment.Version < 1 || saved.Assignment.LogicGateID != processID || saved.Assignment.StepID == nil || *saved.Assignment.StepID != stepID || (execution.nodeID != "" && saved.Node.NodeID != execution.nodeID) {
		return "", errors.New("Mango could not confirm the saved Node placement. Check the Process before trying again.")
	}
	execution.nodeID, execution.stepID, execution.status = saved.Node.NodeID, stepID, saved.Node.Status
	execution.assignmentVersion = saved.Assignment.Version
	if name == "create_process_node" {
		if err := emit(assistantEvent{Type: "node", NodeID: execution.nodeID, ProcessID: processID}); err != nil {
			return "", err
		}
	}
	return result, nil
}
