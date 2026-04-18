package domain

import "time"

type Node struct {
	CompanyID        string    `json:"company_id"`
	NodeID           string    `json:"node_id"`
	Header           string    `json:"header"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
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

type LogicGate struct {
	CompanyID        string    `json:"company_id"`
	LogicGateID      string    `json:"logic_gate_id"`
	Header           string    `json:"header"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
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
