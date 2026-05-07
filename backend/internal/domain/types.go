package domain

import "time"

type User struct {
	UserID           string    `json:"user_id"`
	CognitoSubject   string    `json:"cognito_subject"`
	Email            string    `json:"email"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type Company struct {
	CompanyID        string    `json:"company_id"`
	Name             string    `json:"name"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type CompanyMembership struct {
	CompanyID        string    `json:"company_id"`
	UserID           string    `json:"user_id"`
	Role             string    `json:"role"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type Node struct {
	CompanyID string `json:"company_id"`
	NodeID    string `json:"node_id"`
	// Title is the canonical public API field name for node text labels.
	Title            string    `json:"title"`
	Status           *string   `json:"status"`
	StatusColor      *string   `json:"status_color"`
	DueDate          *string   `json:"due_date"`
	Priority         *int      `json:"priority"`
	AssigneeUserID   *string   `json:"assignee_user_id"`
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

type CompanyExplorerFolder struct {
	CompanyID        string    `json:"company_id"`
	FolderID         string    `json:"folder_id"`
	ParentFolderID   *string   `json:"parent_folder_id,omitempty"`
	FolderKind       string    `json:"folder_kind"`
	Name             string    `json:"name"`
	Position         int       `json:"position"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type CompanyExplorerFolderItem struct {
	CompanyID        string    `json:"company_id"`
	FolderID         string    `json:"folder_id"`
	ItemType         string    `json:"item_type"`
	ItemID           string    `json:"item_id"`
	Position         int       `json:"position"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
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

type KanbanBoard struct {
	CompanyID        string    `json:"company_id"`
	BoardID          string    `json:"board_id"`
	LogicGateID      *string   `json:"logic_gate_id"`
	Title            string    `json:"title"`
	Position         int       `json:"position"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type KanbanColumn struct {
	CompanyID        string    `json:"company_id"`
	BoardID          string    `json:"board_id"`
	ColumnID         string    `json:"column_id"`
	Title            string    `json:"title"`
	Position         int       `json:"position"`
	WidthPx          int       `json:"width_px"`
	HeightPx         int       `json:"height_px"`
	ItemColor        string    `json:"item_color"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

type KanbanCard struct {
	CompanyID           string    `json:"company_id"`
	BoardID             string    `json:"board_id"`
	CardID              string    `json:"card_id"`
	ColumnID            string    `json:"column_id"`
	NodeID              string    `json:"node_id"`
	LogicGateID         *string   `json:"logic_gate_id"`
	NodeTitle           string    `json:"node_title"`
	DescriptionSnapshot string    `json:"description_snapshot"`
	IsIssue             bool      `json:"is_issue"`
	Position            int       `json:"position"`
	CreatedTimestamp    time.Time `json:"created_timestamp"`
	UpdatedTimestamp    time.Time `json:"updated_timestamp"`
}
