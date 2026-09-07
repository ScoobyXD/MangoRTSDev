package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"time"
)

// AssistantRun records submission and action authority. Native replies, memory
// and session storage remain in the separately scoped Hermes home.
type AssistantRun struct {
	CompanyID      string    `json:"company_id"`
	UserID         string    `json:"user_id"`
	RequestID      string    `json:"request_id"`
	ConversationID string    `json:"conversation_id"`
	Message        string    `json:"message,omitempty"`
	RunID          string    `json:"run_id"`
	Cancelled      bool      `json:"cancelled"`
	Settled        bool      `json:"settled"`
	CreatedAt      time.Time `json:"created_at"`
	PayloadHash    string    `json:"-"`
}

type AssistantRepository interface {
	ReserveAssistantRun(context.Context, AssistantRun) (AssistantRun, error)
	GetAssistantRun(context.Context, string, string, string) (AssistantRun, error)
	FindAssistantRun(context.Context, string, string, string) (AssistantRun, error)
	ActiveAssistantRun(context.Context, string, string) (AssistantRun, error)
	BindAssistantRun(context.Context, string, string, string, string) (AssistantRun, error)
	SettleAssistantRun(context.Context, string, string, string) error
	CancelAssistantRun(context.Context, string, string, string) error
	AcquireAssistantStream(context.Context, string, string, string) (func(), error)
	AssistantCreateNode(context.Context, AssistantRun, string, LogicGateNodeAssignmentInput) (LogicGateNodeAssignmentResult, error)
}

func normalizeAssistantRun(input AssistantRun) (AssistantRun, error) {
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.UserID = strings.TrimSpace(input.UserID)
	input.RequestID = strings.TrimSpace(input.RequestID)
	input.ConversationID = strings.TrimSpace(input.ConversationID)
	input.Message = strings.TrimSpace(input.Message)
	if input.CompanyID == "" || input.UserID == "" || input.RequestID == "" || input.Message == "" {
		return AssistantRun{}, ErrInvalid
	}
	encoded, _ := json.Marshal([]string{input.ConversationID, input.Message})
	hash := sha256.Sum256(encoded)
	input.PayloadHash = hex.EncodeToString(hash[:])
	input.RunID, input.Cancelled, input.Settled = "", false, false
	input.CreatedAt = time.Now().UTC()
	return input, nil
}

func assistantNodeInput(run AssistantRun, actionKey string, input LogicGateNodeAssignmentInput) (LogicGateNodeAssignmentInput, error) {
	if run.RunID == "" || strings.TrimSpace(actionKey) == "" || strings.TrimSpace(input.CreateNodeTitle) == "" {
		return LogicGateNodeAssignmentInput{}, ErrInvalid
	}
	input.CompanyID, input.ActorUserID = run.CompanyID, run.UserID
	input.IdempotencyKey = "assistant:" + run.RequestID + ":" + actionKey
	return NormalizeLogicGateNodeAssignmentInput(input)
}

var _ AssistantRepository = (*MemoryRepo)(nil)
var _ AssistantRepository = (*PostgresRepo)(nil)
