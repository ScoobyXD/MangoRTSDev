package httpapi

import (
	"encoding/json"

	"github.com/openai/openai-go/v3/responses"
)

func assistantUserContext(actor ActorContext, role string) map[string]string {
	return map[string]string{"user_id": actor.User.UserID, "display_name": actor.User.DisplayName, "email": actor.User.Email, "company_id": actor.CompanyID, "company_role": role}
}

// Human-readable input is sent once, then only new items are appended for each
// continuation. This is request-local diagnostics, never stored chat history.
type assistantContext struct {
	Step                  int                         `json:"step"`
	Model                 string                      `json:"model,omitempty"`
	ReasoningEffort       string                      `json:"reasoning_effort,omitempty"`
	Instructions          string                      `json:"instructions,omitempty"`
	Tools                 *[]responses.ToolUnionParam `json:"tools,omitempty"`
	Input                 []json.RawMessage           `json:"input"`
	OmittedReasoningItems int                         `json:"omitted_reasoning_items"`
}

func assistantInspectContext(step int, params responses.ResponseNewParams, offset int) (*assistantContext, error) {
	inspection := &assistantContext{Step: step, Input: []json.RawMessage{}}
	if step == 1 {
		inspection.Model = params.Model
		inspection.ReasoningEffort = string(params.Reasoning.Effort)
		inspection.Instructions = params.Instructions.Value
		inspection.Tools = &params.Tools
	}
	for _, item := range params.Input.OfInputItemList[offset:] {
		data, err := json.Marshal(item)
		if err != nil {
			return nil, err
		}
		var kind struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(data, &kind); err != nil {
			return nil, err
		}
		if kind.Type == "reasoning" {
			inspection.OmittedReasoningItems++
			continue
		}
		inspection.Input = append(inspection.Input, data)
	}
	return inspection, nil
}
