package store

import (
	"miraeopus/backend/internal/domain"
	"strings"
)

const ProcessWorkChangedEventType = "process.work.changed"

type ProcessStepCreateInput struct {
	CompanyID          string
	LogicGateID        string
	Name               string
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
	Step         *domain.ProcessStep                     `json:"step,omitempty"`
	Relationship *domain.ResourceOperationalRelationship `json:"relationship,omitempty"`
	Events       []domain.DomainEvent                    `json:"-"`
}

func processWorkChangedEvent(companyID, logicGateID, actorUserID string) DomainEventInput {
	return DomainEventInput{CompanyID: companyID, StreamType: workspaceDomainStreamType, StreamID: companyID, Type: ProcessWorkChangedEventType, ActorUserID: actorUserID, Payload: map[string]any{"company_id": companyID, "logic_gate_id": logicGateID, "resource_type": "logic_gate", "resource_id": logicGateID}}
}

func validProcessStepName(name string) bool { return strings.TrimSpace(name) != "" && len(name) <= 200 }

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
