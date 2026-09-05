package store

import (
	"encoding/json"
	"sort"
	"strings"

	"miraeopus/backend/internal/domain"
)

const ProcessWorkChangedEventType = "process.work.changed"

const processStepPositionStride = 1000
const maxPostgresInteger = 2147483647

type ProcessStepCreateInput struct {
	CompanyID          string
	LogicGateID        string
	Name               string
	BodyJSON           json.RawMessage
	AfterProcessStepID *string
	ActorUserID        string
}
type ProcessStepUpdateInput struct {
	CompanyID     string
	LogicGateID   string
	ProcessStepID string
	Name          *string
	Position      *int
	ActorUserID   string
}
type ProcessStepDeleteInput struct {
	CompanyID     string
	LogicGateID   string
	ProcessStepID string
	ActorUserID   string
}
type ProcessStepRelationshipInput struct {
	CompanyID   string
	LogicGateID string
	Source      domain.ProcessMapResourceRef
	Target      domain.ProcessMapResourceRef
	ActorUserID string
}
type ProcessStepRelationshipDeleteInput struct {
	CompanyID      string
	LogicGateID    string
	RelationshipID string
	ActorUserID    string
}
type ProcessStepMutationResult struct {
	Step            *domain.ProcessStep                     `json:"step,omitempty"`
	Relationship    *domain.ResourceOperationalRelationship `json:"relationship,omitempty"`
	PositionUpdates map[string]int                          `json:"position_updates,omitempty"`
	Events          []domain.DomainEvent                    `json:"-"`
}

func processWorkChangedEvent(companyID, logicGateID, actorUserID string) DomainEventInput {
	return DomainEventInput{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, Type: ProcessWorkChangedEventType, ActorUserID: actorUserID, Payload: map[string]any{"company_id": companyID, "logic_gate_id": logicGateID, "resource_type": "logic_gate", "resource_id": logicGateID}}
}

func validProcessStepName(name string) bool { return strings.TrimSpace(name) != "" && len(name) <= 200 }

func normalizeProcessStepBody(body json.RawMessage) (json.RawMessage, error) {
	if body == nil {
		return emptyEditorTextboxBody(), nil
	}
	document, annotations, err := decodeEditorTextboxBody(body)
	if err != nil {
		return nil, err
	}
	body, err = encodeEditorTextboxBody(document, annotations)
	if err == nil && EditorOwnerTextLimitExceeded(0, int64(len(body))) {
		return nil, ErrEditorOwnerTextLimit
	}
	return body, err
}

func cloneProcessStep(step domain.ProcessStep) domain.ProcessStep {
	step.BodyJSON = append(json.RawMessage(nil), step.BodyJSON...)
	return step
}

func planProcessStepInsertion(steps []domain.ProcessStep, afterProcessStepID *string) (int, map[string]int, bool) {
	ordered := append([]domain.ProcessStep(nil), steps...)
	sort.Slice(ordered, func(i, j int) bool {
		if ordered[i].Position != ordered[j].Position {
			return ordered[i].Position < ordered[j].Position
		}
		return ordered[i].ProcessStepID < ordered[j].ProcessStepID
	})
	insertionIndex := len(ordered)
	if afterProcessStepID != nil {
		insertionIndex = -1
		for index, step := range ordered {
			if step.ProcessStepID == *afterProcessStepID {
				insertionIndex = index + 1
				break
			}
		}
		if insertionIndex < 0 {
			return 0, nil, false
		}
	}
	if len(ordered)+1 > maxPostgresInteger/processStepPositionStride {
		return 0, nil, false
	}
	if insertionIndex == len(ordered) {
		if len(ordered) == 0 {
			return processStepPositionStride, nil, true
		}
		lastPosition := ordered[len(ordered)-1].Position
		if lastPosition <= maxPostgresInteger-processStepPositionStride {
			return lastPosition + processStepPositionStride, nil, true
		}
	} else {
		leftPosition, rightPosition := ordered[insertionIndex-1].Position, ordered[insertionIndex].Position
		if rightPosition-leftPosition > 1 {
			return leftPosition + (rightPosition-leftPosition)/2, nil, true
		}
	}
	positionUpdates := map[string]int{}
	for index, step := range ordered {
		slot := index
		if index >= insertionIndex {
			slot++
		}
		position := (slot + 1) * processStepPositionStride
		if step.Position != position {
			positionUpdates[step.ProcessStepID] = position
		}
	}
	return (insertionIndex + 1) * processStepPositionStride, positionUpdates, true
}

func validProcessStepRelationship(input ProcessStepRelationshipInput) bool {
	return input.CompanyID != "" && input.LogicGateID != "" && input.Source.ResourceType == "process_step" && input.Target.ResourceType == "process_step" && input.Source.ResourceID != "" && input.Target.ResourceID != "" && input.Source.ResourceID != input.Target.ResourceID
}

func processStepIDForMove(current *string, currentGate, targetGate string, value *string, set bool) *string {
	if set {
		return normalizeOptionalStringPointer(value)
	}
	if currentGate != targetGate {
		return nil
	}
	return cloneStringPointer(current)
}
