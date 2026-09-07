package store

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"math/big"
	"strings"
	"time"

	"miraeopus/backend/internal/domain"
)

type AIChat struct {
	CompanyID string    `json:"company_id"`
	UserID    string    `json:"user_id"`
	ChatID    string    `json:"chat_id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_timestamp"`
}

type AIRun struct {
	CompanyID    string           `json:"company_id"`
	UserID       string           `json:"user_id"`
	RunID        string           `json:"run_id"`
	HermesRunID  string           `json:"hermes_run_id,omitempty"`
	ChatID       string           `json:"chat_id,omitempty"`
	Status       string           `json:"status"`
	PendingInput string           `json:"pending_input,omitempty"`
	History      []AIHistoryEvent `json:"history"`
	CreatedAt    time.Time        `json:"created_timestamp"`
}

type AIMessage struct {
	CompanyID string    `json:"company_id"`
	UserID    string    `json:"user_id"`
	MessageID int64     `json:"message_id"`
	ChatID    string    `json:"chat_id"`
	RunID     string    `json:"run_id,omitempty"`
	Role      string    `json:"role"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_timestamp"`
}

// ID is supplied once by the trusted event producer and reused on retries.
// History order is the order of successful append, not clock order.
type AIHistoryEvent struct {
	ID        string          `json:"id"`
	Type      string          `json:"event"`
	CreatedAt time.Time       `json:"created_timestamp"`
	Data      json.RawMessage `json:"data"`
}

type AIRepository interface {
	ReserveAIRun(context.Context, AIRun) (AIRun, error)
	GetAIRun(context.Context, string, string, string) (AIRun, error)
	FindAIRun(context.Context, string, string, string) (AIRun, error)
	ActiveAIRun(context.Context, string, string) (AIRun, error)
	BindAIRun(context.Context, string, string, string, string) (AIRun, error)
	SetAIRunStatus(context.Context, string, string, string, string) (AIRun, error)
	AppendAIHistoryEvent(context.Context, string, string, string, AIHistoryEvent) (AIRun, error)
	AcquireAIStream(context.Context, string, string, string) (func(), error)
	AICreateNode(context.Context, AIRun, string, LogicGateNodeAssignmentInput) (LogicGateNodeAssignmentResult, error)
	AIUpdateNode(context.Context, AIRun, string, UpdateNodeInput) (AINodeUpdateResult, error)
	AIMoveNode(context.Context, AIRun, string, LogicGateNodeAssignmentMoveInput) (LogicGateNodeAssignmentResult, error)
	AICommitEditor(context.Context, AIRun, string, EditorJSONCommitInput) (EditorJSONCommit, error)
	AICreateEditor(context.Context, AIRun, string, EditorJSONCommitInput) (AIEditorCreateResult, error)
	AICreateNodeChat(context.Context, AIRun, string, AINodeChatCreateInput) (domain.NodeInformation, error)
	AICreateProcess(context.Context, AIRun, string, string, string) (WorkspaceEntityBatchResult, error)
	AIUpdateProcess(context.Context, AIRun, string, string, string) (AIProcessUpdateResult, error)
	AIMoveProcess(context.Context, AIRun, string, string, string) (CompanyExplorerV2Row, error)
	AICreateProcessStep(context.Context, AIRun, string, ProcessStepCreateInput) (ProcessStepMutationResult, error)
	UpsertAIChat(context.Context, AIChat) (AIChat, error)
	GetAIChat(context.Context, string, string, string) (AIChat, error)
	ListAIChats(context.Context, string, string, int, int) ([]AIChat, error)
	ImportAIMessages(context.Context, string, string, []AIMessage) error
	PruneAIMessages(context.Context, string, string, string, []int64) error
	ListAIMessages(context.Context, string, string, string, int, int) ([]AIMessage, error)
}

const aiCreateNodeAction = "mango_create_node"

type aiActionKey struct{ Name, Key string }

func aiScopeKey(companyID, userID, id string) string {
	return companyID + "\x00" + userID + "\x00" + id
}
func aiTime(value time.Time) time.Time { return value.UTC().Truncate(time.Microsecond) }
func aiValidText(value string) bool    { return !strings.ContainsRune(value, '\x00') }
func aiValidPage(limit, offset int) bool {
	return limit > 0 && limit <= 500 && offset >= 0 && offset <= 1000000
}

func normalizeAIRun(input AIRun) (AIRun, error) {
	input.CompanyID, input.UserID, input.RunID = cleanUUIDText(input.CompanyID), cleanUUIDText(input.UserID), cleanUUIDText(input.RunID)
	input.ChatID, input.PendingInput = strings.TrimSpace(input.ChatID), strings.TrimSpace(input.PendingInput)
	if input.CompanyID == "" || input.UserID == "" || input.RunID == "" || input.PendingInput == "" || len(input.PendingInput) > 32000 || !aiValidText(input.ChatID+input.PendingInput) {
		return AIRun{}, ErrInvalid
	}
	input.HermesRunID, input.Status, input.CreatedAt = "", "pending", aiTime(time.Now())
	input.History = []AIHistoryEvent{{ID: "status:pending", Type: "run.pending", CreatedAt: input.CreatedAt, Data: json.RawMessage(`{}`)}}
	return input, nil
}

func AITerminalStatus(status string) bool {
	switch status {
	case "completed", "failed", "cancelled", "interrupted":
		return true
	}
	return false
}

func aiRunStatus(run AIRun, status string) (AIRun, error) {
	if status != "pending" && status != "running" && status != "stopping" && !AITerminalStatus(status) {
		return AIRun{}, ErrInvalid
	}
	if AITerminalStatus(run.Status) || run.Status == status || status == "pending" || (run.Status == "stopping" && status == "running") {
		return run, nil
	}
	if status == "running" && run.HermesRunID == "" {
		return AIRun{}, ErrConflict
	}
	run.Status = status
	if AITerminalStatus(status) {
		run.PendingInput = ""
	}
	return appendAIHistory(run, AIHistoryEvent{ID: "status:" + status, Type: "run." + status, CreatedAt: aiTime(time.Now()), Data: json.RawMessage(`{}`)})
}

func cloneAIRun(run AIRun) AIRun {
	run.History = append([]AIHistoryEvent{}, run.History...)
	for i := range run.History {
		run.History[i].Data = append(json.RawMessage(nil), run.History[i].Data...)
	}
	return run
}

func normalizeAIHistoryEvent(event AIHistoryEvent) (AIHistoryEvent, error) {
	if strings.TrimSpace(event.ID) == "" || strings.TrimSpace(event.Type) == "" || len(event.ID) > 512 || len(event.Type) > 128 || event.CreatedAt.IsZero() || !aiValidText(event.ID+event.Type) {
		return AIHistoryEvent{}, ErrInvalid
	}
	event.CreatedAt = aiTime(event.CreatedAt)
	if len(event.Data) == 0 {
		event.Data = json.RawMessage(`{}`)
	}
	decoder := json.NewDecoder(bytes.NewReader(event.Data))
	decoder.UseNumber()
	var value any
	if !json.Valid(event.Data) || decoder.Decode(&value) != nil {
		return AIHistoryEvent{}, ErrInvalid
	}
	data, err := json.Marshal(value)
	if err != nil {
		return AIHistoryEvent{}, ErrInvalid
	}
	event.Data = data
	return event, nil
}

func appendAIHistory(run AIRun, event AIHistoryEvent) (AIRun, error) {
	event, err := normalizeAIHistoryEvent(event)
	if err != nil {
		return AIRun{}, err
	}
	for _, saved := range run.History {
		if saved.ID != event.ID {
			continue
		}
		saved, err = normalizeAIHistoryEvent(saved)
		if err != nil || saved.Type != event.Type || !saved.CreatedAt.Equal(event.CreatedAt) || !aiJSONEqual(saved.Data, event.Data) {
			return AIRun{}, ErrConflict
		}
		return run, nil
	}
	run = cloneAIRun(run)
	run.History = append(run.History, event)
	return run, nil
}

// Both objects already have sorted keys. JSONB may expand exponent-form numbers;
// compare exact numeric values without losing integer precision through float64.
func aiJSONEqual(left, right json.RawMessage) bool {
	a, b := json.NewDecoder(bytes.NewReader(left)), json.NewDecoder(bytes.NewReader(right))
	a.UseNumber()
	b.UseNumber()
	for {
		x, xerr := a.Token()
		y, yerr := b.Token()
		if xerr != nil || yerr != nil {
			return xerr == io.EOF && yerr == io.EOF
		}
		if number, ok := x.(json.Number); ok {
			other, ok := y.(json.Number)
			if !ok {
				return false
			}
			first, firstOK := new(big.Rat).SetString(string(number))
			second, secondOK := new(big.Rat).SetString(string(other))
			if !firstOK || !secondOK || first.Cmp(second) != 0 {
				return false
			}
		} else if x != y {
			return false
		}
	}
}

func aiNodeInput(run AIRun, actionKey string, input LogicGateNodeAssignmentInput) (LogicGateNodeAssignmentInput, error) {
	if run.HermesRunID == "" || strings.TrimSpace(actionKey) == "" || strings.TrimSpace(input.CreateNodeTitle) == "" {
		return LogicGateNodeAssignmentInput{}, ErrInvalid
	}
	input.CompanyID, input.ActorUserID = run.CompanyID, run.UserID
	input.IdempotencyKey = "ai:" + run.RunID + ":" + aiCreateNodeAction + ":" + actionKey
	return NormalizeLogicGateNodeAssignmentInput(input)
}

func aiCommittedNodeEvent(actionKey string, result LogicGateNodeAssignmentResult) AIHistoryEvent {
	data, _ := json.Marshal(map[string]any{"action_name": aiCreateNodeAction, "action_key": actionKey, "node_id": result.Node.NodeID, "logic_gate_id": result.Assignment.LogicGateID, "process_step_id": result.Assignment.ProcessStepID})
	return AIHistoryEvent{ID: "action:" + aiCreateNodeAction + ":" + actionKey, Type: "action_committed", CreatedAt: aiTime(time.Now()), Data: data}
}

func normalizeAIChat(chat AIChat) (AIChat, error) {
	chat.CompanyID, chat.UserID = cleanUUIDText(chat.CompanyID), cleanUUIDText(chat.UserID)
	chat.ChatID, chat.Name = strings.TrimSpace(chat.ChatID), strings.TrimSpace(chat.Name)
	if chat.CompanyID == "" || chat.UserID == "" || chat.ChatID == "" || !aiValidText(chat.ChatID+chat.Name) {
		return AIChat{}, ErrInvalid
	}
	if chat.CreatedAt.IsZero() {
		chat.CreatedAt = time.Now()
	}
	chat.CreatedAt = aiTime(chat.CreatedAt)
	return chat, nil
}

func normalizeAIMessage(companyID, userID string, message AIMessage) (AIMessage, error) {
	if (message.CompanyID != "" && message.CompanyID != companyID) || (message.UserID != "" && message.UserID != userID) {
		return AIMessage{}, ErrInvalid
	}
	message.CompanyID, message.UserID = companyID, userID
	if cleanUUIDText(companyID) == "" || cleanUUIDText(userID) == "" || message.MessageID <= 0 || message.ChatID == "" || (message.Role != "user" && message.Role != "ai") || message.CreatedAt.IsZero() || !aiValidText(message.ChatID+message.Content) {
		return AIMessage{}, ErrInvalid
	}
	if message.RunID != "" {
		message.RunID = cleanUUIDText(message.RunID)
		if message.RunID == "" {
			return AIMessage{}, ErrInvalid
		}
	}
	message.CreatedAt = aiTime(message.CreatedAt)
	return message, nil
}

func mergeAIMessage(saved, incoming AIMessage) (AIMessage, error) {
	if saved.ChatID != incoming.ChatID || saved.Role != incoming.Role || saved.Content != incoming.Content || !saved.CreatedAt.Equal(incoming.CreatedAt) || (saved.RunID != "" && incoming.RunID != "" && saved.RunID != incoming.RunID) {
		return AIMessage{}, ErrConflict
	}
	if saved.RunID == "" {
		saved.RunID = incoming.RunID
	}
	return saved, nil
}

var _ AIRepository = (*MemoryRepo)(nil)
var _ AIRepository = (*PostgresRepo)(nil)
