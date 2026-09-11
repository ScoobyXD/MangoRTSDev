package store

import (
	"context"
	"encoding/json"
	"time"
)

// IDs are the exact OpenAI session, turn and call IDs, never Mango resource IDs.
type AIAgentSession struct {
	ID                string          `json:"id"`
	CompanyID         string          `json:"-"`
	UserID            string          `json:"-"`
	Prompt            string          `json:"prompt"`
	Instructions      string          `json:"instructions"`
	Skills            json.RawMessage `json:"skills"`
	Stopped           bool            `json:"stopped"`
	AwaitingTurnAfter string          `json:"-"`
	CreatedAt         time.Time       `json:"created_at"`
}

type AIAgentAction struct {
	SessionID     string          `json:"-"`
	TurnID        string          `json:"turn_id"`
	CallID        string          `json:"call_id"`
	Name          string          `json:"name"`
	Arguments     json.RawMessage `json:"arguments"`
	State         string          `json:"state"`
	Output        json.RawMessage `json:"output,omitempty"`
	Error         string          `json:"error,omitempty"`
	Consequential bool            `json:"consequential"`
}

type AIAgentRepository interface {
	CreateAIAgentSession(context.Context, AIAgentSession) error
	ListAIAgentSessions(context.Context, string, string) ([]AIAgentSession, error)
	GetAIAgentSession(context.Context, string, string, string) (AIAgentSession, error)
	StopAIAgentSession(context.Context, string, string, string) error
	AwaitAIAgentTurn(context.Context, string, string, string, string) error
	DeleteAIAgentSession(context.Context, string, string, string) error
	PutAIAgentAction(context.Context, string, string, AIAgentAction) error
	ListAIAgentActions(context.Context, string, string, string) ([]AIAgentAction, error)
	GetAIAgentAction(context.Context, string, string, string, string, string) (AIAgentAction, error)
	ClaimAIAgentAction(context.Context, string, string, string, string, string) (bool, error)
	FinishAIAgentAction(context.Context, string, string, AIAgentAction) error
}
