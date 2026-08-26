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

type ProcessMapPathPoint struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type ProcessMapPlacement struct {
	CompanyID                 string    `json:"company_id"`
	ResourceType              string    `json:"resource_type"`
	ResourceID                string    `json:"resource_id"`
	PlacementIncarnationToken string    `json:"-"`
	MapParentFolderID         *string   `json:"map_parent_folder_id"`
	GridX                     int       `json:"grid_x"`
	GridY                     int       `json:"grid_y"`
	GridWidth                 int       `json:"grid_width"`
	GridHeight                int       `json:"grid_height"`
	Revision                  int64     `json:"revision"`
	CreatedTimestamp          time.Time `json:"created_timestamp"`
	UpdatedTimestamp          time.Time `json:"updated_timestamp"`
}

type ProcessMapBounds struct {
	MinX int `json:"min_x"`
	MinY int `json:"min_y"`
	MaxX int `json:"max_x"`
	MaxY int `json:"max_y"`
}

type ProcessMapScene struct {
	Bounds                *ProcessMapBounds `json:"bounds"`
	ProcessMapReadVersion int64             `json:"process_map_read_version"`
	TileSize              int               `json:"tile_size"`
	MinTileZoom           int               `json:"min_tile_zoom"`
	MaxTileZoom           int               `json:"max_tile_zoom"`
}

// ProcessMapTilePlacement is sealed so restricted projections cannot acquire
// visible resource fields through caller-defined implementations.
type ProcessMapTilePlacement interface {
	isProcessMapTilePlacement()
}

type ProcessMapPresentation string

const (
	ProcessMapPresentationWhole   ProcessMapPresentation = "whole"
	ProcessMapPresentationNormal  ProcessMapPresentation = "normal"
	ProcessMapPresentationEditing ProcessMapPresentation = "editing"
)

type ProcessMapVisiblePlacement struct {
	Restricted        bool                   `json:"restricted"`
	Presentation      ProcessMapPresentation `json:"presentation"`
	ResourceType      string                 `json:"resource_type"`
	ResourceID        string                 `json:"resource_id"`
	Name              string                 `json:"name,omitempty"`
	MapParentFolderID *string                `json:"map_parent_folder_id"`
	GridX             int                    `json:"grid_x"`
	GridY             int                    `json:"grid_y"`
	GridWidth         int                    `json:"grid_width"`
	GridHeight        int                    `json:"grid_height"`
	Revision          int64                  `json:"revision"`
	CreatedTimestamp  time.Time              `json:"created_timestamp"`
	UpdatedTimestamp  time.Time              `json:"updated_timestamp"`
	CanEdit           bool                   `json:"can_edit"`
}

func (ProcessMapVisiblePlacement) isProcessMapTilePlacement() {}

type ProcessMapRestrictedPlacement struct {
	Restricted bool `json:"restricted"`
	GridX      int  `json:"grid_x"`
	GridY      int  `json:"grid_y"`
}

func (ProcessMapRestrictedPlacement) isProcessMapTilePlacement() {}

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

type ProcessMapTileTrace struct {
	ResourceOperationalRelationshipID string                  `json:"resource_operational_relationship_id"`
	Presentation                      ProcessMapPresentation  `json:"presentation"`
	Source                            ProcessMapResourceRef   `json:"source"`
	Target                            ProcessMapResourceRef   `json:"target"`
	RoutePoints                       []ProcessMapRoutePoint  `json:"route_points"`
	PathFragments                     [][]ProcessMapPathPoint `json:"path_fragments"`
	Revision                          int64                   `json:"revision"`
	CreatedTimestamp                  time.Time               `json:"created_timestamp"`
	UpdatedTimestamp                  time.Time               `json:"updated_timestamp"`
}

type ProcessMapTile struct {
	Z                     int                       `json:"z"`
	X                     int                       `json:"x"`
	Y                     int                       `json:"y"`
	ProcessMapReadVersion int64                     `json:"process_map_read_version"`
	Placements            []ProcessMapTilePlacement `json:"placements"`
	Traces                []ProcessMapTileTrace     `json:"traces"`
}
