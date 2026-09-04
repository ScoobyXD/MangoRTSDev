package domain

// ProcessStepMapLayout contains presentation only. Steps and connections keep
// their identities and ownership in process_steps and operational relationships.
type ProcessStepMapLayout struct {
	CompanyID   string                    `json:"-"`
	LogicGateID string                    `json:"-"`
	Revision    int64                     `json:"revision"`
	Steps       []ProcessStepMapRectangle `json:"steps"`
	Routes      []ProcessStepMapRoute     `json:"routes"`
}

type ProcessStepMapRectangle struct {
	ProcessStepID string `json:"process_step_id"`
	X             int    `json:"x"`
	Y             int    `json:"y"`
	Width         int    `json:"width"`
	Height        int    `json:"height"`
}

type ProcessStepMapRoute struct {
	ResourceOperationalRelationshipID string                 `json:"resource_operational_relationship_id"`
	Points                            []ProcessMapRoutePoint `json:"points"`
}
