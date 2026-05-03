package domain

import "time"

type Node struct {
	CompanyID string `json:"company_id"`
	NodeID    string `json:"node_id"`
	// Title is the canonical public API field name for node text labels.
	Title            string    `json:"title"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
}

type NodeRelationship struct {
	CompanyID          string    `json:"company_id"`
	NodeRelationshipID string    `json:"node_relationship_id"`
	NodeIDA            string    `json:"node_id_a"`
	NodeIDB            string    `json:"node_id_b"`
	APosition          string    `json:"a_position"`
	BPosition          string    `json:"b_position"`
	CreatedTimestamp   time.Time `json:"created_timestamp"`
}

type NodeInformation struct {
	CompanyID        string    `json:"company_id"`
	InformationID    string    `json:"information_id"`
	NodeID           string    `json:"node_id"`
	Type             string    `json:"type"`
	Information      string    `json:"information"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type NodeProjection struct {
	CompanyID        string    `json:"company_id"`
	NodeID           string    `json:"node_id"`
	Type             string    `json:"type"`
	Information      string    `json:"information"`
	InformationID    string    `json:"information_id"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type NodeDetails struct {
	Node          Node               `json:"node"`
	Information   []NodeInformation  `json:"information"`
	Relationships []NodeRelationship `json:"relationships"`
}

type LogicGate struct {
	CompanyID        string    `json:"company_id"`
	LogicGateID      string    `json:"logic_gate_id"`
	Header           string    `json:"header"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
}

type LogicGateRelationship struct {
	CompanyID               string    `json:"company_id"`
	LogicGateRelationshipID string    `json:"logic_gate_relationship_id"`
	LogicGateIDA            string    `json:"logic_gate_id_a"`
	LogicGateIDB            string    `json:"logic_gate_id_b"`
	APosition               string    `json:"a_position"`
	BPosition               string    `json:"b_position"`
	CreatedTimestamp        time.Time `json:"created_timestamp"`
}

type LogicGateInformation struct {
	CompanyID        string    `json:"company_id"`
	InformationID    string    `json:"information_id"`
	LogicGateID      string    `json:"logic_gate_id"`
	Type             string    `json:"type"`
	Information      string    `json:"information"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type LogicGateProjection struct {
	CompanyID        string    `json:"company_id"`
	LogicGateID      string    `json:"logic_gate_id"`
	Type             string    `json:"type"`
	Information      string    `json:"information"`
	InformationID    string    `json:"information_id"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type LogicGateDetails struct {
	LogicGate     LogicGate               `json:"logic_gate"`
	Information   []LogicGateInformation  `json:"information"`
	Relationships []LogicGateRelationship `json:"relationships"`
}

type NodeMapPosition struct {
	CompanyID        string    `json:"company_id"`
	NodeID           string    `json:"node_id"`
	X                float64   `json:"x"`
	Y                float64   `json:"y"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type LogicGateMapPosition struct {
	CompanyID        string    `json:"company_id"`
	LogicGateID      string    `json:"logic_gate_id"`
	X                float64   `json:"x"`
	Y                float64   `json:"y"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type Operation struct {
	CompanyID      string     `json:"company_id"`
	OperationID    string     `json:"operation_id"`
	NodeID         *string    `json:"node_id,omitempty"`
	LogicGateID    *string    `json:"logic_gate_id,omitempty"`
	Status         string     `json:"status"`
	StartTimestamp time.Time  `json:"start_timestamp"`
	EndTimestamp   *time.Time `json:"end_timestamp,omitempty"`
}

type WorkspaceContextEvent struct {
	CompanyID      string    `json:"company_id"`
	WorkspaceID    string    `json:"workspace_id"`
	ContextID      string    `json:"context_id"`
	SourceModuleID string    `json:"source_module_id"`
	Sequence       int64     `json:"sequence"`
	UserActionType string    `json:"user_action_type"`
	PayloadJSON    string    `json:"payload_json"`
	CreatedAt      time.Time `json:"created_timestamp"`
}

type WorkspaceContextProjection struct {
	CompanyID        string    `json:"company_id"`
	WorkspaceID      string    `json:"workspace_id"`
	ContextID        string    `json:"context_id"`
	LastSequence     int64     `json:"last_sequence"`
	LastEventAt      time.Time `json:"last_event_timestamp"`
	LastPayloadJSON  string    `json:"last_payload_json"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}
