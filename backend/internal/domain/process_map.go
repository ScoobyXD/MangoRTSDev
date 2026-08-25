package domain

import "time"

const (
	ProcessMapResourceTypeFolder  = "company_explorer_folder"
	ProcessMapResourceTypeProcess = "logic_gate"
)

type ProcessMapResourceRef struct {
	ResourceType string `json:"resource_type"`
	ResourceID   string `json:"resource_id"`
}

type ProcessMapRoutePoint struct {
	X int `json:"x"`
	Y int `json:"y"`
}

type ProcessMapPlacement struct {
	CompanyID         string    `json:"company_id"`
	ResourceType      string    `json:"resource_type"`
	ResourceID        string    `json:"resource_id"`
	MapParentFolderID *string   `json:"map_parent_folder_id"`
	GridX             int       `json:"grid_x"`
	GridY             int       `json:"grid_y"`
	Revision          int64     `json:"revision"`
	CreatedTimestamp  time.Time `json:"created_timestamp"`
	UpdatedTimestamp  time.Time `json:"updated_timestamp"`
}

// ProcessMapLayerPlacement is deliberately sealed to the domain package. A
// restricted projection can therefore never acquire visible resource fields
// through a caller-defined implementation.
type ProcessMapLayerPlacement interface {
	isProcessMapLayerPlacement()
}

type ProcessMapVisiblePlacement struct {
	Restricted       bool      `json:"restricted"`
	ResourceType     string    `json:"resource_type"`
	ResourceID       string    `json:"resource_id"`
	Name             string    `json:"name"`
	GridX            int       `json:"grid_x"`
	GridY            int       `json:"grid_y"`
	Revision         int64     `json:"revision"`
	CreatedTimestamp time.Time `json:"created_timestamp"`
	UpdatedTimestamp time.Time `json:"updated_timestamp"`
}

func (ProcessMapVisiblePlacement) isProcessMapLayerPlacement() {}

type ProcessMapRestrictedPlacement struct {
	Restricted bool `json:"restricted"`
	GridX      int  `json:"grid_x"`
	GridY      int  `json:"grid_y"`
}

func (ProcessMapRestrictedPlacement) isProcessMapLayerPlacement() {}

type ResourceOperationalRelationship struct {
	CompanyID                         string                `json:"company_id"`
	ResourceOperationalRelationshipID string                `json:"resource_operational_relationship_id"`
	Source                            ProcessMapResourceRef `json:"source"`
	Target                            ProcessMapResourceRef `json:"target"`
	CreatedTimestamp                  time.Time             `json:"created_timestamp"`
}

type ProcessMapTrace struct {
	CompanyID                         string                 `json:"company_id"`
	ResourceOperationalRelationshipID string                 `json:"resource_operational_relationship_id"`
	RoutePoints                       []ProcessMapRoutePoint `json:"route_points"`
	Revision                          int64                  `json:"revision"`
	CreatedTimestamp                  time.Time              `json:"created_timestamp"`
	UpdatedTimestamp                  time.Time              `json:"updated_timestamp"`
}

type ProcessMapLayerTrace struct {
	ResourceOperationalRelationshipID string                 `json:"resource_operational_relationship_id"`
	Source                            ProcessMapResourceRef  `json:"source"`
	Target                            ProcessMapResourceRef  `json:"target"`
	RoutePoints                       []ProcessMapRoutePoint `json:"route_points"`
	Revision                          int64                  `json:"revision"`
	CreatedTimestamp                  time.Time              `json:"created_timestamp"`
	UpdatedTimestamp                  time.Time              `json:"updated_timestamp"`
}

type ProcessMapLayer struct {
	Kind     string `json:"kind"`
	FolderID string `json:"folder_id,omitempty"`
	Name     string `json:"name,omitempty"`
}

type ProcessMapLayerView struct {
	Layer      ProcessMapLayer            `json:"layer"`
	Placements []ProcessMapLayerPlacement `json:"placements"`
	Traces     []ProcessMapLayerTrace     `json:"traces"`
}
